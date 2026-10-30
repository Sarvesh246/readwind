import type { Book, PageMark } from './types';

type SourceLine = { text: string; header: boolean; y: number; size: number };
const key = (s: string) => s.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
const pageToken = /^(?:[1-9]\d*|[ivxlcdm]+)$/i;

export function interpolatePrintedLabels(labels: string[]): string[] {
  return labels.map((label, i) => {
    if (!label.startsWith('PDF ')) return label;
    let left=i-1, right=i+1;
    while (left>=0 && labels[left].startsWith('PDF ')) left--;
    while (right<labels.length && labels[right].startsWith('PDF ')) right++;
    if (left<0 || right>=labels.length || !/^\d+$/.test(labels[left]) || !/^\d+$/.test(labels[right])) return label;
    return Number(labels[right])-Number(labels[left]) === right-left ? String(Number(labels[left])+i-left) : label;
  });
}

/** Unknown printed numbers are explicitly distinct from physical PDF positions. */
export function printedLabels(pages: SourceLine[][], embedded?: string[] | null, heights?: number[]): string[] {
  const observed = pages.map((lines, i) => {
    const body = lines.filter(l => !l.header && l.text.length > 20);
    const bodySize = body.length ? Math.min(...body.map(l => l.size)) : 12;
    const tokens = [...new Set(lines.filter(l => l.header && (l.y > (heights?.[i] || 800) / 2 || (l.size <= bodySize * 1.1 && body.length > 0))).map(l => l.text.trim()).filter(t => pageToken.test(t)))];
    return tokens.length === 1 ? tokens[0] : undefined;
  });
  return interpolatePrintedLabels(pages.map((_, i) => {
    if (observed[i]) return observed[i]!;
    if (embedded?.[i]) return embedded[i];
    return `PDF ${i + 1}`;
  }));
}

export function findPrintedPage(marks: PageMark[], input: string): PageMark | undefined {
  const matches = marks.filter(m => m.label.trim().toLowerCase() === input.trim().toLowerCase());
  return matches.length === 1 ? matches[0] : undefined;
}

export type ContentsLink = { top:number; bottom:number; index:number };
export function contentsChapters(pages: SourceLine[][], labels: string[], links = new Map<number, ContentsLink[]>()) {
  const chapters = new Map<number, string>();
  const unresolved: string[] = [];
  const contentsPages = new Set<number>();
  let continuing = false;
  for (let pi = 0; pi < Math.min(pages.length, 80); pi++) {
    const lines = pages[pi];
    const explicit = lines.some(l => /^(?:tableof)?contents$/i.test(l.text.replace(/\s/g, '')));
    // Reassemble right-aligned page numbers split by the PDF layout analyzer.
    const rows: { y: number; text: string }[] = [];
    for (const l of [...lines].sort((a,b) => a.y-b.y)) {
      const row = rows.find(r => Math.abs(r.y-l.y) < 3);
      if (row) row.text += '  ' + l.text; else rows.push({ y:l.y, text:l.text });
    }
    const entries = rows.flatMap(l => {
      const m = l.text.trim().match(/^(.{2,180}?)\s*(?:\.{2,}|…+|\s{2,}|\s)([1-9]\d*|[ivxlcdm]+)\s*$/i);
      return m && /\p{L}/u.test(m[1]) ? [{ title:m[1].replace(/[.\s…]+$/, ''), label:m[2], y:l.y }] : [];
    });
    if (!(explicit || continuing) || entries.length < 2) { continuing = false; continue; }
    continuing = true;
    contentsPages.add(pi);
    for (const entry of entries) {
      const matches = labels.flatMap((label, i) => label.toLowerCase() === entry.label.toLowerCase() && i > pi ? [i] : []);
      const titleKey = key(entry.title);
      const titleMatches = pages.flatMap((ls, i) => i > pi && ls.some(l => l.y < 300 && key(l.text) === titleKey) ? [i] : []);
      const linked = [...new Set((links.get(pi) || []).filter(l=>entry.y >= l.top-3 && entry.y <= l.bottom+3 && l.index>pi && l.index<pages.length).map(l=>l.index))];
      const target = linked.length === 1 ? linked[0] : matches.length === 1 ? matches[0] : titleMatches.length === 1 ? titleMatches[0] : undefined;
      if (target === undefined || (matches.length === 1 && matches[0] !== target) || (titleMatches.length === 1 && titleMatches[0] !== target)) { unresolved.push(entry.title); continue; }
      if (!chapters.has(target)) chapters.set(target, entry.title);
      if (labels[target].startsWith('PDF ')) labels[target] = entry.label;
    }
  }
  return { chapters, unresolved, contentsPages };
}

/** Split at an existing page anchor so no source text, figures or page marks are lost. */
export function addChapterAtPage(book: Book, label: string, title: string): Book {
  const mark = findPrintedPage(book.pageMarks, label);
  if (!mark) throw new Error('That printed page is missing or ambiguous. Correct its page label in the preview first.');
  if (!title.trim()) throw new Error('Enter a chapter title.');
  const b = structuredClone(book), { section: si, block: bi } = mark.at;
  if (mark.at.offset !== 0) throw new Error('This page starts inside a paragraph and cannot be split safely.');
  if (bi === 0) { b.sections[si].title = title.trim(); b.sections[si].heading = true; return b; }
  b.sections.splice(si + 1, 0, { id:crypto.randomUUID(), title:title.trim(), heading:true, blocks:b.sections[si].blocks.splice(bi) });
  b.pageMarks = b.pageMarks.map(m => ({ ...m, at:m.at.section === si && m.at.block >= bi ? { ...m.at, section:si+1, block:m.at.block-bi } : m.at.section > si ? { ...m.at, section:m.at.section+1 } : m.at }));
  return b;
}
