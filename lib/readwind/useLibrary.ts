"use client";
import { boundedFetch, SyncRequestError, checkPayloadSize } from './sync-safety';
import {wordProgress,start,bookDensity} from './anchors';
import { validateFile } from "./file-validation";
import {bookAssets,privateBookAssets,verifiedAsset,catalogMetadataUpdate,bookMetadataUpdate} from './catalog';
import {book as catalogBookSchema} from './schemas';
import { recoverDevice } from './device-recovery';
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { ReadwindDB, deviceId, encodeFile, storedBlob } from "./db";
import type { Pending } from "./db";
import type { Book, Annotation, Anchor, Settings, Progress } from "./types";
import { defaults } from "./types";
import {addPaceSample,addBookPaceSample,addCalibration,mergeReadingPace,readingSpeed,speedForBook,validPaceSample} from './reading-pace';
import {mergeReviewCal,recordOutcome} from './spaced-repetition';
import {addActivity,mergeReadingLog,setDayStartHour,setLogSession} from './reading-log';
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
  bookIds?: string[];
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
  const recoveredDevice = useRef<string | null>(null);
  const remoteRevision = useRef<{ owner: string; etag: string; books: string | null } | null>(null);
  const syncFailures = useRef(0), nextAutomaticSync = useRef(0), lastActivity = useRef(0);
  const syncAgain = useRef<() => void>(() => {});
  const lifetime = useRef(new AbortController());
  const editingLocked = useRef(false);
  const restoringArchive = useRef(false);
  const [optimisticDeletes,setOptimisticDeletes]=useState<{owner:string;ids:Set<string>}>({owner:db.name,ids:new Set()});
  // Two separate live queries on purpose. Books carry their full text, and every
  // reading-position change writes to `pending`; a single query that read both
  // tables re-deserialised the whole shelf on each queued change. Now the (large)
  // books table reloads only when books change, and the (tiny) deletion list is
  // joined in memory.
  const storedBooks = useLiveQuery(async()=>({owner:db.name,books:await db.books.toArray()}), [db]);
  const pendingDeletes = useLiveQuery(async()=>({owner:db.name,ids:new Set((await db.pending.where('entity').equals('delete-book').toArray()).map(p=>p.bookId))}), [db]);
  const books=useMemo(()=>{
    // Show nothing until both halves have loaded, as the single query did.
    if(storedBooks?.owner!==db.name || pendingDeletes?.owner!==db.name)return [];
    const deleted=pendingDeletes.ids;
    return storedBooks.books.filter(b=>!deleted.has(b.id) &&(optimisticDeletes.owner!==db.name || !optimisticDeletes.ids.has(b.id)));
  },[storedBooks,pendingDeletes,optimisticDeletes,db]);
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
  useEffect(() => { setLogSession(crypto.randomUUID()); }, []);
  useEffect(() => { setDayStartHour(settings.dayStartHour ?? 0); }, [settings.dayStartHour]);
  const pendingSnapshot=useLiveQuery(async()=>({owner:db.name,values:await db.pending.toArray()}),[db]);
  const failedChanges=pendingSnapshot?.owner===db.name?pendingSnapshot.values.filter(p=>p.error):[];
  const api = useCallback(
    async (path: string, init?: RequestInit) => {
      if (!auth || !alive.current || lifetime.current.signal.aborted) throw new Error("Sign in to sync.");
      return boundedFetch(path, { ...init, signal:lifetime.current.signal, credentials: "same-origin" });
    },
    [auth,lifetime],
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
        throw new SyncRequestError(signed.status,
          await responseError(signed, "Could not prepare the file upload."),
        );
      const grant = (await signed.json()) as {
        url?: string;
        headers?: Record<string, string>;
      };
      if (!grant.url) throw new Error("Could not prepare the file upload.");
      let stored: Response;
      try {
        stored = await boundedFetch(grant.url, {
          method: "PUT",
          headers: grant.headers,
          body: blob,
          signal: lifetime.current.signal,
        });
      } catch (error) {
        if (lifetime.current.signal.aborted) throw error;
        // A retry may use an attachment that is already referenced remotely.
        // Keep its object and reservation on ambiguous upload failures.
        throw new Error(
          "Could not upload the book file. Check your connection and retry.",
        );
      }
      if (!stored.ok) {
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
        throw new SyncRequestError(complete.status,
          await responseError(complete, "Could not verify the uploaded file."),
        );
    },
    [api],
  );
  const putChange = async (change: Pending) => db.pending.put(change);
  const sync = useCallback(async (retryFailed = false): Promise<boolean> => {
    if (
      guest ||
      restoringArchive.current ||
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
      if (recoveredDevice.current !== db.name) {
        await recoverDevice(db, userId, deviceId(), api, uploadFile);
        recoveredDevice.current = db.name;
      }
      const pending = await db.pending.toArray();
      const processedDeletes=new Set<string>();
      const blockedBooks = new Set<string>();
      for (const change of pending.sort(
        (a, b) => (b.entity==='delete-book'?2:b.entity==='book'?1:0)-(a.entity==='delete-book'?2:a.entity==='book'?1:0),
      )) {
        if(!active())return false;
        if (change.bookId && blockedBooks.has(change.bookId)) continue;
        if (change.error && !retryFailed) { if(change.entity==='book' && change.bookId)blockedBooks.add(change.bookId); continue; }
        try {
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
            if (!file) throw new SyncRequestError(422,"An attached file is missing. Restore it from a backup before retrying.");
            await uploadFile(id, storedBlob(file));
            // Remember each stored file so a retry never re-uploads a large PDF
            // or burns through the upload rate limit a second time.
            uploaded.add(id);
            change.uploaded = [...uploaded];
            await db.pending.update(change.id, { uploaded: [...uploaded] });
          }
          if(!active())return false;
          if(await db.pending.get(`delete-book:${book.id}`))continue;
          let response = await api(`/api/library${change.restoreDeleted?'?restore=true':''}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(book.catalog?catalogMetadataUpdate(book):change.uploadFiles===false?bookMetadataUpdate(book):book),
          });
          if (response.status === 428 && !book.catalog && active()) {
            response = await api(`/api/library${change.restoreDeleted?'?restore=true':''}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(book) });
          }
          if(response.status===410){
            await db.transaction('rw',[db.books,db.progress,db.annotations,db.pending],async()=>{
              if(await db.pending.get(`delete-book:${book.id}`))return;
              const latest=await db.pending.get(change.id);if(latest?.restoreDeleted || latest && JSON.stringify(latest.value)!==JSON.stringify(change.value))return;
              await db.books.delete(book.id);await db.progress.delete(book.id);await db.annotations.where('bookId').equals(book.id).delete();await db.pending.where("bookId").equals(book.id).delete();
            });continue;
          }
          if (!response.ok) {
            const problem=await response.json().catch(()=>({})) as {alternate?:unknown;error?:string};
            if(problem.alternate)await db.pending.update(change.id,{alternate:problem.alternate});
            throw new SyncRequestError(response.status,problem.error || 'Could not save the book.');
          }
          const saved=await response.json() as {revision?:number};
          if(saved.revision!==undefined)await db.transaction('rw',[db.books,db.pending],async()=>{
            await db.books.update(book.id,{revision:saved.revision});
            const queued=await db.pending.get(change.id);
            if(queued && JSON.stringify(queued.value)!==JSON.stringify(change.value))await db.pending.update(change.id,{value:{...(queued.value as Book),revision:saved.revision}});
          });
        } else {
          const response = await api("/api/sync", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(change),
          });
          const data = (await response.json()) as {
            alternate?:unknown;
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
          if(data.alternate)await db.pending.update(change.id,{alternate:data.alternate});
          if (!response.ok)
            throw new SyncRequestError(response.status, data.error || "Could not sync changes.");
          if (!active()) return false;
          if(change.entity==='annotation' && data.revision!==undefined)await db.transaction('rw',[db.annotations,db.pending],async()=>{
            await db.annotations.update((change.value as Annotation).id,{revision:data.revision});
            const queued=await db.pending.get(change.id);
            if(queued && JSON.stringify(queued.value)!==JSON.stringify(change.value))await db.pending.update(change.id,{value:{...(queued.value as Annotation),revision:data.revision}});
          });
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
        } catch(error) {
          if (!(error instanceof SyncRequestError) || !error.permanent) throw error;
          await db.transaction('rw',db.pending,async()=>{
            const latest=await db.pending.get(change.id);
            if(latest && JSON.stringify(latest.value)===JSON.stringify(change.value))
              await db.pending.update(change.id,{error:error.message});
          });
          if(change.entity==='book' && change.bookId)blockedBooks.add(change.bookId);
        }
      }
      const data: {
        books: Book[];
        progress: Progress[];
        annotations: Annotation[];
        settings: Settings | null;
      } = { books: [], progress: [], annotations: [], settings: null };
      let offset: number | null = 0;
      let snapshot: string | null = null;
      let restarts = 0;
      let unchanged = false;
      let receivedRevision: string | null = null;
      let receivedBooksRevision: string | null = null;
      while (offset !== null) {
        if(!active())return false;
        const etag = offset === 0 && remoteRevision.current?.owner === db.name ? remoteRevision.current.etag : undefined;
        const headers: Record<string, string> = {};
        if (etag) headers['If-None-Match'] = etag;
        if(snapshot)headers['X-Readwind-Snapshot']=snapshot;
        if (remoteRevision.current?.owner === db.name && remoteRevision.current.books !== null) headers['X-Readwind-Books-Revision'] = remoteRevision.current.books;
        const response = await api(`/api/library?offset=${offset}&device=${encodeURIComponent(deviceId())}`, { headers });
        if (offset === 0 && response.status === 304) { unchanged = true; break; }
        if(response.status===409 && restarts++<3){
          data.books=[];data.annotations=[];data.progress=[];data.settings=null;
          snapshot=null;offset=0;remoteRevision.current=null;continue;
        }
        if (!response.ok) throw new Error("Your library changed or could not be loaded. Cached books and pending edits are preserved; sync will retry.");
        if (offset === 0) {
          snapshot=response.headers.get('x-readwind-snapshot');
          receivedRevision = response.headers.get('etag');
          receivedBooksRevision = response.headers.get('x-readwind-books-revision');
        }
        const page = (await response.json()) as LibraryPage;
        if (page.bookIds) {
          const cached = await db.books.bulkGet(page.bookIds);
          if (cached.some(book => !book)) {
            // A cache eviction needs a complete pull before authoritative reconciliation.
            remoteRevision.current = null;
            data.books = []; data.annotations = []; data.progress = []; data.settings = null;
            offset = 0;
            continue;
          }
          data.books.push(...cached.filter((book): book is Book => !!book));
        }
        data.books.push(...(page.books || []));
        data.annotations.push(...(page.annotations || []));
        // Progress and settings arrive with the first page only.
        if (page.progress) data.progress = page.progress;
        if (page.settings !== undefined) data.settings = page.settings;
        const next = page.nextOffset;
        // Also stops on responses that predate pagination or omit the cursor.
        offset = typeof next === "number" && next > offset ? next : null;
      }
      if(snapshot && !unchanged){
        const verified=await api(`/api/library?verify=1&device=${encodeURIComponent(deviceId())}`,{headers:{'X-Readwind-Snapshot':snapshot}});
        if(!verified.ok)throw new Error('Your library changed before reconciliation. Cached books are preserved; sync will retry.');
      }
      if (!active()) return false;
      if (!unchanged) await db.transaction(
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
          // One bulk write per table instead of one awaited put per row.
          const incomingBooks = data.books.filter((b) => !ids.has(`book:${b.id}`) && !deleting.has(b.id));
          if (incomingBooks.length) await db.books.bulkPut(incomingBooks);
          const incomingProgress = data.progress
            .filter((p) => !ids.has(`progress:${p.bookId}`) && remoteBooks.has(p.bookId))
            .map((p) => ({ ...p, updatedAt: Number(p.updatedAt) }));
          if (incomingProgress.length) await db.progress.bulkPut(incomingProgress);
          const incomingNotes = data.annotations.filter((a) => !ids.has(`annotation:${a.id}`) && remoteBooks.has(a.bookId));
          if (incomingNotes.length) await db.annotations.bulkPut(incomingNotes);
          if (data.settings && !ids.has("settings"))
          {
            const local = (await db.preferences.get("reader"))?.value;
            await db.preferences.put({
              id: "reader",
              value: { ...defaults, ...data.settings, readingPace:mergeReadingPace(local?.readingPace,data.settings.readingPace), readingLog:mergeReadingLog(local?.readingLog,data.settings.readingLog), reviewCal:mergeReviewCal(local?.reviewCal,data.settings.reviewCal) },
            });
          }
          // The account is authoritative for books. Remove copies deleted on
          // another device, with their notes and position, unless this device
          // still has an unsent change for that book.
          // Read the stored books once (they carry full text) and track survivors
          // here, rather than re-reading the whole table for each later step.
          const editedBooks = new Set(changes.filter((change) => change.entity !== "delete-book").map((change) => change.bookId));
          const liveBooks: Book[] = [];
          const removedIds: string[] = [];
          for (const b of await db.books.toArray()) {
            if (remoteBooks.has(b.id) || editedBooks.has(b.id)) { liveBooks.push(b); continue; }
            removedIds.push(b.id);
          }
          if (removedIds.length) {
            // Bulk deletes plus an indexed pending lookup (no full-table scans).
            await db.books.bulkDelete(removedIds);
            await db.progress.bulkDelete(removedIds);
            await db.annotations.where("bookId").anyOf(removedIds).delete();
            await db.pending
              .where("bookId")
              .anyOf(removedIds)
              .filter((change) => change.id !== `book:${change.bookId}`)
              .delete();
          }
          const live = new Set(liveBooks.map((b) => b.id));
          const orphanProgress = await db.progress.filter((p) => !live.has(p.bookId)).primaryKeys();
          if (orphanProgress.length) await db.progress.bulkDelete(orphanProgress);
          const orphanNotes = await db.annotations.filter((a) => !live.has(a.bookId)).primaryKeys();
          if (orphanNotes.length) await db.annotations.bulkDelete(orphanNotes);
          const used = new Set(liveBooks.flatMap(bookFileIds));
          const unused=(await db.blobs.toCollection().primaryKeys()).filter(id=>!used.has(id));
          if(unused.length)await db.blobs.bulkDelete(unused);
          for(const change of changes.filter(p=>p.entity==='delete-book'))if(processedDeletes.has(change.id)&&!data.books.some(b=>b.id===change.bookId))await db.pending.delete(change.id);
        },
      );
      if (!unchanged) remoteRevision.current = receivedRevision ? { owner: db.name, etag: receivedRevision, books: receivedBooksRevision } : null;
      const outstanding = await db.pending.toArray();
      const remaining = outstanding.length;
      const failed = outstanding.filter(p=>p.error).length;
      if (alive.current)
        setStatus(
          conflicted.current
            ? "Choose a reading position"
            : failed ? `${failed} change(s) need attention in your account` : remaining ? "Saving…" : "All changes synced",
        );
      // Edits can be queued while a request is in flight. Drain them promptly;
      // never acknowledge a snapshot as though it included these newer edits.
      if (remaining && active() && (await db.pending.toArray()).some(p=>!p.error && !blockedBooks.has(p.bookId || '') && (p.entity!=='progress'||!conflicted.current)))
        setTimeout(() => syncAgain.current(), 0);
      syncFailures.current = 0;
      nextAutomaticSync.current = 0;
      return remaining === 0 && !conflicted.current;
    } catch (e) {
      syncFailures.current = Math.min(syncFailures.current + 1, 6);
      nextAutomaticSync.current = Date.now() + Math.min(300000, 12000 * 2 ** syncFailures.current * (0.8 + Math.random()*0.4));
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
  }, [db, guest, auth, api, uploadFile,lifetime,userId]);
  useEffect(() => { syncAgain.current = () => void sync(); }, [sync]);
  useEffect(() => {
    alive.current = true;
    lastActivity.current = Date.now();
    if (lifetime.current.signal.aborted) lifetime.current = new AbortController();
    (async () => {
      await db.open();
      if(!guest && !navigator.onLine)setStatus("Offline · saved on this device");
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
      if (document.visibilityState === "visible" && Date.now() - lastActivity.current < 120000 && Date.now() >= nextAutomaticSync.current) void sync();
    }, 12000);
    const wake = () => {
      lastActivity.current = Date.now();
      if (document.visibilityState === "visible" && Date.now() >= nextAutomaticSync.current) void sync();
    };
    const activity = () => { const idle = Date.now() - lastActivity.current >= 120000; lastActivity.current = Date.now(); if (idle) wake(); };
    const reconnect = () => { nextAutomaticSync.current = 0; wake(); };
    window.addEventListener("online", reconnect);
    window.addEventListener('pointerdown', activity);
    window.addEventListener('keydown', activity);
    window.addEventListener("focus", wake);
    document.addEventListener("visibilitychange", wake);
    const offline = () => setStatus("Offline · saved on this device");
    window.addEventListener("offline", offline);
    return () => {
      alive.current = false;
      lifetime.current.abort();
      clearInterval(id);
      window.removeEventListener("online", reconnect);
      window.removeEventListener('pointerdown', activity);
      window.removeEventListener('keydown', activity);
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
      if (document.visibilityState === "visible" && (watching || Date.now() - lastActivity.current < 120000)) void refreshImports();
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
    if(editingLocked.current)return;
    await db.transaction(
      "rw",
      [db.progress, db.pending, db.books],
      async () => {
        const book=await db.books.get(bookId);if(!book)return;
        const current = await db.progress.get(bookId);
        const value: Progress = {
          bookId,
          at,
          wordsRead: Math.min(wordProgress(book,start).total,Math.max(current?.wordsRead || 0, wordsRead)),
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
    if(editingLocked.current)throw new Error("Account changes are paused while signing out or restoring.");
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
    if(editingLocked.current)throw new Error("Account changes are paused while signing out or restoring.");
    await db.transaction("rw", [db.preferences, db.pending], async () => {
      const current = await db.preferences.get("reader");
      value = {...value,readingPace:mergeReadingPace(current?.value.readingPace,value.readingPace),readingLog:mergeReadingLog(current?.value.readingLog,value.readingLog),reviewCal:mergeReviewCal(current?.value.reviewCal,value.reviewCal)};
      await db.preferences.put({ id: "reader", value });
      if (!guest)
        await putChange({ id: "settings", entity: "settings", value });
    });
    void sync();
  };
  const recordReading = async (words:number,seconds:number,bookId?:string) => {
    if(editingLocked.current)return;
    if(!validPaceSample(words,seconds))return;
    await db.transaction("rw",[db.preferences,db.pending],async()=>{
      const current=(await db.preferences.get("reader"))?.value || defaults;
      let pace=addPaceSample(current.readingPace || {},deviceId(),words,seconds);
      if(bookId)pace=addBookPaceSample(pace,bookId,words,seconds);
      if(pace===current.readingPace)return;
      const value={...current,readingPace:pace};
      await db.preferences.put({id:"reader",value});
      if(!guest)await putChange({id:"settings",entity:"settings",value});
    });
    void sync();
  };
  /** How much longer or shorter a stretch of reading took than predicted; feeds time-left estimates. */
  const recordCalibration = async (lnRatio:number) => {
    if(editingLocked.current)return;
    await db.transaction("rw",[db.preferences,db.pending],async()=>{
      const current=(await db.preferences.get("reader"))?.value || defaults;
      const pace=addCalibration(current.readingPace || {},deviceId(),lnRatio);
      if(pace===current.readingPace)return;
      const value={...current,readingPace:pace};
      await db.preferences.put({id:"reader",value});
      if(!guest)await putChange({id:"settings",entity:"settings",value});
    });
    void sync();
  };
  /** Remembers whether a reviewed highlight was recalled, so intervals fit this reader's memory. */
  const recordReviewOutcome = async (predicted:number,recalled:boolean) => {
    if(editingLocked.current)return;
    await db.transaction("rw",[db.preferences,db.pending],async()=>{
      const current=(await db.preferences.get("reader"))?.value || defaults;
      const value={...current,reviewCal:recordOutcome(current.reviewCal,predicted,recalled)};
      await db.preferences.put({id:"reader",value});
      if(!guest)await putChange({id:"settings",entity:"settings",value});
    });
    void sync();
  };
  /** Written the moment a page is read, so the streak never waits on a sync. */
  const recordActivity = async (credit:LogEntry) => {
    if(editingLocked.current)return;
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
    checkPayloadSize(book);
    if(editingLocked.current)throw new Error("Account changes are paused while signing out or restoring.");
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
    checkPayloadSize(book);
    if(editingLocked.current)throw new Error("Account changes are paused while signing out or restoring.");
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
    if(editingLocked.current)throw new Error("Account changes are paused while signing out or restoring.");
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
  const renameBook = async (bookId: string, title: string) => {
    const normalized = title.trim();
    if (!normalized || normalized.length > 500) throw new Error("Enter a book title between 1 and 500 characters.");
    if (!alive.current || lifetime.current.signal.aborted) throw new Error("Account changed. Please try again.");
    await db.transaction("rw", [db.books, db.pending], async () => {
      const current = await db.books.get(bookId);
      if (!current || await db.pending.get(`delete-book:${bookId}`)) throw new Error("This book is no longer in your library.");
      const queued = await db.pending.get(`book:${bookId}`);
      if (!alive.current || lifetime.current.signal.aborted) throw new Error("Account changed. Please try again.");
      const value = { ...current, title: normalized };
      await db.books.put(value);
      if (!guest) await db.pending.put({ ...queued, id: `book:${bookId}`, entity: "book", bookId, value, uploadFiles: queued ? queued.uploadFiles !== false : false });
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
    if(editingLocked.current)throw new Error("Account changes are paused.");
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
    checkPayloadSize(book);
    if(editingLocked.current)throw new Error("Account changes are paused while signing out or restoring.");
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
    if(editingLocked.current)throw new Error("Account changes are paused while signing out or restoring.");
    setOptimisticDeletes(old=>({owner:db.name,ids:new Set([...(old.owner===db.name?old.ids:[]),id])}));
    try{await db.transaction("rw",[db.books,db.progress,db.annotations,db.pending],async()=>{
      const book=await db.books.get(id),previous=await db.pending.get(`delete-book:${id}`);
      const files=book?bookFileIds(book):(previous?.value as {files?:string[]})?.files||[];
      await db.books.delete(id);
      await db.progress.delete(id);
      await db.annotations.where("bookId").equals(id).delete();
      await db.pending.where("bookId").equals(id).delete();
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
  const checkImportCapacity=async(bytes:number)=>{
    if(editingLocked.current)throw new Error('Wait for the current account operation to finish.');
    const estimate=await navigator.storage?.estimate();
    if(estimate?.quota && estimate.quota-(estimate.usage || 0)<bytes*1.3)throw new Error('This device is low on storage. Remove synced downloads before importing.');
    if(!guest && auth && navigator.onLine){
      const response=await api('/api/account');
      if(response.ok){const usage=await response.json() as {bytes:number;limit:number;projectAvailable?:number};
        if(usage.limit-usage.bytes<bytes || usage.projectAvailable!==undefined && usage.projectAvailable<bytes)throw new Error('Cloud storage has insufficient capacity for this file. Free space or contact the operator before importing.');
      }
    }
  };
  const removeDownload=async(id:string)=>{
    if(guest)throw new Error('Guest books have no cloud copy. Export a backup before removing them.');
    await db.transaction('rw',[db.books,db.pending,db.blobs],async()=>{
      const book=await db.books.get(id);if(!book)return;
      const pending=await db.pending.toArray();
      const pendingBooks=new Set(pending.map(p=>p.bookId));
      const protectedIds=new Set((await db.books.toArray()).filter(b=>pendingBooks.has(b.id)).flatMap(bookAssets));
      const assets=bookAssets(book);
      if(pending.some(p=>p.bookId===id)||assets.some(asset=>protectedIds.has(asset)))throw new Error('Sync this book and its shared attachments before removing downloads.');
      await db.blobs.bulkDelete(assets);
    });
  };
  const resolveFailedChange = async (id:string,keepLocal:boolean) => {
    await db.transaction('rw',[db.books,db.annotations,db.pending],async()=>{
      const change=await db.pending.get(id);if(!change?.alternate)return;
      if(keepLocal){
        const alternate=change.alternate as {revision?:number};
        const value={...(change.value as object),revision:alternate.revision || 0};
        await db.pending.update(id,{value,error:undefined,alternate:undefined});
        if(change.entity==='book')await db.books.put(value as Book);else if(change.entity==='annotation')await db.annotations.put(value as Annotation);
      }else{
        if(change.entity==='book')await db.books.put(change.alternate as Book);
        else if(change.entity==='annotation')await db.annotations.put(change.alternate as Annotation);
        await db.pending.delete(id);
      }
    });remoteRevision.current=null;void sync();
  };
  const restoreArchive = async (data: Awaited<ReturnType<typeof import('./backup').readBackup>>['data'], files:{id:string;blob:Blob}[]) => {
    if(editingLocked.current)throw new Error('Another account operation is in progress.');
    editingLocked.current=true;restoringArchive.current=true;
    try {
      const deadline=Date.now()+60000;
      while(running.current && Date.now()<deadline)await new Promise(resolve=>setTimeout(resolve,100));
      if(running.current)throw new Error('Sync is busy. Retry restoration after it finishes.');
      for(const b of data.books)checkPayloadSize(b);
      const encoded=await Promise.all(files.map(encodeFile));
      await db.transaction('rw',db.tables,async()=>{
        await db.blobs.bulkPut(encoded);
        for(const b of data.books){
          const current=await db.books.get(b.id);
          const value={...b,revision:current?.revision || 0};
          await db.books.put(value);
          if(!guest)await db.pending.put({id:`book:${b.id}`,entity:'book',bookId:b.id,value,restoreDeleted:true});
        }
        for(const a of data.annotations){const current=await db.annotations.get(a.id);const value={...a,revision:current?.revision || 0};await db.annotations.put(value);if(!guest)await db.pending.put({id:`annotation:${a.id}`,entity:'annotation',bookId:a.bookId,value});}
        for(const p of data.progress){const current=await db.progress.get(p.bookId);const value={...p,revision:current?.revision || 0,deviceId:deviceId()};await db.progress.put(value);if(!guest)await db.pending.put({id:`progress:${p.bookId}`,entity:'progress',bookId:p.bookId,value});}
        if(data.settings){const current=(await db.preferences.get('reader'))?.value;const value={...data.settings,readingLog:mergeReadingLog(current?.readingLog,data.settings.readingLog),readingPace:mergeReadingPace(current?.readingPace,data.settings.readingPace),reviewCal:mergeReviewCal(current?.reviewCal,data.settings.reviewCal)};await db.preferences.put({id:'reader',value});if(!guest)await db.pending.put({id:'settings',entity:'settings',value});}
      });
    } finally {editingLocked.current=false;restoringArchive.current=false;}
    remoteRevision.current=null;
    void sync();
  };
  const prepareSignOut = async () => {
    editingLocked.current=true;
    if(imports.some(job=>job.status==='running'))return false;
    const deadline=Date.now()+60000;
    while(running.current && Date.now()<deadline)await new Promise(resolve=>setTimeout(resolve,100));
    if(running.current || !await sync(true))return false;
    return !conflicted.current && recoveredDevice.current===db.name && await db.pending.count()===0;
  };
  return {
    checkImportCapacity,
    removeDownload,
    failedChanges,
    resolveFailedChange,
    restoreArchive,
    prepareSignOut,
    resumeEditing:()=>{editingLocked.current=false;},
    renameBook,
    deleteBook,
    db,
    books,
    annotations,
    progress,
    settings,
    paceOwner:userId,
    readingSpeed:readingSpeed(settings.readingPace),
    /** Words per minute for this book's own words: reader pace, tuned to the book, corrected by calibration. */
    speedFor:(b:Book)=>speedForBook(settings.readingPace,b.id,bookDensity(b)),
    recordReading,
    recordCalibration,
    recordReviewOutcome,
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
