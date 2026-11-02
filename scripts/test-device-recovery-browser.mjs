import { chromium, webkit } from "@playwright/test";
import { createServer } from "vite";
import assert from "node:assert/strict";
import fs from "node:fs";
const fixture = JSON.parse(
  fs.readFileSync("lib/readwind/classics.json", "utf8"),
)[0];
fixture.id = "device-recovery-book";
fixture.sourcePdfBlobId = "device-recovery-pdf";
const server = await createServer({
  configFile: false,
  root: process.cwd(),
  server: {
    host: "127.0.0.1",
    port: 0,
    watch: { ignored: ["**/work/**", "**/.next/**"] },
  },
});
server.middlewares.use("/recovery-test", (request, response) => {
  response.setHeader("Content-Type", "text/html");
  response.end("<!doctype html><title>Readwind recovery test</title>");
});
await server.listen();
const origin = `http://127.0.0.1:${server.httpServer.address().port}`;
try {
  for (const engine of [chromium, webkit]) {
    const browser = await engine.launch();
    try {
      const page = await browser.newPage();
      await page.goto(origin + "/recovery-test");
      const result = await page.evaluate(async (fixture) => {
        const { ReadwindDB, encodeFile, storedBlob } = await import(
          "/lib/readwind/db.ts"
        );
        const { recoverDevice } = await import(
          "/lib/readwind/device-recovery.ts"
        );
        const { defaults } = await import("/lib/readwind/types.ts");
        const { default: Dexie } = await import(
          "/node_modules/dexie/dist/dexie.mjs"
        );
        const owner = "recovery-browser-owner",
          device = "recovery-browser-device",
          epoch = "recovery-browser-epoch";
        const db = new ReadwindDB(owner);
        await db.open();
        const progress = {
          bookId: fixture.id,
          at: { section: 0, block: 0, offset: 0 },
          revision: 7,
          deviceId: device,
          wordsRead: 123,
          updatedAt: Date.now(),
        };
        const note = {
          id: "recovery-note",
          bookId: fixture.id,
          kind: "bookmark",
          range: { start: progress.at, end: progress.at },
          quote: "A passage",
          note: "A preserved thought",
          color: "yellow",
          createdAt: Date.now(),
          updatedAt: Date.now(),
        };
        const preferences = {
          ...defaults,
          readingLog: {
            "2026-10-31.phone": { pages: 10, words: 100, seconds: 60 },
            "2026-11-01.desktop": { pages: 12, words: 120, seconds: 90 },
          },
        };
        await db.books.put(fixture);
        await db.progress.put(progress);
        await db.annotations.put(note);
        await db.preferences.put({ id: "reader", value: preferences });
        const pdf = new Blob(["%PDF-1.4\nPreserved bytes"], {
          type: "application/pdf",
        });
        await db.blobs.put(
          await encodeFile({ id: fixture.sourcePdfBlobId, blob: pdf }),
        );
        let fail = true,
          complete = false;
        const requests = [],
          uploads = [];
        const archive = new Dexie("readwind-recovery-" + owner);
        archive.version(1).stores({ snapshots: "id", files: "id" });
        const api = async (path, init) => {
          if (!init)
            return Response.json({ required: !complete, epoch, files: [] });
          if ((await archive.table("snapshots").count()) !== 1)
            throw Error("A cloud write preceded the durable device snapshot");
          const value = JSON.parse(init.body);
          requests.push(value);
          if (value.kind === "settings" && fail) {
            fail = false;
            return Response.json(
              { error: "Simulated service outage" },
              { status: 503 },
            );
          }
          if (value.kind === "complete") complete = true;
          return Response.json({ archived: true });
        };
        const upload = async (id, blob) => {
          uploads.push({ id, bytes: await blob.text() });
        };
        let failed = false;
        try {
          await recoverDevice(db, owner, device, api, upload);
        } catch {
          failed = true;
        }
        const afterFailure = {
          books: await db.books.count(),
          progress: await db.progress.count(),
          notes: await db.annotations.count(),
          blobs: await db.blobs.count(),
          complete,
        };
        await db.books.update(fixture.id, {
          title: "A newer local edit during recovery",
        });
        await recoverDevice(db, owner, device, api, upload);
        const archived = await archive
            .table("snapshots")
            .get(epoch + ":" + device),
          archivedFile = await archive
            .table("files")
            .get(fixture.sourcePdfBlobId);
        const count = requests.length;
        await recoverDevice(db, owner, device, api, upload);
        const result = {
          failed,
          afterFailure,
          complete,
          requests,
          uploads,
          archived,
          archivedBytes: await storedBlob(archivedFile).text(),
          localTitle: (await db.books.get(fixture.id)).title,
          repeatWrites: requests.length - count,
        };
        archive.close();
        db.close();
        return result;
      }, fixture);
      assert.equal(result.failed, true);
      assert.deepEqual(result.afterFailure, {
        books: 1,
        progress: 1,
        notes: 1,
        blobs: 1,
        complete: false,
      });
      assert.equal(result.complete, true);
      assert.equal(result.repeatWrites, 0);
      assert.equal(result.localTitle, "A newer local edit during recovery");
      assert.equal(result.archived.books[0].title, fixture.title);
      assert.equal(result.archived.progress[0].revision, 7);
      assert.equal(result.archived.annotations[0].note, "A preserved thought");
      assert.equal(
        Object.keys(result.archived.preferences[0].value.readingLog).length,
        2,
      );
      assert.equal(result.archivedBytes, "%PDF-1.4\nPreserved bytes");
      assert(
        result.uploads.every((file) => file.bytes === result.archivedBytes),
      );
      assert(
        result.requests
          .filter((value) => value.kind === "book")
          .every((value) => value.value.title === fixture.title),
        "retry must use the original snapshot",
      );
      console.log(
        `PASS ${engine.name()}: durable pre-sync snapshot, source preservation on failure, complete reading history and attachments, retry consistency, and completed-device idempotence.`,
      );
    } finally {
      await browser.close();
    }
  }
} finally {
  await server.close();
}
