import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import type { Book } from "../lib/readwind/types";
import { sha256 } from "../lib/readwind/catalog";
import {
  markBookDeleted,
  finishBookCleanup,
  saveLiveBook,
} from "../lib/readwind/book-deletion";
const state = vi.hoisted(() => ({
  pg: null as PGlite | null,
  files: new Map<string, Uint8Array>(),
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
  storageFetch: async (key: string) =>
    state.files.has(key)
      ? new Response(new Uint8Array(state.files.get(key)!))
      : new Response(null, { status: 404 }),
}));
import { POST as add } from "../app/api/catalog/[editionId]/add/route";
import { GET as asset } from "../app/api/catalog/assets/[id]/route";
import { GET as search } from "../app/api/catalog/route";
import { catalogEntries } from "../lib/readwind/catalog-server";
import { POST as saveMetadata } from "../app/api/library/route";
import { catalogMetadataUpdate } from "../lib/readwind/catalog";
let originalFlag: string | undefined;
const tag = async (strings: TemplateStringsArray, ...values: unknown[]) =>
  (
    await state.pg!.query(
      strings.reduce((s, t, i) => s + (i ? `$${i}` : "") + t, ""),
      values,
    )
  ).rows;
const prepared: Book = {
  id: "prepared",
  title: "A complete book",
  author: "Author",
  addedAt: 1,
  lastOpenedAt: 1,
  printPageCount: 1,
  pageMarks: [],
  pagination: "flow",
  sourceFormat: "epub",
  sections: [
    {
      id: "s",
      title: "Chapter",
      heading: false,
      blocks: [
        { type: "p", text: "The complete beginning, middle and ending." },
      ],
    },
  ],
  cover: { kind: "image", blobId: "cover", color: "#123456", fg: "#ffffff" },
  catalog: {
    editionId: "edition",
    version: "v1",
    assets: [],
    subjects: ["History"],
  },
};
beforeEach(async () => {
  originalFlag = process.env.READWIND_CATALOG_ENABLED;
  process.env.READWIND_CATALOG_ENABLED = "true";
  state.pg = new PGlite();
  state.files.clear();
  await state.pg.exec(
    "CREATE TABLE folio_books(owner_id text,id text,data jsonb,updated_at timestamptz DEFAULT now(),PRIMARY KEY(owner_id,id)); CREATE TABLE folio_settings(owner_id text PRIMARY KEY,data jsonb,updated_at timestamptz DEFAULT now());",
  );
  await state.pg.exec(readFileSync("db/catalog.sql", "utf8"));
  const body = new TextEncoder().encode(JSON.stringify(prepared));
  state.files.set("catalog/manifest", body);
  state.files.set("catalog/cover", new Uint8Array([1, 2, 3]));
  const entry = {
    id: "edition",
    title: prepared.title,
    author: prepared.author,
    subjects: ["History"],
    coverId: "cover",
    version: "v1",
  };
  await state.pg.query(
    "INSERT INTO folio_catalog_versions(id,edition_id,entry,manifest_id,manifest_sha256,report,ready,published) VALUES($1,$2,$3,$4,$5,$6,true,true)",
    [
      "v1",
      "edition",
      JSON.stringify(entry),
      "manifest",
      await sha256(body),
      "{}",
    ],
  );
  await state.pg.query(
    "INSERT INTO folio_catalog_assets VALUES($1,$2,$3,$4,$5)",
    ["cover", "v1", "a".repeat(64), 3, "image/png"],
  );
});
afterEach(async () => {
  await state.pg?.close();
  state.pg = null;
  if (originalFlag === undefined) delete process.env.READWIND_CATALOG_ENABLED;
  else process.env.READWIND_CATALOG_ENABLED = originalFlag;
});
describe("catalog persistence and access", () => {
  it("updates a large catalog book through a small metadata request and keeps its body intact", async () => {
    const large: Book = {
      ...prepared,
      id: "catalog-edition",
      customCoverBlobId: "old-cover",
      sections: [
        {
          id: "large",
          title: "Chapter",
          heading: false,
          blocks: Array.from({ length: 30 }, () => ({
            type: "p" as const,
            text: "a".repeat(190000),
          })),
        },
      ],
    };
    await saveLiveBook(tag, "alice", large);
    const patch = catalogMetadataUpdate({
      ...large,
      title: "My title",
      customCoverBlobId: undefined,
    });
    const body = JSON.stringify(patch);
    expect(body.length).toBeLessThan(2000);
    const response = await saveMetadata(
      new Request("https://readwind.test/api/library", {
        method: "POST",
        headers: { "x-test-user": "alice", "Content-Type": "application/json" },
        body,
      }),
    );
    expect(response.status).toBe(200);
    const saved = (
      await state.pg!.query<{ data: Book }>("SELECT data FROM folio_books")
    ).rows[0].data;
    expect(saved.title).toBe("My title");
    expect(saved.sections).toEqual(large.sections);
    expect(saved.customCoverBlobId).toBeUndefined();
  });
  it("restores a catalog copy from its immutable manifest using metadata alone", async () => {
    const patch = catalogMetadataUpdate({ ...prepared, id: "catalog-edition" });
    const response = await saveMetadata(
      new Request("https://readwind.test/api/library?restore=true", {
        method: "POST",
        headers: { "x-test-user": "alice", "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      }),
    );
    expect(response.status).toBe(200);
    expect(
      (await state.pg!.query<{ data: Book }>("SELECT data FROM folio_books"))
        .rows[0].data.sections,
    ).toEqual(prepared.sections);
  });
  it("fails closed behind the feature flag", async () => {
    process.env.READWIND_CATALOG_ENABLED = "false";
    await expect(catalogEntries()).rejects.toThrow("not available");
  });
  it("only searches published editions", async () => {
    expect(
      (
        await search(
          new Request("https://readwind.test/api/catalog?q=complete"),
        )
      ).status,
    ).toBe(200);
    await state.pg!.exec("UPDATE folio_catalog_versions SET published=false");
    const response = await search(
      new Request("https://readwind.test/api/catalog"),
    );
    expect(((await response.json()) as { items: unknown[] }).items).toEqual([]);
  });
  it("authenticates additions and converges simultaneous requests without resetting edits", async () => {
    const context = { params: Promise.resolve({ editionId: "edition" }) };
    expect(
      (
        await add(
          new Request("https://readwind.test/api/catalog/edition/add", {
            method: "POST",
          }),
          context,
        )
      ).status,
    ).toBe(401);
    const request = () =>
      new Request("https://readwind.test/api/catalog/edition/add", {
        method: "POST",
        headers: { "x-test-user": "alice" },
      });
    const results = await Promise.all([
      add(request(), context),
      add(request(), context),
    ]);
    expect(results.map((r) => r.status)).toEqual([200, 200]);
    expect(
      (await state.pg!.query("SELECT * FROM folio_books")).rows,
    ).toHaveLength(1);
    await state.pg!.exec(
      `UPDATE folio_books SET data=jsonb_set(data,'{title}','"My edited title"')`,
    );
    const response = await add(request(), context);
    expect(((await response.json()) as { book: Book }).book.title).toBe(
      "My edited title",
    );
  });
  it("retains an unpublished version for its owner but blocks other accounts", async () => {
    await saveLiveBook(tag, "alice", { ...prepared, id: "catalog-edition" });
    await state.pg!.exec("UPDATE folio_catalog_versions SET published=false");
    const context = { params: Promise.resolve({ id: "cover" }) };
    expect(
      (
        await asset(
          new Request("https://readwind.test/api/catalog/assets/cover", {
            headers: { "x-test-user": "alice" },
          }),
          context,
        )
      ).status,
    ).toBe(200);
    expect(
      (
        await asset(
          new Request("https://readwind.test/api/catalog/assets/cover", {
            headers: { "x-test-user": "bob" },
          }),
          context,
        )
      ).status,
    ).toBe(404);
  });
  it("prevents an old add from resurrecting a subsequent deletion", async () => {
    const book = { ...prepared, id: "catalog-edition" };
    await saveLiveBook(tag, "alice", book);
    await markBookDeleted(tag, "alice", book.id, []);
    await finishBookCleanup(tag, "alice", book.id);
    expect(
      await saveLiveBook(tag, "alice", book, true, true, null),
    ).toHaveLength(0);
    const snapshot = (
      await state.pg!.query<{ deletion: unknown }>(
        `SELECT data->'_bookDeletions'->'catalog-edition' AS deletion FROM folio_settings WHERE owner_id='alice'`,
      )
    ).rows[0].deletion;
    expect(
      await saveLiveBook(tag, "alice", book, true, true, snapshot),
    ).toHaveLength(1);
  });
  it("rejects a corrupted prepared manifest before adding a library book", async () => {
    state.files.set("catalog/manifest", new TextEncoder().encode("{}"));
    const response = await add(
      new Request("https://readwind.test/api/catalog/edition/add", {
        method: "POST",
        headers: { "x-test-user": "alice" },
      }),
      { params: Promise.resolve({ editionId: "edition" }) },
    );
    expect(response.status).toBe(503);
    expect(
      (await state.pg!.query("SELECT * FROM folio_books")).rows,
    ).toHaveLength(0);
  });
});
