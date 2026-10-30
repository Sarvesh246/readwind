import { HttpError } from "./security";
export const fileTypes = [
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/webp",
] as const;
export function validateFile(bytes: Uint8Array, type: string) {
  const ascii = (offset: number, text: string) =>
    [...text].every((c, i) => bytes[offset + i] === c.charCodeAt(0));
  const valid =
    type === "application/pdf"
      ? ascii(0, "%PDF-")
      : type === "image/png"
        ? [137, 80, 78, 71, 13, 10, 26, 10].every((b, i) => bytes[i] === b)
        : type === "image/jpeg"
          ? bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255
          : type === "image/webp"
            ? ascii(0, "RIFF") && ascii(8, "WEBP")
            : false;
  if (!valid)
    throw new HttpError(
      415,
      "Unsupported or invalid file. Use PDF, PNG, JPEG or WebP.",
    );
}
