import { owner, sql, unauthorized, storageFetch } from "@/lib/readwind/server";
import { book } from "@/lib/readwind/schemas";
import {
  readJson,
  safeRoute,
  safeId,
  HttpError,
} from "@/lib/readwind/security";
import { rateLimit } from "@/lib/readwind/server";
import {
  markBookDeleted,
  finishBookCleanup,
  saveLiveBook,
} from "@/lib/readwind/book-deletion";
import { z } from "zod";
import { validateCatalogReference } from "@/lib/readwind/catalog-server";
import { preparedBook } from "@/lib/readwind/catalog-server";
import { streamJson } from "@/lib/readwind/json-stream";
const catalogMetadata = z
  .object({
    kind: z.literal("catalog-metadata"),
    id: z.string().regex(safeId),
    catalog: z
      .object({
        editionId: z.string().regex(safeId),
        version: z.string().regex(safeId),
      })
      .strict(),
    metadata: z
      .object({
        title: book.shape.title.trim().min(1),
        author: book.shape.author,
        addedAt: book.shape.addedAt,
        lastOpenedAt: book.shape.lastOpenedAt,
        cover: book.shape.cover,
        customCoverBlobId: book.shape.customCoverBlobId.nullable(),
        readingMode: book.shape.readingMode,
      })
      .strict(),
  })
  .strict();
const privateMetadata = catalogMetadata
  .omit({ catalog: true })
  .extend({ kind: z.literal("book-metadata") })
  .strict();
