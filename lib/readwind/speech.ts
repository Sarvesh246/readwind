import type { Anchor, Book } from "./types";
import { compare, bookDensity } from "./anchors";
import { hasReadableContent } from "./content";
import { isContentsSection } from "./reading-layout";
import { readingWordCount } from "./word-count";

/**
 * The audiobook's script: the whole book as sentence-sized chunks, each tied to the exact source
 * characters it voices. Sentences keep every utterance short (Chrome silently drops long ones), make
 * skipping exact, and let the spoken position become the saved reading position.
 */
export type Chunk = {
  section: number;
  block: number;
  /** Source character range in the block's text. */
  start: number;
  end: number;
  /** What the voice says, after cleanup. */
  say: string;
  /** `map[i]` is the source offset of `say[i]`, for word highlighting from boundary events. */
  map: number[];
  /** Counted words, for timing and reading credit. */
  words: number;
  kind: "text" | "title" | "caption";
};
export type Script = {
  chunks: Chunk[];
  /** Index of each section's first chunk (sections with nothing to read are absent). */
  sectionFirst: Map<number, number>;
  /** Words before each chunk, for elapsed and remaining time. */
  before: number[];
  totalWords: number;
  density: number;
};

/** Typical text-to-speech pace at rate 1.0, in standard words per minute. */
export const VOICE_WPM = 165;
/** Longest sentence spoken as one utterance before splitting at a pause. */
const MAX_CHUNK = 260;

const ABBREVIATIONS: [RegExp, string][] = [
  [/\be\.g\./g, "for example"],
  [/\bi\.e\./g, "that is"],
  [/\betc\./g, "et cetera"],
  [/\bvs\./g, "versus"],
  [/\bMrs\./g, "Missus"],
  [/\bMr\./g, "Mister"],
  [/\bDr\./g, "Doctor"],
  [/\bSt\./g, "Saint"],
];
/** Ends of these words are not sentence ends. */
const NO_BREAK = /(?:\b(?:Mr|Mrs|Ms|Dr|St|Jr|Sr|Prof|vs|etc|e\.g|i\.e|cf|No|Vol|ch|p|pp|fig)|\b[A-Z])\.$/;

/**
 * Text ready for the voice, with a map back to source offsets. Soft hyphens, superscript footnote
 * markers and print-page markers are dropped; a few abbreviations are read in full.
 */
export function speakable(text: string, base = 0): { say: string; map: number[] } {
  const chars: string[] = [],
    map: number[] = [];
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === "­" || /[¹²³⁰-⁹]/.test(c)) continue;
    if (c === "│") {
      while (i + 1 < text.length && /\d/.test(text[i + 1])) i++;
      continue;
    }
    chars.push(/\s/.test(c) ? " " : c);
    map.push(base + i);
  }
  let say = chars.join("");
  let offsets = map;
  for (const [pattern, full] of ABBREVIATIONS) {
    pattern.lastIndex = 0;
    if (!pattern.test(say)) continue;
    pattern.lastIndex = 0;
    let out = "",
      outMap: number[] = [],
      last = 0;
    for (const m of say.matchAll(pattern)) {
      const at = m.index!;
      out += say.slice(last, at);
      outMap = outMap.concat(offsets.slice(last, at));
      out += full;
      outMap = outMap.concat(Array(full.length).fill(offsets[at]));
      last = at + m[0].length;
    }
    out += say.slice(last);
    outMap = outMap.concat(offsets.slice(last));
    say = out;
    offsets = outMap;
  }
  return { say, map: offsets };
}

