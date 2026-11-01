import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { csvRows } from "./providers.mjs";
import { bulkGutenbergCandidates } from "./gutenberg-bulk.mjs";
import { openQueue, enqueue } from "./worker.mjs";
const [csv, rights, covers, count = "1000", ...priority] =
  process.argv.slice(2);
if (!csv || !rights || !covers)
  throw new Error(
    "Usage: node scripts/catalog/seed-gutenberg.mjs catalog.csv.gz rights.json covers.json [count] [priority IDs...]",
  );
const queue = openQueue();
try {
  const records = bulkGutenbergCandidates(
    csvRows(
      gunzipSync(readFileSync(csv), {
        maxOutputLength: 80 * 1024 * 1024,
      }).toString(),
    ),
    JSON.parse(readFileSync(rights, "utf8")),
    JSON.parse(readFileSync(covers, "utf8")),
    {
      limit: Number(count),
      priority,
      excluded: queue.db
        .prepare("SELECT id FROM jobs")
        .all()
        .map((j) => j.id),
    },
  );
  for (const record of records) enqueue(queue, record);
  console.log(
    `${records.length} diverse candidates queued; publication still requires all source, cover, conversion and storage checks.`,
  );
} finally {
  queue.db.close();
}
