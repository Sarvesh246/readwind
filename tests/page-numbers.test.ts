import { describe, expect, it } from "vitest";
import { stripPageNumbers } from "../lib/readwind/page-numbers";

const H = 800;
type L = { text: string; x: number; y: number; size: number; endX?: number };
const body = (text: string, y = 300): L => ({ text, x: 60, y, size: 12, endX: 60 + text.length * 6 });
const run = (pages: L[][]) => {
  const n = stripPageNumbers(pages, pages.map(() => H), 12);
  return { n, text: pages.map((p) => p.map((l) => l.text)) };
};
const book = (count: number, make: (i: number) => L[]) => Array.from({ length: count }, (_, i) => make(i));

describe("stray page number removal", () => {
  it("removes a footer number that sits in the margin of every page", () => {
    const pages = book(8, (i) => [body("Some prose on the page."), { text: String(i + 1), x: 300, y: 760, size: 10 }]);
    const { text } = run(pages);
    expect(text.every((t) => t.length === 1 && t[0] === "Some prose on the page.")).toBe(true);
  });

  it("removes header numbers, offset numbering and decorated forms", () => {
    for (const fmt of [(n: number) => `${n}`, (n: number) => `- ${n} -`, (n: number) => `Page ${n}`, (n: number) => `${n} / 300`]) {
      const pages = book(8, (i) => [{ text: fmt(i + 17), x: 300, y: 40, size: 10 }, body("Prose.")]);
      expect(run(pages).text.flat().every((t) => t === "Prose.")).toBe(true);
    }
  });

  it("removes numbers even when only some pages have them", () => {
    const pages = book(10, (i) => [body("Prose."), ...(i % 2 ? [{ text: String(i + 1), x: 300, y: 760, size: 10 }] : [])]);
    expect(run(pages).text.flat().every((t) => t === "Prose.")).toBe(true);
  });

  it("removes roman numeral front-matter numbers", () => {
    const romans = ["i", "ii", "iii", "iv", "v", "vi"];
    const pages = book(6, (i) => [body("Preface."), { text: romans[i], x: 300, y: 760, size: 10 }]);
    expect(run(pages).text.flat().every((t) => t === "Preface.")).toBe(true);
  });

  it("strips a number glued to the first line and a running-header number", () => {
    const pages = book(8, (i) => [
      { text: `${i + 40} person I want. I really do not care`, x: 60, y: 60, size: 12, endX: 300 },
      { text: `${i + 40} WALDEN`, x: 60, y: 30, size: 10, endX: 120 },
      body("Prose."),
    ]);
    const { text } = run(pages);
    expect(text[0]).toContain("person I want. I really do not care");
    expect(text.flat().some((t) => /^\d/.test(t))).toBe(false);
    expect(text[0]).toContain("WALDEN");
  });

  it("keeps legitimate numbers that do not follow the page sequence", () => {
    const pages = book(8, (i) => [
      body("In 1984 the company had 7 people."),
      { text: "7", x: 60, y: 760, size: 10 },
      ...(i === 3 ? [{ text: "1984", x: 60, y: 60, size: 12 }] : []),
    ]);
    const { n, text } = run(pages);
    expect(n).toBe(0);
    expect(text.flat().filter((t) => t === "7")).toHaveLength(8);
    expect(text[3]).toContain("1984");
  });

  it("keeps numbers in the body and in isolated margin lines", () => {
    const pages = book(6, () => [body("12", 400), body("The 7 samurai", 420), body("Chapter 5", 40)]);
    const { n, text } = run(pages);
    expect(n).toBe(0);
    expect(text[0]).toEqual(["12", "The 7 samurai", "Chapter 5"]);
  });

  it("leaves a lone page alone and never strips ordinary words", () => {
    expect(run([[body("Text."), { text: "1", x: 0, y: 760, size: 10 }]]).n).toBe(0);
    const pages = book(6, () => [body("Mix"), { text: "mix", x: 0, y: 760, size: 10 }]);
    expect(run(pages).n).toBe(0);
  });

  it("is idempotent", () => {
    const pages = book(6, (i) => [body("Prose."), { text: String(i + 1), x: 300, y: 760, size: 10 }]);
    run(pages);
    expect(run(pages).n).toBe(0);
  });
});
