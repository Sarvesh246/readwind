import { cleanWord, lookup } from "@/lib/readwind/dictionary";
import { HttpError, safeRoute } from "@/lib/readwind/security";

// Best-effort per-instance throttle; the long CDN cache below absorbs repeat lookups.
const hits = new Map<string, { n: number; at: number }>();
function throttle(request: Request) {
  const who = request.headers.get("x-forwarded-for")?.split(",")[0].trim() || request.headers.get("cf-connecting-ip") || "local";
  const now = Date.now();
  const entry = hits.get(who);
  if (!entry || now - entry.at > 60_000) hits.set(who, { n: 1, at: now });
  else if (++entry.n > 90) throw new HttpError(429, "Too many lookups. Please wait a moment.");
  if (hits.size > 5000) for (const [key, value] of hits) if (now - value.at > 60_000) hits.delete(key);
}

async function fetchJson(url: string): Promise<unknown | null> {
  try {
    const response = await fetch(url, {
      headers: { "User-Agent": "Readwind/1.0 (reading app; dictionary lookup)", Accept: "application/json" },
      signal: AbortSignal.timeout(6000),
      next: { revalidate: 60 * 60 * 24 * 7 },
    });
    return response.ok ? await response.json() : null;
  } catch {
    return null;
  }
}

export const GET = safeRoute(async (request: Request) => {
  if (request.headers.get("sec-fetch-site") === "cross-site") throw new HttpError(403, "Not allowed.");
  throttle(request);
  const word = cleanWord(new URL(request.url).searchParams.get("word") || "");
  if (!word) throw new HttpError(400, "Choose a word to define.");
  const entry = await lookup(word, fetchJson);
  if (!entry)
    return Response.json({ found: false, word }, { headers: { "Cache-Control": "public, max-age=3600, s-maxage=86400" } });
  return Response.json(
    { found: true, entry },
    { headers: { "Cache-Control": "public, max-age=86400, s-maxage=604800, stale-while-revalidate=86400" } },
  );
});
