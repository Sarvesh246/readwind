// Builds lib/readwind/classics.json from Project Gutenberg plain-text files.
// Usage: node scripts/build-classics.mjs <dir containing pg<ID>.txt files>
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const srcDir = process.argv[2];
if (!srcDir) {
  console.error("usage: node scripts/build-classics.mjs <temp-dir>");
  process.exit(1);
}
const outFile = resolve(dirname(fileURLToPath(import.meta.url)), "..", "lib", "readwind", "classics.json");

const WORDS_PER_PAGE = 280;
const BASE_TIME = 1793203200000;

const eq = (s) => (l) => l === s;
const re = (r) => (l) => r.test(l);

const BOOKS = [
  {
    id: "classic-walden", pg: 205, title: "Walden", author: "Henry David Thoreau",
    color: "#2F4A3A", fg: "#F1E4D6",
    sections: [
      { title: "Where I Lived, and What I Lived For", start: eq("Where I Lived, and What I Lived For") },
      { title: "Reading", start: eq("Reading") },
    ],
    // "Sounds" is left out: all three chapters run ~15.5k words, over the 10k cap.
    end: eq("Sounds"),
  },
  {
    id: "classic-meditations", pg: 2680, title: "Meditations", author: "Marcus Aurelius",
    color: "#6E2F2A", fg: "#F1E4D6",
    sections: [
      { title: "The First Book", start: eq("THE FIRST BOOK") },
      { title: "The Second Book", start: eq("THE SECOND BOOK") },
      // Books 1-2 alone are only ~6k words, so Book 3 is added to reach the target.
      { title: "The Third Book", start: eq("THE THIRD BOOK") },
    ],
    end: eq("THE FOURTH BOOK"),
  },
  {
    id: "classic-art-of-war", pg: 132, title: "The Art of War", author: "Sun Tzu",
    color: "#8A5A2B", fg: "#F6EBD9",
    sections: [
      { title: "I. Laying Plans", start: eq("Chapter I. LAYING PLANS") },
      { title: "II. Waging War", start: eq("Chapter II. WAGING WAR") },
      { title: "III. Attack by Stratagem", start: eq("Chapter III. ATTACK BY STRATAGEM") },
      { title: "IV. Tactical Dispositions", start: eq("Chapter IV. TACTICAL DISPOSITIONS") },
      // I-IV alone are only ~3k words, so further whole chapters are added toward the target.
      { title: "V. Energy", start: eq("Chapter V. ENERGY") },
      { title: "VI. Weak Points and Strong", start: eq("Chapter VI. WEAK POINTS AND STRONG") },
      { title: "VII. Manœuvring", start: re(/^Chapter VII\. MAN/) },
      { title: "VIII. Variation of Tactics", start: eq("Chapter VIII. VARIATION OF TACTICS") },
      { title: "IX. The Army on the March", start: eq("Chapter IX. THE ARMY ON THE MARCH") },
      { title: "X. Terrain", start: eq("Chapter X. TERRAIN") },
    ],
    end: eq("Chapter XI. THE NINE SITUATIONS"),
    stripNotes: true,
  },
  {
    id: "classic-odyssey", pg: 1727, title: "The Odyssey", author: "Homer",
    color: "#23344F", fg: "#E8E1D2",
    sections: [
      { title: "Book I", start: eq("BOOK I"), dropArgument: true },
      { title: "Book II", start: eq("BOOK II"), dropArgument: true },
    ],
    // Book III would push the total to ~13k words, over the cap.
    end: eq("BOOK III"),
    stripFootnoteMarks: true,
  },
  {
    id: "classic-frankenstein", pg: 84, title: "Frankenstein", author: "Mary Shelley",
    color: "#3A3633", fg: "#E9E2D6",
    sections: [
      { title: "Letter 1", start: eq("Letter 1") },
      { title: "Letter 2", start: eq("Letter 2") },
      { title: "Letter 3", start: eq("Letter 3") },
      { title: "Letter 4", start: eq("Letter 4") },
      { title: "Chapter 1", start: eq("Chapter 1") },
      { title: "Chapter 2", start: eq("Chapter 2") },
    ],
    // Chapter 3 is left out: Letters 1-4 plus Chapters 1-3 run ~12k words, over the 10k cap.
    end: eq("Chapter 3"),
  },
  {
    id: "classic-pride", pg: 1342, title: "Pride and Prejudice", author: "Jane Austen",
    color: "#C9B48A", fg: "#2A2622",
    sections: [
      { title: "Chapter 1", start: eq("Chapter I.]") },
      ...["II", "III", "IV", "V", "VI", "VII"].map((r, i) => ({
        title: `Chapter ${i + 2}`, start: eq(`CHAPTER ${r}.`),
      })),
    ],
    // Chapters 8-10 are left out: Chapters 1-10 run ~15.5k words, over the 10k cap.
    end: eq("CHAPTER VIII."),
  },
];

