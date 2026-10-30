import { assertSchemaReady, readinessSql } from "../scripts/check-readwind-schema.mjs";
import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
const db = new PGlite();
const sample = {
  id: "book",
  title: "Book",
  author: "Author",
  sections: [
    {
      id: "s",
      title: "Chapter",
      heading: true,
      blocks: [{ type: "p", text: "One two three" }],
    },
  ],
  cover: { kind: "typeset", color: "#222222", fg: "#ffffff" },
  pageMarks: [],
  addedAt: 1,
  lastOpenedAt: 1,
  printPageCount: 1,
};
beforeAll(async () => {
  // Run exactly the statement boundaries used by the migration runner.
  const source = readFileSync("db/folio.sql", "utf8");
  const statements = source.match(/(?:[^;$]|\$(?!\$)|\$\$[\s\S]*?\$\$)+/g)!;
  await db.transaction(async (tx) => {
    for (const statement of statements)
      if (statement.trim()) await tx.exec(statement);
  });
  await db.exec(readFileSync("db/runtime-role.sql", "utf8"));
}, 30000);
afterAll(() => db.close());
async function tenant<T>(
  id: string,
  fn: (tx: Parameters<Parameters<typeof db.transaction>[0]>[0]) => Promise<T>,
) {
  return db.transaction(async (tx) => {
    await tx.exec("SET LOCAL ROLE readwind_runtime");
    await tx.query("SELECT set_config('readwind.owner',$1,true)", [id]);
    return fn(tx);
  });
}
describe("database tenant and quota enforcement", () => {
  it("rejects missing context and foreign-tenant writes, and hides other tenants", async () => {
    await tenant("alice", (tx) =>
      tx.query("INSERT INTO folio_books(owner_id,id,data) VALUES($1,$2,$3)", [
        "alice",
        "book",
        sample,
      ]),
    );
    expect(
      (await tenant("bob", (tx) => tx.query("SELECT * FROM folio_books"))).rows,
    ).toHaveLength(0);
    await expect(
      tenant("bob", (tx) =>
        tx.query("INSERT INTO folio_books(owner_id,id,data) VALUES($1,$2,$3)", [
          "alice",
          "foreign",
          sample,
        ]),
      ),
    ).rejects.toThrow(/row-level security/);
    const rows = await db.transaction(async (tx) => {
      await tx.exec("SET LOCAL ROLE readwind_runtime");
      return tx.query("SELECT * FROM folio_books");
    });
    expect(rows.rows).toHaveLength(0);
  });
  it("prevents runtime DDL and table ownership privileges", async () => {
    await expect(
      tenant("alice", (tx) => tx.exec("DROP TABLE folio_books CASCADE")),
    ).rejects.toThrow(/owner/);
    await expect(
      tenant("alice", (tx) =>
        tx.exec("CREATE TABLE public.unauthorized(id text)"),
      ),
    ).rejects.toThrow(/permission/);
  });
  it("enforces book count and storage bytes at the database boundary", async () => {
    await tenant("quota", async (tx) => {
      for (let i = 0; i < 100; i++)
        await tx.query(
          "INSERT INTO folio_books(owner_id,id,data) VALUES($1,$2,$3)",
          ["quota", `b${i}`, { ...sample, id: `b${i}` }],
        );
    });
    await expect(
      tenant("quota", (tx) =>
        tx.query("INSERT INTO folio_books(owner_id,id,data) VALUES($1,$2,$3)", [
          "quota",
          "overflow",
          sample,
        ]),
      ),
    ).rejects.toThrow(/quota/);
    await tenant("quota", async (tx) => {
      for (let i = 0; i < 25; i++)
        await tx.query(
          "INSERT INTO folio_files(owner_id,id,bytes) VALUES($1,$2,$3)",
          ["quota", `f${i}`, 20971520],
        );
    });
    await expect(
      tenant("quota", (tx) =>
        tx.query(
          "INSERT INTO folio_files(owner_id,id,bytes) VALUES($1,$2,$3)",
          ["quota", "overflow", 1],
        ),
      ),
    ).rejects.toThrow(/quota/);
    await tenant("quota", (tx) =>
      tx.query(
        "INSERT INTO folio_files(owner_id,id,bytes) VALUES($1,$2,$3) ON CONFLICT(owner_id,id) DO UPDATE SET bytes=EXCLUDED.bytes",
        ["quota", "f0", 20971520],
      ),
    );
  });
  it("isolates import progress per tenant and validates its values", async () => {
    const insert = "INSERT INTO folio_imports(owner_id,id,title,percent,message,status,device_id) VALUES($1,$2,'Book',$3,'Working',$4,'d')";
    await tenant("alice", (tx) => tx.query(insert, ["alice", "job", 42, "running"]));
    expect((await tenant("bob", (tx) => tx.query("SELECT * FROM folio_imports"))).rows).toHaveLength(0);
    expect((await tenant("alice", (tx) => tx.query("SELECT percent FROM folio_imports"))).rows).toEqual([{ percent: 42 }]);
    await expect(tenant("bob", (tx) => tx.query(insert, ["alice", "foreign", 1, "running"]))).rejects.toThrow(/row-level security/);
    await expect(tenant("alice", (tx) => tx.query(insert, ["alice", "bad", 101, "running"]))).rejects.toThrow();
    await expect(tenant("alice", (tx) => tx.query(insert, ["alice", "bad", 5, "paused"]))).rejects.toThrow();
  });
  it("cascades book deletion to notes and progress", async () => {
    await tenant("alice", async (tx) => {
      await tx.query(
        "INSERT INTO folio_progress(owner_id,book_id,at,device_id) VALUES('alice','book','{}','device')",
      );
      await tx.query(
        "INSERT INTO folio_annotations(owner_id,id,book_id,data) VALUES('alice','note','book','{}')",
      );
      await tx.query("DELETE FROM folio_books WHERE id='book'");
      expect(
        (await tx.query("SELECT * FROM folio_progress")).rows,
      ).toHaveLength(0);
      expect(
        (await tx.query("SELECT * FROM folio_annotations")).rows,
      ).toHaveLength(0);
    });
  });
});

describe("deployment database readiness",()=>{
  it("rejects an unmigrated database and accepts the actual migrated schema",async()=>{
    const empty = new PGlite();
    try {
      const before = await empty.query(readinessSql);
      expect(()=>assertSchemaReady(before.rows)).toThrow(/folio_rate_limits/);
      const after = await db.query(readinessSql);
      expect(()=>assertSchemaReady(after.rows)).not.toThrow();
    } finally {await empty.close();}
  });
});
