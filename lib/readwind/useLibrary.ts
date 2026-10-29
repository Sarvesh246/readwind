"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { ReadwindDB, deviceId } from "./db";
import type { Pending } from "./db";
import type { Book, Annotation, Anchor, Settings, Progress } from "./types";
import { defaults } from "./types";
import { sampleBooks, sampleAnnotations } from "./samples";
export type { AuthClient } from "./auth";
import type { AuthClient } from "./auth";
export type SyncConflict = {
  bookId: string;
  local: Progress;
  remote: { at: Anchor; revision: number; deviceId: string };
};
export function useLibrary(userId: string, auth: AuthClient | null) {
  const db = useMemo(() => new ReadwindDB(userId), [userId]);
  const guest = userId === "preview";
  const [status, setStatus] = useState(
    guest ? "Sample library" : "Connecting…",
  );
  const [ready, setReady] = useState(false);
  const [conflict, setConflict] = useState<SyncConflict | null>(null);
  const running = useRef(false),
    alive = useRef(true),
    conflicted = useRef<string | null>(null);
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
      if (!auth) throw new Error("Sign in to sync.");
      return fetch(path, { ...init, credentials: "same-origin" });
    },
    [auth],
  );
  const putChange = async (change: Pending) => db.pending.put(change);
  const sync = useCallback(async () => {
    if (
      guest ||
      !auth ||
      running.current ||
      !navigator.onLine ||
      !alive.current
    )
      return;
    running.current = true;
    setStatus("Syncing…");
    try {
      const pending = await db.pending.toArray();
      for (const change of pending.sort(
        (a, b) => Number(b.entity === "book") - Number(a.entity === "book"),
      )) {
        if (change.id === conflicted.current) continue;
        if (change.entity === "book") {
          const book = change.value as Book;
          const blobIds = [
            book.sourcePdfBlobId,
            book.cover.blobId,
            ...book.sections.flatMap((s) =>
              s.blocks
                .filter((b) => b.type === "figure")
                .map((b) => (b.type === "figure" ? b.blobId : undefined)),
            ),
          ].filter(Boolean) as string[];
          for (const id of new Set(change.uploadFiles === false ? [] : blobIds)) {
            const file = await db.blobs.get(id);
            if (!file) throw new Error("An attached file is missing.");
            const response = await api(
              `/api/files?id=${encodeURIComponent(id)}`,
              {
                method: "POST",
                headers: { "Content-Type": file.blob.type },
                body: file.blob,
              },
            );
            if (!response.ok)
              throw new Error("Could not upload the book file.");
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
          if (!response.ok)
            throw new Error(data.error || "Could not sync changes.");
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
      const response = await api("/api/library");
      if (!response.ok) throw new Error("Could not load your library.");
      const data = (await response.json()) as {
        books: Book[];
        progress: Progress[];
        annotations: Annotation[];
        settings: Settings | null;
      };
      await db.transaction(
        "rw",
        [db.books, db.progress, db.annotations, db.preferences, db.pending],
        async () => {
          const changes = await db.pending.toArray(),
            ids = new Set(changes.map((p) => p.id));
          for (const b of data.books)
            if (!ids.has(`book:${b.id}`)) await db.books.put(b);
          for (const p of data.progress)
            if (!ids.has(`progress:${p.bookId}`))
              await db.progress.put({ ...p, updatedAt: Number(p.updatedAt) });
          for (const a of data.annotations)
            if (!ids.has(`annotation:${a.id}`)) await db.annotations.put(a);
          if (data.settings && !ids.has("settings"))
            await db.preferences.put({
              id: "reader",
              value: { ...defaults, ...data.settings },
            });
        },
      );
      if (alive.current)
        setStatus(
          conflicted.current
            ? "Choose a reading position"
            : "All changes synced",
        );
    } catch (e) {
      if (alive.current)
        setStatus(
          navigator.onLine
            ? (e as Error).message
            : "Offline · saved on this device",
        );
    } finally {
      running.current = false;
      if (alive.current) setReady(true);
    }
  }, [db, guest, auth, api]);
  useEffect(() => {
    alive.current = true;
    (async () => {
      await db.open();
      if (guest && (await db.books.count()) === 0) {
        await db.books.bulkPut(sampleBooks);
        await db.annotations.bulkPut(sampleAnnotations());
      }
      if (!guest) await sync();
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
  }, [db, sync, guest]);
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
    await db.transaction("rw", [db.books, db.blobs, db.pending], async () => {
      await db.books.put(book);
      if (files.length) await db.blobs.bulkPut(files);
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
        await db.pending.put({id:`book:${book.id}`,entity:'book',bookId:book.id,value,uploadFiles:queued ? queued.uploadFiles !== false : false});
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
        file = { id, blob: await r.blob() };
        await db.blobs.put(file);
      }
      return file?.blob;
    },
    [db, guest, api],
  );
  const resolveConflict = async (useLocal: boolean) => {
    if (!conflict) return;
    const c = conflict;
    if (useLocal) {
      const value = { ...c.local, revision: c.remote.revision };
      await db.progress.put(value);
      await db.pending.put({
        id: `progress:${c.bookId}`,
        entity: "progress",
        bookId: c.bookId,
        value,
      });
    } else {
      await db.pending.delete(`progress:${c.bookId}`);
      await db.progress.put({ ...c.local, ...c.remote });
    }
    conflicted.current = null;
    setConflict(null);
    void sync();
  };
  const addSamples = async () => {
    for (const b of sampleBooks)
      await addBook({ ...b, addedAt: Date.now(), lastOpenedAt: Date.now() });
    for (const a of sampleAnnotations()) await saveAnnotation(a);
  };
  return {
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
    addSamples,
  };
}
export type Library = ReturnType<typeof useLibrary>;
