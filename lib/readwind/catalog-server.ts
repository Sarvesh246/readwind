import { sql, storageFetch } from "./server";
import { HttpError, safeId } from "./security";
import { book as bookSchema } from "./schemas";
import { sha256, type CatalogEntry } from "./catalog";
import type { Book } from "./types";
export function catalogEnabled() {
  return process.env.READWIND_CATALOG_ENABLED === "true";
}
export function requireCatalog() {
  if (!catalogEnabled())
    throw new HttpError(
      503,
      "Book discovery is not available yet. You can still upload a file.",
    );
}
// The published catalog changes only when the catalog worker publishes, yet every
// search page and index request used to re-read and re-sort all of it. Keep one
// copy per isolate for a short window (matching the routes' own 30-60s HTTP
// caching) and share a single in-flight read between concurrent requests.
const CATALOG_TTL_MS = 30_000;
let catalogCache:
  | { at: number; entries: Promise<CatalogEntry[]> }
  | undefined;
/** Drop the cached list so the next read hits the database (publish/unpublish hooks and tests). */
export function clearCatalogCache() {
  catalogCache = undefined;
}
export async function catalogEntries() {
  requireCatalog();
  const now = Date.now();
  if (catalogCache && now - catalogCache.at < CATALOG_TTL_MS)
    return catalogCache.entries;
  const entries = (async () => {
    const rows =
      await sql()`SELECT entry FROM folio_catalog_versions WHERE published AND ready AND NOT cleaning ORDER BY entry->>'title',edition_id`;
    return rows.map((r) => r.entry as CatalogEntry);
  })();
  const slot = { at: now, entries };
  catalogCache = slot;
  // Never cache a failure: the next request should try the database again.
  entries.catch(() => {
    if (catalogCache === slot) catalogCache = undefined;
  });
  return entries;
}
export async function catalogVersion(editionId: string) {
  requireCatalog();
  if (!safeId.test(editionId)) throw new HttpError(400, "Invalid edition.");
  const rows =
    await sql()`SELECT id,entry,manifest_id,manifest_sha256 FROM folio_catalog_versions WHERE edition_id=${editionId} AND published AND ready AND NOT cleaning`;
  if (!rows.length)
    throw new HttpError(404, "This book is no longer available to add.");
  return rows[0];
}
export async function preparedBook(
  row: Record<string, unknown>,
): Promise<Book> {
  const response = await storageFetch(`catalog/${row.manifest_id}`);
  if (!response.ok)
    throw new HttpError(503, "This book could not be loaded. Please retry.");
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.length > 12000000 || (await sha256(bytes)) !== row.manifest_sha256)
    throw new HttpError(503, "Book verification failed.");
  const parsed = bookSchema.safeParse(
    JSON.parse(new TextDecoder().decode(bytes)),
  );
  if (!parsed.success || parsed.data.catalog?.version !== row.id)
    throw new HttpError(503, "Invalid prepared book.");
  return parsed.data as Book;
}
export async function validateCatalogReference(book: Book) {
  if (!book.catalog) return;
  // Independent lookups: fetch both together, then judge them in the same order.
  const [rows, assets] = await Promise.all([
    sql()`SELECT id FROM folio_catalog_versions WHERE id=${book.catalog.version} AND edition_id=${book.catalog.editionId} AND ready AND NOT cleaning`,
    sql()`SELECT id,sha256,bytes,type FROM folio_catalog_assets WHERE version_id=${book.catalog.version}`,
  ]);
  if (!rows.length) throw new HttpError(400, "Unknown catalog edition.");
  const known = new Map(assets.map((r) => [r.id as string, r]));
  if (
    book.catalog.assets.some((a) => {
      const r = known.get(a.id);
      return (
        !r ||
        r.sha256 !== a.sha256 ||
        Number(r.bytes) !== a.bytes ||
        r.type !== a.type
      );
    })
  )
    throw new HttpError(400, "Invalid catalog assets.");
}
