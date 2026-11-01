import {
  importBook,
  defaultImportOptions,
} from "../../lib/readwind/import-book";
import { importStructured } from "../../lib/readwind/structured-book";
import { book as schema } from "../../lib/readwind/schemas";
import { sha256 } from "../../lib/readwind/catalog";
import type { Book } from "../../lib/readwind/types";
import { validateFile } from "../../lib/readwind/file-validation";
type Payload =
  | {
      data: string;
      name: string;
      format: string;
      cover?: { data: string; type: string };
      resources?: Record<string, { data: string; type: string }>;
    }
  | { validateOnly: Book; assets?: { type: string; data: string }[] };
const bytes = (data: string) =>
  Uint8Array.from(atob(data), (c) => c.charCodeAt(0));
const base64 = (data: Uint8Array) => {
  let text = "";
  for (let i = 0; i < data.length; i += 8192)
    text += String.fromCharCode(...data.subarray(i, i + 8192));
  return btoa(text);
};
declare global {
  interface Window {
    prepareReadwindBook: (payload: Payload) => Promise<unknown>;
  }
}
window.prepareReadwindBook = async (payload) => {
  if ("validateOnly" in payload) {
    for (const asset of payload.assets || [])
      validateFile(bytes(asset.data), asset.type);
    const parsed = schema.safeParse(payload.validateOnly);
    if (!parsed.success)
      throw new Error(
        parsed.error.issues
          .slice(0, 5)
          .map((i) => `${i.path.join(".")}: ${i.message}`)
          .join("; "),
      );
    return { valid: true };
  }
  const file = new File([bytes(payload.data)], payload.name, {
    type:
      payload.format === "epub"
        ? "application/epub+zip"
        : payload.format === "pdf"
          ? "application/pdf"
          : "text/html",
  });
  const resources = Object.fromEntries(
    Object.entries(payload.resources || {}).map(([path, r]) => [
      path,
      { bytes: bytes(r.data), type: r.type },
    ]),
  );
  const result =
    payload.format === "html"
      ? await importStructured(file, () => {}, undefined, resources)
      : await importBook(file, {
          ...defaultImportOptions,
          verifyAllText: true,
        });
  if (payload.cover) {
    const blob = new Blob([bytes(payload.cover.data)], {
        type: payload.cover.type,
      }),
      url = URL.createObjectURL(blob);
    try {
      const img = new Image();
      img.src = url;
      await img.decode();
      if (img.naturalWidth < 100 || img.naturalHeight < 100)
        throw new Error("Cover resolution is too small.");
    } finally {
      URL.revokeObjectURL(url);
    }
    const id = crypto.randomUUID();
    result.files.push({ id, blob });
    result.book.cover = { ...result.book.cover, kind: "image", blobId: id };
  }
  const warnings =
    "conversionReport" in result
      ? (
          result as unknown as {
            conversionReport: { warnings: string[]; passed: boolean };
          }
        ).conversionReport.warnings
      : result.book.importReport?.warnings || [];
  const report =
    "conversionReport" in result
      ? (result as unknown as { conversionReport: Record<string, unknown> })
          .conversionReport
      : {
          version: 1,
          passed: !result.book.importReport?.pages.some((p) =>
            p.issues.some((i) =>
              [
                "extraction-error",
                "low-ocr",
                "ocr-mismatch",
                "content-loss",
                "cropped-text",
              ].includes(i),
            ),
          ),
          pages: result.book.importReport?.pages,
        };
  let coverThumbnailId: string | undefined;
  if (result.book.cover.blobId) {
    const original = result.files.find(
      (f) => f.id === result.book.cover.blobId,
    )!;
    const url = URL.createObjectURL(original.blob);
    try {
      const image = new Image();
      image.src = url;
      await image.decode();
      const scale = Math.min(
          1,
          224 / image.naturalWidth,
          336 / image.naturalHeight,
        ),
        canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
      canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
      canvas
        .getContext("2d")!
        .drawImage(image, 0, 0, canvas.width, canvas.height);
      const blob = await new Promise<Blob>((resolve, reject) =>
        canvas.toBlob(
          (b) =>
            b
              ? resolve(b)
              : reject(new Error("Could not prepare cover thumbnail.")),
          "image/webp",
          0.82,
        ),
      );
      coverThumbnailId = crypto.randomUUID();
      result.files.push({ id: coverThumbnailId, blob });
    } finally {
      URL.revokeObjectURL(url);
    }
  }
  const assets = await Promise.all(
    result.files.map(async (f) => {
      const data = new Uint8Array(await f.blob.arrayBuffer());
      validateFile(data, f.blob.type);
      return {
        id: f.id,
        type: f.blob.type,
        bytes: data.length,
        sha256: await sha256(data),
        data: base64(data),
      };
    }),
  );
  if (!result.book.cover.blobId)
    warnings.push("A real edition cover is required.");
  else {
    const cover = result.files.find((f) => f.id === result.book.cover.blobId);
    if (!cover) throw new Error("Missing cover asset.");
    const url = URL.createObjectURL(cover.blob);
    try {
      const img = new Image();
      img.src = url;
      await img.decode();
      if (img.naturalWidth < 100 || img.naturalHeight < 100)
        warnings.push("Cover resolution requires review.");
    } finally {
      URL.revokeObjectURL(url);
    }
  }
  result.book.readingMode = "reflow";
  const parsed = schema.safeParse(result.book);
  if (!parsed.success)
    throw new Error(
      parsed.error.issues
        .slice(0, 5)
        .map((i) => `${i.path.join(".")}: ${i.message}`)
        .join("; "),
    );
  return {
    book: result.book as Book,
    assets,
    report,
    warnings,
    coverThumbnailId,
  };
};
