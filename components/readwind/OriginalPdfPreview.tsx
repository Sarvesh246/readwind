"use client";
import { useEffect, useRef, useState } from "react";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { PdfPage } from "./PdfPage";
/** Render untrusted originals as PDF pages, never as an embedded document. */
export function OriginalPdfPreview({ blob, index }: { blob: Blob; index: number }) {
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null);
  const [error, setError] = useState("");
  const [width, setWidth] = useState(300);
  const area = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const observer = new ResizeObserver(([entry]) =>
      setWidth(Math.max(200, Math.min(900, entry.contentRect.width))),
    );
    observer.observe(area.current!);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    let alive = true,
      task:
        | ReturnType<(typeof import("pdfjs-dist"))["getDocument"]>
        | undefined;
    (async () => {
      const js = await import("pdfjs-dist");
      if (!alive) return;
      js.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
      const data = await blob.arrayBuffer();
      if (!alive) return;
      task = js.getDocument({
        data,
        cMapUrl: "/cmaps/",
        cMapPacked: true,
        standardFontDataUrl: "/standard_fonts/",
        wasmUrl: "/pdf-wasm/",
      });
      task.onPassword = (update: (password: string) => void) => {
        const password = window.prompt("Enter the PDF password.");
        if (password !== null) update(password);
        else {
          void task?.destroy();
          if (alive) setError("PDF unlock cancelled.");
        }
      };
      const document = await task.promise;
      if (alive) setPdf(document);
    })().catch((e) => {
      if (alive) setError(e.message || "Could not open the original PDF.");
    });
    return () => {
      alive = false;
      void task?.destroy();
    };
  }, [blob]);
  return (
    <div ref={area} className="original-pdf-preview">
      {error ? (
        <p role="alert">{error}</p>
      ) : pdf ? (
        <PdfPage
          pdf={pdf}
          index={Math.max(0, Math.min(index, pdf.numPages - 1))}
          width={width}
        />
      ) : (
        <p role="status">Opening original PDF…</p>
      )}
    </div>
  );
}
