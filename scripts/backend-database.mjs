import { neon } from "@neondatabase/serverless";
import postgres from "postgres";
import { supabasePostgresOptions } from "../lib/readwind/postgres-options.mjs";

const clients = new Map();
/** The catalog and maintenance scripts retain their parameterized, lazy query interface. */
export function createDatabase(url) {
  if (process.env.READWIND_BACKEND !== "supabase") return neon(url);
  if (!url) throw new Error("Database connection is required");
  if (clients.has(url)) return clients.get(url);
  const connection = postgres(url, { ...supabasePostgresOptions, max: 2 });
  const descriptors = new WeakMap();
  const query = (text, values = []) => {
    let pending;
    const operation = {
      then(resolve, reject) {
        pending ||= connection.unsafe(text, values);
        return pending.then(resolve, reject);
      },
    };
    descriptors.set(operation, { text, values });
    return operation;
  };
  const tag = (strings, ...values) =>
    query(
      strings.reduce(
        (text, part, index) => text + (index ? `$${index}` : "") + part,
        "",
      ),
      values,
    );
  tag.query = query;
  tag.transaction = (operations) =>
    connection.begin(async (transaction) => {
      const results = [];
      for (const operation of operations) {
        const descriptor = descriptors.get(operation);
        if (!descriptor)
          throw new Error(
            "Transaction queries must use the same database client",
          );
        results.push(
          await transaction.unsafe(descriptor.text, descriptor.values),
        );
      }
      return results;
    });
  tag.end = async () => {
    clients.delete(url);
    await connection.end();
  };
  clients.set(url, tag);
  return tag;
}
export async function closeDatabase(database) {
  if (database.end) await database.end();
}
