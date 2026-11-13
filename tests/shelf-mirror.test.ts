import "fake-indexeddb/auto";
import { afterEach, describe, expect, it } from "vitest";
import { ReadwindDB } from "@/lib/readwind/db";
import { wordProgress } from "@/lib/readwind/anchors";
import { bookAssets } from "@/lib/readwind/catalog";
import type { Book } from "@/lib/readwind/types";

const para = (text: string) => ({ type: "p" as const, text });
const make = (id: string, extra: Partial<Book> = {}): Book => ({
  id, title: `Title ${id}`, author: "A", addedAt: 1, lastOpenedAt: 1,
  cover: { color: "#000", fg: "#fff", kind: "typeset" }, printPageCount: 2, pageMarks: [],
  sections: [
    { id: "s0", title: "One", heading: true, blocks: [para("alpha beta gamma delta ".repeat(6)), para("epsilon zeta eta theta")] },
    { id: "s1", title: "Two", heading: true, blocks: [{ type: "figure", blobId: `fig-${id}` }, para("iota kappa lambda mu")] },
  ],
  ...extra,
});
let n = 0;
const open = () => new ReadwindDB(`shelf-test-${++n}`);
const dbs: ReadwindDB[] = [];
afterEach(async () => { for (const d of dbs.splice(0)) { d.close(); await d.delete(); } });
const fresh = () => { const d = open(); dbs.push(d); return d; };

describe("shelf mirror", () => {
  it("mirrors puts, updates, bulk writes and deletes without the text", async () => {
    const db = fresh();
    await db.books.put(make("a"));
    await db.books.bulkPut([make("b"), make("c")]);
    expect((await db.shelf.toArray()).map((s) => s.id).sort()).toEqual(["a", "b", "c"]);
    const row = (await db.shelf.get("a"))!;
    expect(JSON.stringify(row)).not.toContain("epsilon zeta");
    expect(row.sections.every((s) => !("blocks" in s))).toBe(true);
    expect(row.sections.map((s) => s.title)).toEqual(["One", "Two"]);
    expect(row.assets).toContain("fig-a");
    expect(row.opening).toContain("alpha beta");
    await db.books.update("a", { title: "Renamed" });
    expect((await db.shelf.get("a"))!.title).toBe("Renamed");
    await db.books.delete("b");
    await db.books.bulkDelete(["c"]);
    expect((await db.shelf.toArray()).map((s) => s.id)).toEqual(["a"]);
    await db.books.where("id").equals("a").delete();
    expect(await db.shelf.count()).toBe(0);
  });
  it("stays atomic inside explicit transactions that do not name the shelf", async () => {
    const db = fresh();
    await db.books.put(make("a"));
    await expect(db.transaction("rw", [db.books, db.pending], async () => {
      await db.books.put(make("z"));
      throw new Error("abort");
    })).rejects.toThrow("abort");
    expect((await db.shelf.toArray()).map((s) => s.id)).toEqual(["a"]);
    await db.transaction("rw", [db.books, db.pending], async () => { await db.books.put(make("y")); });
    expect(await db.shelf.count()).toBe(2);
    await db.books.clear();
    expect(await db.shelf.count()).toBe(0);
  });
  it("gives the same progress and assets as the full book", async () => {
    const db = fresh();
    const book = make("a", { cover: { color: "#000", fg: "#fff", kind: "image", blobId: "cover-a" } });
    await db.books.put(book);
    const row = (await db.shelf.get("a"))!;
    for (const at of [{ section: 0, block: 0, offset: 0 }, { section: 0, block: 1, offset: 0 }, { section: 1, block: 1, offset: 0 }]) {
      expect(wordProgress(row, at)).toEqual(wordProgress(book, at));
    }
    expect(bookAssets(row)).toEqual(bookAssets(book));
  });
  it("rebuilds the shelf when upgrading a library saved before it existed", async () => {
    const name = `shelf-upgrade-${++n}`;
    const { default: Dexie } = await import("dexie");
    const old = new Dexie(`folio-${name}`);
    old.version(2).stores({ books: "id,lastOpenedAt,title", annotations: "id,bookId,kind,updatedAt", progress: "bookId", blobs: "id", pending: "id,entity,bookId", preferences: "id" });
    await old.open();
    await old.table("books").put(make("legacy"));
    old.close();
    const db = new ReadwindDB(name);
    dbs.push(db);
    await db.open();
    expect((await db.shelf.toArray()).map((s) => s.id)).toEqual(["legacy"]);
  });
});
