import { catalogVersion, preparedBook } from "@/lib/readwind/catalog-server";
import { owner, sql, unauthorized, rateLimit } from "@/lib/readwind/server";
import { safeRoute, HttpError } from "@/lib/readwind/security";
import { saveLiveBook } from "@/lib/readwind/book-deletion";
export const POST = safeRoute(
  async (
    request: Request,
    { params }: { params: Promise<{ editionId: string }> },
  ) => {
    const user = await owner(request);
    if (!user) return unauthorized();
    await rateLimit(`catalog-add:${user}`, 20);
    const { editionId } = await params,
      row = await catalogVersion(editionId),
      db = sql(user, `library:${user}`);
    // A stable per-edition ID makes concurrent adds converge, including across devices.
    const id = `catalog-${editionId}`;
    const existing =
      await db`SELECT data FROM folio_books WHERE owner_id=${user} AND id=${id}`;
    if (existing.length) return Response.json({ book: existing[0].data });
    const markers =
      await db`SELECT data->'_bookDeletions'->${id} AS deletion FROM folio_settings WHERE owner_id=${user}`;
    const prepared = await preparedBook(row),
      now = Date.now(),
      book = {
        ...prepared,
        id,
        addedAt: now,
        lastOpenedAt: now,
        readingMode: "reflow" as const,
      };
    const restore = new URL(request.url).searchParams.get("restore") === "true";
    let result;
    try {
      result = await saveLiveBook(
        db,
        user,
        book,
        restore,
        true,
        markers[0]?.deletion ?? null,
      );
    } catch (error) {
      if ((error as { code?: string }).code === "23514")
        throw new HttpError(
          413,
          "Your library is full. Remove a book before adding another.",
        );
      throw error;
    }
    if (!Array.isArray(result) || !result.length)
      throw new HttpError(
        409,
        "This book was removed. Retry Add after deletion has finished.",
      );
    // Return the winning data; a simultaneous add must not reset later user changes.
    const saved =
      await db`SELECT data FROM folio_books WHERE owner_id=${user} AND id=${id}`;
    return Response.json(
      { book: saved[0].data },
      { headers: { "Cache-Control": "no-store" } },
    );
  },
);
