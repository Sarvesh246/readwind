import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { HttpError } from "../lib/readwind/security";

const state = vi.hoisted(() => ({
  pg: null as PGlite | null,
  objects: new Map<string, Uint8Array>(),
  calls: [] as { key: string; method: string }[],
  check: "ok" as "ok" | "missing" | "error" | "size" | "signature" | "timeout",
  put: "ok" as "ok" | "error" | "timeout",
  sign: vi.fn(async () => ({ url: "https://storage.invalid/upload", headers: {} })),
}));

vi.mock("../lib/readwind/server", () => ({
  owner: async (request: Request) => request.headers.get("x-test-user"),
  unauthorized: () => new Response(null, { status: 401 }),
  rateLimit: async () => {},
  sql: () => async (strings: TemplateStringsArray, ...values: unknown[]) =>
    (await state.pg!.query(strings.reduce((s, t, i) => s + (i ? `$${i}` : "") + t, ""), values)).rows,
  storagePresign: () => state.sign(),
  storageFetch: async (key: string, init: RequestInit = {}) => {
    const method = init.method || "GET";
    state.calls.push({ key, method });
    if (method === "DELETE") {
      state.objects.delete(key);
      return new Response(null, { status: 204 });
    }
    if (method === "PUT") {
      if (state.put === "timeout") throw new Error("Upload timed out");
      if (state.put === "error") return new Response(null, { status: 503 });
      state.objects.set(key, new Uint8Array(init.body as Uint8Array));
      return new Response(null, { status: 200 });
    }
    if (state.check === "timeout") throw new Error("Verification timed out");
    if (state.check === "missing") return new Response(null, { status: 404 });
    if (state.check === "error") return new Response(null, { status: 503 });
    const data = state.objects.get(key);
    if (!data) return new Response(null, { status: 404 });
    const bytes = state.check === "signature" ? new Uint8Array(data.length) : new Uint8Array(data);
    return new Response(bytes, {
      headers: { "content-length": String(data.length + (state.check === "size" ? 1 : 0)) },
    });
  },
}));

import { POST as sign } from "../app/api/files/sign/route";
import { POST as complete } from "../app/api/files/complete/route";
import { POST as upload, DELETE as cancel } from "../app/api/files/route";
import { DELETE as deleteBook } from "../app/api/library/route";

