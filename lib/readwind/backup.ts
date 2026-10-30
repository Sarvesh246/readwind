import { z } from "zod";

import { book, annotation, progress, settings, timestamp } from "./schemas";

import { safeId } from "./security";

import { validateFile } from "./file-validation";

const maxBackup = 80 * 1024 * 1024;

const schema = z.object({
  format: z.literal("folio-backup-1"),
  books: z.array(book).max(100),

  annotations: z.array(annotation).max(10000).default([]),

  progress: z
    .array(progress.extend({ updatedAt: timestamp }))
    .max(100)
    .default([]),

  settings: settings.optional(),

  blobs: z
    .array(
      z.object({
        id: z.string().regex(safeId),
        type: z.string().max(100).optional(),
        data: z.string().max(28 * 1024 * 1024),
      }),
    )
    .max(2000)
    .default([]),
});

export function decodeBackup(input: unknown) {
  const parsed = schema.safeParse(input);

  if (!parsed.success)
    throw new Error("This backup contains invalid or excessive library data.");

  const data = parsed.data;

  const ids = new Set(data.books.map((b) => b.id));

  if (
    ids.size !== data.books.length ||
    data.annotations.some((a) => !ids.has(a.bookId)) ||
    data.progress.some((p) => !ids.has(p.bookId))
  )
    throw new Error("Invalid backup references.");

  const books = new Map(data.books.map((b) => [b.id, b]));
  const valid = (
    id: string,
    at: { section: number; block: number; offset: number },
  ) => {
    const block = books.get(id)?.sections[at.section]?.blocks[at.block];
    return !!block && at.offset <= (block.text?.length || 0);
  };
  if (
    data.annotations.some(
      (a) => !valid(a.bookId, a.range.start) || !valid(a.bookId, a.range.end),
    ) ||
    data.progress.some((p) => !valid(p.bookId, p.at))
  )
    throw new Error("Invalid backup reading position.");
  const files = data.blobs.map((b) => {
    // Decode bytes directly. Never fetch a URL supplied by an archive.

    const match =
      /^data:(application\/pdf|image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/]*={0,2})$/.exec(
        b.data,
      );

    if (!match || (b.type && b.type !== match[1]))
      throw new Error("Backup contains an unsupported attachment.");

    const bytes = Uint8Array.from(atob(match[2]), (c) => c.charCodeAt(0));

    if (bytes.length > 20 * 1024 * 1024)
      throw new Error("Backup attachment exceeds 20 MB.");

    validateFile(bytes, match[1]);

    return { id: b.id, blob: new Blob([bytes], { type: match[1] }) };
  });

  if (new Set(files.map((f) => f.id)).size !== files.length)
    throw new Error("Duplicate attachment ID.");

  const lookup = new Map(files.map((f) => [f.id, f.blob]));

  for (const b of data.books) {
    if (
      b.sourcePdfBlobId &&
      lookup.get(b.sourcePdfBlobId)?.type !== "application/pdf"
    )
      throw new Error("Original attachment must be a PDF.");

    const images = [
      b.cover.blobId,
      b.pdfCoverBlobId,
      b.customCoverBlobId,
      ...b.sections.flatMap((s) =>
        s.blocks.map((block) =>
          block.type === "figure" ? block.blobId : undefined,
        ),
      ),
    ].filter(Boolean) as string[];

    if (images.some((id) => !lookup.get(id)?.type.startsWith("image/")))
      throw new Error("Invalid image attachment.");
  }

  return { data, files };
}

function base64(bytes: Uint8Array) {
  let text = "";

  for (let i = 0; i < bytes.length; i += 8192)
    text += String.fromCharCode(...bytes.subarray(i, i + 8192));

  return btoa(text);
}

async function key(password: string, salt: Uint8Array) {
  if (password.length < 12)
    throw new Error("Use a backup password with at least 12 characters.");

  const material = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveKey"],
  );

  return crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      hash: "SHA-256",
      salt: salt as BufferSource,
      iterations: 600000,
    },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

export async function encryptBackup(json: string, password: string) {
  if (new TextEncoder().encode(json).length > maxBackup)
    throw new Error("Backup exceeds 80 MB. Export a smaller library.");

  const salt = crypto.getRandomValues(new Uint8Array(16)),
    iv = crypto.getRandomValues(new Uint8Array(12));

  const encrypted = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    await key(password, salt),
    new TextEncoder().encode(json),
  );

  return JSON.stringify({
    format: "readwind-encrypted-1",
    salt: base64(salt),
    iv: base64(iv),
    data: base64(new Uint8Array(encrypted)),
  });
}

export async function readBackup(file: File, password: () => string | null) {
  if (file.size > 115 * 1024 * 1024) throw new Error("Backup exceeds 115 MB.");

  let input = JSON.parse(await file.text());

  if (input?.format === "readwind-encrypted-1") {
    const envelope = z
      .object({
        format: z.literal("readwind-encrypted-1"),
        salt: z.string().length(24),
        iv: z.string().length(16),
        data: z.string().max(112 * 1024 * 1024),
      })
      .parse(input);

    const secret = password();

    if (!secret) throw new Error("Restore cancelled.");

    try {
      const bytes = (s: string) =>
        Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

      const plain = await crypto.subtle.decrypt(
        { name: "AES-GCM", iv: bytes(envelope.iv) },
        await key(secret, bytes(envelope.salt)),
        bytes(envelope.data),
      );

      input = JSON.parse(new TextDecoder().decode(plain));
    } catch {
      throw new Error("Incorrect password or damaged backup.");
    }
  }

  return decodeBackup(input);
}
