import type { ImportOptions, Imported } from "./pdf";
export const defaultImportOptions: ImportOptions = {
  removeHeaders: true,
  joinHyphens: true,
  ocr: false,
  verifyText: true,
  verifyAllText: false,
  textLayout: "auto",
};
export async function importBook(
  file: File,
  options: ImportOptions = defaultImportOptions,
  onProgress: (message: string, pct: number) => void = () => {},
  signal?: AbortSignal,
): Promise<Imported> {
  if (/\.epub$/i.test(file.name) || file.type === "application/epub+zip") {
    const { importStructured } = await import("./structured-book");
    return importStructured(file, onProgress, signal);
  }
  const { importPDF } = await import("./pdf");
  const result = await importPDF(file, options, onProgress, signal);
  result.book.sourceFormat = "pdf";
  result.book.pagination = "printed";
  return result;
}
