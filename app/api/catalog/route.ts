import { catalogEntries } from "@/lib/readwind/catalog-server";
import { searchCatalog } from "@/lib/readwind/catalog";
import { safeRoute, HttpError } from "@/lib/readwind/security";
export const GET = safeRoute(async (request: Request) => {
  const params = new URL(request.url).searchParams,
    offset = Number(params.get("offset") || 0),
    q = (params.get("q") || "").slice(0, 300);
  if (!Number.isInteger(offset) || offset < 0 || offset > 100000)
    throw new HttpError(400, "Invalid page.");
  const matches = searchCatalog(await catalogEntries(), q);
  return Response.json(
    {
      items: matches.slice(offset, offset + 24),
      total: matches.length,
      nextOffset: offset + 24 < matches.length ? offset + 24 : null,
    },
    { headers: { "Cache-Control": "public, max-age=30" } },
  );
});