// Remove balanced [ ... ] blocks. If onlyAtLineStart, only blocks whose "[" opens a line
// (optionally after whitespace) and, when a prefix is given, begins with that prefix.
function removeBracketBlocks(text, { prefix = null, onlyAtLineStart = false } = {}) {
  let out = "";
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    const atLineStart = i === 0 || /^[ \t]*$/.test(text.slice(text.lastIndexOf("\n", i - 1) + 1, i));
    const ok = ch === "[" && (!onlyAtLineStart || atLineStart) && (!prefix || text.startsWith(prefix, i));
    if (!ok) { out += ch; i++; continue; }
    let depth = 0, j = i;
    for (; j < text.length; j++) {
      if (text[j] === "[") depth++;
      else if (text[j] === "]") { depth--; if (depth === 0) { j++; break; } }
    }
    i = j;
  }
  return out;
}

const wc = (s) => (s.match(/\S+/g) || []).length;

function paragraphs(lines, opts) {
  let text = lines.join("\n");
  text = removeBracketBlocks(text, { prefix: "[Illustration" });
  let raw = text.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);

  if (opts.stripNotes) {
    // Translator notes are bracketed paragraphs; some are never closed, so a note
    // also ends where the next numbered paragraph ("10." / "5, 6.") begins.
    const kept = [];
    let inNote = false;
    for (const p of raw) {
      if (inNote && /^\d+(, \d+)*\.\s/.test(p)) inNote = false;
      if (inNote) { if (p.endsWith("]")) inNote = false; continue; }
      if (p.startsWith("[")) { if (!p.endsWith("]")) inNote = true; continue; }
      if (p.endsWith("]") && !p.includes("[")) continue; // tail of a note whose "[" is missing in the source
      kept.push(p);
    }
    // A sentence interrupted by a note resumes in a lowercase paragraph: rejoin it.
    raw = kept.reduce((acc, p) => {
      if (acc.length && /^[a-z]/.test(p)) acc[acc.length - 1] += " " + p;
      else acc.push(p);
      return acc;
    }, []);
  }

  return raw
    .map((p) => {
      let t = p.replace(/_/g, "").replace(/\s+/g, " ").trim();
      // Butler's footnote anchors are digits glued to the preceding word or punctuation.
      if (opts.stripFootnoteMarks) t = t.replace(/(?<=[A-Za-z.,;:!?’”"])\d{1,3}(?=$|[\s.,;:!?’”"])/g, "");
      return t;
    })
    .filter(Boolean);
}

function build(cfg, index) {
  const raw = readFileSync(join(srcDir, `pg${cfg.pg}.txt`), "utf8").replace(/^﻿/, "");
  const all = raw.split(/\r?\n/);
  const s = all.findIndex((l) => l.startsWith("*** START OF"));
  const e = all.findIndex((l) => l.startsWith("*** END OF"));
  if (s < 0 || e < 0) throw new Error(`markers missing in pg${cfg.pg}`);
  const lines = all.slice(s + 1, e);

  // Locate headings sequentially.
  let cursor = 0;
  const starts = [];
  for (const sec of cfg.sections) {
    const k = lines.findIndex((l, n) => n >= cursor && sec.start(l.trimEnd()));
    if (k < 0) throw new Error(`${cfg.title}: heading not found: ${sec.title}`);
    starts.push(k);
    cursor = k + 1;
  }
  const endIdx = lines.findIndex((l, n) => n >= cursor && cfg.end(l.trimEnd()));
  if (endIdx < 0) throw new Error(`${cfg.title}: end marker not found`);
  starts.push(endIdx);

  const sections = cfg.sections.map((sec, i) => {
    let paras = paragraphs(lines.slice(starts[i] + 1, starts[i + 1]), cfg);
    if (sec.dropArgument && paras.length && !/[a-z]/.test(paras[0])) paras = paras.slice(1);
    return {
      id: `section-${i}`,
      title: sec.title,
      heading: true,
      blocks: paras.map((text) => ({ type: "p", text })),
    };
  });

  const pageMarks = [];
  let cum = 0, nextAt = 0;
  sections.forEach((sec, si) => {
    sec.blocks.forEach((b, bi) => {
      if (cum >= nextAt) {
        pageMarks.push({ label: String(pageMarks.length + 1), index: pageMarks.length, at: { section: si, block: bi, offset: 0 } });
        nextAt = (Math.floor(cum / WORDS_PER_PAGE) + 1) * WORDS_PER_PAGE;
      }
      cum += wc(b.text);
    });
  });

  const t = BASE_TIME - index - 1;
  return {
    id: cfg.id,
    title: cfg.title,
    author: cfg.author,
    addedAt: t,
    lastOpenedAt: t,
    cover: { kind: "typeset", color: cfg.color, fg: cfg.fg },
    printPageCount: pageMarks.length,
    sample: true,
    sections,
    pageMarks,
  };
}

const books = BOOKS.map(build);
mkdirSync(dirname(outFile), { recursive: true });
writeFileSync(outFile, JSON.stringify(books));
console.log(`wrote ${outFile}`);
