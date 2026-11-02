import { beforeAll, afterAll, describe, it, expect } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { splitSqlStatements } from "../scripts/sql-statements.mjs";
const db = new PGlite();
beforeAll(async () => {
  await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS; CREATE SCHEMA auth;
    GRANT USAGE ON SCHEMA auth TO service_role;
    CREATE TABLE auth.users(id uuid PRIMARY KEY,banned_until timestamptz,deleted_at timestamptz,email_confirmed_at timestamptz);
    CREATE TABLE auth.sessions(id uuid PRIMARY KEY,user_id uuid REFERENCES auth.users(id),not_after timestamptz);`);
  for (const file of ["db/folio.sql", "db/catalog.sql", "db/supabase.sql"])
    for (const statement of splitSqlStatements(readFileSync(file, "utf8")))
      await db.exec(statement);
}, 30000);
afterAll(() => db.close());
async function tenant<T>(
  owner: string,
  fn: (tx: Parameters<Parameters<typeof db.transaction>[0]>[0]) => Promise<T>,
) {
  return db.transaction(async (tx) => {
    await tx.exec("SET LOCAL ROLE readwind_runtime");
    await tx.query("SELECT set_config('readwind.owner',$1,true)", [owner]);
    return fn(tx);
  });
}
describe("Supabase recovery database boundaries", () => {
  it("tracks content, position, preference and deletion changes without reading book payloads", async () => {
    const revision = async () =>
      Number(
        (
          await tenant("recovery-a", (tx) =>
            tx.query<{ revision: number }>(
              "SELECT revision FROM folio_account_revisions",
            ),
          )
        ).rows[0]?.revision || 0,
      );
    await tenant("recovery-a", (tx) =>
      tx.query("INSERT INTO folio_books(owner_id,id,data) VALUES($1,$2,$3)", [
        "recovery-a",
        "book",
        { title: "Preserved book" },
      ]),
    );
    const before = await revision();
    const bookRevision = async () =>
      Number(
        (
          await tenant("recovery-a", (tx) =>
            tx.query<{ books_revision: number }>(
              "SELECT books_revision FROM folio_account_revisions",
            ),
          )
        ).rows[0].books_revision,
      );
    const contentBefore = await bookRevision();
    expect(before).toBeGreaterThan(0);
    expect(await revision()).toBe(before);
    await tenant("recovery-a", (tx) =>
      tx.query(
        "INSERT INTO folio_progress(owner_id,book_id,at,device_id) VALUES($1,$2,$3,$4)",
        ["recovery-a", "book", { section: 0, block: 0, offset: 0 }, "phone"],
      ),
    );
    const position = await revision();
    expect(position).toBeGreaterThan(before);
    expect(await bookRevision()).toBe(contentBefore);
    await tenant("recovery-a", (tx) =>
      tx.query("INSERT INTO folio_settings(owner_id,data) VALUES($1,$2)", [
        "recovery-a",
        {
          readingLog: {
            "2026-11-01.phone": { pages: 12, words: 500, seconds: 120 },
          },
        },
      ]),
    );
    const settings = await revision();
    expect(settings).toBeGreaterThan(position);
    expect(await bookRevision()).toBe(contentBefore);
    await tenant("recovery-a", (tx) =>
      tx.query("DELETE FROM folio_books WHERE id=$1", ["book"]),
    );
    expect(await revision()).toBeGreaterThan(settings);
    expect(await bookRevision()).toBeGreaterThan(contentBefore);
    expect(
      (
        await tenant("recovery-b", (tx) =>
          tx.query("SELECT * FROM folio_account_revisions"),
        )
      ).rows,
    ).toHaveLength(0);
  });
  it("isolates raw recovery archives and prevents runtime identity reassignment", async () => {
    await tenant("recovery-a", (tx) =>
      tx.query(
        "INSERT INTO folio_recovery_snapshots(owner_id,device_id,epoch,entity,entity_id,data) VALUES($1,$2,$3,$4,$5,$6)",
        [
          "recovery-a",
          "phone",
          "epoch",
          "settings",
          "reader",
          { privateNote: "Only this owner" },
        ],
      ),
    );
    expect(
      (
        await tenant("recovery-a", (tx) =>
          tx.query("SELECT data FROM folio_recovery_snapshots"),
        )
      ).rows,
    ).toHaveLength(1);
    expect(
      (
        await tenant("recovery-b", (tx) =>
          tx.query("SELECT data FROM folio_recovery_snapshots"),
        )
      ).rows,
    ).toHaveLength(0);
    await expect(
      tenant("recovery-b", (tx) =>
        tx.query(
          "INSERT INTO folio_recovery_snapshots(owner_id,device_id,epoch,entity,entity_id,data) VALUES($1,$2,$3,$4,$5,$6)",
          ["recovery-a", "attacker", "epoch", "settings", "reader", {}],
        ),
      ),
    ).rejects.toThrow(/row-level security/);
    await expect(
      tenant("recovery-a", (tx) =>
        tx.exec(
          "INSERT INTO folio_identities(auth_user_id,owner_id) VALUES('11111111-1111-1111-1111-111111111111','someone-else')",
        ),
      ),
    ).rejects.toThrow(/permission denied/);
  });
  it("denies anonymous table and session RPC access and checks live provider account state", async () => {
    const user = "11111111-1111-1111-1111-111111111111",
      session = "22222222-2222-2222-2222-222222222222";
    await db.query(
      "INSERT INTO auth.users(id,email_confirmed_at) VALUES($1,now())",
      [user],
    );
    await db.query("INSERT INTO auth.sessions(id,user_id) VALUES($1,$2)", [
      session,
      user,
    ]);
    const live = async () =>
      db.transaction(async (tx) => {
        await tx.exec("SET LOCAL ROLE service_role");
        return (
          await tx.query<{ live: boolean }>(
            "SELECT public.readwind_session_live($1,$2) AS live",
            [session, user],
          )
        ).rows[0].live;
      });
    expect(await live()).toBe(true);
    await db.query(
      "UPDATE auth.users SET banned_until=now()+interval '1 hour' WHERE id=$1",
      [user],
    );
    expect(await live()).toBe(false);
    await db.query(
      "UPDATE auth.users SET banned_until=NULL,email_confirmed_at=NULL WHERE id=$1",
      [user],
    );
    expect(await live()).toBe(false);
    await db.query(
      "UPDATE auth.users SET email_confirmed_at=now(),deleted_at=now() WHERE id=$1",
      [user],
    );
    expect(await live()).toBe(false);
    await db.query("UPDATE auth.users SET deleted_at=NULL WHERE id=$1", [user]);
    expect(await live()).toBe(true);
    await db.query("DELETE FROM auth.sessions WHERE id=$1", [session]);
    expect(await live()).toBe(false);
    await expect(
      db.transaction(async (tx) => {
        await tx.exec("SET LOCAL ROLE anon");
        await tx.query("SELECT public.readwind_session_live($1,$2)", [
          session,
          user,
        ]);
      }),
    ).rejects.toThrow(/permission denied/);
    await expect(
      db.transaction(async (tx) => {
        await tx.exec("SET LOCAL ROLE anon");
        await tx.exec("SELECT * FROM folio_recovery_snapshots");
      }),
    ).rejects.toThrow(/permission denied/);
  });
});