/** Sentence ranges `[start, end)` within `text`, long ones split at a natural pause. */
export function sentences(text: string): [number, number][] {
  const out: [number, number][] = [];
  const re = /[.!?…]+["”’')\]]*(?=\s+|$)/g;
  let start = 0;
  for (const m of text.matchAll(re)) {
    const end = m.index! + m[0].length;
    if (NO_BREAK.test(text.slice(Math.max(start, end - 6), end)) && end < text.length) continue;
    out.push([start, end]);
    start = end;
  }
  if (start < text.length) out.push([start, text.length]);
  const split: [number, number][] = [];
  for (const [first, b] of out) {
    let a = first;
    while (a < b && /\s/.test(text[a])) a++;
    if (a >= b) continue;
    while (b - a > MAX_CHUNK) {
      const window = text.slice(a, a + MAX_CHUNK);
      const cut = Math.max(window.lastIndexOf("; "), window.lastIndexOf(", "), window.lastIndexOf(" —"), window.lastIndexOf(": "));
      const at = cut > MAX_CHUNK * 0.4 ? a + cut + 1 : a + (window.lastIndexOf(" ") > 0 ? window.lastIndexOf(" ") : MAX_CHUNK);
      split.push([a, at]);
      a = at;
      while (a < b && /\s/.test(text[a])) a++;
    }
    if (a < b) split.push([a, b]);
  }
  return split;
}

const scripts = new WeakMap<Book, Map<string, Script>>();
/** The book's script, built once per book snapshot and option set. */
export function scriptOf(book: Book, options: { readCaptions?: boolean } = {}): Script {
  const key = options.readCaptions ? "captions" : "plain";
  let byKey = scripts.get(book);
  if (!byKey) scripts.set(book, (byKey = new Map()));
  const cached = byKey.get(key);
  if (cached) return cached;
  const chunks: Chunk[] = [],
    sectionFirst = new Map<number, number>();
  book.sections.forEach((section, s) => {
    if (isContentsSection(book, s)) return;
    const firstText = section.blocks.findIndex(hasReadableContent);
    const begin = chunks.length;
    const title = section.title.trim();
    const opensWithTitle =
      firstText >= 0 &&
      section.blocks[firstText].type === "h" &&
      (section.blocks[firstText].text || "").trim().toLowerCase() === title.toLowerCase();
    if (title && section.heading && !opensWithTitle && firstText >= 0) {
      const { say, map } = speakable(title);
      chunks.push({ section: s, block: firstText, start: 0, end: 0, say, map: map.map(() => 0), words: readingWordCount(title), kind: "title" });
    }
    section.blocks.forEach((block, b) => {
      if (block.type === "figure") {
        if (options.readCaptions && block.caption?.trim()) {
          const { say } = speakable(block.caption);
          chunks.push({ section: s, block: b, start: 0, end: 0, say: `Figure: ${say}`, map: [], words: readingWordCount(block.caption), kind: "caption" });
        }
        return;
      }
      if (!hasReadableContent(block) || block.contentsEntry) return;
      const text = block.text || "";
      for (const [a, z] of sentences(text)) {
        const { say, map } = speakable(text.slice(a, z), a);
        if (!/[\p{L}\p{N}]/u.test(say)) continue;
        chunks.push({ section: s, block: b, start: a, end: z, say: say.trim(), map, words: readingWordCount(text.slice(a, z)), kind: "text" });
      }
    });
    if (chunks.length > begin) sectionFirst.set(s, begin);
  });
  const before: number[] = [];
  let total = 0;
  for (const c of chunks) {
    before.push(total);
    total += c.words;
  }
  const script = { chunks, sectionFirst, before, totalWords: total, density: bookDensity(book) };
  byKey.set(key, script);
  return script;
}

export const anchorOf = (c: Chunk): Anchor => ({ section: c.section, block: c.block, offset: c.start });

/** The chunk being read at `at`, or the next one after it. */
export function chunkAt(script: Script, at: Anchor): number {
  const { chunks } = script;
  let lo = 0,
    hi = chunks.length - 1,
    found = chunks.length ? 0 : -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const c = chunks[mid];
    const end: Anchor = { section: c.section, block: c.block, offset: Math.max(c.end, c.start + 1) };
    if (compare(end, at) <= 0) lo = mid + 1;
    else {
      found = mid;
      hi = mid - 1;
    }
  }
  return lo >= chunks.length ? chunks.length - 1 : found;
}

