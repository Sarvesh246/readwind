import Dexie, { type EntityTable } from "dexie";
import type { Book, Annotation, Progress, Settings } from "./types";
export type StoredFile = { id: string; blob: Blob } | { id: string; data: ArrayBuffer; type: string };
export async function encodeFile(file: {id: string; blob: Blob}): Promise<StoredFile> {
  // Binary buffers avoid WebKit's failing IndexedDB Blob serialization path.
  // Convert before opening a transaction: awaiting Blob reads can auto-close it.
  return {id: file.id, data: await file.blob.arrayBuffer(), type: file.blob.type};
}
export function storedBlob(file: StoredFile): Blob {
  return 'blob' in file ? file.blob : new Blob([file.data], {type: file.type});
}
export type Pending = {
  id: string;
  entity: "book" | "progress" | "annotation" | "settings" | "delete-book";
  bookId?: string;
  value: unknown;
  baseRevision?: number;
  uploadFiles?: boolean;
  /** File IDs already stored remotely for this book, so retries skip them. */
  uploaded?: string[];
  restoreDeleted?:boolean;
};
export class ReadwindDB extends Dexie {
  books!: EntityTable<Book, "id">;
  annotations!: EntityTable<Annotation, "id">;
  progress!: EntityTable<Progress, "bookId">;
  blobs!: EntityTable<StoredFile, "id">;
  pending!: EntityTable<Pending, "id">;
  preferences!: EntityTable<{ id: string; value: Settings }, "id">;
  constructor(owner: string) {
    super(`folio-${owner}`);
    this.version(1).stores({
      books: "id,lastOpenedAt,title",
      annotations: "id,bookId,kind,updatedAt",
      progress: "bookId",
      blobs: "id",
      pending: "id,entity",
      preferences: "id",
    });
  }
}
export function deviceId() {
  let id = localStorage.getItem("folio-device");
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem("folio-device", id);
  }
  return id;
}
