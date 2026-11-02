import Dexie from "dexie";
import { bookAssets } from "./catalog";
import { storedBlob, type ReadwindDB, type StoredFile } from "./db";
import type { Book, Progress, Annotation, Settings } from "./types";
import type { Pending } from "./db";

type Snapshot = {
  id: string;
  capturedAt: number;
  books: Book[];
  progress: Progress[];
  annotations: Annotation[];
  preferences: { id: string; value: Settings }[];
  pending: Pending[];
};
type Api = (path: string, init?: RequestInit) => Promise<Response>;
/** Preserve the device before the restored server is allowed to reconcile its shelf. */
export async function recoverDevice(
  db: ReadwindDB,
  owner: string,
  device: string,
  api: Api,
  upload: (id: string, blob: Blob) => Promise<void>,
) {
  const state = await api(`/api/recovery?device=${encodeURIComponent(device)}`);
  if (state.status === 404) return; // A pre-migration server has no recovery protocol.
  if (!state.ok)
    throw new Error(
      "Could not check device recovery. Your cached library is preserved.",
    );
  const config = (await state.json()) as {
    required?: boolean;
    epoch?: string;
    files?: { id: string; bytes: number | string }[];
  };
  if (!config.required) return;
  if (!config.epoch)
    throw new Error("The recovery service returned an incomplete response.");
  const archive = new Dexie(`readwind-recovery-${owner}`);
  archive.version(1).stores({ snapshots: "id", files: "id" });
  const snapshotId = `${config.epoch}:${device}`;
  try {
    let snapshot = await archive.table<Snapshot>("snapshots").get(snapshotId);
    if (!snapshot) {
      const source = await db.transaction("r", db.tables, async () => ({
        id: snapshotId,
        capturedAt: Date.now(),
        books: await db.books.toArray(),
        progress: await db.progress.toArray(),
        annotations: await db.annotations.toArray(),
        preferences: await db.preferences.toArray(),
        pending: await db.pending.toArray(),
        files: await db.blobs.toArray(),
      }));
      const { files, ...metadata } = source;
      await archive.transaction("rw", archive.tables, async () => {
        await archive.table("files").bulkPut(files);
        await archive.table("snapshots").put(metadata);
      });
      snapshot = metadata;
    }
    const remoteFiles = new Map(
      (config.files || []).map((file) => [file.id, Number(file.bytes)]),
    );
    const files = await archive.table<StoredFile>("files").toArray();
    const post = async (
      kind: "book" | "settings" | "complete",
      value: unknown,
      extra = {},
    ) => {
      const response = await api("/api/recovery", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          epoch: config.epoch,
          deviceId: device,
          kind,
          value,
          ...extra,
        }),
      });
      if (!response.ok)
        throw new Error(
          "Could not finish device recovery. Your original device snapshot is preserved.",
        );
    };
    // File IDs are immutable. Reuse the already-restored copy when its length matches.
    for (const file of files) {
      const blob = storedBlob(file);
      if (remoteFiles.get(file.id) !== blob.size) {
        await upload(file.id, blob);
        remoteFiles.set(file.id, blob.size);
      }
    }
    const deleting = new Set(
      snapshot.pending
        .filter((p) => p.entity === "delete-book")
        .map((p) => p.bookId),
    );
    for (const book of snapshot.books.filter(
      (book) => !deleting.has(book.id),
    )) {
      await post("book", book, {
        progress: snapshot.progress.find((p) => p.bookId === book.id),
        annotations: snapshot.annotations.filter((a) => a.bookId === book.id),
        pending: snapshot.pending.filter((p) => p.bookId === book.id),
      });
    }
    const preferences = snapshot.preferences.find(
      (value) => value.id === "reader",
    );
    if (preferences)
      await post("settings", preferences.value, {
        pending: snapshot.pending.filter((p) => p.entity === "settings"),
      });
    const missingFiles = [
      ...new Set(snapshot.books.flatMap(bookAssets)),
    ].filter((id) => !remoteFiles.has(id));
    await post("complete", {
      capturedAt: snapshot.capturedAt,
      books: snapshot.books.length,
      progress: snapshot.progress.length,
      annotations: snapshot.annotations.length,
      cachedFiles: files.length,
      missingFiles,
      preferences: snapshot.preferences,
      pending: snapshot.pending,
    });
  } finally {
    archive.close();
  }
}
