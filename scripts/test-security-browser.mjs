import assert from "node:assert/strict";
import { chromium } from "@playwright/test";
const origin = process.env.READWIND_TEST_ORIGIN || "http://127.0.0.1:5180";
const book = {
  id: "safe-book",
  title: "Security fixture",
  author: "Author",
  sections: [
    {
      id: "s",
      title: "Chapter",
      heading: true,
      blocks: [{ type: "p", text: "A safe library paragraph." }],
    },
  ],
  pageMarks: [],
  cover: { kind: "typeset", color: "#222222", fg: "#ffffff" },
  addedAt: 1,
  lastOpenedAt: 1,
  printPageCount: 1,
};
const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  let active = true;
  let holdNext = false, releaseHold;
  const heldResponse = new Promise(resolve=>{releaseHold=resolve;});
  const pages = [];
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === "/api/config")
      return route.fulfill({ json: { authUrl: "/api/auth" } });
    if (url.pathname === "/api/auth/get-session")
      return route.fulfill({
        json: active
          ? {
              user: {
                id: "security-user",
                name: "Test",
                email: "test@example.com",
                emailVerified: true,
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
              },
              session: {
                id: "session",
                userId: "security-user",
                expiresAt: new Date(Date.now() + 60000).toISOString(),
              },
            }
          : null,
      });
    if (url.pathname === "/api/auth/sign-out") {
      active = false;
      return route.fulfill({ json: { success: true } });
    }
    if (url.pathname === "/api/library") {
      pages.push(url.searchParams.get("offset"));
      if (holdNext) {holdNext=false;await heldResponse;}
      return route.fulfill({
        json: {
          books: [
            {
              ...book,
              id:
                url.searchParams.get("offset") === "1"
                  ? "second-book"
                  : book.id,
              title:
                url.searchParams.get("offset") === "1"
                  ? "Second fixture"
                  : book.title,
            },
          ],
          annotations: [],
          progress: [],
          settings: null,
          nextOffset: url.searchParams.get("offset") === "1" ? null : 1,
        },
      }).catch(()=>{});
    }
    return route.fulfill({
      status: 400,
      json: { error: "Unexpected test request" },
    });
  });
  await page.goto(origin);
  await page
    .getByRole("button", { name: "Read Second fixture", exact: true })
    .waitFor();
  assert.ok(pages.includes("1"), "client follows library pagination");
  await page.getByRole("button", { name: "Your account", exact: true }).click();
  const malicious = {
    format: "folio-backup-1",
    books: [
      {
        ...book,
        id: "malicious",
        sourcePdfBlobId: "evil",
        readingMode: "reflow",
      },
    ],
    blobs: [{ id: "evil", data: "http://192.168.0.1/admin" }],
  };
  let remoteRequests = 0;
  page.on("request", (req) => {
    if (req.url().includes("192.168.0.1")) remoteRequests++;
  });
  await page
    .locator(".backup-restore input")
    .setInputFiles({
      name: "malicious.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify(malicious)),
    });
  await page
    .getByText("Backup contains an unsupported attachment.", { exact: true })
    .waitFor();
  assert.equal(remoteRequests, 0, "archive never triggers LAN fetches");
  holdNext=true;
  const pendingSnapshot=page.waitForRequest('**/api/library?offset=0');
  await page.locator(".conflict-options").getByRole("button", { name: "Sync now", exact: true }).click();
  await pendingSnapshot;
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await page
    .getByRole("button", { name: "Sign in to your account", exact: true })
    .waitFor();
  await page.waitForFunction(
    async () =>
      !(await indexedDB.databases()).some(
        (db) => db.name === "folio-security-user",
      ),
  );
  releaseHold();
  await page.waitForTimeout(250);
  assert.equal(await page.evaluate(async()=> (await indexedDB.databases()).some(db=>db.name==='folio-security-user')),false,'late sync response must not recreate a signed-out cache');
  assert.equal(
    await page.evaluate(() => sessionStorage.getItem("folio-offline-user")),
    null,
  );
  assert.deepEqual(errors, []);
  console.log(
    "PASS: paged library, malicious backup rejection without outbound requests, sign-out cache removal during an in-flight sync.",
  );
  await page.close();
  for (const path of ["/", "/favicon.svg", "/api/library"]) {
    const response = await fetch(origin + path);
    assert.ok(response.headers.get("content-security-policy"));
    assert.equal(response.headers.get("x-content-type-options"), "nosniff");
    assert.equal(response.headers.get("x-frame-options"), "DENY");
    if (path.startsWith("/api/")) {
      assert.equal(response.status, 401);
      assert.match(response.headers.get("cache-control"), /no-store/);
    }
  }
  console.log(
    "PASS: production Worker and static-asset security headers; anonymous API denial.",
  );
} finally {
  await browser.close();
}
