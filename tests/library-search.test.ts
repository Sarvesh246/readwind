import "fake-indexeddb/auto";
import { afterEach, describe, expect, it } from "vitest";
import { ReadwindDB } from "@/lib/readwind/db";
import { findPhrase, searchLibraryText } from "@/lib/readwind/library-search";
import type { Book } from "@/lib/readwind/types";

const book = (id: string, ...paras: string[]): Book => ({
  id, title: id, author: "A", addedAt: 1, lastOpenedAt: 1, cover: { color: "#000", fg: "#fff", kind: "typeset" },
  printPageCount: 1, pageMarks: [], sections: [{ id: "s", title: "S", heading: true, blocks: paras.map((text) => ({ type: "p" as const, text })) }],
});
describe("library text search", () => {
  it("finds a phrase ignoring case and accents, with a snippet and count", () => {
    const hit = findPhrase(book("x", "Nothing here.", "She walked into the Café de Flore twice, then left the café."), "cafe")!;
    expect(hit.count).toBe(2);
    expect(hit.at).toMatchObject({ section: 0, block: 1 });
    expect(hit.snippet.toLowerCase()).toContain("caf");
  });
  it("ignores very short queries and misses", () => {
    expect(findPhrase(book("x", "alpha"), "al")).toBeNull();
    expect(findPhrase(book("x", "alpha"), "omega")).toBeNull();
  });
  let db: ReadwindDB;
  afterEach(async () => { db?.close(); await db?.delete(); });
  it("searches every stored book and stops when cancelled", async () => {
    db = new ReadwindDB("library-search");
    await db.books.bulkPut([book("one", "The white whale surfaced."), book("two", "Nothing relevant."), book("three", "A whale of a time.")]);
    expect([...(await searchLibraryText(db, "whale", () => false)).keys()].sort()).toEqual(["one", "three"]);
    expect((await searchLibraryText(db, "whale", () => true)).size).toBe(0);
  });
});
