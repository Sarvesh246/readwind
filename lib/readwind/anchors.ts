import type { Anchor, Book } from "./types";
import { hasReadableContent } from './content';
import {readingWordCount} from './word-count';
// Books and sections are immutable snapshots in the library store.
const summaries=new WeakMap<Book,{starts:number[];sections:{start:number;end:number;blocks:number[]}[];total:number;chars:number}>();
function counts(book:Book){
  let cached=summaries.get(book);if(cached)return cached;
  let total=0,chars=0;const starts:number[]=[],sections:{start:number;end:number;blocks:number[]}[]=[];
  for(const section of book.sections){const begin=total,blocks:number[]=[];starts.push(total);for(const block of section.blocks){blocks.push(total);const text=hasReadableContent(block)?block.text || '':'';chars+=text.length;total+=readingWordCount(text);}sections.push({start:begin,end:total,blocks});}
  cached={starts,sections,total,chars};summaries.set(book,cached);return cached;
}
/**
 * How much reading a counted "word" represents in this book, relative to typical English prose
 * (about 5.7 characters per word including the space). Short-word text is below 1, long-word or
 * dense text above, and unspaced scripts (where a "word" is a short token) well below. Pace is learned
 * in these standard words so books and languages measure on one scale.
 */
export function bookDensity(book:Book){
  const {total,chars}=counts(book);
  if(!total||!chars)return 1;
  return Math.max(0.25,Math.min(2.5,chars/total/5.7));
}
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
export function sectionStart(book:Book, section:number):Anchor {
  const block=book.sections[section]?.blocks.findIndex(hasReadableContent) ?? -1;
  return {section,block:Math.max(0,block),offset:0};
}
export function wordProgress(book: Book, at: Anchor, wordsPerMinute = 230) {
  const speed = Number.isFinite(wordsPerMinute) && wordsPerMinute > 0 ? wordsPerMinute : 230;
  const summary=counts(book),total=summary.total;
  const section=summary.sections[at.section];
  const block=book.sections[at.section]?.blocks[at.block];
  const text=block && hasReadableContent(block)?block.text || '':'';
  const before=section ? (section.blocks[at.block] ?? section.end)+readingWordCount(text.slice(0,at.offset)) : total;
  const chapterLeft=section ? section.end-(section.blocks[at.block] ?? section.end)-readingWordCount(text)+readingWordCount(text.slice(at.offset)) : 0;
  return {
    pct: total ? before / total : 0,
    total,
    before,
    bookMinutes: Math.ceil(Math.max(0, total - before) / speed),
    minutes: Math.max(1, Math.ceil(chapterLeft / speed)),
  };
}
export const start: Anchor = { section: 0, block: 0, offset: 0 };
