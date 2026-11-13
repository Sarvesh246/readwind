import { computeStats } from "./anchors";
import { bookAssets } from "./catalog";
import { hasReadableContent } from "./content";
import type { Book, ShelfBook } from "./types";

/** A real line from the opening of the book, cut at a sentence or word boundary. */
export function openingLine(book: Book) {
  const text =
    book.sections
      .flatMap((s) => s.blocks)
      .find((b) => b.type === "p" && hasReadableContent(b) && (b.text || "").length > 60)?.text || "";
  const stop = text.slice(0, 230).search(/[.!?;:]["”’]?\s/);
  if (stop > 50) return text.slice(0, stop + 1);
  if (text.length <= 170) return text;
  return `${text.slice(0, 170).replace(/\s+\S*$/, "")}…`;
}

/** The text-free row the shelf lists. Everything the shelf shows is computed here, once, at write time. */
export function toShelf(book: Book): ShelfBook {
  const { sections, ...rest } = book;
  delete rest.footnotes;
  delete rest.importReport;
  return {
    ...rest,
    sections: sections.map(({ id, title, heading, level }) => ({ id, title, heading, level })),
    stats: computeStats(book),
    opening: openingLine(book),
    assets: bookAssets(book),
  };
}
