import { describe, it, expect } from "vitest";
import {
  searchCatalog,
  recommendCatalog,
  verifiedAsset,
  sha256,
  privateBookAssets,
  type CatalogEntry,
} from "../lib/readwind/catalog";
import {
  unpackEpub,
  retainedText,
  resourcePath,
  expandEmptyXhtmlTags,
} from "../lib/readwind/structured-book";
import type { Book } from "../lib/readwind/types";
import { zipSync, strToU8 } from "fflate";
const entry = (
  id: string,
  title: string,
  author = "Jane Austen",
  subjects = ["Fiction"],
): CatalogEntry => ({
  id,
  workId: id,
  title,
  author,
  subjects,
  language: "en",
  edition: "Complete",
  publisher: "Publisher",
  source: "Source",
  sourceUrl: "https://example.org",
  license: "CC BY 4.0",
  coverId: "cover",
  version: "v1",
  bytes: 100,
  format: "epub",
});
const book = (e: CatalogEntry): Book => ({
  id: "book",
  title: e.title,
  author: e.author,
  addedAt: 1,
  lastOpenedAt: 2,
  cover: { kind: "typeset", color: "#123456", fg: "#ffffff" },
  printPageCount: 1,
  sections: [
    {
      id: "s",
      title: "Chapter",
      heading: true,
      blocks: [{ type: "p", text: "Book text" }],
    },
  ],
  pageMarks: [],
  catalog: { editionId: e.id, version: "v1", subjects: e.subjects, assets: [] },
});
describe("catalog discovery", () => {
  it("matches catalog author ordering and preserves signals after an edition is unpublished", () => {
    const a = entry("a", "Owned", "Austen, Jane, 1775-1817"),
      next = entry("b", "Another book", "Jane Austen"),
      manual = { ...book(a), author: "Jane Austen", catalog: undefined };
    expect(recommendCatalog([a, next], [manual], []).personalized).toBe(true);
    expect(recommendCatalog([next], [book(a)], []).items[0].reason).toBe(
      "More by this author",
    );
    expect(searchCatalog([a], "Jane Austen")).toHaveLength(1);
  });
  it("ranks exact titles before prefixes, author matches and subjects", () => {
    const entries = [
      entry("a", "Other", "Pride"),
      entry("b", "Pride and Prejudice"),
      entry("c", "Pride"),
      entry("d", "Other title", "Else", ["Pride"]),
    ];
    expect(searchCatalog(entries, "pride").map((e) => e.id)).toEqual([
      "c",
      "b",
      "a",
      "d",
    ]);
  });
  it("normalizes accents and punctuation", () =>
    expect(searchCatalog([entry("a", "Émile: A Book")], "emile").length).toBe(
      1,
    ));
  it("finds an authorized edition by its documented alternative title", () => {
    const letters = {
      ...entry("seneca", "Moral Letters to Lucilius", "Seneca"),
      aliases: ["Letters from a Stoic"],
    };
    expect(searchCatalog([letters], "letters from a stoic")).toEqual([letters]);
    expect(searchCatalog([letters], "letters from")).toEqual([letters]);
  });
  it("excludes owned books and does not infer subjects from ambiguous manual matches", () => {
    const a = entry("a", "Book"),
      b = entry("b", "Next");
    const own = book(a);
    expect(
      recommendCatalog([a, b], [own], []).items.map((i) => i.entry.id),
    ).toEqual(["b"]);
    const manual = { ...own, catalog: undefined };
    expect(
      recommendCatalog([a, { ...a, id: "another" }, b], [manual], [])
        .personalized,
    ).toBe(false);
  });
  it("uses actual progress and limits repeated authors", () => {
    const a = entry("a", "Owned");
    const result = recommendCatalog(
      [
        a,
        ...Array.from({ length: 8 }, (_, i) => entry(String(i), "Book " + i)),
        entry("x", "Different", "Other author"),
      ],
      [book(a)],
      [],
    );
    expect(result.personalized).toBe(true);
    expect(
      result.items.filter((i) => i.entry.author === "Jane Austen").length,
    ).toBeLessThanOrEqual(2);
    expect(result.items.some((i) => i.entry.id === "x")).toBe(true);
  });
  it("never treats catalog assets as private uploads", () => {
    const b = book(entry("a", "Book"));
    b.cover.blobId = "shared";
    b.customCoverBlobId = "private";
    b.catalog!.assets = [
      { id: "shared", bytes: 1, sha256: "a".repeat(64), type: "image/png" },
    ];
    expect(privateBookAssets(b)).toEqual(["private"]);
  });
});
describe("download integrity", () => {
  it("rejects altered, short, and oversized content", async () => {
    const bytes = new Uint8Array([1, 2, 3]),
      asset = { bytes: 3, sha256: await sha256(bytes), type: "image/png" };
    expect((await verifiedAsset(new Response(bytes), asset)).size).toBe(3);
    await expect(
      verifiedAsset(new Response(new Uint8Array([1, 2])), asset),
    ).rejects.toThrow();
    await expect(
      verifiedAsset(new Response(new Uint8Array([1, 2, 4])), asset),
    ).rejects.toThrow();
    await expect(
      verifiedAsset(new Response(new Uint8Array([1, 2, 3, 4])), asset),
    ).rejects.toThrow();
  });
});
describe("structured source safeguards", () => {
  it("checks token multiplicity and numeric retention", () => {
    expect(retainedText("one one 203", "one 203")).toBe(false);
    expect(retainedText("one 203", "one 204")).toBe(false);
    expect(retainedText("one\n203", "one 203")).toBe(true);
  });
  it("rejects archives without an EPUB mimetype and traversal entries", () => {
    expect(() =>
      unpackEpub(zipSync({ "text.txt": strToU8("not an epub") })),
    ).toThrow();
    expect(() =>
      unpackEpub(
        zipSync({
          mimetype: strToU8("application/epub+zip"),
          "../outside": strToU8("bad"),
        }),
      ),
    ).toThrow();
  });
  it("resolves relative links while rejecting external resource fetches", () => {
    expect(resourcePath("OPS/chapter.xhtml", "../images/cover.jpg")).toEqual({
      path: "images/cover.jpg",
      fragment: "",
    });
    expect(() =>
      resourcePath("book.xhtml", "http://127.0.0.1/private"),
    ).toThrow();
    expect(() => resourcePath("book.xhtml", "images\\outside")).toThrow();
  });
  it("preserves XHTML empty anchors without changing void elements or quoted text", () => {
    expect(
      expandEmptyXhtmlTags(
        '<p><a id="page"/>Text<br/><img src="cover.jpg"/></p>',
      ),
    ).toBe('<p><a id="page"></a>Text<br/><img src="cover.jpg"/></p>');
    expect(expandEmptyXhtmlTags('<span title="a > b" />')).toBe(
      '<span title="a > b" ></span>',
    );
    expect(expandEmptyXhtmlTags('<a broken <span id="valid"/>')).toBe(
      '<a broken <span id="valid"></span>',
    );
  });
});
