import { it, expect } from "vitest";
import { zipSync, strToU8 } from "fflate";
import { sourceCoverValidation } from "../scripts/catalog/source-cover.mjs";
import { validateCandidate } from "../scripts/catalog/providers.mjs";
import { authorIdentityMatches } from "../scripts/catalog/worker.mjs";

it("holds generic Gutenberg covers while retaining scanned edition covers", () => {
  const record = { provider: "gutenberg", format: "epub" };
  const source = (href: string) =>
    zipSync({
      "OEBPS/content.opf": strToU8(
        `<package><manifest><item href="${href}" properties="cover-image"/></manifest></package>`,
      ),
    });
  expect(
    sourceCoverValidation(record, source("123456_136-cover.png")).passed,
  ).toBe(false);
  expect(sourceCoverValidation(record, source("123456_cover.jpg")).passed).toBe(
    true,
  );
});

it("holds unknown author attribution and explicitly partial editions", () => {
  expect(validateCandidate({ author: "Unknown" }).errors).toContain(
    "Verified author attribution is required.",
  );
  expect(
    validateCandidate({ title: "Webster's Dictionary (1st 100 Pages)" }).errors,
  ).toContain("Not an approved complete edition");
  expect(
    validateCandidate({
      title: "Index of the Project Gutenberg Works of Stephen Leacock",
    }).errors,
  ).toContain("A navigation index is not a complete book.");
  expect(validateCandidate({ title: "Grania, vol. 1/2" }).errors).toContain(
    "Not an approved complete edition",
  );
});

it("matches documented initials without treating other contributors as authors", () => {
  expect(
    authorIdentityMatches(
      "Wells, H. G. (Herbert George), 1866-1946",
      "H. G. Wells",
    ),
  ).toBe(true);
  expect(
    authorIdentityMatches(
      "Twain, Mark, 1835-1910; Kemble, E. W. (Edward Windsor), 1861-1933 [Illustrator]",
      "Mark Twain",
    ),
  ).toBe(true);
  expect(
    authorIdentityMatches(
      "Wells, H. G. (Herbert George), 1866-1946",
      "Orson Welles",
    ),
  ).toBe(false);
});