const metadataPatch = z.discriminatedUnion("kind", [
  catalogMetadata,
  privateMetadata,
]);
export const GET = safeRoute(async (request: Request) => {
  const id = await owner(request);
  if (!id) return unauthorized();
  await rateLimit(`read:${id}`, 240);
  const deletion = new URL(request.url).searchParams.get("deletion");
  if (deletion) {
    if (!safeId.test(deletion)) throw new HttpError(400, "Invalid book ID.");
    const rows = await sql(
      id,
    )`SELECT data->'_bookDeletions'->${deletion} AS deletion FROM folio_settings WHERE owner_id=${id}`;
    return Response.json(
      {
        deleted: !!rows[0]?.deletion,
        cleanupPending: !!rows[0]?.deletion?.files?.length,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  }
  const offset = Number(new URL(request.url).searchParams.get("offset") || "0");
  if (!Number.isInteger(offset) || offset < 0 || offset > 10000)
    return Response.json({ error: "Invalid page" }, { status: 400 });
  // Ten books and one hundred notes per response keep a page bounded while
  // letting a normal shelf arrive in one request. The cursors advance together;
  // the annotation offset is ten times the book offset.
  const BOOKS = 10;
  const ANNOTATIONS = 100;
  const db = sql(id);
  const [books, annotations, progress, settings] = await Promise.all([
    db`SELECT data FROM folio_books WHERE owner_id=${id} ORDER BY id LIMIT ${BOOKS + 1} OFFSET ${offset}`,
    db`SELECT data FROM folio_annotations WHERE owner_id=${id} ORDER BY id LIMIT ${ANNOTATIONS + 1} OFFSET ${offset * (ANNOTATIONS / BOOKS)}`,
    offset === 0
      ? db`SELECT book_id AS "bookId", at, revision, device_id AS "deviceId", words_read AS "wordsRead", EXTRACT(EPOCH FROM updated_at)*1000 AS "updatedAt" FROM folio_progress WHERE owner_id=${id}`
      : [],
    offset === 0
      ? db`SELECT data-'_bookDeletions' AS data FROM folio_settings WHERE owner_id=${id}`
      : [],
  ]);
  const nextOffset =
    books.length > BOOKS || annotations.length > ANNOTATIONS
      ? offset + BOOKS
      : null;
  return streamJson(
    {
      books: books.slice(0, BOOKS).map((r) => r.data),
      // Progress and settings only need to travel once per sync.
      ...(offset === 0
        ? {
            progress,
            settings: settings[0]?.data || null,
          }
        : {}),
      annotations: annotations.slice(0, ANNOTATIONS).map((r) => r.data),
      nextOffset,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
});
export const POST = safeRoute(async (request: Request) => {
  const id = await owner(request);
  if (!id) return unauthorized();
  await rateLimit(`library:${id}`, 30);
  let input = await readJson(request, 12_000_000);
  if (
    ["catalog-metadata", "book-metadata"].includes(
      (input as { kind?: string })?.kind || "",
    )
  ) {
    const patch = metadataPatch.safeParse(input);
    if (!patch.success) throw new HttpError(400, "Invalid book metadata.");
    const value = patch.data,
      db = sql(id),
      existing =
        await db`SELECT data FROM folio_books WHERE owner_id=${id} AND id=${value.id}`;
    let base = existing[0]?.data;
    if (
      base &&
      value.kind === "catalog-metadata" &&
      (base.catalog?.version !== value.catalog.version ||
        base.catalog?.editionId !== value.catalog.editionId)
    )
      throw new HttpError(
        409,
        "This book version has changed. Refresh your library and retry.",
      );
    if (!base) {
      if (value.kind === "book-metadata") {
        const deleted =
          await db`SELECT data->'_bookDeletions'->${value.id} AS deletion FROM folio_settings WHERE owner_id=${id}`;
        return Response.json(
          {
            error: deleted[0]?.deletion
              ? "This book has been deleted."
              : "The complete book is required for its first sync.",
          },
          { status: deleted[0]?.deletion ? 410 : 428 },
        );
      }
      const versions =
        await db`SELECT id,manifest_id,manifest_sha256 FROM folio_catalog_versions WHERE id=${value.catalog.version} AND edition_id=${value.catalog.editionId} AND ready AND NOT cleaning`;
      if (!versions.length)
        throw new HttpError(400, "Unknown catalog edition.");
      base = await preparedBook(versions[0]);
    }
    input = {
      ...base,
      ...value.metadata,
      customCoverBlobId: value.metadata.customCoverBlobId ?? undefined,
      id: value.id,
    };
  }
  const parsed = book.safeParse(input);
  if (!parsed.success)
    return Response.json({ error: "Invalid book data." }, { status: 400 });
  const b = parsed.data;
  await validateCatalogReference(b);
  const restore = new URL(request.url).searchParams.get("restore") === "true";
  const rows = await saveLiveBook(sql(id, `library:${id}`), id, b, restore);
  if (!Array.isArray(rows) || !rows.length)
    return Response.json(
      {
        error: restore
          ? "Deletion cleanup is still pending. Restoration will retry."
          : "This book has been deleted.",
      },
      { status: restore ? 409 : 410 },
    );
  return Response.json({ ok: true });
});

export const DELETE = safeRoute(async (request: Request) => {
  const user = await owner(request);
  if (!user) return unauthorized();
  await rateLimit(`delete:${user}`, 20);
  const id = new URL(request.url).searchParams.get("id");
  if (!id || !safeId.test(id)) throw new HttpError(400, "Invalid book ID.");
  const db = sql(user, `library:${user}`);
  const incoming = request.body
    ? z
        .object({
          files: z.array(z.string().regex(safeId)).max(20000).optional(),
        })
        .safeParse(await readJson(request, 2_000_000))
    : { success: true as const, data: { files: [] as string[] } };
  if (!incoming.success) throw new HttpError(400, "Invalid deletion data.");
  // Remove the book and cascading notes immediately; retain a retryable cleanup record.
  const marked = (await markBookDeleted(
    db,
    user,
    id,
    incoming.data.files || [],
  )) as { deletion: { files: string[] } }[];
  const rows = await db`SELECT data FROM folio_books WHERE owner_id=${user}`;
  const refs = (data: import("@/lib/readwind/types").Book) =>
    [
      data.sourcePdfBlobId,
      data.sourceBlobId,
      data.cover.blobId,
      data.pdfCoverBlobId,
      data.customCoverBlobId,
      ...data.sections.flatMap((s) =>
        s.blocks.map((b) => (b.type === "figure" ? b.blobId : undefined)),
      ),
    ].filter((v): v is string => !!v && safeId.test(v));
  const used = new Set(rows.flatMap((row) => refs(row.data)));
  const candidates = [...new Set(marked[0]?.deletion.files || [])].filter(
    (file) => safeId.test(file) && !used.has(file),
  );
  const owned = new Set(
    (await db`SELECT id FROM folio_files WHERE owner_id=${user}`).map(
      (row) => row.id as string,
    ),
  );
  // Delete private objects before releasing their quota. Failed deletes are retryable.
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(4, candidates.length) }, async () => {
      while (next < candidates.length) {
        const file = candidates[next++];
        if (!owned.has(file)) continue;
        const result = await storageFetch(`${user}/${file}`, {
          method: "DELETE",
        });
        if (!result.ok && result.status !== 404)
          throw new HttpError(
            502,
            "Book deleted. Attached-file cleanup will retry.",
          );
        await db`DELETE FROM folio_files WHERE owner_id=${user} AND id=${file}`;
      }
    }),
  );
  await finishBookCleanup(db, user, id);
  return Response.json({ ok: true });
});
