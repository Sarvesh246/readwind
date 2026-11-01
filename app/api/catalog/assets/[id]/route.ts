import { sql, storageFetch, owner } from "@/lib/readwind/server";
import { safeRoute, HttpError, safeId } from "@/lib/readwind/security";
export const GET = safeRoute(
  async (request: Request, { params }: { params: Promise<{ id: string }> }) => {
    const { id } = await params;
    if (!safeId.test(id)) throw new HttpError(400, "Invalid asset.");
    const rows =
      await sql()`SELECT a.*,v.published FROM folio_catalog_assets a JOIN folio_catalog_versions v ON v.id=a.version_id WHERE a.id=${id} AND v.ready AND NOT v.cleaning`;
    if (!rows.length) throw new HttpError(404, "File unavailable.");
    const asset = rows[0];
    if (!asset.published) {
      const user = await owner(request);
      if (!user) throw new HttpError(404, "File unavailable.");
      const owned = await sql(
        user,
      )`SELECT id FROM folio_books WHERE owner_id=${user} AND data->'catalog'->>'version'=${asset.version_id} LIMIT 1`;
      if (!owned.length) throw new HttpError(404, "File unavailable.");
    }
    const response = await storageFetch(`catalog/${id}`);
    if (!response.ok)
      throw new HttpError(503, "Book file is temporarily unavailable.");
    return new Response(response.body, {
      headers: {
        "Content-Type": asset.type,
        "Content-Length": String(asset.bytes),
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "sandbox; default-src 'none'",
        "Cache-Control": "private, max-age=31536000, immutable",
      },
    });
  },
);
