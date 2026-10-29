import { owner, sql, unauthorized } from "@/lib/readwind/server";
import { z } from "zod";
const anchor = z.object({
  section: z.number().int().min(0),
  block: z.number().int().min(0),
  offset: z.number().int().min(0),
});
const book = z.object({
  id: z.string().max(120),
  title: z.string().min(1).max(500),
  author: z.string().max(500),
  sections: z
    .array(
      z.object({
        id: z.string(),
        title: z.string(),
        heading: z.boolean(),
        blocks: z
          .array(
            z.object({
              type: z.enum(["p", "h", "quote", "figure"]),
              text: z.string().optional(),
              blobId: z.string().optional(),
              caption: z.string().optional(),
              footnoteRefs: z
                .array(
                  z.object({ at: z.number().int().min(0), noteId: z.string() }),
                )
                .optional(),
            }),
          )
          .min(1),
      }),
    )
    .min(1),
  pageMarks: z.array(
    z.object({ label: z.string(), index: z.number(), at: anchor }),
  ),
  cover: z.object({
    kind: z.enum(["typeset", "pdfPage"]),
    color: z.string().regex(/^#[0-9a-f]{6}$/i),
    fg: z.string(),
    blobId: z.string().optional(),
  }),
  addedAt: z.number(),
  lastOpenedAt: z.number(),
  printPageCount: z.number().int().positive(),
  sourcePdfBlobId: z.string().optional(),
  sample: z.boolean().optional(),
  readingMode: z.enum(['original','reflow']).optional(),
  importReport: z.object({version:z.literal(1),recommendedMode:z.enum(['original','reflow']),warnings:z.array(z.string().max(2000)),pages:z.array(z.object({index:z.number().int().min(0),width:z.number().positive(),height:z.number().positive(),characters:z.number().int().min(0),issues:z.array(z.enum(['columns','rotated-text','rtl','vertical-text','scanned','text-mapping','sparse','illustrated','low-ocr','extraction-error']))}))}).optional(),
  footnotes: z
    .array(
      z.object({
        id: z.string(),
        marker: z.string(),
        text: z.string(),
        pageIndex: z.number(),
      }),
    )
    .optional(),
});
export async function GET(request: Request) {
  const id = await owner(request);
  if (!id) return unauthorized();
  const db = sql();
  const [books, progress, annotations, settings] = await Promise.all([
    db`SELECT data FROM folio_books WHERE owner_id=${id}`,
    db`SELECT book_id AS "bookId", at, revision, device_id AS "deviceId", words_read AS "wordsRead", EXTRACT(EPOCH FROM updated_at)*1000 AS "updatedAt" FROM folio_progress WHERE owner_id=${id}`,
    db`SELECT data FROM folio_annotations WHERE owner_id=${id}`,
    db`SELECT data FROM folio_settings WHERE owner_id=${id}`,
  ]);
  return Response.json(
    {
      books: books.map((r) => r.data),
      progress,
      annotations: annotations.map((r) => r.data),
      settings: settings[0]?.data || null,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
export async function POST(request: Request) {
  const id = await owner(request);
  if (!id) return unauthorized();
  if (Number(request.headers.get("content-length")) > 12_000_000)
    return Response.json(
      { error: "Book content is too large." },
      { status: 413 },
    );
  const parsed = book.safeParse(await request.json());
  if (!parsed.success)
    return Response.json({ error: "Invalid book data." }, { status: 400 });
  const b = parsed.data;
  await sql()`INSERT INTO folio_books(owner_id,id,data) VALUES(${id},${b.id},${JSON.stringify(b)}::jsonb) ON CONFLICT(owner_id,id) DO UPDATE SET data=EXCLUDED.data, updated_at=now()`;
  return Response.json({ ok: true });
}