const pdf = new TextEncoder().encode("%PDF-1.7\n upload fixture");
const fields = { id: "original", type: "application/pdf", bytes: pdf.length };
const book = {
  id: "book", title: "Book", author: "Author", sourcePdfBlobId: fields.id,
  addedAt: 1, lastOpenedAt: 1, printPageCount: 1, pageMarks: [],
  cover: { kind: "typeset", color: "#112233", fg: "#ffffff" },
  sections: [{ id: "s", title: "Text", heading: false, blocks: [{ type: "p", text: "A paragraph." }] }],
};
function request(path: string, body?: unknown, user = "alice", method = "POST") {
  return new Request(`https://readwind.test${path}`, {
    method,
    headers: { "content-type": "application/json", "x-test-user": user, origin: "https://readwind.test" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}
async function reservations() {
  return (await state.pg!.query<{ owner_id: string; id: string; bytes: number }>("SELECT owner_id,id,bytes FROM folio_files ORDER BY owner_id,id")).rows;
}
async function expectPreserved() {
  expect(state.objects.get("alice/original")).toEqual(pdf);
  expect(state.objects.get("bob/original")).toEqual(pdf);
  expect(await reservations()).toEqual([
    { owner_id: "alice", id: "original", bytes: pdf.length },
    { owner_id: "bob", id: "original", bytes: pdf.length },
  ]);
  expect(state.calls.some(call => call.method === "DELETE")).toBe(false);
  expect((await state.pg!.query<{ data: typeof book }>("SELECT data FROM folio_books WHERE owner_id='alice'")).rows[0].data).toEqual(book);
}
beforeEach(async () => {
  state.pg = new PGlite();
  await state.pg.exec(readFileSync("db/folio.sql", "utf8"));
  state.objects.clear(); state.calls = []; state.check = "ok"; state.put = "ok";
  state.sign.mockReset().mockResolvedValue({ url: "https://storage.invalid/upload", headers: {} });
  for (const owner of ["alice", "bob"]) {
    state.objects.set(`${owner}/original`, new Uint8Array(pdf));
    await state.pg.query("INSERT INTO folio_files VALUES($1,$2,$3)", [owner, fields.id, pdf.length]);
    await state.pg.query("INSERT INTO folio_books(owner_id,id,data) VALUES($1,$2,$3)", [owner, book.id, book]);
  }
});
afterEach(async () => { await state.pg?.close(); });

describe("non-destructive upload retries", () => {
  it("rejects cancellation from old tabs without deleting referenced or in-flight files", async () => {
    expect((await cancel(request("/api/files?id=original", undefined, "alice", "DELETE"))).status).toBe(409);
    await expectPreserved();
    await state.pg!.query("INSERT INTO folio_files VALUES('alice','in-flight',10)");
    expect((await cancel(request("/api/files?id=in-flight", undefined, "alice", "DELETE"))).status).toBe(409);
    expect((await reservations()).some(row => row.id === "in-flight")).toBe(true);
    expect(state.calls).toEqual([]);
  });

  for (const [failure, status] of [["missing", 400], ["error", 400], ["size", 400], ["signature", 415], ["timeout", 503]] as const)
    it(`preserves objects and quota after ${failure} verification, then completes a retry`, async () => {
      state.check = failure;
      expect((await complete(request("/api/files/complete", fields))).status).toBe(status);
      await expectPreserved();
      state.check = "ok";
      expect((await sign(request("/api/files/sign", fields))).status).toBe(200);
      expect((await complete(request("/api/files/complete", fields))).status).toBe(200);
      await expectPreserved();
    });

  for (const failure of ["error", "timeout"] as const)
    it(`retains quota after a legacy ${failure} upload and allows retry`, async () => {
      state.put = failure;
      const send = () => upload(new Request("https://readwind.test/api/files?id=original", {
        method: "POST", headers: { "x-test-user": "alice", "content-type": fields.type }, body: pdf,
      }));
      expect((await send()).status).toBe(failure === "error" ? 502 : 503);
      await expectPreserved();
      state.put = "ok";
      expect((await send()).status).toBe(200);
      await expectPreserved();
    });

  it("keeps the shared reservation when one signing attempt fails after another finishes", async () => {
    let rejectFirst!: (error: Error) => void;
    state.sign.mockImplementationOnce(() => new Promise((_resolve, reject) => { rejectFirst = reject; }));
    const first = sign(request("/api/files/sign", { ...fields, id: "shared" }));
    await vi.waitFor(() => expect(state.sign).toHaveBeenCalledTimes(1));
    expect((await sign(request("/api/files/sign", { ...fields, id: "shared" }))).status).toBe(200);
    state.objects.set("alice/shared", new Uint8Array(pdf));
    expect((await complete(request("/api/files/complete", { ...fields, id: "shared" }))).status).toBe(200);
    rejectFirst(new HttpError(503, "Signing failed"));
    expect((await first).status).toBe(503);
    expect((await reservations()).find(row => row.owner_id === "alice" && row.id === "shared")?.bytes).toBe(pdf.length);
    expect(state.objects.get("alice/shared")).toEqual(pdf);
  });

  it("explicit book deletion still removes its private files and releases quota", async () => {
    expect((await deleteBook(request("/api/library?id=book", { files: [fields.id] }, "alice", "DELETE"))).status).toBe(200);
    expect(state.objects.has("alice/original")).toBe(false);
    expect(state.objects.get("bob/original")).toEqual(pdf);
    expect(await reservations()).toEqual([{ owner_id: "bob", id: "original", bytes: pdf.length }]);
  });

  it("can release a failed new upload by deleting its locally queued book", async () => {
    state.sign.mockRejectedValueOnce(new HttpError(503, "Signing failed"));
    expect((await sign(request("/api/files/sign", { ...fields, id: "new-upload" }))).status).toBe(503);
    expect((await reservations()).some(row => row.id === "new-upload")).toBe(true);
    expect((await deleteBook(request("/api/library?id=not-yet-synced", { files: ["new-upload"] }, "alice", "DELETE"))).status).toBe(200);
    await expectPreservedAfterCleanup();
  });
});

async function expectPreservedAfterCleanup() {
  expect((await reservations()).some(row => row.id === "new-upload")).toBe(false);
  expect(state.objects.get("alice/original")).toEqual(pdf);
  expect(state.objects.get("bob/original")).toEqual(pdf);
}
