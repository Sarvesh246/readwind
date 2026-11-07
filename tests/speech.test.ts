import { describe, it, expect } from "vitest";
import classics from "../lib/readwind/classics.json";
import type { Book } from "../lib/readwind/types";
import { speakable, sentences, scriptOf, chunkAt, anchorOf, skipBy, chapters, previousChapter, nextChapter, ListenCredit, voiceWpm } from "../lib/readwind/speech";

const book = classics[0] as Book;

describe("speakable text", () => {
  it("drops soft hyphens, superscript markers and page markers but maps back to the source", () => {
    const text = "Wal­den pond¹ is │114deep.";
    const { say, map } = speakable(text);
    expect(say).toBe("Walden pond is deep.");
    expect(text[map[say.indexOf("deep")]]).toBe("d");
  });
  it("reads common abbreviations in full", () => {
    expect(speakable("Mr. Smith, e.g. a man.").say).toBe("Mister Smith, for example a man.");
  });
});

describe("sentences", () => {
  it("splits at sentence ends but not after titles or initials", () => {
    const text = "Mr. Field came. He said “Go!” Then J. Smith left.";
    expect(sentences(text).map(([a, b]) => text.slice(a, b))).toEqual(["Mr. Field came.", "He said “Go!”", "Then J. Smith left."]);
  });
  it("splits a very long sentence at a pause", () => {
    const long = Array(40).fill("the water was clear and still").join(", ") + ".";
    const parts = sentences(long);
    expect(parts.length).toBeGreaterThan(1);
    expect(parts.every(([a, b]) => b - a <= 260)).toBe(true);
    expect(parts.at(-1)![1]).toBe(long.length);
  });
});

describe("book script", () => {
  const script = scriptOf(book);
  it("covers the whole book in reading order and is cached", () => {
    expect(script.chunks.length).toBeGreaterThan(20);
    expect(scriptOf(book)).toBe(script);
    for (let i = 1; i < script.chunks.length; i++) {
      const a = script.chunks[i - 1], b = script.chunks[i];
      expect(a.section < b.section || (a.section === b.section && (a.block < b.block || (a.block === b.block && a.start <= b.start)))).toBe(true);
    }
  });
  it("finds the chunk for a saved position", () => {
    const c = script.chunks[10];
    expect(chunkAt(script, anchorOf(c))).toBe(10);
    expect(chunkAt(script, { ...anchorOf(c), offset: c.start + 1 })).toBe(10);
  });
  it("skips by whole sentences and moves between chapters", () => {
    const wpm = voiceWpm(1);
    expect(skipBy(script, 10, -30, wpm)).toBeLessThan(10);
    expect(skipBy(script, 10, 30, wpm)).toBeGreaterThan(10);
    const list = chapters(script, book);
    expect(list.length).toBeGreaterThan(0);
    if (list.length > 1) {
      expect(nextChapter(script, list[0].first)).toBe(list[1].first);
      expect(previousChapter(script, list[1].first + 2, 10)).toBe(list[1].first);
      expect(previousChapter(script, list[1].first, 1)).toBe(list[0].first);
    }
  });
});

describe("listening credit", () => {
  it("credits whole pages with real time and marks it as listening", () => {
    const credit = new ListenCredit(250);
    expect(credit.add(100, 40)).toBeUndefined();
    const first = credit.add(200, 70)!;
    expect(first).toMatchObject({ pages: 1, words: 300, seconds: 110, listenSeconds: 110 });
    credit.add(100, 30);
    expect(credit.flush()).toMatchObject({ pages: 0, words: 100 });
    credit.add(120, 30);
    expect(credit.flush()!.pages).toBe(1);
  });
});
