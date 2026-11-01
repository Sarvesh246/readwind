"use client";
import { useCallback } from "react";
import type { Imported } from "@/lib/readwind/pdf";
import type { Book } from "@/lib/readwind/types";
import type { StructuredImport } from "@/lib/readwind/structured-book";
import { Cover } from "./Library";
import { ChapterTitleInput } from "./ChapterTitleInput";
import { Icon } from "./Icon";
export function StructuredImportReview({
  result,
  busy,
  error,
  onChange,
  onCancel,
  onReset,
  onAdd,
}: {
  result: Imported;
  busy: boolean;
  error: string;
  onChange: (patch: Partial<Book>) => void;
  onCancel: () => void;
  onReset: () => void;
  onAdd: () => void;
}) {
  const report = (result as StructuredImport).conversionReport,
    loadBlob = useCallback(
      async (id: string) => result.files.find((f) => f.id === id)?.blob,
      [result.files],
    );
  const rename = (index: number, title: string) => {
    const sections = result.book.sections.map((s, i) =>
        i === index ? { ...s, title } : s,
      ),
      chapterLinks = result.book.chapterLinks?.map((link) =>
        link.at.section === index && link.at.block === 0
          ? { ...link, title }
          : link,
      );
    onChange({ sections, chapterLinks });
  };
  return (
    <div className="app-shell import-screen">
      <header className="document-header">
        <button
          className="icon-button"
          aria-label="Cancel import"
          disabled={busy}
          onClick={onCancel}
        >
          <Icon name="close" />
        </button>
        <h1>Review your book</h1>
      </header>
      <main className="structured-review">
        <div className="structured-cover">
          <Cover book={result.book} loadBlob={loadBlob} />
        </div>
        <label>
          Book title
          <input
            value={result.book.title}
            maxLength={500}
            onChange={(e) => onChange({ title: e.target.value })}
          />
        </label>
        <label>
          Author
          <input
            value={result.book.author}
            maxLength={500}
            onChange={(e) => onChange({ author: e.target.value })}
          />
        </label>
        <p>
          {result.book.sections.length} sections · {result.figures}{" "}
          illustrations · Adjustable text
        </p>
        <p className="muted">
          This book has no fixed printed pages. Chapters and reading progress
          follow its text.
        </p>
        <ol>
          {result.book.sections.map((section, index) => (
            <li key={section.id}>
              <ChapterTitleInput
                title={section.title}
                label={`Chapter ${index + 1} title`}
                onChange={(title) => rename(index, title)}
              />
            </li>
          ))}
        </ol>
        {report?.warnings.length > 0 && (
          <details>
            <summary>Review import details</summary>
            {report.warnings.map((warning, i) => (
              <p key={i}>{warning}</p>
            ))}
          </details>
        )}
        {report?.passed === false && (
          <p role="alert">
            Some content could not be preserved reliably. Choose another edition
            or a PDF copy to keep the complete book.
          </p>
        )}
        {error && <p role="alert">{error}</p>}
        <div className="inline-actions">
          <button
            className="button primary"
            disabled={
              busy || !result.book.title.trim() || report?.passed === false
            }
            onClick={onAdd}
          >
            {busy ? "Saving…" : "Add book"}
          </button>
          <button className="button" disabled={busy} onClick={onReset}>
            Choose another file
          </button>
        </div>
      </main>
    </div>
  );
}
