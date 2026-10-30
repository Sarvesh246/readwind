import type { Anchor, Book } from "./types";
import { hasReadableContent } from './content';
export function compare(a: Anchor, b: Anchor) {
  return a.section - b.section || a.block - b.block || a.offset - b.offset;
}
export function contains(a: Anchor, start: Anchor, end: Anchor) {
  return compare(a, start) >= 0 && compare(a, end) < 0;
}
export function clampAnchor(book: Book, a: Anchor): Anchor {
  const section = Math.min(Math.max(0, a.section), book.sections.length - 1);
  const block = Math.min(
    Math.max(0, a.block),
    book.sections[section].blocks.length - 1,
  );
  return {
    section,
    block,
    offset: Math.min(
      Math.max(0, a.offset),
      (book.sections[section].blocks[block].text || "").length,
    ),
  };
}
export function labelAt(book: Book, a: Anchor) {
  let label = book.pageMarks[0]?.label || "1";
  for (const m of book.pageMarks) {
    if (compare(m.at, a) > 0) break;
    label = m.label;
  }
  return label;
}
export function wordProgress(book: Book, at: Anchor, wordsPerMinute = 230) {
  const speed = Number.isFinite(wordsPerMinute) && wordsPerMinute > 0 ? wordsPerMinute : 230;
  let total = 0,
    before = 0,
    chapterLeft = 0;
  book.sections.forEach((s, si) =>
    s.blocks.forEach((b, bi) => {
      const t = hasReadableContent(b) ? b.text || "" : "";
      const words = t.trim() ? t.trim().split(/\s+/).length : 0;
      total += words;
      if (si < at.section || (si === at.section && bi < at.block))
        before += words;
      else if (si === at.section && bi === at.block)
        before += t
          .slice(0, at.offset)
          .trim()
          .split(/\s+/)
          .filter(Boolean).length;
      if (si === at.section && bi >= at.block)
        chapterLeft += (bi === at.block ? t.slice(at.offset) : t)
          .trim()
          .split(/\s+/)
          .filter(Boolean).length;
    }),
  );
  return {
    pct: total ? before / total : 0,
    total,
    before,
    bookMinutes: Math.ceil(Math.max(0, total - before) / speed),
    minutes: Math.max(1, Math.ceil(chapterLeft / speed)),
  };
}
export const start: Anchor = { section: 0, block: 0, offset: 0 };
