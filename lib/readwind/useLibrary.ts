"use client";
import { validateFile } from "./file-validation";
import {bookAssets,privateBookAssets,verifiedAsset,catalogMetadataUpdate} from './catalog';
import {book as catalogBookSchema} from './schemas';
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { ReadwindDB, deviceId, encodeFile, storedBlob } from "./db";
import type { Pending } from "./db";
import type { Book, Annotation, Anchor, Settings, Progress } from "./types";
import { defaults } from "./types";
import {addPaceSample,mergeReadingPace,readingSpeed,validPaceSample} from './reading-pace';
import {addActivity,mergeReadingLog} from './reading-log';
import type {LogEntry} from './reading-log';
import { loadClassics } from "./classics";
import type { ImportJob, ImportJobInput } from "./import-jobs";
export type { AuthClient } from "./auth";
import type { AuthClient } from "./auth";
export type SyncConflict = {
  owner:string;
  bookId: string;
  local: Progress;
  remote: { at: Anchor; revision: number; deviceId: string };
};
type LibraryPage = {
  books?: Book[];
  progress?: Progress[];
  annotations?: Annotation[];
  settings?: Settings | null;
  nextOffset?: number | null;
};
function bookFileIds(book: Book) {
  return bookAssets(book);
}
async function responseError(response: Response, fallback: string) {
  const data = (await response.json().catch(() => null)) as {
    error?: string;
  } | null;
  return data?.error || fallback;
}
export function useLibrary(userId: string, auth: AuthClient | null) {
  const db = useMemo(() => new ReadwindDB(userId), [userId]);
  const guest = userId === "preview";
  const [status, setStatus] = useState(
    guest ? "Saved on this device" : "Connecting…",
  );
  const [ready, setReady] = useState(false);
  const [conflict, setConflict] = useState<SyncConflict | null>(null);
  const running = useRef(false),
    alive = useRef(true),
    conflicted = useRef<string | null>(null);
  const syncAgain = useRef<() => void>(() => {});
  const lifetime = useRef(new AbortController());
  const [optimisticDeletes,setOptimisticDeletes]=useState<{owner:string;ids:Set<string>}>({owner:db.name,ids:new Set()});
  const storedBooks = useLiveQuery(() => db.transaction('r',[db.books,db.pending],async()=>{
    const deleted=new Set((await db.pending.where('entity').equals('delete-book').toArray()).map(p=>p.bookId));
    return {owner:db.name,books:(await db.books.toArray()).filter(b=>!deleted.has(b.id))};
  }), [db]);
  const books=useMemo(()=>storedBooks?.owner===db.name?storedBooks.books.filter(b=>optimisticDeletes.owner!==db.name || !optimisticDeletes.ids.has(b.id)):[],[storedBooks,optimisticDeletes,db]);
  const annotationSnapshot =
    useLiveQuery(
      async() => ({owner:db.name,values:await db.annotations.filter((a) => !a.deleted).toArray()}),
      [db],
    );
  const annotations=annotationSnapshot?.owner===db.name?annotationSnapshot.values:[];
  const progressSnapshot = useLiveQuery(async() => ({owner:db.name,values:await db.progress.toArray()}), [db]);
  const progress=progressSnapshot?.owner===db.name?progressSnapshot.values:[];
  const preferences = useLiveQuery(async() => ({owner:db.name,value:(await db.preferences.get("reader"))?.value}), [db]);
  const settings = preferences?.owner===db.name?preferences.value||defaults:defaults;
  const api = useCallback(
    async (path: string, init?: RequestInit) => {
      if (!auth || !alive.current || lifetime.current.signal.aborted) throw new Error("Sign in to sync.");
      return fetch(path, { ...init, signal:lifetime.current.signal, credentials: "same-origin" });
    },
    [auth,lifetime],
  );
  const cancelUpload = useCallback(
    async (id: string) => {
      await api(`/api/files?id=${encodeURIComponent(id)}`, {
        method: "DELETE",
      }).catch(() => {});
    },
    [api],
  );
  const uploadFile = useCallback(
    async (id: string, blob: Blob) => {
      // Upload straight to object storage. Routing the bytes through a Vercel
      // function hits its 4.5 MB request limit for ordinary book PDFs.
      const signed = await api("/api/files/sign", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, type: blob.type, bytes: blob.size }),
      });
      if (!signed.ok)
        throw new Error(
          await responseError(signed, "Could not prepare the file upload."),
        );
      const grant = (await signed.json()) as {
        url?: string;
        headers?: Record<string, string>;
      };
      if (!grant.url) throw new Error("Could not prepare the file upload.");
      let stored: Response;
      try {
        stored = await fetch(grant.url, {
          method: "PUT",
          headers: grant.headers,
          body: blob,
          signal: lifetime.current.signal,
        });
      } catch (error) {
        if (lifetime.current.signal.aborted) throw error;
        await cancelUpload(id);
        throw new Error(
          "Could not upload the book file. Check your connection and retry.",
        );
      }
      if (!stored.ok) {
        await cancelUpload(id);
        throw new Error(
          stored.status === 413
            ? "This file is larger than 20 MB."
            : "Could not upload the book file. Please retry.",
        );
      }
      const complete = await api("/api/files/complete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, type: blob.type, bytes: blob.size }),
      });
      if (!complete.ok)
        throw new Error(
          await responseError(complete, "Could not verify the uploaded file."),
        );
    },
    [api, cancelUpload],
  );
  const putChange = async (change: Pending) => db.pending.put(change);
  const sync = useCallback(async (): Promise<boolean> => {
    if (
      guest ||
      !auth ||
      running.current ||
      !navigator.onLine ||
      !alive.current || lifetime.current.signal.aborted
    )
      return false;
    running.current = true;
    const signal=lifetime.current.signal,active=()=>alive.current&&!signal.aborted;
    setStatus("Syncing…");
    try {
      const pending = await db.pending.toArray();
      const processedDeletes=new Set<string>();
      for (const change of pending.sort(
        (a, b) => (b.entity==='delete-book'?2:b.entity==='book'?1:0)-(a.entity==='delete-book'?2:a.entity==='book'?1:0),
      )) {
        if(!active())return false;
        // Checked before any await: resolving a conflict mid-loop must not let a stale change through.
        if (change.entity === 'progress' && conflicted.current) continue;
        if(change.bookId && change.entity!=='delete-book' && await db.pending.get(`delete-book:${change.bookId}`))continue;
        if(change.entity==='delete-book'){
          const response=await api(`/api/library?id=${encodeURIComponent(change.bookId!)}`,{method:'DELETE',headers:{'Content-Type':'application/json'},body:JSON.stringify(change.value)});
          if(!response.ok && response.status!==404)throw new Error('Book removed locally · deletion will retry when sync is available.');
          processedDeletes.add(change.id);
          // Keep the durable marker until a fresh pull confirms absence.
          continue;
        }
        if (change.entity === "book") {
          const book = change.value as Book;
          if(change.restoreDeleted){
            const state=await api(`/api/library?deletion=${encodeURIComponent(book.id)}`);if(!state.ok)throw new Error('Could not check restoration status.');
            if(((await state.json()) as {cleanupPending?:boolean}).cleanupPending)throw new Error('Deletion cleanup is still pending · restoration will retry.');
          }
          const blobIds = privateBookAssets(book);
          const uploaded = new Set(change.uploaded || []);
          for (const id of new Set(change.uploadFiles === false ? [] : blobIds)) {
            if(!active())return false;
            if(await db.pending.get(`delete-book:${book.id}`))break;
            if (uploaded.has(id)) continue;
            const file = await db.blobs.get(id);
            if (!file) throw new Error("An attached file is missing.");
            await uploadFile(id, storedBlob(file));
            // Remember each stored file so a retry never re-uploads a large PDF
            // or burns through the upload rate limit a second time.
            uploaded.add(id);
            change.uploaded = [...uploaded];
            await db.pending.update(change.id, { uploaded: [...uploaded] });
          }
          if(!active())return false;
          if(await db.pending.get(`delete-book:${book.id}`))continue;
          const response = await api(`/api/library${change.restoreDeleted?'?restore=true':''}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(book.catalog?catalogMetadataUpdate(book):book),
          });
          if(response.status===410){
            await db.transaction('rw',[db.books,db.progress,db.annotations,db.pending],async()=>{
              if(await db.pending.get(`delete-book:${book.id}`))return;
              const latest=await db.pending.get(change.id);if(latest?.restoreDeleted || latest && JSON.stringify(latest.value)!==JSON.stringify(change.value))return;
              await db.books.delete(book.id);await db.progress.delete(book.id);await db.annotations.where('bookId').equals(book.id).delete();await db.pending.filter(p=>p.bookId===book.id).delete();
            });continue;
          }
          if (!response.ok) throw new Error("Could not save the book.");
        } else {
          const response = await api("/api/sync", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(change),
          });
          const data = (await response.json()) as {
            current?: SyncConflict["remote"];
            error?: string;
            revision: number;
          };
          if (response.status === 409 && data.current) {
            conflicted.current = change.id;
            setConflict({
              owner:db.name,
              bookId: change.bookId!,
              local: change.value as Progress,
              remote: data.current,
            });
            continue;
          }
          if (response.status === 404) {
            // The book was deleted on another device. Discard this stale
            // change; the pull below removes the local copy and its notes.
            await db.pending.delete(change.id);
            continue;
          }
          if (!response.ok)
            throw new Error(data.error || "Could not sync changes.");
          if (!active()) return false;
          if (change.entity === "progress") {
            await db.transaction("rw", [db.progress, db.pending], async () => {
              const current = await db.progress.get(change.bookId!);
              const queued = await db.pending.get(change.id);
              if (current)
                await db.progress.put({ ...current, revision: data.revision });
              if (
                queued &&
                JSON.stringify(queued.value) !== JSON.stringify(change.value)
              )
                await db.pending.put({
                  ...queued,
                  value: {
                    ...(queued.value as Progress),
                    revision: data.revision,
                  },
                });
            });
          }
        }
        if (!active()) return false;
        await db.transaction("rw", db.pending, async () => {
          const latest = await db.pending.get(change.id);
          if (
            latest &&
            JSON.stringify(latest.value) === JSON.stringify(change.value)
          )
            await db.pending.delete(change.id);
          else if (change.entity === "progress" && latest) {
            const old = change.value as Progress,
              cur = latest.value as Progress;
            if (
              JSON.stringify({ ...cur, revision: old.revision }) ===
              JSON.stringify(old)
            )
              await db.pending.delete(change.id);
          }
        });
      }
      const data: {
        books: Book[];
        progress: Progress[];
        annotations: Annotation[];
        settings: Settings | null;
      } = { books: [], progress: [], annotations: [], settings: null };
      let offset: number | null = 0;
      while (offset !== null) {
        if(!active())return false;
        const response = await api(`/api/library?offset=${offset}`);
        if (!response.ok) throw new Error("Could not load your library.");
        const page = (await response.json()) as LibraryPage;
        data.books.push(...(page.books || []));
        data.annotations.push(...(page.annotations || []));
        // Progress and settings arrive with the first page only.
        if (page.progress) data.progress = page.progress;
        if (page.settings !== undefined) data.settings = page.settings;
        const next = page.nextOffset;
        // Also stops on responses that predate pagination or omit the cursor.
        offset = typeof next === "number" && next > offset ? next : null;
      }
      if (!active()) return false;
      await db.transaction(
        "rw",
        [
          db.books,
          db.progress,
          db.annotations,
          db.preferences,
          db.pending,
          db.blobs,
        ],
        async () => {
          const changes = await db.pending.toArray(),
            ids = new Set(changes.map((p) => p.id)),
            deleting = new Set(changes.filter(p=>p.entity==='delete-book').map(p=>p.bookId)),
            remoteBooks = new Set(data.books.filter(b=>!deleting.has(b.id)).map((b) => b.id));
          for (const b of data.books)
            if (!ids.has(`book:${b.id}`) && !deleting.has(b.id)) await db.books.put(b);
          for (const p of data.progress)
            if (!ids.has(`progress:${p.bookId}`) && remoteBooks.has(p.bookId))
              await db.progress.put({ ...p, updatedAt: Number(p.updatedAt) });
          for (const a of data.annotations)
            if (!ids.has(`annotation:${a.id}`) && remoteBooks.has(a.bookId))
              await db.annotations.put(a);
          if (data.settings && !ids.has("settings"))
          {
            const local = (await db.preferences.get("reader"))?.value;
            await db.preferences.put({
              id: "reader",
              value: { ...defaults, ...data.settings, readingPace:mergeReadingPace(local?.readingPace,data.settings.readingPace), readingLog:mergeReadingLog(local?.readingLog,data.settings.readingLog) },
            });
          }
          // The account is authoritative for books. Remove copies deleted on
          // another device, with their notes and position, unless this device
          // still has an unsent change for that book.
          for (const b of await db.books.toArray()) {
            if (remoteBooks.has(b.id) || ids.has(`book:${b.id}`)) continue;
            await db.books.delete(b.id);
            await db.progress.delete(b.id);
            await db.annotations.where("bookId").equals(b.id).delete();
            await db.pending
              .filter(
                (change) =>
                  change.bookId === b.id && change.id !== `book:${b.id}`,
              )
              .delete();
          }
          const live = new Set((await db.books.toArray()).map((b) => b.id));
          for (const p of await db.progress.toArray())
            if (!live.has(p.bookId)) await db.progress.delete(p.bookId);
          for (const a of await db.annotations.toArray())
            if (!live.has(a.bookId)) await db.annotations.delete(a.id);
          const used = new Set((await db.books.toArray()).flatMap(bookFileIds));
          const unused=(await db.blobs.toCollection().primaryKeys()).filter(id=>!used.has(id));
          if(unused.length)await db.blobs.bulkDelete(unused);
          for(const change of changes.filter(p=>p.entity==='delete-book'))if(processedDeletes.has(change.id)&&!data.books.some(b=>b.id===change.bookId))await db.pending.delete(change.id);
        },
      );
      const remaining = await db.pending.count();
      if (alive.current)
        setStatus(
          conflicted.current
            ? "Choose a reading position"
            : remaining ? "Saving…" : "All changes synced",
        );
      // Edits can be queued while a request is in flight. Drain them promptly;
      // never acknowledge a snapshot as though it included these newer edits.
      if (remaining && active() && (await db.pending.toArray()).some(p=>p.entity!=='progress'||!conflicted.current))
        setTimeout(() => syncAgain.current(), 0);
      return true;
    } catch (e) {
      if (alive.current)
        setStatus(
          navigator.onLine
            ? (e as Error).message
            : "Offline · saved on this device",
        );
      return false;
    } finally {
      running.current = false;
      if (alive.current) setReady(true);
    }
  }, [db, guest, auth, api, uploadFile,lifetime]);
  useEffect(() => { syncAgain.current = () => void sync(); }, [sync]);
  useEffect(() => {
    alive.current = true;
    if (lifetime.current.signal.aborted) lifetime.current = new AbortController();
    (async () => {
      await db.open();
      if (guest) {
        // Remove one-paragraph sample excerpts created by earlier builds.
        // Guests otherwise start with an empty shelf and can add the
        // public-domain classics explicitly.
        const legacy = await db.books
          .filter((b) => b.id.startsWith("sample-"))
          .toArray();
        if (legacy.length) {
          const ids = legacy.map((b) => b.id);
          await db.books.bulkDelete(ids);
          await db.progress.bulkDelete(ids);
          await db.annotations
            .filter((a) => a.id.startsWith("sample-highlight-"))
            .delete();
        }
      } else {
        // The account is the source of truth; do not invent starter books.
        await sync();
      }
      setReady(true);
      navigator.storage?.persist().catch(() => {});
    })().catch((e) => {
      setStatus(e.message);
      setReady(true);
    });
    const id = setInterval(() => {
      if (document.visibilityState === "visible") void sync();
    }, 12000);
    const wake = () => {
      if (document.visibilityState === "visible") void sync();
    };
    window.addEventListener("online", sync);
    window.addEventListener("focus", wake);
    document.addEventListener("visibilitychange", wake);
    const offline = () => setStatus("Offline · saved on this device");
    window.addEventListener("offline", offline);
    return () => {
      alive.current = false;
      lifetime.current.abort();
      clearInterval(id);
      window.removeEventListener("online", sync);
      window.removeEventListener("focus", wake);
      document.removeEventListener("visibilitychange", wake);
      window.removeEventListener("offline", offline);
      // A development refresh or Strict Mode may immediately restart this
      // effect with the same connection. Close only after a real unmount.
      setTimeout(() => {
        if (!alive.current) db.close();
      }, 1000);
    };
  }, [db, sync, guest, userId]);
  // Imports run in the browser that started them; other devices only see their progress.
  const [imports, setImports] = useState<ImportJob[]>([]);
  // A poll already in flight must not bring back a card that was just dismissed.
  const dismissed = useRef(new Set<string>());
  const refreshImports = useCallback(async () => {
    if (guest || !auth || !navigator.onLine) return;
    try {
      const response = await api("/api/imports");
      if (!response.ok) return;
      const data = (await response.json()) as { imports?: ImportJob[] };
      if (alive.current) setImports((data.imports || []).filter(job => !dismissed.current.has(job.id)));
    } catch {
      // Mirroring is best-effort; the shelf works without it.
    }
  }, [api, auth, guest, alive]);
  const watching = imports.length > 0;
  useEffect(() => {
    const first = setTimeout(() => void refreshImports(), 0);
    const id = setInterval(() => {
      if (document.visibilityState === "visible") void refreshImports();
    }, watching ? 4000 : 20000);
    const wake = () => {
      if (document.visibilityState === "visible") void refreshImports();
    };
    window.addEventListener("focus", wake);
    document.addEventListener("visibilitychange", wake);
    return () => {
      clearTimeout(first);
      clearInterval(id);
      window.removeEventListener("focus", wake);
      document.removeEventListener("visibilitychange", wake);
    };
  }, [refreshImports, watching]);
  const reportImport = useCallback(
    async (job: Omit<ImportJobInput, "deviceId">) => {
      if (guest || !auth) return;
      const body: ImportJobInput = { ...job, deviceId: deviceId() };
      dismissed.current.delete(body.id);
      setImports(old => [{ ...body, age: 0 }, ...old.filter(item => item.id !== body.id)]);
      try {
        await api("/api/imports", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
      } catch {
        // The import itself continues locally either way.
      }
    },
    [api, auth, guest],
  );
  const clearImport = useCallback(
    async (id: string) => {
      dismissed.current.add(id);
      setImports(old => old.filter(item => item.id !== id));
      if (guest || !auth) return;
      await api(`/api/imports?id=${encodeURIComponent(id)}`, { method: "DELETE" }).catch(() => {});
    },
    [api, auth, guest],
  );
  const saveProgress = async (
    bookId: string,
    at: Anchor,
    wordsRead: number,
  ) => {
    await db.transaction(
      "rw",
      [db.progress, db.pending, db.books],
      async () => {
        if(!await db.books.get(bookId))return;
        const current = await db.progress.get(bookId);
        const value: Progress = {
          bookId,
          at,
          wordsRead: Math.max(current?.wordsRead || 0, wordsRead),
          revision: current?.revision || 0,
          deviceId: deviceId(),
          updatedAt: Date.now(),
        };
        await db.progress.put(value);
        if (!guest)
          await putChange({
            id: `progress:${bookId}`,
            entity: "progress",
            bookId,
            value,
          });
        await db.books.update(bookId, { lastOpenedAt: Date.now() });
      },
    );
    if (!guest)
      setStatus(
        navigator.onLine ? "Saving…" : "Offline · saved on this device",
      );
    void sync();
  };
  const saveAnnotation = async (a: Annotation) => {
    const value = { ...a, updatedAt: Date.now() };
    await db.transaction("rw", [db.books,db.annotations, db.pending], async () => {
      if(!await db.books.get(a.bookId))return;
      await db.annotations.put(value);
      if (!guest)
        await putChange({
          id: `annotation:${a.id}`,
          entity: "annotation",
          bookId: a.bookId,
          value,
        });
    });
    void sync();
  };
  const saveSettings = async (value: Settings) => {
    await db.transaction("rw", [db.preferences, db.pending], async () => {
      const current = await db.preferences.get("reader");
      value = {...value,readingPace:mergeReadingPace(current?.value.readingPace,value.readingPace),readingLog:mergeReadingLog(current?.value.readingLog,value.readingLog)};
      await db.preferences.put({ id: "reader", value });
      if (!guest)
        await putChange({ id: "settings", entity: "settings", value });
    });
    void sync();
  };
  const recordReading = async (words:number,seconds:number) => {
    if(!validPaceSample(words,seconds))return;
    await db.transaction("rw",[db.preferences,db.pending],async()=>{
      const current=(await db.preferences.get("reader"))?.value || defaults;
      const pace=addPaceSample(current.readingPace || {},deviceId(),words,seconds);
      if(pace===current.readingPace)return;
      const value={...current,readingPace:pace};
      await db.preferences.put({id:"reader",value});
      if(!guest)await putChange({id:"settings",entity:"settings",value});
    });
    void sync();
  };
  /** Written the moment a page is read, so the streak never waits on a sync. */
  const recordActivity = async (credit:LogEntry) => {
    await db.transaction("rw",[db.preferences,db.pending],async()=>{
      const current=(await db.preferences.get("reader"))?.value || defaults;
      const value={...current,readingLog:addActivity(current.readingLog || {},deviceId(),credit)};
      await db.preferences.put({id:"reader",value});
      if(!guest)await putChange({id:"settings",entity:"settings",value});
    });
    void sync();
  };
  const addBook = async (
    book: Book,
    files: { id: string; blob: Blob }[] = [],
    restoreDeleted=false,
  ) => {
    const encoded = await Promise.all(files.map(encodeFile));
    await db.transaction("rw", [db.books, db.blobs, db.pending], async () => {
      const deleted=await db.pending.get(`delete-book:${book.id}`);
      restoreDeleted ||= !!deleted;
      await db.pending.delete(`delete-book:${book.id}`);
      await db.books.put(book);
      if (encoded.length) await db.blobs.bulkPut(encoded);
      if (!guest)
        await putChange({
          id: `book:${book.id}`,
          entity: "book",
          bookId: book.id,
          value: book,
          restoreDeleted,
        });
    });
    if(alive.current)setOptimisticDeletes(old=>({owner:db.name,ids:new Set([...(old.owner===db.name?old.ids:[])].filter(id=>id!==book.id))}));
    void sync();
  };
  /**
   * Saves metadata-only edits (cover, reading mode) without re-uploading the
   * files that are already attached to the book.
   */
  const saveBook = async (
    book: Book,
    files: { id: string; blob: Blob }[] = [],
  ) => {
    const encoded = await Promise.all(files.map(encodeFile));
    await db.transaction("rw", [db.books, db.blobs, db.pending], async () => {
      if(!await db.books.get(book.id) || await db.pending.get(`delete-book:${book.id}`))return;
      await db.books.put(book);
      if (encoded.length) await db.blobs.bulkPut(encoded);
      if (!guest) {
        const queued = await db.pending.get(`book:${book.id}`);
        const incoming = new Set(files.map((file) => file.id));
        const uploaded = new Set(queued?.uploaded || []);
        // A queued add still has to upload its original attachments. Once the
        // book is known remotely, skip files that are already stored there.
        if (!queued || queued.uploadFiles === false)
          for (const id of bookFileIds(book))
            if (!incoming.has(id)) uploaded.add(id);
        await db.pending.put({
          id: `book:${book.id}`,
          entity: "book",
          bookId: book.id,
          value: book,
          uploadFiles: true,
          uploaded: [...uploaded],
        });
      }
    });
    void sync();
  };
  const saveReadingMode = async (book: Book, readingMode: 'original'|'reflow') => {
    await db.transaction('rw', [db.books,db.pending], async()=>{
      if(!await db.books.get(book.id) || await db.pending.get(`delete-book:${book.id}`))return;
      const value={...book,readingMode};
      await db.books.put(value);
      if(!guest){
        const queued=await db.pending.get(`book:${book.id}`);
        await db.pending.put({id:`book:${book.id}`,entity:'book',bookId:book.id,value,uploadFiles:queued ? queued.uploadFiles !== false : false,uploaded:queued?.uploaded});
      }
    });
    void sync();
  };
  const loadBlob = useCallback(
    async (id: string) => {
      let file = await db.blobs.get(id);
      if(!file){
        const shared=(await db.books.toArray()).flatMap(b=>b.catalog?.assets||[]).find(a=>a.id===id);
        if(shared){const blob=await verifiedAsset(await fetch(`/api/catalog/assets/${encodeURIComponent(id)}`,{signal:lifetime.current.signal}),shared);if(!alive.current||lifetime.current.signal.aborted)throw new Error('Account changed.');file=await encodeFile({id,blob});await db.blobs.put(file);}
      }
      if (!file && !guest) {
        const r = await api(`/api/files?id=${encodeURIComponent(id)}`);
        if (!r.ok) throw new Error("File unavailable. Connect to download it.");
        const bytes = new Uint8Array(await r.arrayBuffer());
        const type = r.headers.get("x-readwind-file-type") || r.headers.get("content-type") || "";
        validateFile(bytes,type);
        file = await encodeFile({id,blob:new Blob([bytes],{type})});
        await db.blobs.put(file);
      }
      if (!file) return undefined;
      const blob = storedBlob(file);
      validateFile(new Uint8Array(await blob.slice(0,12).arrayBuffer()),blob.type);
      return blob;
    },
    [db, guest, api],
  );
  const resolveConflict = async (useLocal: boolean) => {
    if (!conflict || conflict.owner!==db.name) return;
    const c = conflict;
    if (useLocal) {
      await db.transaction('rw', [db.progress, db.pending], async () => {
        const latest = await db.progress.get(c.bookId);
        const value = { ...(latest || c.local), revision: c.remote.revision };
        await db.progress.put(value);
        await db.pending.put({id: `progress:${c.bookId}`, entity: 'progress', bookId: c.bookId, value});
      });
    } else {
      await db.transaction('rw', [db.progress, db.pending], async () => {
        await db.pending.delete(`progress:${c.bookId}`);
        await db.progress.put({ ...c.local, ...c.remote });
      });
    }
    conflicted.current = null;
    setConflict(null);
    void sync();
  };
  const addCatalogBook = async (
    editionId: string,
    onProgress?: (percent: number) => void,
  ) => {
    const currentLifetime = lifetime.current,
      check = () => {
        if (!alive.current || currentLifetime.signal.aborted)
          throw new Error("Account changed. Please retry.");
      };
    const response = guest
      ? await fetch(`/api/catalog/${encodeURIComponent(editionId)}?content=1`, {
          signal: currentLifetime.signal,
        })
      : await api(
          `/api/catalog/${encodeURIComponent(editionId)}/add?restore=true`,
          { method: "POST" },
        );
    if (!response.ok)
      throw new Error(
        await responseError(response, "Could not add this book."),
      );
    const data = (await response.json()) as { book: Book },
      book = catalogBookSchema.parse(data.book) as Book;
    check();
    if (!book.catalog || book.catalog.editionId !== editionId)
      throw new Error("Invalid catalog book.");
    if (guest) {
      book.id = `catalog-${editionId}`;
      book.addedAt = Date.now();
      book.lastOpenedAt = book.addedAt;
      book.readingMode = "reflow";
    }
    const files: { id: string; blob: Blob }[] = [];
    for (const [i, asset] of book.catalog.assets.entries()) {
      check();
      const cached = await db.blobs.get(asset.id);
      const blob = await verifiedAsset(
        cached
          ? new Response(storedBlob(cached))
          : await fetch(`/api/catalog/assets/${encodeURIComponent(asset.id)}`, {
              signal: currentLifetime.signal,
            }),
        asset,
      );
      files.push({ id: asset.id, blob });
      onProgress?.(Math.round(((i + 1) / book.catalog.assets.length) * 100));
    }
    const encoded = await Promise.all(files.map(encodeFile));
    check();
    await db.transaction("rw", [db.books, db.blobs, db.pending], async () => {
      check();
      if (await db.pending.get(`delete-book:${book.id}`))
        throw new Error("Deletion is still syncing. Please retry.");
      const existing = await db.books.get(book.id);
      await db.books.put(existing || book);
      await db.blobs.bulkPut(encoded);
    });
    if (alive.current)
      setOptimisticDeletes((old) => ({
        owner: db.name,
        ids: new Set(
          [...(old.owner === db.name ? old.ids : [])].filter(
            (id) => id !== book.id,
          ),
        ),
      }));
    return book.id;
  };
  const deleteBook = async (id:string) => {
    setOptimisticDeletes(old=>({owner:db.name,ids:new Set([...(old.owner===db.name?old.ids:[]),id])}));
    try{await db.transaction("rw",[db.books,db.progress,db.annotations,db.pending],async()=>{
      const book=await db.books.get(id),previous=await db.pending.get(`delete-book:${id}`);
      const files=book?bookFileIds(book):(previous?.value as {files?:string[]})?.files||[];
      await db.books.delete(id);
      await db.progress.delete(id);
      await db.annotations.where("bookId").equals(id).delete();
      await db.pending.filter(change=>change.bookId===id).delete();
      if(!guest)await db.pending.put({id:`delete-book:${id}`,entity:'delete-book',bookId:id,value:{files:[...new Set(files)]}});
    });}catch(error){if(alive.current)setOptimisticDeletes(old=>old.owner!==db.name?old:{owner:old.owner,ids:new Set([...old.ids].filter(value=>value!==id))});throw error;}
    if(conflicted.current===`progress:${id}`){conflicted.current=null;setConflict(null);}
    if(!guest&&alive.current)setStatus(navigator.onLine?'Deleting…':'Offline · deletion queued');
    // Cleanup runs after the shelf update and uses keys, never loading large PDF blobs.
    void db.transaction('rw',[db.books,db.blobs],async()=>{
      const used=new Set((await db.books.toArray()).flatMap(bookFileIds));
      const unused=(await db.blobs.toCollection().primaryKeys()).filter(key=>!used.has(key));if(unused.length)await db.blobs.bulkDelete(unused);
    }).catch(()=>{});
    void sync();
  };
  const addClassics = async () => {
    const now = Date.now();
    for (const [i, b] of (await loadClassics()).entries())
      await addBook({ ...b, addedAt: now - i, lastOpenedAt: now - i },[],true);
  };
  return {
    deleteBook,
    db,
    books,
    annotations,
    progress,
    settings,
    paceOwner:userId,
    readingSpeed:readingSpeed(settings.readingPace),
    recordReading,
    recordActivity,
    readingLog:settings.readingLog,
    status,
    ready,
    guest,
    sync,
    saveProgress,
    saveAnnotation,
    saveSettings,
    addBook,
    addCatalogBook,
    saveBook,
    saveReadingMode,
    loadBlob,
    conflict:conflict?.owner===db.name?conflict:null,
    resolveConflict,
    imports,
    reportImport,
    clearImport,
    addClassics,
  };
}
export type Library = ReturnType<typeof useLibrary>;
