import { it, expect } from "vitest";
import { bulkGutenbergCandidates } from "../scripts/catalog/gutenberg-bulk.mjs";
const rights = {
  source: "https://www.gutenberg.org/cache/epub/feeds/rdf-files.tar.zip",
  sha256: "a".repeat(64),
  rights: {
    "1": "Public domain in the USA.",
    "2": "Public domain in the USA.",
    "3": "Copyrighted. Read the copyright notice inside this book for details.",
    "4": "Public domain in the USA.",
    "5": "Public domain in the USA.",
  },
};
const covers = {
  source: "https://www.gutenberg.org/cache/epub/feeds/img_data.csv.gz",
  sha256: "b".repeat(64),
  ids: ["1", "2", "3", "4"],
};
const rows = [1, 2, 3, 4, 5].map((id) => ({
  "Text#": String(id),
  Type: "Text",
  Title: `Book ${id}`,
  Authors: "Writer, A.",
  Language: "en",
  Subjects: "Literature",
  Bookshelves: id === 2 ? "Category: Science" : "Category: Fiction",
  LoCC: "P",
}));
it("requires item-level public-domain evidence and uses real-cover inventory as a discovery hint", () => {
  expect(
    bulkGutenbergCandidates(rows, rights, covers, {
      limit: 10,
      excluded: ["pg-4"],
    })
      .map((r) => r.id)
      .sort(),
  ).toEqual(["pg-1", "pg-2"]);
  const priority = bulkGutenbergCandidates(rows, rights, covers, {
    limit: 1,
    priority: ["5"],
  });
  expect(priority[0].id).toBe("pg-5");
  expect(priority[0].evidence.rightsArchiveSha256).toBe(rights.sha256);
});
it("balances subjects and holds preview or partial metadata without weakening worker gates", () => {
  const selected = bulkGutenbergCandidates(rows, rights, covers, { limit: 2 });
  expect(selected).toHaveLength(2);
  expect(selected.some((r) => r.id === "pg-2")).toBe(true);
  expect(selected.some((r) => ["pg-1", "pg-4"].includes(r.id))).toBe(true);
  expect(
    bulkGutenbergCandidates(
      [{ ...rows[0], Title: "Book preview" }],
      rights,
      covers,
    ),
  ).toEqual([]);
  expect(() =>
    bulkGutenbergCandidates(
      rows,
      { ...rights, source: "https://unverified.test/feed" },
      covers,
    ),
  ).toThrow("official");
});
