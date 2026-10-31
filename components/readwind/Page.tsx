"use client";
import { memo, useState } from "react";
import type { ScreenPage, Fragment, Geometry } from "@/lib/readwind/pagination";
import type { Book, Settings, Annotation, Anchor } from "@/lib/readwind/types";
import { colors, themes, families } from "@/lib/readwind/types";
import { compare } from "@/lib/readwind/anchors";
import {BookFigure} from "./BookFigure";
import {BlobImage} from './BlobImage';
import { figureHeight, chapterLayout } from "@/lib/readwind/pagination";
import { Modal } from "./Modal";
import { CoverTitle } from "./CoverTitle";
import {ContentsText} from './ContentsText';
import {blockLayout} from '@/lib/readwind/block-layout';
import {contentsRanges} from '@/lib/readwind/reading-layout';
type Props = {
  page: ScreenPage | null;
  book: Book;
  g: Geometry;
  settings: Settings;
  side: "left" | "right" | "single";
  annotations: Annotation[];
  loadBlob: (id: string) => Promise<Blob | undefined>;
  onAnnotation?: (a: Annotation) => void;
  cover?: boolean;
  inside?: boolean;
  decorative?: boolean;
  onNavigate?: (at:Anchor)=>void;
  onSourcePage?: (index:number)=>void;
};
export {BlobImage} from "./BlobImage";
export function textRuns(
  f: Fragment,
  book: Book,
  annotations: Annotation[],
  settings: Settings,
  onAnnotation?: Props["onAnnotation"],
  onFootnote?: (text: string) => void,
) {
  const hits = annotations.filter(
    (a) =>
      a.kind === "highlight" &&
      !a.deleted &&
      a.range.start.section <= f.section &&
      a.range.end.section >= f.section &&
      compare(a.range.start, {
        section: f.section,
        block: f.block,
        offset: f.end,
      }) < 0 &&
      compare(a.range.end, {
        section: f.section,
        block: f.block,
        offset: f.start,
      }) > 0,
  );
  const boundaries = new Set([f.start, f.end]);
  for (const a of hits) {
    if (a.range.start.section === f.section && a.range.start.block === f.block)
      boundaries.add(Math.max(f.start, a.range.start.offset));
    if (a.range.end.section === f.section && a.range.end.block === f.block)
      boundaries.add(Math.min(f.end, a.range.end.offset));
  }
  const marks = book.pageMarks.filter(
    (m) =>
      m.at.section === f.section &&
      m.at.block === f.block &&
      m.at.offset >= f.start &&
      m.at.offset < f.end,
  );
  marks.forEach((m) => boundaries.add(m.at.offset));
  if (f.drop) boundaries.add(f.start + 1);
  const source = book.sections[f.section].blocks[f.block];
  const styles=source.type==='figure'?[]:source.styles || [];
  styles.forEach(r=>{if(r.start>f.start&&r.start<f.end)boundaries.add(r.start);if(r.end>f.start&&r.end<f.end)boundaries.add(r.end);});
  const refs =
    source.type === "figure"
      ? []
      : (source.footnoteRefs || []).filter(
          (r) => r.at > f.start && r.at <= f.end,
        );
  refs.forEach((r) => boundaries.add(r.at));
  const points = [...boundaries].sort((a, b) => a - b),
    text = source.text || "";
  return points.slice(0, -1).map((offset, i) => {
    const end = points[i + 1],
      a = hits.find(
        (a) =>
          compare(
            { section: f.section, block: f.block, offset },
            a.range.start,
          ) >= 0 &&
          compare({ section: f.section, block: f.block, offset }, a.range.end) <
            0,
      );
    const mark = marks.find((m) => m.at.offset === offset),
      raw = text.slice(offset, end);
    const style=styles.find(r=>r.start<=offset&&r.end>=end);
    const content = a ? raw.trimEnd() : raw,
      trail = a ? raw.slice(content.length) : "";
    const bg = a
      ? a.color === "yellow"
        ? themes[settings.paper].hlYellow
        : a.color === "blue"
          ? themes[settings.paper].hlBlue
          : colors[a.color]
      : "transparent";
    return (
      <span key={offset}>
        {mark && offset !== f.start && (
          <span
            className="print-marker"
            title={`Print page ${mark.label} begins here`}
          >
            {mark.label}
          </span>
        )}
        <span
          data-offset={offset}
          data-section={f.section}
          data-block={f.block}
          data-highlight={a?.id}
          className={f.drop && offset === f.start ? "drop-cap" : undefined}
          style={{
            fontWeight:style?.bold?600:undefined,
            fontStyle:style?.italic?'italic':undefined,
            background: bg,
            color: a && (a.color === 'green' || a.color === 'pink') ? '#2A2622' : undefined,
            borderRadius: 2,
            cursor: a ? "pointer" : undefined,
          }}
          onClick={
            a
              ? (e) => {
                  e.stopPropagation();
                  onAnnotation?.(a);
                }
              : undefined
          }
        >
          {content}
        </span>
        {a?.note && end === a.range.end.offset && (
          <sup className="note-mark" aria-label="Has a note">
            ✎
          </sup>
        )}
        {refs
          .filter((r) => r.at === end)
          .map((r) => {
            const n = book.footnotes?.find((n) => n.id === r.noteId);
            return n ? (
              <button
                key={r.noteId}
                className="footnote-ref"
                aria-label={`Read footnote ${n.marker}`}
                onClick={(e) => {
                  e.stopPropagation();
                  onFootnote?.(n.text);
                }}
              >
                {n.marker}
              </button>
            ) : null;
          })}
        {trail}
      </span>
    );
  });
}
export const Page = memo(function Page({
  page,
  book,
  g,
  settings,
  side,
  annotations,
  loadBlob,
  onAnnotation,
  cover,
  inside,
  decorative,
  onNavigate,
  onSourcePage,
}: Props) {
  const [footnote, setFootnote] = useState<string | null>(null);
  const figureSource=(f:Fragment)=>{const b=book.sections[f.section].blocks[f.block];return b.type==='figure'?b:undefined;};
  const t = themes[settings.paper];
  const chapter = chapterLayout(g, page?.chapterTitle || '');
  const gutter = {
    left: "inset -90px 0 70px -70px rgba(40,28,14,.10), inset -18px 0 18px -16px rgba(40,28,14,.06)",
    right:
      "inset 90px 0 70px -70px rgba(40,28,14,.09), inset 18px 0 18px -16px rgba(40,28,14,.05)",
    single: "inset 36px 0 34px -30px rgba(40,28,14,.09)",
  };
  const bookmarked =
    page &&
    annotations.some(
      (a) =>
        a.kind === "bookmark" &&
        compare(a.range.start, page.start) >= 0 &&
        compare(a.range.start, page.end) < 0,
    );
  return (
    <div
      className={`book-page ${side} ${decorative ? "decorative-page" : ""}`}
      style={{
        background: cover ? book.cover.color : inside ? t.inside : t.page,
        color: t.ink,
        fontFamily: families[settings.font],
        fontSize: g.fs,
      }}
      aria-hidden={decorative || undefined}
    >
      {cover ? (
        <div
          className="reader-cover"
          style={{ background: book.cover.color, color: book.cover.fg }}
        >
          {(book.cover.kind === "pdfPage" || book.cover.kind === "image") &&
          book.cover.blobId ? (
            <BlobImage
              id={book.cover.blobId}
              loadBlob={loadBlob}
              alt={`${book.title} cover`}
              className="pdf-cover"
            />
          ) : (
            <>
              <div className="cover-author">{book.author}</div>
              <CoverTitle
                text={book.title}
                className="cover-title"
                maxSize={64}
              />
              {book.title === "Walden" && (
                <div className="cover-subtitle">or, Life in the Woods</div>
              )}
              <div className="cover-spacer" />
            </>
          )}
          <div className="bookmark-ribbon cover-ribbon" />
        </div>
      ) : inside ? null : page && !page.blank ? (
        <div
          className="page-inner"
          style={{ padding: `${g.padTop}px ${g.padX}px ${g.padBottom}px` }}
        >
          <div
            className="running-head"
            style={{ color: t.muted, opacity: page.chapterStart ? 0 : 1 }}
          >
            {side === "left" ? book.title : page.chapterTitle}
          </div>
          <div
            className={`page-text ${settings.focusParagraph ? "focus-paragraph" : ""}`}
            style={{ fontSize: g.fs, lineHeight: g.lh }}
          >
            {page.chapterStart && (
              <div
                className="chapter-heading"
                style={{
                  paddingTop: chapter.paddingTop,
                  paddingBottom: chapter.paddingBottom,
                  gap: chapter.gap,
                }}
              >
                <div style={{ color: t.muted }}>{book.title}</div>
                <h2 style={{ fontSize: chapter.titleSize }}>
                  {page.chapterTitle}
                </h2>
                <span style={{ background: t.muted }} />
              </div>
            )}
            {page.fragments.map((f, i) =>
              f.type === "figure" ? (
                <figure
                  key={i}
                  className="book-figure"
                  style={{ height: figureHeight(book.sections[f.section].blocks[f.block],g,page.chapterStart && i===0,page.chapterTitle) }}
                >
                  <BookFigure id={f.blobId!} loadBlob={loadBlob} sourcePageIndex={figureSource(f)?.sourcePageIndex} sourcePdf={figureSource(f)?.sourcePdf} aspectRatio={figureSource(f)?.aspectRatio} onSourcePage={onSourcePage}/>
                </figure>
              ) : f.type === "h" ? (
                <h3 key={i}>
                  {textRuns(
                    f,
                    book,
                    annotations,
                    settings,
                    onAnnotation,
                    setFootnote,
                  )}
                </h3>
              ) : (
                <p
                  key={i}
                  dir="auto"
                  data-paragraph={`${f.section}:${f.block}`}
                  style={{
                    textIndent: f.continuation || f.drop || f.type==='quote' || (contentsRanges(book,f.section,f.block)) ? "0" : "1.4em",
                    textAlign: contentsRanges(book,f.section,f.block) ? 'left' : undefined,
                    marginBottom: f.type==='quote'?'.6em':undefined,
                    marginTop:f.type==='quote'?'.6em':undefined,
                    marginInline:f.type==='quote'?'1em':undefined,
                    whiteSpace:'pre-line',
                    ...blockLayout(book.sections[f.section].blocks[f.block]),
                  }}
                >
                  <ContentsText book={book} fragment={f} onNavigate={onNavigate} render={part=>textRuns(part,book,annotations,settings,onAnnotation,setFootnote)}/>

                </p>
              ),
            )}
          </div>
          <div className="folio" style={{ color: t.muted }}>
            {page.folio}
          </div>
        </div>
      ) : null}
      {bookmarked && (
        <div role="img" aria-label="Bookmarked" className="bookmark-ribbon" />
      )}
      <div
        className="page-gutter"
        style={{ boxShadow: cover ? "none" : gutter[side] }}
      />
      {footnote && (
        <Modal title="Footnote" onClose={() => setFootnote(null)}>
          <p>{footnote}</p>
        </Modal>
      )}
    </div>
  );
});
