import { MAX_API_JSON_BYTES } from '@/lib/readwind/sync-safety';
import { z } from "zod";
import { owner, sql, rateLimit, unauthorized } from "@/lib/readwind/server";
import {
  readJson,
  safeRoute,
  safeId,
  HttpError,
} from "@/lib/readwind/security";
import { book, annotation, progress, settings } from "@/lib/readwind/schemas";
import { persistSettings } from "@/lib/readwind/settings-sync";
import { mergeReadingLog } from "@/lib/readwind/reading-log";
import { mergeReadingPace } from "@/lib/readwind/reading-pace";
import type { Settings } from "@/lib/readwind/types";

export const GET = safeRoute(async (request: Request) => {
  const epoch =
    process.env.READWIND_BACKEND === "supabase"
      ? process.env.READWIND_RECOVERY_EPOCH
      : undefined;
  if (!epoch) return Response.json({ required: false });
  const user = await owner(request);
  if (!user) return unauthorized();
  const device = new URL(request.url).searchParams.get("device") || "";
  if (!safeId.test(device))
    throw new HttpError(400, "Invalid recovery device.");
  await rateLimit(`recover:${user}`, 300);
  const db = sql(user);
  const state =
    await db`SELECT 1 FROM folio_recovery_snapshots WHERE owner_id=${user} AND device_id=${device} AND epoch=${epoch} AND entity='complete'`;
  const files = state.length
    ? []
    : await db`SELECT id,bytes FROM folio_files WHERE owner_id=${user}`;
  return Response.json(
    { required: !state.length, epoch, files },
    { headers: { "Cache-Control": "private, no-store" } },
  );
});
const envelope = z.object({
  epoch: z.string().min(1).max(120),
  deviceId: z.string().regex(safeId),
  kind: z.enum(["book", "settings", "complete"]),
  value: z.unknown(),
  progress: z.unknown().optional(),
  annotations: z.array(z.unknown()).max(10000).optional(),
  pending: z.array(z.unknown()).max(2000).optional(),
});
export const POST = safeRoute(async (request: Request) => {
  if (
    process.env.READWIND_BACKEND !== "supabase" ||
    !process.env.READWIND_RECOVERY_EPOCH
  )
    throw new HttpError(404, "Recovery is not active.");
  const user = await owner(request);
  if (!user) return unauthorized();
  await rateLimit(`recover:${user}`, 300);
  const parsed = envelope.safeParse(await readJson(request, MAX_API_JSON_BYTES));
  if (!parsed.success) throw new HttpError(400, "Invalid recovery archive.");
  const input = parsed.data,
    epoch = process.env.READWIND_RECOVERY_EPOCH;
  if (input.epoch !== epoch)
    throw new HttpError(
      409,
      "The recovery version changed. Refresh and retry.",
    );
  const db = sql(user, `recovery:${user}`);
  const id =
    input.kind === "book"
      ? book.parse(input.value).id
      : input.kind === "settings"
        ? "reader"
        : "complete";
  const existing =
    await db`SELECT 1 FROM folio_recovery_snapshots WHERE owner_id=${user} AND device_id=${input.deviceId} AND epoch=${epoch} AND entity=${input.kind} AND entity_id=${id}`;
  if (!existing.length) {
    const serialized = JSON.stringify(input);
    const inserted =
      await db`INSERT INTO folio_recovery_snapshots(owner_id,device_id,epoch,entity,entity_id,data) SELECT ${user},${input.deviceId},${epoch},${input.kind},${id},${serialized}::jsonb WHERE (SELECT count(*) FROM folio_recovery_snapshots WHERE owner_id=${user})<1000 AND (SELECT COALESCE(sum(octet_length(data::text)),0) FROM folio_recovery_snapshots WHERE owner_id=${user})+octet_length(${serialized}::text)<=52428800 ON CONFLICT DO NOTHING RETURNING 1`;
    if (!inserted.length) {
      const saved =
        await db`SELECT 1 FROM folio_recovery_snapshots WHERE owner_id=${user} AND device_id=${input.deviceId} AND epoch=${epoch} AND entity=${input.kind} AND entity_id=${id}`;
      if (!saved.length)
        throw new HttpError(
          413,
          "The device recovery archive is full. Your local copy is preserved.",
        );
    }
  }
  if (input.kind === "book") {
    const b = book.parse(input.value),
      raw = input.value as Record<string, unknown>;
    let recoveredBook = input.value;
    if (b.catalog) {
      const catalog =
        await db`SELECT 1 FROM folio_catalog_versions WHERE id=${b.catalog.version} AND ready AND published AND NOT cleaning`;
      if (!catalog.length) {
        // The device's uploaded copies keep an unavailable catalog edition readable.
        // Its original catalog reference remains in the immutable recovery snapshot.
        const privateEdition = { ...raw };
        delete privateEdition.catalog;
        recoveredBook = privateEdition;
      }
    }
    const remote =
      await db`SELECT data FROM folio_books WHERE owner_id=${user} AND id=${b.id}`;
    // Keep established content on an equal/older snapshot; the full original stays archived.
    const revision =
      typeof raw.revision === "number" && Number.isSafeInteger(raw.revision)
        ? raw.revision
        : 0;
    if (
      !remote.length ||
      revision > Number(remote[0].data.revision || 0) ||
      (revision === Number(remote[0].data.revision || 0) &&
        b.lastOpenedAt > remote[0].data.lastOpenedAt)
    ) {
      await db`INSERT INTO folio_books(owner_id,id,data) SELECT ${user},${b.id},${JSON.stringify(recoveredBook)}::jsonb WHERE NOT EXISTS(SELECT 1 FROM folio_settings WHERE owner_id=${user} AND data->'_bookDeletions' ? ${b.id}) ON CONFLICT(owner_id,id) DO UPDATE SET data=EXCLUDED.data,updated_at=now()`;
    }
    if (input.progress) {
      const p = progress.parse(input.progress);
      if (p.bookId !== b.id)
        throw new HttpError(
          400,
          "The reading position belongs to another book.",
        );
      const rawProgress = input.progress as { updatedAt?: number };
      const updated =
        typeof rawProgress.updatedAt === "number" &&
        Number.isFinite(rawProgress.updatedAt)
          ? new Date(rawProgress.updatedAt)
          : new Date(0);
      await db`INSERT INTO folio_progress(owner_id,book_id,at,revision,device_id,words_read,updated_at) SELECT ${user},${p.bookId},${JSON.stringify(p.at)}::jsonb,${Math.max(1, p.revision)},${p.deviceId},${p.wordsRead},${updated.toISOString()}::timestamptz WHERE EXISTS(SELECT 1 FROM folio_books WHERE owner_id=${user} AND id=${p.bookId}) ON CONFLICT(owner_id,book_id) DO UPDATE SET at=EXCLUDED.at,revision=GREATEST(folio_progress.revision,EXCLUDED.revision),device_id=EXCLUDED.device_id,words_read=EXCLUDED.words_read,updated_at=EXCLUDED.updated_at WHERE EXCLUDED.revision>folio_progress.revision OR (EXCLUDED.revision=folio_progress.revision AND EXCLUDED.updated_at>folio_progress.updated_at)`;
    }
    for (const value of input.annotations || []) {
      const a = annotation.parse(value);
      if (a.bookId !== b.id)
        throw new HttpError(400, "The annotation belongs to another book.");
      await db`INSERT INTO folio_annotations(owner_id,id,book_id,data,updated_at) SELECT ${user},${a.id},${a.bookId},${JSON.stringify(value)}::jsonb,${new Date(a.updatedAt).toISOString()}::timestamptz WHERE EXISTS(SELECT 1 FROM folio_books WHERE owner_id=${user} AND id=${a.bookId}) ON CONFLICT(owner_id,id) DO UPDATE SET data=EXCLUDED.data,updated_at=EXCLUDED.updated_at WHERE EXCLUDED.updated_at>folio_annotations.updated_at`;
    }
  } else if (input.kind === "settings") {
    const local = settings.parse(input.value),
      rows = await db`SELECT data FROM folio_settings WHERE owner_id=${user}`;
    const remote = rows[0]?.data as Settings | undefined;
    const merged = {
      ...local,
      ...remote,
      readingLog: mergeReadingLog(remote?.readingLog, local.readingLog),
      readingPace: mergeReadingPace(remote?.readingPace, local.readingPace),
    };
    await persistSettings(db, user, merged);
  }
  return Response.json(
    { archived: true, complete: input.kind === "complete" },
    { headers: { "Cache-Control": "private, no-store" } },
  );
});
