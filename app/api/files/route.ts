import {
  owner,
  storageFetch,
  unauthorized,
  rateLimit,
  sql,
} from "@/lib/readwind/server";
import {
  readBytes,
  safeId,
  safeRoute,
  HttpError,
} from "@/lib/readwind/security";
import { validateFile } from "@/lib/readwind/file-validation";
export const POST = safeRoute(async (request: Request) => {
  const user = await owner(request);
  if (!user) return unauthorized();
  await rateLimit(`upload:${user}`, 10);
  const id = new URL(request.url).searchParams.get("id");
  if (!id || !safeId.test(id)) throw new HttpError(400, "Invalid file ID");
  // 20 MB leaves headroom within the Worker's memory ceiling for signing/copies.
  const bytes = await readBytes(request, 20 * 1024 * 1024);
  const type = request.headers.get("content-type") || "";
  validateFile(bytes, type);
  // Reserve quota before S3. Reservations are conservative on upload failures.
  // One row per owner serializes concurrent reservations across isolates.
  const db = sql(user);
  await db`INSERT INTO folio_files(owner_id,id,bytes) VALUES(${user},${id},${bytes.length})
    ON CONFLICT(owner_id,id) DO UPDATE SET bytes=GREATEST(folio_files.bytes,EXCLUDED.bytes)`;
  const response = await storageFetch(`${user}/${id}`, {
    method: "PUT",
    headers: { "Content-Type": type },
    body: bytes as BodyInit,
  });
  if (!response.ok)
    throw new HttpError(502, "File upload failed. Please retry.");
  return Response.json({ ok: true });
});
export const GET = safeRoute(async (request: Request) => {
  const user = await owner(request);
  if (!user) return unauthorized();
  await rateLimit(`download:${user}`, 120);
  const id = new URL(request.url).searchParams.get("id");
  if (!id || !safeId.test(id)) throw new HttpError(400, "Invalid file ID");
  const result = await storageFetch(`${user}/${id}`);
  if (!result.ok) throw new HttpError(404, "File unavailable");
  // Old unsafe uploads are inert too, regardless of their stored MIME type.
  return new Response(result.body, {
    headers: {
      "Content-Type": "application/octet-stream",
      "Content-Disposition": `attachment; filename="${id}"`,
      "Content-Security-Policy": "sandbox; default-src 'none'",
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
      "X-Readwind-File-Type":
        result.headers.get("content-type") || "application/octet-stream",
    },
  });
});
