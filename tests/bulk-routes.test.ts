import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";

// Real-Postgres coverage for the two routes that were rewritten from per-row
// queries to set-based SQL: book deletion cleanup and recovery note import.
const state = vi.hoisted(() => ({
  pg: null as PGlite | null,
  storageDeletes: [] as string[],
}));
vi.mock("../lib/readwind/server", () => ({
  sql:
    () =>
    async (strings: TemplateStringsArray, ...values: unknown[]) =>
      (
        await state.pg!.query(
          strings.reduce((s, t, i) => s + (i ? `$${i}` : "") + t, ""),
          values,
        )
      ).rows,
  owner: async (request: Request) => request.headers.get("x-test-user"),
  unauthorized: () => Response.json({ error: "Unauthorized" }, { status: 401 }),
  rateLimit: async () => {},
  storageFetch: async (key: string, init?: RequestInit) => {
    if (init?.method === "DELETE") state.storageDeletes.push(key);
    return new Response(null, { status: 204 });
  },
}));
import { DELETE as deleteBook } from "../app/api/library/route";
import { POST as recover } from "../app/api/recovery/route";

const EPOCH = "epoch-1";
const original = {
  backend: process.env.READWIND_BACKEND,
  epoch: process.env.READWIND_RECOVERY_EPOCH,
};
beforeEach(async () => {
  process.env.READWIND_BACKEND = "supabase";
  process.env.READWIND_RECOVERY_EPOCH = EPOCH;
  state.storageDeletes = [];
  state.pg = new PGlite();
  await state.pg.exec(`
    CREATE TABLE folio_books(owner_id text,id text,data jsonb,updated_at timestamptz DEFAULT now(),PRIMARY KEY(owner_id,id));
    CREATE TABLE folio_settings(owner_id text PRIMARY KEY,data jsonb,updated_at timestamptz DEFAULT now());
    CREATE TABLE folio_files(owner_id text,id text,bytes bigint,PRIMARY KEY(owner_id,id));
    CREATE TABLE folio_progress(owner_id text,book_id text,at jsonb,revision int,device_id text,words_read int,updated_at timestamptz,PRIMARY KEY(owner_id,book_id));
    CREATE TABLE folio_annotations(owner_id text,id text,book_id text,data jsonb,updated_at timestamptz DEFAULT now(),PRIMARY KEY(owner_id,id));
    CREATE TABLE folio_recovery_snapshots(owner_id text,device_id text,epoch text,entity text,entity_id text DEFAULT '',data jsonb);
  `);
});
afterEach(async () => {
  await state.pg?.close();
  state.pg = null;
  for (const [key, value] of [
    ["READWIND_BACKEND", original.backend],
    ["READWIND_RECOVERY_EPOCH", original.epoch],
  ] as const) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

const bookData = (id: string, refs: { source?: string; figure?: string }) => ({
  id,
  title: id,
  author: "Author",
  addedAt: 1,
  lastOpenedAt: 1,
  printPageCount: 1,
  pageMarks: [],
  pagination: "flow",
  sourceFormat: "epub",
  ...(refs.source ? { sourceBlobId: refs.source } : {}),
  cover: { kind: "typeset", color: "#123456", fg: "#ffffff" },
  sections: [
    {
      id: "s",
      title: "Chapter",
      heading: false,
      blocks: [
        { type: "p", text: "Text" },
        ...(refs.figure ? [{ type: "figure", blobId: refs.figure }] : []),
      ],
    },
  ],
});

describe("book deletion cleanup", () => {
  it("removes only files no other book still references, in one quota release", async () => {
    const pg = state.pg!;
    for (const [id, data] of [
      ["a", bookData("a", { source: "only-a", figure: "shared" })],
      ["b", bookData("b", { figure: "shared" })],
    ] as const)
      await pg.query("INSERT INTO folio_books(owner_id,id,data) VALUES($1,$2,$3)", [
        "alice",
        id,
        JSON.stringify(data),
      ]);
    for (const file of ["only-a", "shared", "stranger"])
      await pg.query("INSERT INTO folio_files VALUES($1,$2,10)", ["alice", file]);

    const response = await deleteBook(
      new Request("https://readwind.test/api/library?id=a", {
        method: "DELETE",
        headers: { "x-test-user": "alice" },
      }),
    );

    expect(response.status).toBe(200);
    expect(state.storageDeletes).toEqual(["alice/only-a"]);
    const left = await pg.query<{ id: string }>(
      "SELECT id FROM folio_files ORDER BY id",
    );
    expect(left.rows.map((r) => r.id)).toEqual(["shared", "stranger"]);
    const books = await pg.query<{ id: string }>("SELECT id FROM folio_books");
    expect(books.rows.map((r) => r.id)).toEqual(["b"]);
  });
});

describe("recovery note import", () => {
  const note = (id: string, updatedAt: number, text: string) => ({
    id,
    bookId: "a",
    kind: "highlight",
    range: {
      start: { section: 0, block: 0, offset: 0 },
      end: { section: 0, block: 0, offset: 2 },
    },
    color: "yellow",
    quote: text,
    note: "",
    createdAt: 1,
    updatedAt,
  });
  const send = (notes: unknown[]) =>
    recover(
      new Request("https://readwind.test/api/recovery", {
        method: "POST",
        headers: {
          "x-test-user": "alice",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          epoch: EPOCH,
          deviceId: "device-1",
          kind: "book",
          value: { ...bookData("a", {}), revision: 1 },
          annotations: notes,
        }),
      }),
    );

  it("upserts many notes across chunks, keeping the newest duplicate", async () => {
    const notes = Array.from({ length: 1100 }, (_, i) =>
      note(`n${i}`, 1000 + i, `quote ${i}`),
    );
    // The same note twice in one archive: the newer copy must win.
    notes.push(note("n5", 9000, "newest"), note("n5", 2000, "older"));
    const response = await send(notes);
    expect(response.status).toBe(200);

    const count = await state.pg!.query<{ n: number }>(
      "SELECT count(*)::int AS n FROM folio_annotations",
    );
    expect(count.rows[0].n).toBe(1100);
    const kept = await state.pg!.query<{ quote: string }>(
      "SELECT data->>'quote' AS quote FROM folio_annotations WHERE id='n5'",
    );
    expect(kept.rows[0].quote).toBe("newest");
  });

  it("does not overwrite a newer stored note with an older archived one", async () => {
    await send([note("n1", 5000, "current")]);
    await send([note("n1", 100, "stale")]);
    const kept = await state.pg!.query<{ quote: string }>(
      "SELECT data->>'quote' AS quote FROM folio_annotations WHERE id='n1'",
    );
    expect(kept.rows[0].quote).toBe("current");
  });

  it("rejects a note that belongs to another book without writing any", async () => {
    const stray = { ...note("n2", 1, "x"), bookId: "other" };
    const response = await send([note("n1", 1, "ok"), stray]);
    expect(response.status).toBe(400);
    const count = await state.pg!.query<{ n: number }>(
      "SELECT count(*)::int AS n FROM folio_annotations",
    );
    expect(count.rows[0].n).toBe(0);
  });
});
