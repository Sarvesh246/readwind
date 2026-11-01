import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { splitSqlStatements } from "../scripts/sql-statements.mjs";
describe("Postgres migration splitting", () => {
  it("keeps semicolons inside comments and quoted values", () => {
    const statements = splitSqlStatements(
      `-- comment; keep this\nSELECT 'a; b -- c'; /* another; /* nested; */ comment */ SELECT "column;name" FROM example; -- trailing;`,
    );
    expect(statements).toHaveLength(2);
    expect(statements[0]).toContain("SELECT 'a; b -- c'");
    expect(statements[1]).toContain('SELECT "column;name"');
  });
  it("preserves dollar-quoted function bodies and escaped SQL quotes", () => {
    expect(
      splitSqlStatements(
        `DO $body$ BEGIN PERFORM 'it''s; fine'; END $body$; SELECT 1;`,
      ),
    ).toHaveLength(2);
    expect(() => splitSqlStatements("SELECT 'unfinished")).toThrow(
      "Unterminated",
    );
  });
  it("applies the actual catalog role migrations as split statements", async () => {
    const pg = new PGlite();
    try {
      for (const file of [
        "db/folio.sql",
        "db/runtime-role.sql",
        "db/catalog.sql",
        "db/catalog-worker-role.sql",
      ])
        for (const statement of splitSqlStatements(readFileSync(file, "utf8")))
          await pg.exec(statement);
      const rows = await pg.query<{
        can_write: boolean;
        can_read_private: boolean;
      }>(
        "SELECT has_table_privilege('readwind_catalog_publisher','folio_catalog_versions','INSERT') AS can_write,has_table_privilege('readwind_catalog_publisher','folio_books','SELECT') AS can_read_private",
      );
      expect(rows.rows[0]).toEqual({
        can_write: true,
        can_read_private: false,
      });
    } finally {
      await pg.close();
    }
  });
});
