import { owner, sql, unauthorized } from "@/lib/readwind/server";
import { z } from "zod";
const anchor = z.object({
  section: z.number().int().min(0),
  block: z.number().int().min(0),
  offset: z.number().int().min(0),
});
const progress = z.object({
  bookId: z.string().max(120),
  at: anchor,
  deviceId: z.string().max(120),
  wordsRead: z.number().int().min(0),
  revision: z.number().int().min(0),
});
const annotation = z.object({
  id: z.string().max(120),
  bookId: z.string().max(120),
  kind: z.enum(["highlight", "bookmark"]),
  range: z.object({ start: anchor, end: anchor }),
  color: z.enum(["yellow", "green", "blue", "pink"]),
  quote: z.string().max(50000),
  note: z.string().max(20000),
  createdAt: z.number(),
  updatedAt: z.number(),
  deleted: z.boolean().optional(),
  pdfRange: z.object({pageIndex:z.number().int().min(0),rects:z.array(z.object({x:z.number().min(0).max(1),y:z.number().min(0).max(1),width:z.number().min(0).max(1),height:z.number().min(0).max(1)})).max(2000)}).optional(),
  review: z
    .object({ due: z.number(), interval: z.number().int().min(0).max(35) })
    .optional(),
});
export async function POST(request: Request) {
  const user = await owner(request);
  if (!user) return unauthorized();
  const body = (await request.json()) as { entity: string; value: unknown };
  const db = sql();
  if (body.entity === "progress") {
    const parsed = progress.safeParse(body.value);
    if (!parsed.success)
      return Response.json({ error: "Invalid progress" }, { status: 400 });
    const p = parsed.data;
    const rows =
      await db`INSERT INTO folio_progress(owner_id,book_id,at,device_id,words_read,revision)
      SELECT ${user},${p.bookId},${JSON.stringify(p.at)}::jsonb,${p.deviceId},${p.wordsRead},1
      WHERE EXISTS(SELECT 1 FROM folio_books WHERE owner_id=${user} AND id=${p.bookId})
      ON CONFLICT(owner_id,book_id) DO UPDATE SET at=EXCLUDED.at, device_id=EXCLUDED.device_id, words_read=GREATEST(folio_progress.words_read,EXCLUDED.words_read),revision=folio_progress.revision+1,updated_at=now()
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
    const a = parsed.data;
    const exists =
      await db`SELECT id FROM folio_books WHERE owner_id=${user} AND id=${a.bookId}`;
    if (!exists.length)
      return Response.json({ error: "Book not found" }, { status: 404 });
    await db`INSERT INTO folio_annotations(owner_id,id,book_id,data) VALUES(${user},${a.id},${a.bookId},${JSON.stringify(a)}::jsonb) ON CONFLICT(owner_id,id) DO UPDATE SET data=EXCLUDED.data,updated_at=now() WHERE (folio_annotations.data->>'updatedAt')::numeric <= (EXCLUDED.data->>'updatedAt')::numeric`;
    return Response.json({ ok: true });
  }
  if (body.entity === "settings") {
    const schema = z.object({
      paper: z.enum(["Paper", "Sepia", "Dusk", "Night"]),
      font: z.enum(["Literata", "Source Serif", "Atkinson"]),
      size: z.number().min(14).max(28),
      spacing: z.enum(["Snug", "Normal", "Airy"]),
      turn: z.enum(["Curl", "Slide", "Scroll"]),
      wideLayout: z.enum(["spread", "single"]),
      warmLight: z.boolean(),
      restNudge: z.boolean(),
      focusParagraph: z.boolean(),
      colorNames: z.object({
        yellow: z.string().max(80),
        green: z.string().max(80),
        blue: z.string().max(80),
        pink: z.string().max(80),
      }),
    });
    const parsed = schema.safeParse(body.value);
    if (!parsed.success)
      return Response.json({ error: "Invalid settings" }, { status: 400 });
    await db`INSERT INTO folio_settings(owner_id,data) VALUES(${user},${JSON.stringify(parsed.data)}::jsonb) ON CONFLICT(owner_id) DO UPDATE SET data=EXCLUDED.data,updated_at=now()`;
    return Response.json({ ok: true });
  }
  return Response.json({ error: "Unknown change" }, { status: 400 });
}
