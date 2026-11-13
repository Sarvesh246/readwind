import Dexie, { type EntityTable } from "dexie";
import type { Book, Annotation, Progress, Settings, ShelfBook } from "./types";
import { toShelf } from "./shelf";
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
  error?: string;
  alternate?: unknown;
  uploadFiles?: boolean;
  /** File IDs already stored remotely for this book, so retries skip them. */
  uploaded?: string[];
  restoreDeleted?:boolean;
};
export class ReadwindDB extends Dexie {
  books!: EntityTable<Book, "id">;
  /** Text-free mirror of `books`, kept in step by the middleware below. Read this to list the library. */
  shelf!: EntityTable<ShelfBook, "id">;
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
    // Adds an index for per-book pending lookups. Dexie backfills it from the
    // existing rows, so no upgrade callback is needed and no data is rewritten.
    this.version(2).stores({
      pending: "id,entity,bookId",
    });
    // The shelf mirror is derived data, so it is rebuilt from the books already stored.
    this.version(3).stores({ shelf: "id" }).upgrade(async (tx) => {
      const rows: ShelfBook[] = [];
      await tx.table("books").each((book: Book) => {
        rows.push(toShelf(book));
      });
      if (rows.length) await tx.table("shelf").bulkPut(rows);
    });
    // Every write to `books` (including implicit single-operation transactions) also writes the
    // matching shelf rows inside the same transaction, so the two can never disagree.
    this.use({
      stack: "dbcore",
      name: "shelf-mirror",
      create: (down) => ({
        ...down,
        transaction: (stores, mode, options) =>
          down.transaction(
            mode === "readwrite" && stores.includes("books") && !stores.includes("shelf") ? [...stores, "shelf"] : stores,
            mode,
            options,
          ),
        table: (name) => {
          const table = down.table(name);
          if (name !== "books") return table;
          return {
            ...table,
            mutate: async (req) => {
              const res = await table.mutate(req);
              // Looked up lazily: while upgrading an older database the table does not exist yet.
              const shelf = down.table("shelf");
              if (req.type === "delete") await shelf.mutate({ type: "delete", trans: req.trans, keys: req.keys });
              else if (req.type === "deleteRange") await shelf.mutate({ type: "deleteRange", trans: req.trans, range: req.range });
              else {
                const keys = res.results ?? req.keys ?? [];
                const books: (Book | undefined)[] =
                  req.values.length === keys.length ? [...req.values] : await table.getMany({ trans: req.trans, keys });
                const values = books.filter((b): b is Book => !!b).map(toShelf);
                if (values.length) await shelf.mutate({ type: "put", trans: req.trans, values });
              }
              return res;
            },
          };
        },
      }),
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
