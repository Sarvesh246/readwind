import Dexie, { type EntityTable } from "dexie";
import type { Book, Annotation, Progress, Settings } from "./types";
export type Pending = {
  id: string;
  entity: "book" | "progress" | "annotation" | "settings";
  bookId?: string;
  value: unknown;
  baseRevision?: number;
  uploadFiles?: boolean;
};
export class ReadwindDB extends Dexie {
  books!: EntityTable<Book, "id">;
  annotations!: EntityTable<Annotation, "id">;
  progress!: EntityTable<Progress, "bookId">;
  blobs!: EntityTable<{ id: string; blob: Blob }, "id">;
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
