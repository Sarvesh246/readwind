import { owner, sql, unauthorized } from "@/lib/readwind/server";
import { z } from "zod";
import type { Anchor, Book } from "@/lib/readwind/types";
import { progress, annotation, settings } from "@/lib/readwind/schemas";
import { readJson, safeRoute } from "@/lib/readwind/security";
import { rateLimit } from "@/lib/readwind/server";
import { persistSettings } from "@/lib/readwind/settings-sync";
function validAnchor(book: Book, at: Anchor) {
  const block = book.sections[at.section]?.blocks[at.block];
  return !!block && at.offset <= (block.text?.length || 0);
}
async function getBook(db: ReturnType<typeof sql>, user: string, id: string) {
  const rows =
    await db`SELECT data FROM folio_books WHERE owner_id=${user} AND id=${id}`;
  return rows[0]?.data as Book | undefined;
}
export const POST = safeRoute(async (request: Request) => {
  const user = await owner(request);
  if (!user) return unauthorized();
  await rateLimit(`sync:${user}`, 120);
  const envelope = z
    .object({ entity: z.string().max(30), value: z.unknown() })
    .safeParse(await readJson(request, 256000));
  if (!envelope.success)
    return Response.json({ error: "Invalid change" }, { status: 400 });
  const body = envelope.data;
  const db = sql(user);
  if (body.entity === "progress") {
    const parsed = progress.safeParse(body.value);
    if (!parsed.success)
      return Response.json({ error: "Invalid progress" }, { status: 400 });
    const p = parsed.data;
    const book = await getBook(db, user, p.bookId);
    if (!book)
      return Response.json({ error: "Book not found" }, { status: 404 });
    const wordCount = book.sections.reduce(
      (n, s) =>
        n +
        s.blocks.reduce((n, b) => n + (b.text?.match(/\S+/g)?.length || 0), 0),
      0,
    );
    if (!validAnchor(book, p.at) || p.wordsRead > wordCount)
      return Response.json(
        { error: "Invalid reading position or word count" },
        { status: 400 },
      );
    const rows =
      await db`INSERT INTO folio_progress(owner_id,book_id,at,device_id,words_read,revision)
      SELECT ${user},${p.bookId},${JSON.stringify(p.at)}::jsonb,${p.deviceId},${p.wordsRead},1
      WHERE EXISTS(SELECT 1 FROM folio_books WHERE owner_id=${user} AND id=${p.bookId})
      ON CONFLICT(owner_id,book_id) DO UPDATE SET at=EXCLUDED.at, device_id=EXCLUDED.device_id, words_read=LEAST(${wordCount},GREATEST(folio_progress.words_read,EXCLUDED.words_read)),revision=folio_progress.revision+1,updated_at=now()
      WHERE folio_progress.revision=${p.revision}
      RETURNING revision`;
    if (!rows.length) {
      const current =
        await db`SELECT at, revision,device_id AS "deviceId" FROM folio_progress WHERE owner_id=${user} AND book_id=${p.bookId}`;
      return Response.json(
        { conflict: true, current: current[0] || null },
        { status: 409 },
      );
    }
    return Response.json({ revision: rows[0].revision });
  }
  if (body.entity === "annotation") {
    const parsed = annotation.safeParse(body.value);
    if (!parsed.success)
      return Response.json({ error: "Invalid annotation" }, { status: 400 });
    const a = {
      ...parsed.data,
      updatedAt: Date.now(),
      createdAt: Math.min(parsed.data.createdAt, Date.now()),
    };
    const book = await getBook(db, user, a.bookId);
    if (!book)
      return Response.json({ error: "Book not found" }, { status: 404 });
    if (
      !validAnchor(book, a.range.start) ||
      !validAnchor(book, a.range.end) ||
      (a.pdfRange && a.pdfRange.pageIndex >= book.printPageCount)
    )
      return Response.json(
        { error: "Invalid annotation position" },
        { status: 400 },
      );
    await db`INSERT INTO folio_annotations(owner_id,id,book_id,data) VALUES(${user},${a.id},${a.bookId},${JSON.stringify(a)}::jsonb) ON CONFLICT(owner_id,id) DO UPDATE SET data=EXCLUDED.data,updated_at=now()`;
    return Response.json({ ok: true });
  }
  if (body.entity === "settings") {
    const parsed = settings.safeParse(body.value);
    if (!parsed.success)
      return Response.json({ error: "Invalid settings" }, { status: 400 });
    await persistSettings(db, user, parsed.data);
    return Response.json({ ok: true });
  }
  return Response.json({ error: "Unknown change" }, { status: 400 });
});
