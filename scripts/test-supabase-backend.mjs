import fs from "node:fs";
import crypto from "node:crypto";
import assert from "node:assert/strict";
import { defaults } from "../lib/readwind/types.ts";
import { bookMetadataUpdate } from "../lib/readwind/catalog.ts";
if (process.env.READWIND_ALLOW_CLOUD_TESTS !== "isolated-recovery-accounts")
  throw Error(
    "This test requires two disposable verified accounts and explicit isolated-recovery-accounts mode.",
  );
const accounts = [
  {
    email: process.env.READWIND_TEST_EMAIL_A,
    password: process.env.READWIND_TEST_PASSWORD_A,
  },
  {
    email: process.env.READWIND_TEST_EMAIL_B,
    password: process.env.READWIND_TEST_PASSWORD_B,
  },
];
assert(
  accounts[0].email !== accounts[1].email &&
    accounts.every((a) => a.email && a.password),
  "Supply two distinct QA accounts",
);
assert(
  accounts.length === 2 &&
    accounts.every((a) =>
      /^readwind-recovery-qa-[a-f0-9-]+@example\.com$/i.test(a.email),
    ),
  "Only disposable recovery QA accounts are allowed",
);
const origin = process.env.READWIND_TEST_ORIGIN || "http://localhost:3100";
async function login(account, device) {
  const r = await fetch(origin + "/api/auth/sign-in/email", {
    method: "POST",
    headers: { Origin: origin, "Content-Type": "application/json" },
    body: JSON.stringify({ email: account.email, password: account.password }),
  });
  assert.equal(r.status, 200, await r.clone().text());
  const result = {
    cookies: r.headers
      .getSetCookie()
      .map((s) => s.split(";")[0])
      .join("; "),
    device,
  };
  const state = await request(result, "/api/recovery?device=" + device);
  assert.equal(state.status, 200);
  const info = await state.json();
  if (info.required)
    assert.equal(
      (
        await request(result, "/api/recovery", {
          epoch: info.epoch,
          deviceId: device,
          kind: "complete",
          value: { reason: "Empty isolated QA device" },
        })
      ).status,
      200,
    );
  return result;
}
async function request(session, path, body, extra = {}, method) {
  if (path === "/api/library") path += "?device=" + session.device;
  return fetch(origin + path, {
    method: method || (body ? "POST" : "GET"),
    headers: {
      Cookie: session.cookies,
      Origin: origin,
      ...(body ? { "Content-Type": "application/json" } : {}),
      ...extra,
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
}
const a = await login(accounts[0], "qa-isolation-a"),
  b = await login(accounts[1], "qa-isolation-b");
const id = crypto.randomUUID(),
  book = JSON.parse(fs.readFileSync("lib/readwind/classics.json", "utf8"))[0];
book.id = "recovery-qa-" + crypto.randomUUID();
book.sourcePdfBlobId = id;
const bytes = new Uint8Array(6 * 1024 * 1024);
bytes.set(
  new TextEncoder().encode("%PDF-1.4\nRecovery isolated storage fixture\n"),
);
let r = await request(a, "/api/files/sign", {
  id,
  type: "application/pdf",
  bytes: bytes.length,
});
assert.equal(r.status, 200, await r.clone().text());
const grant = await r.json();
r = await fetch(grant.url, {
  method: "PUT",
  headers: { ...grant.headers, Origin: origin },
  body: bytes.slice(0, 10),
});
assert.equal(r.status, 400, "A grant enforces its exact length");
r = await fetch(grant.url, {
  method: "PUT",
  headers: { ...grant.headers, Origin: origin },
  body: bytes,
});
assert.equal(r.status, 200, await r.clone().text());
r = await request(a, "/api/files/complete", {
  id,
  type: "application/pdf",
  bytes: bytes.length,
});
assert.equal(r.status, 200, await r.clone().text());
assert.equal((await request(a, "/api/library", book)).status, 200);
const savedBook = (await (await request(a, "/api/library")).json()).books[0];
assert.equal(
  typeof savedBook,
  "object",
  "Serialized JSON must remain a database object",
);
assert.deepEqual(savedBook.sections, book.sections);
assert.equal((await (await request(b, "/api/library")).json()).books.length, 0);
r = await request(a, "/api/files?id=" + id);
assert.equal(r.status, 200);
assert.deepEqual(new Uint8Array(await r.arrayBuffer()), bytes);
assert.equal((await request(b, "/api/files?id=" + id)).status, 404);
const position = {
  bookId: book.id,
  at: { section: 0, block: 1, offset: 5 },
  revision: 0,
  deviceId: "qa-device-a",
  wordsRead: 5,
};
r = await request(a, "/api/sync", { entity: "progress", value: position });
assert.equal(r.status, 200, await r.clone().text());
assert.equal((await r.json()).revision, 1);
const note = {
  id: "qa-note-" + crypto.randomUUID(),
  bookId: book.id,
  kind: "bookmark",
  range: { start: position.at, end: position.at },
  quote: "Test passage",
  note: "Isolated QA note",
  color: "yellow",
  createdAt: Date.now(),
  updatedAt: Date.now(),
};
assert.equal(
  (await request(a, "/api/sync", { entity: "annotation", value: note })).status,
  200,
);
assert.equal(
  (await request(b, "/api/sync", { entity: "annotation", value: note })).status,
  404,
);
const phone = await login(accounts[0], "qa-isolation-phone");
let current = await (await request(phone, "/api/library")).json();
assert.deepEqual(current.progress[0].at, position.at);
assert.equal(current.annotations[0].note, note.note);
r = await request(phone, "/api/sync", {
  entity: "progress",
  value: {
    ...position,
    revision: 1,
    at: { section: 0, block: 2, offset: 0 },
    deviceId: "qa-device-phone",
  },
});
assert.equal(r.status, 200);
assert.equal((await r.json()).revision, 2);
assert.equal(
  (await request(a, "/api/sync", { entity: "progress", value: position }))
    .status,
  409,
);
const day = (daysAgo) =>
  new Date(Date.now() - daysAgo * 86400000).toISOString().slice(0, 10);
const logsA = { [day(2) + ".qa-a"]: { pages: 4, words: 80, seconds: 120 } },
  logsB = { [day(1) + ".qa-phone"]: { pages: 8, words: 140, seconds: 180 } };
assert.equal(
  (
    await request(a, "/api/sync", {
      entity: "settings",
      value: { ...defaults, readingLog: logsA },
    })
  ).status,
  200,
);
assert.equal(
  (
    await request(phone, "/api/sync", {
      entity: "settings",
      value: { ...defaults, readingLog: logsB },
    })
  ).status,
  200,
);
current = await (await request(phone, "/api/library")).json();
assert.deepEqual(current.settings.readingLog, { ...logsA, ...logsB });
const version = await request(a, "/api/library"),
  etag = version.headers.get("etag");
assert(etag);
const same = await request(a, "/api/library", undefined, {
  "If-None-Match": etag,
});
assert.equal(same.status, 304);
assert.equal((await same.text()).length, 0);
const booksRevision = version.headers.get("x-readwind-books-revision");
assert(booksRevision);
assert.equal(
  (
    await request(phone, "/api/sync", {
      entity: "progress",
      value: {
        ...position,
        revision: 2,
        deviceId: "qa-device-phone",
        at: { section: 0, block: 3, offset: 0 },
      },
    })
  ).status,
  200,
);
const delta = await request(a, "/api/library", undefined, {
  "If-None-Match": etag,
  "X-Readwind-Books-Revision": booksRevision,
});
assert.equal(delta.status, 200);
assert.equal(delta.headers.get("x-readwind-books-revision"), booksRevision);
const deltaBody = await delta.json();
assert.deepEqual(deltaBody.bookIds, [book.id]);
assert.equal(
  deltaBody.books,
  undefined,
  "Progress updates must not transfer unchanged book text",
);
assert.equal(deltaBody.progress[0].revision, 3);
const patch = bookMetadataUpdate({ ...book, title: "Recovered QA title" });
assert.equal((await request(a, "/api/library", patch)).status, 200);
const changed = await request(a, "/api/library", undefined, {
  "If-None-Match": etag,
  "X-Readwind-Books-Revision": booksRevision,
});
assert.equal(changed.status, 200);
assert.notEqual(changed.headers.get("etag"), etag);
assert.equal((await changed.json()).books[0].title, "Recovered QA title");
assert.equal(
  (await request(a, "/api/library?id=" + book.id, undefined, {}, "DELETE"))
    .status,
  200,
);
assert.equal((await (await request(a, "/api/library")).json()).books.length, 0);
assert.equal((await request(a, "/api/files?id=" + id)).status, 404);
const nextPassword = crypto.randomBytes(24).toString("base64url");
r = await request(b, "/api/auth/change-password", {
  currentPassword: accounts[1].password,
  newPassword: nextPassword,
});
assert.equal(r.status, 200, await r.clone().text());
const originalPassword = accounts[1].password;
accounts[1].password = nextPassword;
assert.equal((await request(b, "/api/auth/get-session")).status, 200);
const renewed = await login(accounts[1], "qa-new-password");
assert.equal(
  (
    await request(renewed, "/api/auth/change-password", {
      currentPassword: nextPassword,
      newPassword: originalPassword,
    })
  ).status,
  200,
);
for (const session of [a, b, phone, renewed]) {
  assert.equal((await request(session, "/api/auth/sign-out", {})).status, 200);
  assert.equal((await request(session, "/api/library")).status, 401);
}
console.log(
  "PASS: two-account isolation, exact-size six-MB direct uploads, PDF verification and readback, foreign file/note denial, independent sessions, precise progress and stale-write conflicts, merged cross-device reading logs, zero-byte conditional sync and invalidation, metadata editing, deletion/file cleanup, password changes, and session revocation.",
);
