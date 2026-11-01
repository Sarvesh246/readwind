import { readFileSync } from "node:fs";
import { neon } from "@neondatabase/serverless";
if (
  process.env.READWIND_CATALOG_TARGET_VERIFIED !== "true" ||
  !process.env.MIGRATION_DATABASE_URL
)
  throw new Error(
    "Verify the production target and provide a separate schema-owner connection before migration.",
  );
const source = readFileSync("db/catalog.sql", "utf8");
const statements = source
  .match(/(?:[^;$]|\$(?!\$)|\$\$[\s\S]*?\$\$)+/g)
  .filter((s) => s.trim());
await neon(process.env.MIGRATION_DATABASE_URL).transaction(
  statements.map((statement) =>
    neon(process.env.MIGRATION_DATABASE_URL).query(statement),
  ),
);
console.log(
  "Readwind catalog schema applied. Catalog remains disabled until explicitly enabled.",
);
