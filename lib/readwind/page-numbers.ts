import type { TextStyleRun } from "./rich-text";

type NumberLine = {
  text: string;
  x: number;
  y: number;
  size: number;
  endX?: number;
  styles?: TextStyleRun[];
};

type Candidate<T> = {
  line: T;
  page: number;
  value: number;
  roman: boolean;
  kind: "whole" | "prefix" | "suffix";
};

const ROMAN =
  /^(?=[mdclxvi])m{0,3}(?:cm|cd|d?c{0,3})(?:xc|xl|l?x{0,3})(?:ix|iv|v?i{0,3})$/;
const ROMAN_VALUES: Record<string, number> = {
  i: 1,
  v: 5,
  x: 10,
  l: 50,
  c: 100,
  d: 500,
  m: 1000,
};
const WINDOW = 6;

function romanValue(text: string): number | undefined {
  if (text !== text.toLowerCase() && text !== text.toUpperCase())
    return undefined;
  const t = text.toLowerCase();
  if (!ROMAN.test(t)) return undefined;
  let total = 0;
  for (let i = 0; i < t.length; i++) {
    const v = ROMAN_VALUES[t[i]];
    total += v < (ROMAN_VALUES[t[i + 1]] || 0) ? -v : v;
  }
  return total;
}

function candidatesOf<T extends NumberLine>(
  line: T,
  page: number,
  height: number,
  body: number,
): Candidate<T>[] {
  const inBand = line.y < height * 0.16 || line.y > height * 0.86;
  if (!inBand || line.size > body * 1.2) return [];
  const text = line.text.replace(/\s+/g, " ").trim();
  const whole =
    text.match(/^(?:[-–—•·]\s*)?(\d{1,4})(?:\s*[-–—•·])?$/) ||
    text.match(/^page\s+(\d{1,4})$/i) ||
    text.match(/^(\d{1,4})\s*(?:\/|of)\s*\d{1,4}$/i);
  if (whole)
    return [
      { line, page, value: Number(whole[1]), roman: false, kind: "whole" },
    ];
  const roman = romanValue(text);
  if (roman !== undefined)
    return [{ line, page, value: roman, roman: true, kind: "whole" }];
  const found: Candidate<T>[] = [];
  const prefix = text.match(/^(\d{1,4})\s+(?=\p{L})/u);
  if (prefix && /\p{L}/u.test(text.slice(prefix[0].length)))
    found.push({
      line,
      page,
      value: Number(prefix[1]),
      roman: false,
      kind: "prefix",
    });
  const suffix = text.match(/\p{L}[^\d]*\s(\d{1,4})$/u);
  if (suffix && !prefix)
    found.push({
      line,
      page,
      value: Number(suffix[1]),
      roman: false,
      kind: "suffix",
    });
  return found;
}

function trim<T extends NumberLine>(line: T, kind: "prefix" | "suffix") {
  const original = line.text;
  const m =
    kind === "prefix"
      ? original.match(/^\s*\d{1,4}\s+/)
      : original.match(/\s+\d{1,4}\s*$/);
  if (!m) return;
  const cut = m[0].length;
  if (kind === "prefix") {
    if (line.endX !== undefined && original.length)
      line.x += ((line.endX - line.x) * cut) / original.length;
    line.text = original.slice(cut);
    if (line.styles)
      line.styles = line.styles
        .map((r) => ({
          ...r,
          start: Math.max(0, r.start - cut),
          end: r.end - cut,
        }))
        .filter((r) => r.end > r.start);
  } else {
    line.text = original.slice(0, original.length - cut);
    if (line.styles)
      line.styles = line.styles
        .map((r) => ({ ...r, end: Math.min(r.end, line.text.length) }))
        .filter((r) => r.end > r.start);
    if (line.endX !== undefined && original.length)
      line.endX -= ((line.endX - line.x) * cut) / original.length;
  }
}

/**
 * Removes printed page numbers that label detection missed.
 *
 * A number is only treated as a page number when it sits in the top or bottom
 * margin AND the page number on a nearby page counts in step with it (same
 * pages-minus-number offset). A stray figure in the text can't satisfy both,
 * so numbers that really belong to the book are left alone.
 */
export function stripPageNumbers<T extends NumberLine>(
  pages: T[][],
  heights: number[],
  body: number,
): number {
  const all = pages.flatMap((lines, page) =>
    lines.flatMap((line) =>
      candidatesOf(line, page, heights[page] || 800, body),
    ),
  );
  const byPage = new Map<number, Candidate<T>[]>();
  for (const c of all) byPage.set(c.page, [...(byPage.get(c.page) || []), c]);
  const verified = all.filter((c) => {
    for (let d = 1; d <= WINDOW; d++)
      for (const j of [c.page - d, c.page + d])
        if (
          byPage
            .get(j)
            ?.some(
              (o) => o.roman === c.roman && j - o.value === c.page - c.value,
            )
        )
          return true;
    return false;
  });
  const drop = new Set<T>();
  for (const c of verified) {
    if (c.kind === "whole") drop.add(c.line);
    else trim(c.line, c.kind);
  }
  if (drop.size)
    for (const lines of pages) {
      for (let i = lines.length - 1; i >= 0; i--)
        if (drop.has(lines[i])) lines.splice(i, 1);
    }
  return verified.length;
}
