import { owner, sql, unauthorized, rateLimit } from "@/lib/readwind/server";
import { readJson, safeRoute, safeId, HttpError } from "@/lib/readwind/security";
import {
  EXPIRES_AFTER_MINUTES,
  MAX_ACTIVE_IMPORTS,
  importJobInput,
} from "@/lib/readwind/import-jobs";

// Postgres "undefined_table": the migration has not been applied yet. Status
// mirroring is a convenience, so an older database must not break the shelf.
const missingTable = (error: unknown) =>
  (error as { code?: string })?.code === "42P01";
const headers = { "Cache-Control": "no-store" };

export const GET = safeRoute(async (request: Request) => {
  const user = await owner(request);
  if (!user) return unauthorized();
  await rateLimit(`import-read:${user}`, 240);
  try {
    const imports = await sql(user)`SELECT id,title,percent,message,status,device_id AS "deviceId",
      EXTRACT(EPOCH FROM now()-updated_at)::int AS age
      FROM folio_imports WHERE owner_id=${user}
        AND updated_at > now()-(${EXPIRES_AFTER_MINUTES} * interval '1 minute')
      ORDER BY updated_at DESC LIMIT ${MAX_ACTIVE_IMPORTS}`;
    return Response.json({ imports }, { headers });
  } catch (error) {
    if (missingTable(error)) return Response.json({ imports: [] }, { headers });
    throw error;
  }
});

export const PUT = safeRoute(async (request: Request) => {
  const user = await owner(request);
  if (!user) return unauthorized();
  await rateLimit(`import-write:${user}`, 90);
  const parsed = importJobInput.safeParse(await readJson(request, 4096));
  if (!parsed.success)
    return Response.json({ error: "Invalid import status" }, { status: 400 });
  const job = parsed.data;
  try {
    const db = sql(user);
    const others = await db`SELECT count(*)::int AS n FROM folio_imports
      WHERE owner_id=${user} AND id<>${job.id}
        AND updated_at > now()-(${EXPIRES_AFTER_MINUTES} * interval '1 minute')`;
    if (others[0].n >= MAX_ACTIVE_IMPORTS)
      throw new HttpError(429, "Too many imports are in progress.");
    await db`INSERT INTO folio_imports(owner_id,id,title,percent,message,status,device_id)
      VALUES(${user},${job.id},${job.title},${job.percent},${job.message},${job.status},${job.deviceId})
      ON CONFLICT(owner_id,id) DO UPDATE SET title=EXCLUDED.title,percent=EXCLUDED.percent,
        message=EXCLUDED.message,status=EXCLUDED.status,device_id=EXCLUDED.device_id,updated_at=now()`;
    return Response.json({ ok: true }, { headers });
  } catch (error) {
    // Nothing to mirror to yet; the importing device carries on regardless.
    if (missingTable(error)) return Response.json({ ok: false }, { headers });
    throw error;
  }
});

export const DELETE = safeRoute(async (request: Request) => {
  const user = await owner(request);
  if (!user) return unauthorized();
  await rateLimit(`import-write:${user}`, 90);
  const id = new URL(request.url).searchParams.get("id") || "";
  if (!safeId.test(id)) throw new HttpError(400, "Invalid import ID.");
  try {
    await sql(user)`DELETE FROM folio_imports WHERE owner_id=${user} AND id=${id}`;
  } catch (error) {
    if (!missingTable(error)) throw error;
  }
  return Response.json({ ok: true }, { headers });
});
