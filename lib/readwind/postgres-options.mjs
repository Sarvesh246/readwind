import { supabaseDatabaseCA } from "./supabase-ca.mjs";

export const supabasePostgresOptions = {
  prepare: false,
  idle_timeout: 20,
  connect_timeout: 10,
  ssl: { rejectUnauthorized: true, ca: supabaseDatabaseCA },
  types: {
    // Existing Readwind queries bind serialized JSON text before an explicit cast.
    // Preserve that text instead of JSON-encoding it a second time after Describe.
    json: {
      to: 114,
      from: [114, 3802],
      serialize: (value) =>
        typeof value === "string" ? value : JSON.stringify(value),
      parse: JSON.parse,
    },
  },
};
