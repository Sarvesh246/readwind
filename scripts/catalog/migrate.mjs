import { readFileSync } from "node:fs";
import { createDatabase, closeDatabase } from '../backend-database.mjs';
import { splitSqlStatements } from "../sql-statements.mjs";
if (
  process.env.READWIND_CATALOG_TARGET_VERIFIED !== "true" ||
  !process.env.MIGRATION_DATABASE_URL
)
  throw new Error(
    "Verify the production target and provide a separate schema-owner connection before migration.",
  );
const source = readFileSync("db/catalog.sql", "utf8");
const statements = splitSqlStatements(source);
const database=createDatabase(process.env.MIGRATION_DATABASE_URL);
await database.transaction(statements.map(statement=>database.query(statement)));
await closeDatabase(database);
console.log(
  "Readwind catalog schema applied. Catalog remains disabled until explicitly enabled.",
);
