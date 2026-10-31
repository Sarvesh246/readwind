import type { Anchor, Block, Book } from './types';
import { hasReadableContent } from './content';

// Readers search from memory: they half-remember a line, misspell a name, type "dont"
// for "don’t", or recall the right words in the wrong order. So a block matches when
// enough of the query's words appear close together, and exact phrases rank first.

type Token = { word: string; start: number; end: number };
export type SearchHit = { at: Anchor; text: string; score: number };

const WORD = /[\p{L}\p{N}]+(?:['’‘ʼ][\p{L}\p{N}]+)*/gu;
const STOP = new Set('a an and are as at be but by for from had has have he her his i if in is it its me my not of on or our she so that the their them then there they this to was we were what when which who will with you your'.split(' '));
const MIN_SCORE = 0.5;

export function fold(text: string) {
  return text.normalize('NFKD').replace(/\p{M}/gu, '').replace(/['’‘ʼ]/g, '').toLowerCase();
}

function tokenize(text: string): Token[] {
  const out: Token[] = [];
  for (const m of text.matchAll(WORD)) {
    const word = fold(m[0]);
    if (word) out.push({ word, start: m.index, end: m.index + m[0].length });
  }
  return out;
}

const tokenCache = new WeakMap<Block, Token[]>();
function blockTokens(block: Block) {
  let tokens = tokenCache.get(block);
  if (!tokens) tokenCache.set(block, tokens = tokenize(block.text || ''));
  return tokens;
}

function stem(word: string) {
  if (word.length < 5) return word;
  const s = word.replace(/(ingly|edly|ing|ed|es|ly|s)$/, '');
  return s.length >= 3 ? s : word;
}

// Optimal string alignment distance (counts a swapped pair as one typo); gives up past `max`.
function distance(a: string, b: string, max: number) {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev2: number[] = [], prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    let best = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let d = Math.min(prev[j] + 1, row[j - 1] + 1, prev[j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d = Math.min(d, prev2[j - 2] + 1);
      row[j] = d;
      if (d < best) best = d;
    }
    if (best > max) return max + 1;
    prev2 = prev;
    prev = row;
  }
  return prev[b.length];
}

// How well a word in the book stands in for a word the reader typed, 0 to 1.
function closeness(q: string, t: string) {
  if (q === t) return 1;
  if (q.length >= 2 && t.startsWith(q)) return q.length >= 3 ? 0.9 : 0.7;
  const s = stem(q), u = stem(t);
  if (s.length >= 3 && s === u) return 0.85;
  if ((q.length >= 3 || /[^\u0000-ɏ]/.test(q)) && t.includes(q)) return 0.6;
  const max = q.length >= 8 ? 2 : q.length >= 4 ? 1 : 0;
  if (!max) return 0;
  const d = distance(q, t, max);
  return d > max ? 0 : d === 1 ? 0.75 : 0.65;
}

export function searchBook(book: Pick<Book, 'sections'>, query: string, limit = 60) {
  const all = tokenize(query).map(t => t.word);
  if (all.join('').length < 2) return { hits: [] as SearchHit[], total: 0 };
  const content = all.filter(w => !STOP.has(w));
  const words = content.length ? content : all;
  const need = words.length <= 2 ? words.length : Math.ceil(words.length * 0.6);
  const span = Math.max(8, words.length * 3 + 2);
  const memo = new Map<string, number[]>();
  const qualities = (word: string) => {
    let q = memo.get(word);
    if (!q) memo.set(word, q = words.map(w => closeness(w, word)));
    return q;
  };
  const found: (SearchHit & { order: number })[] = [];
  book.sections.forEach((sec, section) => sec.blocks.forEach((b, block) => {
    if (!hasReadableContent(b)) return;
    const tokens = blockTokens(b);
    if (tokens.length < 1) return;
    const quality = tokens.map(t => qualities(t.word));
    let best = 0, from = -1, to = -1;
    for (let i = 0; i < tokens.length; i++) {
      const pos: number[] = [];
      let sum = 0, matched = 0;
      for (let j = 0; j < words.length; j++) {
        let q = 0, at = -1;
        for (let k = i; k < Math.min(tokens.length, i + span); k++) {
          if (quality[k][j] > q) { q = quality[k][j]; at = k; }
        }
        pos.push(at);
        if (q > 0) { sum += q; matched++; }
      }
      if (matched < need) continue;
      const hit = pos.filter(p => p >= 0);
      const first = Math.min(...hit), last = Math.max(...hit);
      let score = sum / words.length;
      const inOrder = hit.every((p, n) => n === 0 || p > hit[n - 1]);
      if (inOrder) {
        score += 0.05;
        const joined = hit.every((p, n) => n === 0 || tokens.slice(hit[n - 1] + 1, p).every(t => STOP.has(t.word)));
        if (joined) score += 0.3;
      }
      score -= 0.1 * Math.min(1, (last - first + 1 - hit.length) / span);
      if (score > best) { best = score; from = first; to = last; }
    }
    if (best < MIN_SCORE) return;
    const text = b.text || '', s = tokens[from].start, e = Math.min(tokens[to].end, s + 180);
    found.push({
      at: { section, block, offset: s },
      text: text.slice(Math.max(0, s - 45), Math.min(text.length, e + 60)),
      score: best,
      order: found.length,
    });
  }));
  found.sort((a, b) => b.score - a.score || a.order - b.order);
  return { hits: found.slice(0, limit).map(({ order, ...hit }) => hit), total: found.length };
}
