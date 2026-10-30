import { owner, sql, unauthorized, storageFetch } from "@/lib/readwind/server";
import { book } from "@/lib/readwind/schemas";
import {
  readJson,
  safeRoute,
  safeId,
  HttpError,
} from "@/lib/readwind/security";
import { rateLimit } from "@/lib/readwind/server";
export const GET = safeRoute(async (request: Request) => {
  const id = await owner(request);
  if (!id) return unauthorized();
  await rateLimit(`read:${id}`, 240);
  const offset = Number(new URL(request.url).searchParams.get("offset") || "0");
  if (!Number.isInteger(offset) || offset < 0 || offset > 10000)
    return Response.json({ error: "Invalid page" }, { status: 400 });
  const db = sql(id);
  const [books, progress, annotations, settings] = await Promise.all([
    db`SELECT data FROM folio_books WHERE owner_id=${id} ORDER BY id LIMIT 2 OFFSET ${offset}`,
    db`SELECT book_id AS "bookId", at, revision, device_id AS "deviceId", words_read AS "wordsRead", EXTRACT(EPOCH FROM updated_at)*1000 AS "updatedAt" FROM folio_progress WHERE owner_id=${id}`,
    db`SELECT data FROM folio_annotations WHERE owner_id=${id} ORDER BY id LIMIT 51 OFFSET ${offset * 50}`,
    db`SELECT data FROM folio_settings WHERE owner_id=${id}`,
  ]);
  return Response.json(
    {
      books: books.slice(0, 1).map((r) => r.data),
      progress,
      annotations: annotations.slice(0, 50).map((r) => r.data),
      settings: settings[0]?.data || null,
      nextOffset:
        books.length > 1 || annotations.length > 50 ? offset + 1 : null,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
});
export const POST = safeRoute(async (request: Request) => {
  const id = await owner(request);
  if (!id) return unauthorized();
  await rateLimit(`library:${id}`, 30);
  const parsed = book.safeParse(await readJson(request, 12_000_000));
  if (!parsed.success)
    return Response.json({ error: "Invalid book data." }, { status: 400 });
  const b = parsed.data;
  await sql(
    id,
  )`INSERT INTO folio_books(owner_id,id,data) VALUES(${id},${b.id},${JSON.stringify(b)}::jsonb) ON CONFLICT(owner_id,id) DO UPDATE SET data=EXCLUDED.data, updated_at=now()`;
  return Response.json({ ok: true });
});

export const DELETE = safeRoute(async (request: Request) => {
  const user = await owner(request);
  if (!user) return unauthorized();
  await rateLimit(`delete:${user}`, 20);
  const id = new URL(request.url).searchParams.get("id");
  if (!id || !safeId.test(id)) throw new HttpError(400, "Invalid book ID.");
  const db = sql(user);
  const rows = await db`SELECT data FROM folio_books WHERE owner_id=${user}`;
  const refs = (data: import("@/lib/readwind/types").Book) =>
    [
      data.sourcePdfBlobId,
      data.cover.blobId,
      ...data.sections.flatMap((s) =>
        s.blocks.map((b) => (b.type === "figure" ? b.blobId : undefined)),
      ),
    ].filter((v): v is string => !!v && safeId.test(v));
  const book = rows.find((row) => row.data.id === id)?.data;
  const used = new Set(
    rows.filter((row) => row.data.id !== id).flatMap((row) => refs(row.data)),
  );
  const candidates = new Set<string>(book ? refs(book) : []);
  // Delete private objects before releasing their quota. Failed deletes are retryable.
  for (const file of candidates) {
    if (used.has(file)) continue;
    const result = await storageFetch(`${user}/${file}`, { method: "DELETE" });
    if (!result.ok && result.status !== 404)
      throw new HttpError(
        502,
        "Could not delete attached files. Please retry.",
      );
    await db`DELETE FROM folio_files WHERE owner_id=${user} AND id=${file}`;
  }
  await db`DELETE FROM folio_books WHERE owner_id=${user} AND id=${id}`;
  return Response.json({ ok: true });
});
