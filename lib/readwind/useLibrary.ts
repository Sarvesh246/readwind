"use client";
import { validateFile } from "./file-validation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { ReadwindDB, deviceId, encodeFile, storedBlob } from "./db";
import type { Pending } from "./db";
import type { Book, Annotation, Anchor, Settings, Progress } from "./types";
import { defaults } from "./types";
import { loadClassics } from "./classics";
export type { AuthClient } from "./auth";
import type { AuthClient } from "./auth";
export type SyncConflict = {
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
  return [
    book.sourcePdfBlobId,
    book.cover.blobId,
    ...book.sections.flatMap((section) =>
      section.blocks.map((block) =>
        block.type === "figure" ? block.blobId : undefined,
      ),
    ),
  ].filter((id): id is string => Boolean(id));
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
  const books = useLiveQuery(() => db.books.toArray(), [db], []) || [];
  const annotations =
    useLiveQuery(
      () => db.annotations.filter((a) => !a.deleted).toArray(),
      [db],
      [],
    ) || [];
  const progress = useLiveQuery(() => db.progress.toArray(), [db], []) || [];
  const preferences = useLiveQuery(() => db.preferences.get("reader"), [db]);
  const settings = preferences?.value || defaults;
  const api = useCallback(
    async (path: string, init?: RequestInit) => {
      if (!auth || !alive.current) throw new Error("Sign in to sync.");
      return fetch(path, { ...init, signal:lifetime.current.signal, credentials: "same-origin" });
    },
    [auth],
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
      !alive.current
    )
      return false;
    running.current = true;
    setStatus("Syncing…");
    try {
      const pending = await db.pending.toArray();
      for (const change of pending.sort(
        (a, b) => Number(b.entity === "book") - Number(a.entity === "book"),
      )) {
        if (change.entity === 'progress' && conflicted.current) continue;
        if (change.entity === "book") {
          const book = change.value as Book;
          const blobIds = bookFileIds(book);
          const uploaded = new Set(change.uploaded || []);
          for (const id of new Set(change.uploadFiles === false ? [] : blobIds)) {
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
          const response = await api("/api/library", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(book),
          });
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
          if (!alive.current) return false;
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
        if (!alive.current) return false;
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
      if (!alive.current) return false;
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
            remoteBooks = new Set(data.books.map((b) => b.id));
          for (const b of data.books)
            if (!ids.has(`book:${b.id}`)) await db.books.put(b);
          for (const p of data.progress)
            if (!ids.has(`progress:${p.bookId}`) && remoteBooks.has(p.bookId))
              await db.progress.put({ ...p, updatedAt: Number(p.updatedAt) });
          for (const a of data.annotations)
            if (!ids.has(`annotation:${a.id}`) && remoteBooks.has(a.bookId))
              await db.annotations.put(a);
          if (data.settings && !ids.has("settings"))
            await db.preferences.put({
              id: "reader",
              value: { ...defaults, ...data.settings },
            });
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
          for (const file of await db.blobs.toArray())
            if (!used.has(file.id)) await db.blobs.delete(file.id);
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
      if (remaining && !conflicted.current && alive.current)
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
  }, [db, guest, auth, api, uploadFile]);
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
  const saveProgress = async (
    bookId: string,
    at: Anchor,
    wordsRead: number,
  ) => {
    await db.transaction(
      "rw",
      [db.progress, db.pending, db.books],
      async () => {
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
    await db.transaction("rw", [db.annotations, db.pending], async () => {
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
      await db.preferences.put({ id: "reader", value });
      if (!guest)
        await putChange({ id: "settings", entity: "settings", value });
    });
    void sync();
  };
  const addBook = async (
    book: Book,
    files: { id: string; blob: Blob }[] = [],
  ) => {
    const encoded = await Promise.all(files.map(encodeFile));
    await db.transaction("rw", [db.books, db.blobs, db.pending], async () => {
      await db.books.put(book);
      if (encoded.length) await db.blobs.bulkPut(encoded);
      if (!guest)
        await putChange({
          id: `book:${book.id}`,
          entity: "book",
          bookId: book.id,
          value: book,
        });
    });
    void sync();
  };
  const saveReadingMode = async (book: Book, readingMode: 'original'|'reflow') => {
    await db.transaction('rw', [db.books,db.pending], async()=>{
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
    if (!conflict) return;
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
  const deleteBook = async (id:string) => {
    if (!guest) {
      const response = await api(`/api/library?id=${encodeURIComponent(id)}`,{method:"DELETE"});
      if (!response.ok && response.status !== 404) throw new Error("Could not delete this book. Connect and retry.");
    }
    await db.transaction("rw",[db.books,db.progress,db.annotations,db.pending],async()=>{
      await db.books.delete(id);
      await db.progress.delete(id);
      await db.annotations.where("bookId").equals(id).delete();
      await db.pending.filter(change=>change.bookId===id).delete();
    });
    const remaining = await db.books.toArray();
    const used = new Set(remaining.flatMap(bookFileIds));
    await db.blobs.filter(file=>!used.has(file.id)).delete();
  };
  const addClassics = async () => {
    const now = Date.now();
    for (const [i, b] of (await loadClassics()).entries())
      await addBook({ ...b, addedAt: now - i, lastOpenedAt: now - i });
  };
  return {
    deleteBook,
    db,
    books,
    annotations,
    progress,
    settings,
    status,
    ready,
    guest,
    sync,
    saveProgress,
    saveAnnotation,
    saveSettings,
    addBook,
    saveReadingMode,
    loadBlob,
    conflict,
    resolveConflict,
    addClassics,
  };
}
export type Library = ReturnType<typeof useLibrary>;
