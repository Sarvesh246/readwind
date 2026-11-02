import postgres from "postgres";
import { supabasePostgresOptions } from "./postgres-options.mjs";

let client: ReturnType<typeof postgres> | undefined;
let configuredUrl: string | undefined;
export function postgresClient() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("Database is not configured");
  if (!client || configuredUrl !== url) {
    client = postgres(url, { ...supabasePostgresOptions, max: 3 });
    configuredUrl = url;
  }
  return client;
}

export function postgresSql(user?: string, serialize?: string) {
  return async (strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.reduce(
      (query, part, index) => query + (index ? `$${index}` : "") + part,
      "",
    );
    const db = postgresClient();
    // All caller values remain bound parameters. Tenant context is transaction-local.
    const parameters = values as Parameters<typeof db.unsafe>[1];
    if (!user) return db.unsafe(text, parameters);
    return db.begin(async (transaction) => {
      await transaction`SELECT set_config('readwind.owner', ${user}, true)`;
      if (serialize)
        await transaction`SELECT pg_advisory_xact_lock(hashtextextended(${serialize},0))`;
      return transaction.unsafe(text, parameters);
    });
  };
}
