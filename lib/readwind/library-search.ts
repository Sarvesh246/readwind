import type { ReadwindDB } from "./db";
import { hasReadableContent } from "./content";
import { fold } from "./search";
import type { Anchor, Book } from "./types";

export type LibraryTextHit = { at: Anchor; snippet: string; count: number };

/** Words shorter than this match too much to be a useful way of finding a book. */
export const MIN_TEXT_SEARCH = 3;

/** The first place in a book that contains the phrase, with the surrounding words, or null. */
export function findPhrase(book: Pick<Book, "sections">, phrase: string): LibraryTextHit | null {
  const q = fold(phrase).trim().replace(/\s+/g, " ");
  if (q.length < MIN_TEXT_SEARCH) return null;
  let first: LibraryTextHit | null = null, count = 0;
  book.sections.forEach((section, s) =>
    section.blocks.forEach((block, b) => {
      if (!hasReadableContent(block) || block.type === "figure") return;
      const text = block.text;
      const folded = fold(text).replace(/\s+/g, " ");
      let from = 0, index = folded.indexOf(q);
      while (index !== -1) {
        count++;
        if (!first) {
          // Folding can change the length (accents, ligatures), so map the position proportionally.
          const at = folded.length === text.length ? index : Math.floor((index / folded.length) * text.length);
          const start = Math.max(0, at - 60), end = Math.min(text.length, at + q.length + 90);
          first = {
            at: { section: s, block: b, offset: at },
            snippet: `${start > 0 ? "…" : ""}${text.slice(start, end).trim()}${end < text.length ? "…" : ""}`,
            count: 0,
          };
        }
        from = index + q.length;
        index = folded.indexOf(q, from);
      }
    }),
  );
  return first ? { ...(first as LibraryTextHit), count } : null;
}

/**
 * Looks inside every book for the phrase. Books are read one at a time and the loop yields between them,
 * so the shelf stays responsive and only one book body is in memory at once.
 */
export async function searchLibraryText(db: ReadwindDB, phrase: string, cancelled: () => boolean) {
  const hits = new Map<string, LibraryTextHit>();
  if (fold(phrase).trim().length < MIN_TEXT_SEARCH) return hits;
  for (const id of await db.shelf.toCollection().primaryKeys()) {
    if (cancelled()) return hits;
    const book = await db.books.get(id);
    const hit = book && findPhrase(book, phrase);
    if (hit) hits.set(id, hit);
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }
  return hits;
}
