import {
  owner,
  rateLimit,
  sql,
  storagePresign,
  unauthorized,
} from "@/lib/readwind/server";
import { fileTypes } from "@/lib/readwind/file-validation";
import { HttpError, readJson, safeId, safeRoute } from "@/lib/readwind/security";

const MAX_FILE_BYTES = 20 * 1024 * 1024;

type UploadRequest = { id?: unknown; type?: unknown; bytes?: unknown };

function uploadFields(input: UploadRequest) {
  if (typeof input.id !== "string" || !safeId.test(input.id))
    throw new HttpError(400, "Invalid file ID");
  if (
    typeof input.type !== "string" ||
    !(fileTypes as readonly string[]).includes(input.type)
  )
    throw new HttpError(415, "Unsupported file. Use PDF, PNG, JPEG or WebP.");
  if (
    !Number.isInteger(input.bytes) ||
    (input.bytes as number) <= 0 ||
    (input.bytes as number) > MAX_FILE_BYTES
  )
    throw new HttpError(413, "This file is larger than 20 MB.");
  return { id: input.id, type: input.type, bytes: input.bytes as number };
}

export const POST = safeRoute(async (request: Request) => {
  const user = await owner(request);
  if (!user) return unauthorized();
  await rateLimit(`uploads:${user}`, 240);
  const { id, type, bytes } = uploadFields(
    (await readJson(request, 2048)) as UploadRequest,
  );
  const db = sql(user);
  const existing = await db`SELECT bytes FROM folio_files WHERE owner_id=${user} AND id=${id}`;
  try {
    // Reserve quota before handing out a URL. The reservation is released if
    // the upload never completes or fails verification.
    await db`INSERT INTO folio_files(owner_id,id,bytes) VALUES(${user},${id},${bytes})
      ON CONFLICT(owner_id,id) DO UPDATE SET bytes=GREATEST(folio_files.bytes,EXCLUDED.bytes)`;
  } catch (error) {
    if (!existing.length)
      await db`DELETE FROM folio_files WHERE owner_id=${user} AND id=${id}`;
    throw error;
  }
  try {
    return Response.json(await storagePresign(`${user}/${id}`, type));
  } catch (error) {
    if (!existing.length)
      await db`DELETE FROM folio_files WHERE owner_id=${user} AND id=${id}`;
    throw error;
  }
});
