import { chromium, webkit } from "@playwright/test";
import { zipSync, strToU8 } from "fflate";
import { mkdirSync } from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { prepare, closePreparation } from "./catalog/prepare.mjs";
const origin = process.env.READWIND_TEST_ORIGIN || "http://127.0.0.1:5173",
  out = path.resolve("work/catalog-qa");
mkdirSync(out, { recursive: true });
const png =
  "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";
const epub = (content, extra = {}) =>
  zipSync({
    mimetype: strToU8("application/epub+zip"),
    "META-INF/container.xml": strToU8(
      '<container><rootfiles><rootfile full-path="OPS/book.opf"/></rootfiles></container>',
    ),
    "OPS/book.opf": strToU8(
      '<package><metadata><title>Fixture book</title><creator>Fixture author</creator></metadata><manifest><item id="c" href="chapter.xhtml" media-type="application/xhtml+xml"/><item id="n" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/><item id="i" href="cover.png" media-type="image/png" properties="cover-image"/></manifest><spine><itemref idref="c"/></spine></package>',
    ),
    "OPS/chapter.xhtml": strToU8(`<html><body>${content}</body></html>`),
    "OPS/nav.xhtml": strToU8(
      '<html><body><nav epub:type="toc"><ol><li><a href="chapter.xhtml#one">First</a><ol><li><a href="chapter.xhtml#two">Second</a></li></ol></li></ol></nav></body></html>',
    ),
    "OPS/cover.png": Buffer.from(png, "base64"),
    ...extra,
  });
