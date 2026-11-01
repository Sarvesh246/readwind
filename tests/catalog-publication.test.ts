import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
const state = vi.hoisted(() => ({
  pg: null as PGlite | null,
  objects: new Map<string, Uint8Array>(),
  failUpload: false,
  puts: 0,
}));
vi.mock("@neondatabase/serverless", () => ({
  neon: () => {
    const tag = (strings: TemplateStringsArray, ...values: unknown[]) => {
      const text = strings.reduce((s, t, i) => s + (i ? `$${i}` : "") + t, "");
      return {
        text,
        values,
        then: (
          resolve: (value: unknown) => unknown,
          reject: (error: unknown) => unknown,
        ) =>
          state
            .pg!.query(text, values)
            .then((result) => result.rows)
            .then(resolve, reject),
      };
    };
    return Object.assign(tag, {
      transaction: async (queries: { text: string; values: unknown[] }[]) =>
        state.pg!.transaction(async (tx) => {
          const results = [];
          for (const q of queries)
            results.push((await tx.query(q.text, q.values)).rows);
          return results;
        }),
    });
  },
}));
vi.mock("aws4fetch", () => ({
  AwsClient: class {
    async fetch(url: string, init?: RequestInit) {
      if (init?.method === "PUT") {
        state.puts++;
        if (state.failUpload) return new Response(null, { status: 503 });
        state.objects.set(
          url,
          new Uint8Array(await new Response(init.body).arrayBuffer()),
        );
        return new Response(null, { status: 200 });
      }
      if (init?.method === "DELETE") {
        state.objects.delete(url);
        return new Response(null, { status: 204 });
      }
      const bytes = state.objects.get(url);
      return bytes
        ? new Response(new Uint8Array(bytes))
        : new Response(null, { status: 404 });
    }
  },
}));
import {
  publishPrepared,
  digest,
  cleanupStaging,
} from "../scripts/catalog/publish.mjs";
let env: NodeJS.ProcessEnv;
const record = {
  id: "edition",
  title: "Book",
  author: "Author",
  language: "en",
  subjects: ["Fiction"],
  edition: "Complete",
  publisher: "Publisher",
  source: "Publisher",
  sourceUrl: "https://publisher.test/book",
  license: "CC BY 4.0",
  format: "epub",
};
function prepared() {
  const bytes = Buffer.from([1, 2, 3]),
    asset = {
      id: "cover",
      type: "image/png",
      bytes: bytes.length,
      sha256: digest(bytes),
      data: bytes.toString("base64"),
    };
  return {
    book: {
      id: "prepared",
      title: "Book",
      cover: { blobId: "cover" },
      catalog: {
        version: "v1",
        assets: [
          {
            id: asset.id,
            type: asset.type,
            sha256: asset.sha256,
            bytes: asset.bytes,
          },
        ],
      },
    },
    assets: [asset],
    report: { passed: true },
  };
}
beforeEach(async () => {
  env = { ...process.env };
  Object.assign(process.env, {
    READWIND_CATALOG_TARGET_VERIFIED: "true",
    READWIND_CATALOG_BUDGET_BYTES: "1000000",
    READWIND_CATALOG_BASELINE_BYTES: "0",
    CATALOG_DATABASE_URL: "postgresql://test:test@localhost/test",
    AWS_ENDPOINT_URL_S3: "https://storage.test",
  });
  state.pg = new PGlite();
  await state.pg.exec(readFileSync("db/catalog.sql", "utf8"));
  state.objects.clear();
  state.failUpload = false;
  state.puts = 0;
});
afterEach(async () => {
  await state.pg?.close();
  state.pg = null;
  process.env = env;
});
describe("catalog atomic publication", () => {
  it("does not upload when the verified free allowance is exhausted", async () => {
    process.env.READWIND_CATALOG_BUDGET_BYTES = "10";
    await expect(publishPrepared(record, prepared())).rejects.toThrow("budget");
    expect(state.puts).toBe(0);
    expect(
      (await state.pg!.query("SELECT * FROM folio_catalog_versions")).rows,
    ).toHaveLength(0);
  });
  it("holds staged reservations after a failure and resumes without exposing partial books", async () => {
    state.failUpload = true;
    await expect(publishPrepared(record, prepared())).rejects.toThrow(
      "upload failed",
    );
    expect(
      (
        await state.pg!.query(
          "SELECT ready,published FROM folio_catalog_versions",
        )
      ).rows,
    ).toEqual([{ ready: false, published: false }]);
    state.failUpload = false;
    await publishPrepared(record, prepared());
    expect(
      (
        await state.pg!.query(
          "SELECT ready,published FROM folio_catalog_versions",
        )
      ).rows,
    ).toEqual([{ ready: true, published: true }]);
    expect(state.objects.size).toBe(2);
  });
  it("rejects corrupt checkpoint assets and conflicting immutable manifests", async () => {
    const corrupt = prepared();
    corrupt.assets[0].data = Buffer.from([4, 5, 6]).toString("base64");
    await expect(publishPrepared(record, corrupt)).rejects.toThrow("integrity");
    expect(state.puts).toBe(0);
    await publishPrepared(record, prepared());
    const conflicting = prepared();
    conflicting.book.title = "Changed";
    await expect(publishPrepared(record, conflicting)).rejects.toThrow(
      "Immutable",
    );
  });
  it("cleans only abandoned staging while retaining completed unpublished versions", async () => {
    await publishPrepared(record, prepared());
    await state.pg!.exec(
      "UPDATE folio_catalog_versions SET published=false,created_at=now()-interval '10 days'; INSERT INTO folio_catalog_versions(id,edition_id,entry,manifest_id,manifest_sha256,report,created_at) VALUES('stale','stale','{}','stale-manifest','hash','{}',now()-interval '10 days')",
    );
    expect(await cleanupStaging()).toBe(1);
    expect(
      (await state.pg!.query("SELECT id,ready FROM folio_catalog_versions"))
        .rows,
    ).toEqual([{ id: "v1", ready: true }]);
    expect(state.objects.size).toBe(2);
  });
  it("rechecks stored assets before republishing a previously completed version", async () => {
    await publishPrepared(record, prepared());
    state.objects.clear();
    await expect(publishPrepared(record, prepared())).rejects.toThrow(
      "verification",
    );
  });
  it("verifies every asset in a batch before activating its manifest", async () => {
    const value = prepared();
    value.assets = Array.from({ length: 9 }, (_, i) => ({
      ...value.assets[0],
      id: i === 0 ? "cover" : `figure-${i}`,
    }));
    value.book.catalog.assets = value.assets.map(
      ({ id, type, sha256, bytes }) => ({ id, type, sha256, bytes }),
    );
    await publishPrepared(record, value);
    expect(state.objects.size).toBe(10);
    expect(
      (
        await state.pg!.query(
          "SELECT count(*)::int AS n FROM folio_catalog_assets",
        )
      ).rows,
    ).toEqual([{ n: 9 }]);
    state.objects.delete("https://storage.test/folio-books/catalog/figure-8");
    await expect(publishPrepared(record, value)).rejects.toThrow(
      "verification",
    );
  });
});
