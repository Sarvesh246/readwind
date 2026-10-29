import { describe, it, expect } from "vitest";
import {
  compare,
  contains,
  clampAnchor,
  labelAt,
  wordProgress,
} from "../lib/readwind/anchors";
import { geometry, pageIndex } from "../lib/readwind/pagination";
import { defaults } from "../lib/readwind/types";
import type { Book } from "../lib/readwind/types";
import walden from "../lib/readwind/walden.json";
const book = walden as Book;
describe("stable reading locations", () => {
  it("orders positions across sections and paragraphs", () => {
    expect(
      compare(
        { section: 1, block: 0, offset: 0 },
        { section: 0, block: 9, offset: 99 },
      ),
    ).toBeGreaterThan(0);
    expect(
      contains(
        { section: 0, block: 0, offset: 5 },
        { section: 0, block: 0, offset: 2 },
        { section: 0, block: 0, offset: 5 },
      ),
    ).toBe(false);
  });
  it("preserves the print label independently of font and viewport", () => {
    const mark = book.pageMarks.find((m) => m.label === "113")!;
    expect(labelAt(book, mark.at)).toBe("113");
    for (const w of [390, 844, 1440])
      for (const size of [14, 18, 28]) {
        geometry(w, 844, { ...defaults, size }, w < 900, w > 640);
        expect(labelAt(book, mark.at)).toBe("113");
      }
  });
  it("uses word counts and keeps reading progress monotonic", () => {
    const initial = wordProgress(book, { section: 0, block: 0, offset: 0 }),
      later = wordProgress(book, { section: 0, block: 1, offset: 180 });
    expect(initial.pct).toBe(0);
    expect(later.pct).toBeGreaterThan(initial.pct);
    expect(later.total).toBe(initial.total);
    expect(later.minutes).toBeGreaterThan(0);
  });
  it("clamps malformed positions to the available text", () => {
    const a = clampAnchor(book, { section: 999, block: 999, offset: 99999 });
    expect(a.section).toBe(1);
    expect(a.offset).toBe(book.sections[1].blocks[a.block].text!.length);
  });
  it("finds an anchor after a layout change, skipping blank pages", () => {
    const base = {
      fragments: [],
      chapterStart: false,
      chapterTitle: "",
      folio: "",
    };
    const pages = [
      {
        ...base,
        start: { section: 0, block: 0, offset: 0 },
        end: { section: 0, block: 0, offset: 100 },
      },
      {
        ...base,
        start: { section: 0, block: 0, offset: 100 },
        end: { section: 0, block: 0, offset: 200 },
      },
      {
        ...base,
        start: { section: 1, block: 0, offset: 0 },
        end: { section: 1, block: 0, offset: 0 },
        blank: true,
      },
      {
        ...base,
        start: { section: 1, block: 0, offset: 0 },
        end: { section: 1, block: 1, offset: 100 },
      },
    ];
    expect(pageIndex(pages, { section: 0, block: 0, offset: 150 }, false)).toBe(
      1,
    );
    expect(pageIndex(pages, { section: 1, block: 0, offset: 4 }, true)).toBe(2);
  });
});
