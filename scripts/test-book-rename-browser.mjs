import { chromium, webkit } from "@playwright/test";
import { createServer } from "vite";
import react from "@vitejs/plugin-react";
import { zipSync, strToU8 } from "fflate";
import { readFileSync, mkdirSync } from "node:fs";
import assert from "node:assert/strict";
const origin = process.env.READWIND_TEST_ORIGIN || "http://127.0.0.1:3100";
mkdirSync("work/rename-qa", { recursive: true });
const epub = zipSync({
  mimetype: strToU8("application/epub+zip"),
  "META-INF/container.xml": strToU8(
    '<container><rootfiles><rootfile full-path="OPS/book.opf"/></rootfiles></container>',
  ),
  "OPS/book.opf": strToU8(
    '<package><metadata><title>Original imported book</title><creator>Example Author</creator></metadata><manifest><item id="chapter" href="chapter.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="chapter"/></spine></package>',
  ),
  "OPS/chapter.xhtml": strToU8(
    "<html><body><h1>Opening chapter</h1><p>The complete original text stays intact after a personal title changes.</p><p>The complete ending stays intact too.</p></body></html>",
  ),
});
async function snapshot(page) {
  return page.evaluate(
    () =>
      new Promise((resolve, reject) => {
        const request = indexedDB.open("folio-preview");
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const db = request.result;
          const transaction = db.transaction(
            ["books", "progress", "annotations"],
            "readonly",
          );
          const books = transaction.objectStore("books").getAll(),
            progress = transaction.objectStore("progress").getAll(),
            notes = transaction.objectStore("annotations").getAll();
          transaction.oncomplete = () => {
            db.close();
            resolve({
              books: books.result,
              progress: progress.result,
              notes: notes.result,
            });
          };
          transaction.onerror = () => {
            db.close();
            reject(transaction.error);
          };
        };
      }),
  );
}
async function waitForLibrary(page, predicate) {
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    if (await page.evaluate(predicate)) return;
    await page.waitForTimeout(50);
  }
  throw new Error("Timed out waiting for library sync.");
}
const fixtureServer = await createServer({
  configFile: false,
  root: process.cwd(),
  resolve: { alias: { "@": process.cwd() } },
  plugins: [react()],
  server: { host: "127.0.0.1", port: 0, watch: { ignored: ["**/work/**", "**/.next/**"] } },
});
await fixtureServer.listen();
const fixtureOrigin = `http://127.0.0.1:${fixtureServer.httpServer.address().port}`;
try {
  for (const engine of [chromium, webkit]) {
    const browser = await engine.launch();
    try {
      for (const width of (process.env.RENAME_SYNC_ONLY ? [] : [320, 1440])) {
        const page = await browser.newPage({
          viewport: { width, height: 900 },
        });
        await page.route("**/api/config", (route) =>
          route.fulfill({ json: { authUrl: null, catalogEnabled: true } }),
        );
        await page.goto(origin + "/import");
        await page
          .locator("input[type=file]")
          .first()
          .setInputFiles({
            name: "book.epub",
            mimeType: "application/epub+zip",
            buffer: Buffer.from(epub),
          });
        await page
          .getByRole("heading", { name: "Review your book", exact: true })
          .waitFor();
        await page
          .getByRole("button", { name: "Add book", exact: true })
          .click();
        await page.locator(".reader-page-position").waitFor();
        await page
          .getByRole("button", { name: "Back to library", exact: true })
          .first()
          .click();
        await page
          .getByRole("button", {
            name: "Edit Original imported book",
            exact: true,
          })
          .click();
        const before = await snapshot(page),
          original = before.books.find((book) => !book.sample);
        const dialog = page.getByRole("dialog", {
          name: "Edit book",
          exact: true,
        });
        await dialog.getByLabel("Book title", { exact: true }).fill("   ");
        await dialog
          .getByRole("button", { name: "Save title", exact: true })
          .click();
        await dialog.getByRole("alert").waitFor();
        await dialog
          .getByLabel("Book title", { exact: true })
          .fill("  My renamed book 📚  ");
        await dialog
          .getByRole("button", { name: "Save title", exact: true })
          .click();
        await dialog.getByText("Title saved.", { exact: true }).waitFor();
        assert.equal(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
          true,
        );
        await page.screenshot({
          path: `work/rename-qa/${engine.name()}-${width}.png`,
        });
        await dialog.getByRole("button", { name: "Done", exact: true }).click();
        await page
          .getByRole("button", { name: "Read My renamed book 📚", exact: true }).first()
          .waitFor();
        const after = await snapshot(page),
          renamed = after.books.find((book) => book.id === original.id);
        assert.equal(renamed.title, "My renamed book 📚");
        assert.deepEqual(renamed.sections, original.sections);
        assert.equal(renamed.sourceBlobId, original.sourceBlobId);
        assert.deepEqual(renamed.cover, original.cover);
        assert.deepEqual(after.progress, before.progress);
        assert.deepEqual(after.notes, before.notes);
        await page.reload();
        await page
          .getByRole("button", { name: "Read My renamed book 📚", exact: true }).first()
          .waitFor();
        await page
          .getByRole("button", { name: "Read My renamed book 📚", exact: true }).first()
          .click();
        await page
          .getByLabel("More reading options", { exact: true })
          .click();
        await page
          .getByRole("button", { name: "Edit book", exact: true })
          .click();
        await page
          .getByLabel("Book title", { exact: true })
          .fill("Renamed while reading");
        await page
          .getByRole("button", { name: "Save title", exact: true })
          .click();
        await page.getByText("Title saved.", { exact: true }).waitFor();
        await page.getByRole("button", { name: "Done", exact: true }).click();
        await page
          .getByRole("button", { name: "Back to library", exact: true })
          .first()
          .click();
        await page
          .getByRole("button", {
            name: "Read Renamed while reading",
            exact: true,
          }).first()
          .waitFor();
        console.log(
          `PASS ${engine.name()} ${width}: imported book rename, validation, reload, reader editing, original content/progress/notes preserved`,
        );
        await page.close();
      }
      const book = {
        ...JSON.parse(readFileSync("lib/readwind/classics.json", "utf8"))[0],
        id: "rename-sync-book",
        sample: false,
      };
      const server = {
        books: [book],
        progress: [],
        annotations: [],
        settings: null,
      };
      const requests = [];
      async function device() {
        const page = await browser.newPage();
        await page.route("**/api/library*", async (route) => {
          if (route.request().method() === "POST") {
            const value = route.request().postDataJSON();
            requests.push(value);
            server.books = server.books.map((book) =>
              book.id === value.id ? { ...book, ...value.metadata } : book,
            );
            return route.fulfill({ json: { ok: true } });
          }
          return route.fulfill({ json: server });
        });
        await page.route("**/api/sync", (route) =>
          route.fulfill({ json: { ok: true } }),
        );
        await page.route("**/api/files/**", () => {
          throw new Error("Renaming must not upload original files.");
        });
        await page.goto(fixtureOrigin + "/tests/fixtures/library-harness.html");
        await page.evaluate(async () =>
          (await import("/tests/fixtures/library-harness.tsx")).mount(
            "rename-account",
          ),
        );
        await waitForLibrary(page, async () => {
          const library = (
            await import("/tests/fixtures/library-harness.tsx")
          ).current();
          return (
            library?.ready &&
            library.books.length === 1 &&
            library.status === "All changes synced"
          );
        });
        return page;
      }
      const first = await device();
      await first.evaluate(
        async (id) =>
          (await import("/tests/fixtures/library-harness.tsx"))
            .current()
            .renameBook(id, "Synced personal title"),
        book.id,
      );
      await waitForLibrary(first, async () => {
        const library = (
          await import("/tests/fixtures/library-harness.tsx")
        ).current();
        return (
          library?.status === "All changes synced" &&
          library.books[0]?.title === "Synced personal title"
        );
      });
      assert.equal(requests[0].kind, "book-metadata");
      assert.ok(JSON.stringify(requests[0]).length < 2000);
      const second = await device();
      assert.equal(
        await second.evaluate(
          async () =>
            (await import("/tests/fixtures/library-harness.tsx")).current()
              .books[0].title,
        ),
        "Synced personal title",
      );
      await first.context().setOffline(true);
      const flags = await first.evaluate(async (id) => {
        const library = (
            await import("/tests/fixtures/library-harness.tsx")
          ).current(),
          current = await library.db.books.get(id);
        await library.db.pending.put({
          id: `book:${id}`,
          entity: "book",
          bookId: id,
          value: current,
          uploadFiles: true,
          uploaded: ["already-uploaded"],
          restoreDeleted: true,
        });
        await library.renameBook(id, "Pending upload title");
        const pending = await library.db.pending.get(`book:${id}`);
        await library.deleteBook(id);
        let rejected = false;
        try {
          await library.renameBook(id, "Stale rename");
        } catch {
          rejected = true;
        }
        return {
          uploadFiles: pending.uploadFiles,
          uploaded: pending.uploaded,
          restoreDeleted: pending.restoreDeleted,
          rejected,
          exists: !!(await library.db.books.get(id)),
        };
      }, book.id);
      assert.deepEqual(flags, {
        uploadFiles: true,
        uploaded: ["already-uploaded"],
        restoreDeleted: true,
        rejected: true,
        exists: false,
      });
      console.log(
        `PASS ${engine.name()}: metadata-only sync, second device, pending upload/restoration flags and deleted-book protection`,
      );
      await first.close();
      await second.close();
    } finally {
      await browser.close();
    }
  }
} finally {
  await fixtureServer.close();
}



