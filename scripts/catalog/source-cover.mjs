import { unzipSync } from "fflate";

/** Gutenberg's numbered -cover.png files are its generic generated artwork. */
export function sourceCoverValidation(record, source) {
  if (
    record.provider !== "gutenberg" ||
    record.format !== "epub" ||
    record.coverUrl
  )
    return { passed: true, errors: [] };
  let extracted = 0;
  const files = unzipSync(source, {
    filter(file) {
      if (!file.name.endsWith(".opf")) return false;
      extracted += file.originalSize;
      if (extracted > 2_000_000)
        throw new Error("EPUB package metadata exceeds limit.");
      return true;
    },
  });
  for (const bytes of Object.values(files)) {
    const xml = new TextDecoder().decode(bytes);
    for (const item of xml.matchAll(/<item\b[^>]*>/gi)) {
      const href = item[0].match(/\bhref=["']([^"']+)["']/i)?.[1] || "";
      if (/(?:^|[_/])\d+-cover\.(?:png|jpe?g)$/i.test(href))
        return {
          passed: false,
          errors: [
            "Generic generated source cover requires a verified real edition cover.",
          ],
        };
    }
  }
  return { passed: true, errors: [] };
}
