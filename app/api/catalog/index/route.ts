import { catalogEntries } from "@/lib/readwind/catalog-server";
import { safeRoute } from "@/lib/readwind/security";
import { sha256 } from "@/lib/readwind/catalog";
export const GET = safeRoute(async (request: Request) => {
  const body = JSON.stringify({ items: await catalogEntries() }),
    etag = `"${await sha256(new TextEncoder().encode(body))}"`;
  return request.headers.get("if-none-match") === etag
    ? new Response(null, { status: 304, headers: { ETag: etag } })
    : new Response(body, {
        headers: {
          "Content-Type": "application/json",
          ETag: etag,
          "Cache-Control": "public, max-age=60",
        },
      });
});