/** Words per minute the voice speaks at `rate`, in this book's counted words. */
export const voiceWpm = (rate: number, density = 1, base = VOICE_WPM) => (base * rate) / Math.max(0.25, density);
export const secondsFor = (words: number, wpm: number) => (words * 60) / Math.max(1, wpm);

/** Chunk to jump to for "back/forward N seconds", rounded to whole sentences so it never starts mid-word. */
export function skipBy(script: Script, index: number, seconds: number, wpm: number): number {
  const words = (Math.abs(seconds) * wpm) / 60;
  if (seconds < 0) {
    let i = index,
      covered = 0;
    while (i > 0 && covered < words) covered += script.chunks[--i].words;
    return i;
  }
  let i = index,
    covered = 0;
  while (i < script.chunks.length - 1 && covered < words) covered += script.chunks[i++].words;
  return i;
}

/** Sections in reading order with the chunk range and words each holds. */
export function chapters(script: Script, book: Book) {
  const entries = [...script.sectionFirst.entries()].sort((a, b) => a[0] - b[0]);
  return entries.map(([section, first], i) => {
    const last = i + 1 < entries.length ? entries[i + 1][1] : script.chunks.length;
    const words = (script.before[last] ?? script.totalWords) - script.before[first];
    return { section, title: book.sections[section].title || `Part ${i + 1}`, first, last, words };
  });
}

/** Where the current chapter starts and ends, for the scrubber. */
export function chapterRange(script: Script, index: number) {
  const section = script.chunks[index]?.section ?? 0;
  const first = script.sectionFirst.get(section) ?? 0;
  let last = first;
  while (last < script.chunks.length && script.chunks[last].section === section) last++;
  return { section, first, last };
}

/** "⏮" goes to the chapter start, or the previous chapter when already within its first few seconds. */
export function previousChapter(script: Script, index: number, heardSeconds: number) {
  const { first } = chapterRange(script, index);
  if (index > first || heardSeconds > 3) return first;
  return first > 0 ? chapterRange(script, first - 1).first : 0;
}
export function nextChapter(script: Script, index: number) {
  const { last } = chapterRange(script, index);
  return last < script.chunks.length ? last : -1;
}

export const formatDuration = (seconds: number) => {
  const m = Math.max(0, Math.round(seconds / 60));
  if (m < 60) return `${m} min`;
  return `${Math.floor(m / 60)} h ${m % 60} min`;
};
export const formatClock = (seconds: number) => {
  const s = Math.max(0, Math.round(seconds));
  const h = Math.floor(s / 3600),
    m = Math.floor((s % 3600) / 60),
    r = s % 60;
  return h ? `${h}:${String(m).padStart(2, "0")}:${String(r).padStart(2, "0")}` : `${m}:${String(r).padStart(2, "0")}`;
};

/**
 * Turns spoken sentences into reading-log credit: about one page per page's worth of words, with the
 * real listening time. Kept apart from pace samples so the voice never overwrites the reader's own speed.
 */
export class ListenCredit {
  private words = 0;
  private seconds = 0;
  /** Words heard since the session began, so pages are whole and never double-counted across flushes. */
  private heard = 0;
  private paged = 0;
  constructor(private wordsPerPage = 250) {}
  add(words: number, seconds: number) {
    this.words += words;
    this.heard += words;
    this.seconds += Math.max(0, Math.min(seconds, 120));
    if (this.words < this.wordsPerPage) return undefined;
    return this.flush();
  }
  flush() {
    if (this.words < 1 || this.seconds < 1) return undefined;
    const pages = Math.floor(this.heard / this.wordsPerPage) - this.paged;
    this.paged += pages;
    const credit = { pages, words: this.words, seconds: this.seconds, listenSeconds: this.seconds };
    this.words = 0;
    this.seconds = 0;
    return credit;
  }
}