let fixture, fixtureSource;
try {
  const source = (fixtureSource = epub(
    '<header id="pg-header"><p>Project Gutenberg source notice.</p></header><h1 id="one">First chapter</h1><p>The <strong>bold</strong> opening has 203 words and a <a href="#note">note</a>.</p><h2 id="two">Second chapter</h2><p class="verse">One line<br/>Next line</p><aside><p id="note" epub:type="footnote">The complete note.</p></aside><p>The complete ending.</p><table><tr><th>Year</th><th>Total</th></tr><tr><td>2024</td><td>203</td></tr></table>',
  ));
  fixture = await prepare({
    data: Buffer.from(source).toString("base64"),
    name: "fixture.epub",
    format: "epub",
  });
  assert.equal(fixture.report.passed, true);
  assert.equal(fixture.report.relocatedNotices.length, 1);
  assert.ok(
    fixture.book.sections
      .at(-1)
      .blocks.some((b) => b.text?.includes("Project Gutenberg source notice")),
  );
  assert.ok(
    !fixture.book.sections[0].blocks.some((b) =>
      b.text?.includes("Project Gutenberg source notice"),
    ),
  );
  assert.equal(fixture.book.sourceFormat, "epub");
  assert.equal(fixture.book.pagination, "flow");
  assert.equal(fixture.book.chapterLinks[1].level, 1);
  assert.ok(
    fixture.book.sections.some((s) =>
      s.blocks.some((b) => b.styles?.some((r) => r.bold)),
    ),
  );
  assert.ok(
    fixture.book.sections.some((s) =>
      s.blocks.some((b) => b.text?.includes("One line\nNext line")),
    ),
  );
  assert.ok(
    fixture.book.sections.some((s) =>
      s.blocks.some((b) => b.footnoteRefs?.length),
    ),
  );
  assert.ok(
    fixture.book.sections.some((s) =>
      s.blocks.some((b) => b.type === "figure" && b.text?.includes("2024")),
    ),
  );
  await assert.rejects(() =>
    prepare({
      data: Buffer.from(
        epub('<h1 id="one">First</h1><img src="missing.png"/>'),
      ).toString("base64"),
      name: "missing.epub",
      format: "epub",
    }),
  );
  console.log(
    "PASS: structured EPUB, nested contents, styles, verse, notes, tables, and missing-resource rejection",
  );
} finally {
  await closePreparation();
}
const entries = Array.from({ length: 30 }, (_, i) => ({
  id: `fixture-${i}`,
  workId: `fixture-${i}`,
  title:
    i === 0
      ? "A long book title with enough words to wrap correctly on small phones"
      : `Fixture book ${i}`,
  author: i === 0 ? "An author with an unusually long name" : `Author ${i % 6}`,
  language: "en",
  subjects: [i % 2 ? "History" : "Fiction"],
  edition: "Test edition",
  publisher: "Fixture publisher",
  source: "Fixture source",
  sourceUrl: "https://example.org/book",
  license: "CC BY 4.0",
  coverId: "fixture-cover",
  version: `v-${i}`,
  bytes: 1000,
  format: "epub",
}));
for (const engine of [chromium, webkit]) {
  const browser = await engine.launch();
  try {
    for (const [label, viewport] of [
      ["phone", { width: 320, height: 740 }],
      ["mobile", { width: 390, height: 844 }],
      ["tablet", { width: 800, height: 1000 }],
      ["desktop", { width: 1440, height: 1000 }],
    ]) {
      const page = await browser.newPage({ viewport });
      await page.route("**/api/config", (r) =>
        r.fulfill({ json: { authUrl: null, catalogEnabled: true } }),
      );
      await page.route("**/api/catalog/index", (r) =>
        r.fulfill({ json: { items: entries } }),
      );
      await page.route("**/api/catalog?*", async (r) => {
        const params = new URL(r.request().url()).searchParams,
          q = (params.get("q") || "").toLowerCase(),
          offset = Number(params.get("offset") || 0);
        if (q === "fixture book 1")
          await new Promise((resolve) => setTimeout(resolve, 250));
        const matches = entries.filter(
          (e) =>
            e.title.toLowerCase().includes(q) ||
            e.author.toLowerCase().includes(q),
        );
        await r.fulfill({
          json: {
            items: matches.slice(offset, offset + 24),
            total: matches.length,
            nextOffset: offset + 24 < matches.length ? offset + 24 : null,
          },
        });
      });
      await page.route("**/api/catalog/assets/*", (r) =>
        r.fulfill({
          body: Buffer.from(png, "base64"),
          contentType: "image/png",
        }),
      );
      await page.goto(`${origin}/discover`);
      await page.getByRole("heading", { name: "Explore books" }).waitFor();
      await page.locator(".catalog-row").first().waitFor();
      await page.waitForFunction(() => {
        const image = document.querySelector(".catalog-cover img");
        return image?.complete && image.naturalWidth > 0;
      });
      for (const theme of ["light", "dark"]) {
        await page.evaluate((theme) => {
          document.documentElement.dataset.theme = theme;
        }, theme);
        assert.equal(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth + 1,
          ),
          true,
          `${engine.name()} ${label}: overflow`,
        );
        assert.ok(
          await page
            .locator(".catalog-cover img")
            .first()
            .evaluate((img) => img.complete && img.naturalWidth > 0),
        );
        await page.screenshot({
          path: path.join(out, `${engine.name()}-${label}-${theme}.png`),
          fullPage: true,
        });
      }
      await page
        .getByRole("button", { name: `Details for ${entries[0].title}` })
        .click();
      await page.getByRole("dialog").waitFor();
      await page.keyboard.press("Escape");
      const input = page.getByRole("searchbox");
      await input.fill("fixture book 1");
      await input.fill("fixture book 29");
      await page
        .getByRole("button", { name: "Fixture book 29", exact: true })
        .waitFor();
      await page.waitForTimeout(500);
      assert.equal(await page.locator(".catalog-row").count(), 1);
      await page.getByRole("button", { name: "Clear search" }).click();
      await page.getByRole("heading", { name: "Explore books" }).waitFor();
      await input.fill("Fixture");
      await page.waitForFunction(
        () => document.querySelectorAll(".catalog-row").length === 24,
      );
      await page
        .getByRole("button", { name: "Load more", exact: true })
        .click();
      await page.waitForFunction(
        () => document.querySelectorAll(".catalog-row").length === 29,
      );
      await page.evaluate(() => window.scrollTo(0, 700));
      await page.waitForFunction(
        () =>
          JSON.parse(sessionStorage.getItem("readwind-discover") || "{}")
            .scroll >= 650,
      );
      await page.reload();
      await page.waitForFunction(
        () =>
          document.querySelectorAll(".catalog-row").length === 29 &&
          window.scrollY >= 650,
      );
      assert.equal(await page.getByRole("searchbox").inputValue(), "Fixture");
      await page
        .getByRole("button", { name: "Upload a file", exact: true })
        .click();
      await page
        .locator("input[type=file]")
        .first()
        .waitFor({ state: "attached" });
      await page.goBack();
      await page.waitForFunction(
        () => document.querySelectorAll(".catalog-row").length === 29,
      );
      assert.equal(await page.getByRole("searchbox").inputValue(), "Fixture");
      await input.fill("not-in-catalog");
      await page
        .getByRole("heading", { name: "No matching books yet." })
        .waitFor();
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth + 1,
        ),
        true,
      );
      console.log(
        `PASS: discovery ${engine.name()} ${label}, themes, details, live search and empty state`,
      );
      await page.close();
    }
    const upload = await browser.newPage({
      viewport: { width: 390, height: 844 },
    });
    await upload.route("**/api/config", (r) =>
      r.fulfill({ json: { authUrl: null } }),
    );
    await upload.goto(origin + "/import");
    await upload
      .locator("input[type=file]")
      .first()
      .setInputFiles({
        name: "fixture.epub",
        mimeType: "application/epub+zip",
        buffer: Buffer.from(fixtureSource),
      });
    await upload
      .getByRole("heading", { name: "Review your book", exact: true })
      .waitFor();
    await upload.getByRole("button", { name: "Add book", exact: true }).click();
    await upload.locator(".reader-page-position").waitFor();
    assert.match(
      await upload.locator(".reader-page-position").innerText(),
      /% read/,
    );
    assert.equal(
      await upload
        .getByRole("button", { name: "Original PDF", exact: true })
        .count(),
      0,
    );
    await upload
      .getByRole("button", { name: "Contents", exact: true })
      .first()
      .click();
    await upload.getByRole("button", { name: "Second", exact: true }).waitFor();
    assert.equal(
      await upload
        .getByRole("textbox", { name: "Print page", exact: true })
        .count(),
      0,
    );
    await upload.keyboard.press("Escape");
    await upload.reload();
    await upload.locator(".reader-page-position").waitFor();
    console.log(
      `PASS: manual EPUB save, reader, contents and reload ${engine.name()}`,
    );
    await upload.close();
    const addPage = await browser.newPage({
      viewport: { width: 390, height: 844 },
    });
    await addPage.route("**/api/config", (r) =>
      r.fulfill({ json: { authUrl: null, catalogEnabled: true } }),
    );
    await addPage.route("**/api/catalog/index", (r) =>
      r.fulfill({ json: { items: [entries[0]] } }),
    );
    await addPage.route("**/api/catalog?*", (r) =>
      r.fulfill({ json: { items: [entries[0]], total: 1, nextOffset: null } }),
    );
    const catalogBook = {
      ...fixture.book,
      title: entries[0].title,
      author: entries[0].author,
      catalog: {
        editionId: entries[0].id,
        version: entries[0].version,
        subjects: entries[0].subjects,
        assets: fixture.assets.map((a) => ({
          id: a.id,
          type: a.type,
          bytes: a.bytes,
          sha256: a.sha256,
        })),
      },
    };
    await addPage.route("**/api/catalog/fixture-0?content=1", (r) =>
      r.fulfill({ json: { book: catalogBook } }),
    );
    let corrupt = true;
    await addPage.route("**/api/catalog/assets/*", (r) => {
      const id = new URL(r.request().url()).pathname.split("/").pop(),
        asset = fixture.assets.find((a) => a.id === id);
      if (!asset)
        return r.fulfill({
          body: Buffer.from(png, "base64"),
          contentType: "image/png",
        });
      let data = Buffer.from(asset.data, "base64");
      if (corrupt && id === catalogBook.sourceBlobId) {
        data = Buffer.from(data);
        data[0] ^= 1;
        corrupt = false;
      }
      return r.fulfill({ body: data, contentType: asset.type });
    });
    await addPage.goto(origin + "/discover");
    await addPage.getByRole("searchbox").fill(entries[0].title);
    await addPage
      .getByRole("button", { name: `Add ${entries[0].title}`, exact: true })
      .click();
    await addPage
      .getByRole("button", { name: `Retry ${entries[0].title}`, exact: true })
      .click();
    await addPage
      .getByRole("button", { name: `Read ${entries[0].title}`, exact: true })
      .click();
    await addPage.locator(".reader-page-position").waitFor();
    console.log(
      `PASS: catalog integrity rejection, retry and one-action reading ${engine.name()}`,
    );
    await addPage.close();
  } finally {
    await browser.close();
  }
}
