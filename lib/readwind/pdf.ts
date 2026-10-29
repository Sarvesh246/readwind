import type { Book, Section, PageMark, Block } from "./types";
import { analyzePdfPage, dominantSize, importReport, type PdfPageReport } from './pdf-layout';
export type ImportOptions = {
  removeHeaders: boolean;
  joinHyphens: boolean;
  ocr: boolean;
  password?: string;
  ocrLanguage?: string;
};
export type Imported = {
  book: Book;
  files: { id: string; blob: Blob }[];
  preview: Blob;
  removed: number;
  fixed: number;
  scanned: number;
  lowConfidence: number;
  figures: number;
  footnoteCount: number;
  pageText: string[];
};
type Line = {
  text: string;
  x: number;
  y: number;
  size: number;
  page: number;
  header: boolean;
  endX?: number;
};
export async function importPDF(
  file: File,
  options: ImportOptions,
  onProgress: (message: string, pct: number) => void,
  signal?: AbortSignal,
): Promise<Imported> {
  if (file.size > 50 * 1024 * 1024)
    throw new Error("Choose a PDF under 50 MB.");
  const pdfjs = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
  const task = pdfjs.getDocument({
    data: await file.arrayBuffer(),
    cMapUrl: "/cmaps/",
    cMapPacked: true,
    standardFontDataUrl: "/standard_fonts/",
    wasmUrl: "/pdf-wasm/",
    password: options.password,
  });
  const abort = () => { void ocr?.terminate(); void task.destroy(); };
  signal?.addEventListener("abort", abort, { once: true });
  let ocr:
    | Awaited<ReturnType<(typeof import("tesseract.js"))["createWorker"]>>
    | undefined;
  try {
    if(signal?.aborted) throw new DOMException('Import cancelled','AbortError');
    const pdf = await task.promise;
    const labels = await pdf.getPageLabels().catch(()=>null),
      outline = await pdf.getOutline().catch(()=>null),
      metadata = await pdf.getMetadata().catch(() => null);
    const info = (metadata?.info || {}) as Record<string, string>;
    const all: Line[][] = [],
      files: { id: string; blob: Blob }[] = [],
      images = new Map<number, { id: string; y: number }[]>(),
      heights: number[] = [];
    const reports: PdfPageReport[] = [];
    let scanned = 0,
      lowConfidence = 0,
      figureCount = 0;
    let preview: Blob | undefined;
    const raster = async (
      page: Awaited<ReturnType<typeof pdf.getPage>>,
      scale: number,
    ) => {
      const base = page.getViewport({scale:1});
      scale = Math.min(scale, Math.sqrt(12_000_000/(base.width*base.height)), 4096/Math.max(base.width,base.height));
      const v = page.getViewport({ scale }),
        canvas = document.createElement("canvas");
      canvas.width = v.width;
      canvas.height = v.height;
      const context = canvas.getContext("2d")!;
      await page.render({ canvasContext: context, canvas, viewport: v })
        .promise;
      return canvas;
    };
    for (let p = 1; p <= pdf.numPages; p++) {
      if (signal?.aborted)
        throw new DOMException("Import cancelled", "AbortError");
      onProgress(
        `Reading page ${p} of ${pdf.numPages}`,
        Math.round((p / pdf.numPages) * 80),
      );
      const page = await pdf.getPage(p),
        v = page.getViewport({ scale: 1 }),
        content = await page.getTextContent().catch(()=>({items:[]}));
      heights.push(v.height);
      const items = content.items.filter((i): i is import("pdfjs-dist/types/src/display/api").TextItem => "str" in i);
      const analysis = analyzePdfPage(items as import("./pdf-layout").PdfTextItem[], v, p-1);
      reports.push(analysis.report);
      const lines: Line[] = analysis.lines;
      if (p === 1) {
        const canvas = await raster(page, 1);
        preview = await new Promise<Blob>((resolve) =>
          canvas.toBlob((b) => resolve(b!), "image/png"),
        );
      }
      if (!analysis.report.characters) {
        scanned++;
        if (options.ocr) {
        try {
        if (!ocr) {
          onProgress(
            "Loading text recognition…",
            Math.round((p / pdf.numPages) * 80),
          );
          const t = await import("tesseract.js");
          ocr = await t.createWorker(options.ocrLanguage || "eng", 1, {
            workerPath: "/ocr/worker.min.js",
            corePath: "/ocr/core/",
          });
        }
        const canvas = await raster(page, 1.6);
        const result = await ocr.recognize(canvas);
        if (result.data.confidence < 75) { lowConfidence++; analysis.report.issues.push("low-ocr"); }
        lines.push(
          ...result.data.text
            .split(/\n+/)
            .filter((x) => x.trim())
            .map((text, i) => ({
              text: text.trim(),
              x: 40,
              y: 50 + i * 15,
              size: 12,
              page: p - 1,
              header: false,
            })),
        );
        } catch(e) { if(signal?.aborted)throw e; analysis.report.issues.push("extraction-error"); }
      }
      }
      if (items.length) {
        try {
        const ops = await page.getOperatorList(),
          stack: number[][] = [],
          regions: { x: number; y: number; w: number; h: number }[] = [];
        let m = [1, 0, 0, 1, 0, 0];
        for (let oi = 0; oi < ops.fnArray.length; oi++) {
          const op = ops.fnArray[oi],
            args = ops.argsArray[oi];
          if (op === pdfjs.OPS.save) stack.push([...m]);
          else if (op === pdfjs.OPS.restore) m = stack.pop() || m;
          else if (op === pdfjs.OPS.transform) {
            const b = args as number[];
            m = [
              m[0] * b[0] + m[2] * b[1],
              m[1] * b[0] + m[3] * b[1],
              m[0] * b[2] + m[2] * b[3],
              m[1] * b[2] + m[3] * b[3],
              m[0] * b[4] + m[2] * b[5] + m[4],
              m[1] * b[4] + m[3] * b[5] + m[5],
            ];
          } else if (
            [
              pdfjs.OPS.paintImageXObject,
              pdfjs.OPS.paintInlineImageXObject,
            ].includes(op)
          ) {
            const corners = [
              [0, 0],
              [0, 1],
              [1, 0],
              [1, 1],
            ].map(([x, y]) =>
              v.convertToViewportPoint(
                m[0] * x + m[2] * y + m[4],
                m[1] * x + m[3] * y + m[5],
              ),
            );
            const xs = corners.map((c) => c[0]),
              ys = corners.map((c) => c[1]);
            const r = {
              x: Math.max(0, Math.min(...xs)),
              y: Math.max(0, Math.min(...ys)),
              w: Math.max(...xs) - Math.min(...xs),
              h: Math.max(...ys) - Math.min(...ys),
            };
            if (
              r.w > 24 &&
              r.h > 24 &&
              !(r.w > v.width * 0.95 && r.h > v.height * 0.95)
            )
              regions.push(r);
          }
        }
        // Preserve aligned numeric table rows as an image instead of flattening cells.
        const tableRows: Line[] = [];
        let run: Line[] = [];
        const finishTable = () => {
          if (
            run.length >= 3 &&
            run.filter((l) => /\d/.test(l.text)).length >= 2
          ) {
            const x = Math.min(...run.map((l) => l.x)),
              right = Math.max(...run.map((l) => l.endX || v.width - 40)),
              top = run[0].y - run[0].size * 1.2,
              bottom = run[run.length - 1].y + run[run.length - 1].size * 0.4;
            regions.push({
              x: Math.max(0, x - 4),
              y: Math.max(0, top - 4),
              w: Math.min(v.width - x, right - x + 8),
              h: bottom - top + 8,
            });
            tableRows.push(...run);
          }
          run = [];
        };
        for (const line of lines) {
          if (
            line.text.includes("\t") &&
            !line.header &&
            (!run.length || line.y - run[run.length - 1].y < line.size * 2.5)
          )
            run.push(line);
          else {
            finishTable();
            if (line.text.includes("\t") && !line.header) run.push(line);
          }
        }
        finishTable();
        for (const row of tableRows) {
          const i = lines.indexOf(row);
          if (i >= 0) lines.splice(i, 1);
        }
        if (regions.length) {
          analysis.report.issues.push("illustrated");
          const full = await raster(page, 1.5);
          for (const r of regions.slice(0,8)) {
            if(figureCount>=40)break;
            const crop = document.createElement("canvas");
            crop.width = Math.ceil(r.w * 1.5);
            crop.height = Math.ceil(r.h * 1.5);
            crop
              .getContext("2d")!
              .drawImage(
                full,
                r.x * full.width/v.width,
                r.y * full.height/v.height,
                r.w * full.width/v.width,
                r.h * full.height/v.height,
                0,
                0,
                crop.width,
                crop.height,
              );
            const blob = await new Promise<Blob>((resolve) =>
                crop.toBlob((b) => resolve(b!), "image/png"),
              ),
              id = crypto.randomUUID();
            files.push({ id, blob });
            const previous = images.get(p - 1) || [];
            previous.push({ id, y: r.y });
            images.set(p - 1, previous);
            figureCount++;
          }
        }
        } catch(e) {
          if(signal?.aborted)throw e;
          analysis.report.issues.push("extraction-error");
        }
      }
      all.push(lines);
      page.cleanup();
      if (p % 3 === 0) await new Promise((resolve) => setTimeout(resolve, 0));
    }
    onProgress("Finding chapters and cleaning the text…", 85);
    const frequency = new Map<string, Set<number>>();
    const normal = (s: string) =>
      s.replace(/\d+/g, "#").replace(/\s+/g, " ").trim().toLowerCase();
    for (const lines of all)
      for (const line of lines.filter((l) => l.header)) {
        const key = normal(line.text);
        if (!frequency.has(key)) frequency.set(key, new Set());
        frequency.get(key)!.add(line.page);
      }
    const median = dominantSize(all.flat().filter(l=>!l.header));
    const outlinePages = new Map<number, string>();
    for (const item of outline || []) {
      try {
        const dest =
          typeof item.dest === "string"
            ? await pdf.getDestination(item.dest)
            : item.dest;
        if (Array.isArray(dest) && dest[0] !== undefined && dest[0] !== null) {
          const n =
            typeof dest[0] === "number"
              ? dest[0]
              : await pdf.getPageIndex(dest[0]);
          outlinePages.set(n, item.title);
        }
      } catch {}
    }
    const sections: Section[] = [],
      marks: PageMark[] = [],
      pageText: string[] = [],
      footnotes: NonNullable<Book["footnotes"]> = [];
    let section: Section | undefined,
      removed = 0,
      fixed = 0;
    all.forEach((lines, pi) => {
      let pageLabel = labels?.[pi] || "";
      if (!pageLabel) {
        const token = lines
          .filter((l) => l.header)
          .map((l) => l.text.trim())
          .find((t) => /^(\d+|[ivxlcdm]+)$/i.test(t));
        pageLabel = token || String(pi + 1);
      }
      const footnoteLines = new Set<Line>();
      let footnote: NonNullable<Book["footnotes"]>[number] | undefined;
      for (const line of lines) {
        if (
          !line.header &&
          line.y > heights[pi] * 0.7 &&
          line.size < median * 0.88
        ) {
          const match = line.text.match(/^([0-9]+|[*†‡])\s*[.)]?\s+(.+)/);
          if (match) {
            footnote = {
              id: crypto.randomUUID(),
              marker: match[1],
              text: match[2],
              pageIndex: pi,
            };
            footnotes.push(footnote);
            footnoteLines.add(line);
          } else if (footnote) {
            footnote.text += " " + line.text;
            footnoteLines.add(line);
          }
        }
      }
      const kept = lines.filter((l) => {
        if (footnoteLines.has(l)) return false;
        const repeated =
          l.header &&
          (frequency.get(normal(l.text))?.size || 0) >=
            Math.max(2, Math.ceil(pdf.numPages * 0.3));
        const numbered = l.header && /^\s*(\d+|[ivxlcdm]+)\s*$/i.test(l.text);
        if (options.removeHeaders && (repeated || numbered)) {
          removed++;
          return false;
        }
        return true;
      });
      const heading =
        outlinePages.get(pi) ||
        kept.find(
          (l) => l.size > median * 1.3 && l.y < 250 && l.text.length < 130,
        )?.text;
      if (!section || heading) {
        section = {
          id: crypto.randomUUID(),
          title: heading || "Beginning",
          heading: !!heading,
          blocks: [],
        };
        sections.push(section);
      }
      const blockAt = section.blocks.length;
      marks.push({
        label: pageLabel,
        index: pi,
        at: { section: sections.length - 1, block: blockAt, offset: 0 },
      });
      let paragraph = "",
        previous: Line | undefined;
      const flush = () => {
        if (paragraph.trim()) {
          section!.blocks.push({
            type: "p",
            text: paragraph.trim().replace(/\s+/g, " "),
          });
          paragraph = "";
        }
      };
      const figures = [...(images.get(pi) || [])].sort((a, b) => a.y - b.y);
      for (const line of kept) {
        while (figures[0] && figures[0].y < line.y) {
          flush();
          section.blocks.push({ type: "figure", blobId: figures.shift()!.id });
        }
        if (line.text === heading) {
          flush();
          continue;
        }
        if (
          previous &&
          (line.y - previous.y > median * 1.9 ||
            line.x - previous.x > median * 1.2)
        )
          flush();
        if (
          options.joinHyphens &&
          /-$/.test(paragraph) &&
          /^\p{Ll}/u.test(line.text)
        ) {
          paragraph = paragraph.slice(0, -1) + line.text;
          fixed++;
        } else paragraph += (paragraph ? " " : "") + line.text;
        previous = line;
      }
      flush();
      for (const figure of figures)
        section.blocks.push({ type: "figure", blobId: figure.id });
      for (const note of footnotes.filter((n) => n.pageIndex === pi)) {
        for (let bi = blockAt; bi < section.blocks.length; bi++) {
          const block = section.blocks[bi];
          if (block.type === "figure") continue;
          const marker = new RegExp(
            `(?:\\b|[.?!])${note.marker.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?=\\s|$)`,
          );
          const match = marker.exec(block.text);
          if (match) {
            block.footnoteRefs ||= [];
            block.footnoteRefs.push({
              at: match.index + match[0].length,
              noteId: note.id,
            });
            break;
          }
        }
      }
      if (section.blocks.length === blockAt)
        section.blocks.push({
          type: "p",
          text: "[No readable text was detected on this page. See the original PDF.]",
        });
      pageText.push(kept.map((l) => l.text).join("\n"));
    });
    const pdfId = crypto.randomUUID();
    files.push({
      id: pdfId,
      blob: new Blob([await file.arrayBuffer()], { type: "application/pdf" }),
    });
    const coverId = crypto.randomUUID();
    files.push({ id: coverId, blob: preview! });
    const title =
      info.Title?.trim() && !/untitled/i.test(info.Title)
        ? info.Title
        : file.name.replace(/\.pdf$/i, "").replace(/[_-]/g, " ");
    const book: Book = {
      id: crypto.randomUUID(),
      title,
      author: info.Author?.trim() || "Unknown author",
      cover: {
        kind: "typeset",
        color: "#2F4A3A",
        fg: "#EFE6D2",
        blobId: coverId,
      },
      sourcePdfBlobId: pdfId,
      readingMode: "original",
      importReport: importReport(reports),
      addedAt: Date.now(),
      lastOpenedAt: Date.now(),
      printPageCount: pdf.numPages,
      sections,
      pageMarks: marks,
      footnotes,
    };
    onProgress("Ready to review", 100);
    return {
      book,
      files,
      preview: preview!,
      removed,
      fixed,
      scanned,
      lowConfidence,
      figures: figureCount,
      footnoteCount: footnotes.length,
      pageText,
    };
  } finally {
    signal?.removeEventListener("abort", abort);
    await ocr?.terminate().catch(()=>{});
    await task.destroy();
  }
}
