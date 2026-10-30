import {
  owner,
  rateLimit,
  sql,
  storageFetch,
  unauthorized,
} from "@/lib/readwind/server";
import { fileTypes, validateFile } from "@/lib/readwind/file-validation";
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

async function discard(user: string, id: string) {
  try {
    const removed = await storageFetch(`${user}/${id}`, { method: "DELETE" });
    if (!removed.ok && removed.status !== 404) return;
  } catch {
    return;
  }
  await sql(user)`DELETE FROM folio_files WHERE owner_id=${user} AND id=${id}`;
}

function storedSize(response: Response) {
  const range = response.headers.get("content-range");
  if (range) return Number(range.slice(range.lastIndexOf("/") + 1));
  const length = response.headers.get("content-length");
  return length ? Number(length) : NaN;
}

export const POST = safeRoute(async (request: Request) => {
  const user = await owner(request);
  if (!user) return unauthorized();
  await rateLimit(`uploads:${user}`, 240);
  const { id, type, bytes } = uploadFields(
    (await readJson(request, 2048)) as UploadRequest,
  );
  // Read only the signature bytes needed to identify the format, but use the
  // range metadata to confirm the full object size.
  const check = await storageFetch(`${user}/${id}`, {
    headers: { Range: "bytes=0-63" },
  });
  if (!check.ok) {
    await discard(user, id);
    throw new HttpError(400, "Upload did not finish. Please retry.");
  }
  const prefix = new Uint8Array(await check.arrayBuffer());
  if (storedSize(check) !== bytes) {
    await discard(user, id);
    throw new HttpError(400, "Upload size did not match. Please retry.");
  }
  try {
    validateFile(prefix, type);
  } catch (error) {
    await discard(user, id);
    throw error;
  }
  return Response.json({ ok: true });
});
