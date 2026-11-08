type NumberLine = {
  text: string;
  y: number;
  size: number;
};

type Candidate<T> = {
  line: T;
  page: number;
  value: number;
  roman: boolean;
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

/** A standalone number adjacent to a title may itself be a chapter heading. */
export function isLikelyHeadingNumber<T extends NumberLine>(line: T, lines: T[], body: number): boolean {
  if (!/^\s*\d{1,4}\s*$/.test(line.text)) return false;
  return lines.some(other => other !== line && other.y > line.y && other.y - line.y <= body * 3 &&
    other.size >= body * 0.95 && /^\s*(?:chapter\b|part\b|section\b|\p{Lu})/u.test(other.text) && other.text.trim().length <= 80);
}

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
      { line, page, value: Number(whole[1]), roman: false },
    ];
  const roman = romanValue(text);
  if (roman !== undefined)
    return [{ line, page, value: roman, roman: true }];
  return [];
}

/**
 * Removes printed page numbers that label detection missed.
 *
 * A number is only treated as a page number when it sits in the top or bottom
 * margin AND the page number on a nearby page counts in step with it (same
 * pages-minus-number offset). Numbers attached to text are always preserved,
 * since they may be chapter or list numbers.
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
  // Attached numbers can be chapter or list numbers even when their text and
  // numbering repeat in a header. Preserve them when the distinction is ambiguous.
  const verified = all.filter((c) => {
    if (isLikelyHeadingNumber(c.line, pages[c.page], body)) return false;
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
  for (const c of verified) drop.add(c.line);
  if (drop.size)
    for (const lines of pages) {
      for (let i = lines.length - 1; i >= 0; i--)
        if (drop.has(lines[i])) lines.splice(i, 1);
    }
  return verified.length;
}
