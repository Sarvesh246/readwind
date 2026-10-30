"use client";
import { useEffect, useRef, useState } from "react";
import type { Book, Settings, Anchor, Annotation } from "@/lib/readwind/types";
import { families, leading, themes } from "@/lib/readwind/types";
import { textRuns, BlobImage } from "./Page";
import { compare } from "@/lib/readwind/anchors";
import { Modal } from "./Modal";
import { hasReadableContent } from '@/lib/readwind/content';
export function ScrollReader({
  book,
  settings: s,
  anchor,
  onProgress,
  annotations,
  loadBlob,
  onAnnotation,
}: {
  book: Book;
  settings: Settings;
  anchor: Anchor;
  onProgress: (a: Anchor) => void;
  annotations: Annotation[];
  loadBlob: (id: string) => Promise<Blob | undefined>;
  onAnnotation: (a: Annotation) => void;
}) {
  const reported = useRef<Anchor | null>(null);
  const ref = useRef<HTMLDivElement>(null),
    timer = useRef<ReturnType<typeof setTimeout> | null>(null),
    restoring = useRef(true),
    [footnote, setFootnote] = useState<string | null>(null);
  useEffect(() => {
    const root = ref.current;
    if (!root || (reported.current && compare(reported.current, anchor) === 0)) return;
    restoring.current = true;
    const p = root.querySelector<HTMLElement>(
      `[data-paragraph="${anchor.section}:${anchor.block}"]`,
    );
    if (p) {
      let target = p.getBoundingClientRect().top;
      for (const el of p.querySelectorAll<HTMLElement>("[data-offset]")) {
        const start = Number(el.dataset.offset),
          end = start + (el.textContent || "").length;
        if (start <= anchor.offset && end >= anchor.offset && el.firstChild) {
          const r = document.createRange();
          r.setStart(
            el.firstChild,
            Math.min(
              anchor.offset - start,
              el.firstChild.textContent?.length || 0,
            ),
          );
          r.collapse(true);
          target = r.getBoundingClientRect().top;
          break;
        }
      }
      root.scrollTop += target - root.getBoundingClientRect().top - 36;
    }
    requestAnimationFrame(() => {
      restoring.current = false;
    });
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [book.id, s.size, s.spacing, s.font, anchor]);
  function scroll() {
    if (restoring.current) return;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      const root = ref.current;
      if (!root) return;
      const bounds = root.getBoundingClientRect(),
        p = [...root.querySelectorAll<HTMLElement>("[data-paragraph]")].find(
          (p) => p.getBoundingClientRect().bottom > bounds.top + 40,
        );
      if (!p) return;
      const [section, block] = p.dataset.paragraph!.split(":").map(Number);
      let offset = 0;
      const doc = document as Document & {
        caretRangeFromPoint?: (x: number, y: number) => Range | null;
      };
      const textBounds = p.getBoundingClientRect();
      const caret = doc.caretRangeFromPoint?.(
        textBounds.left + 4,
        Math.max(bounds.top + 40, textBounds.top + 4),
      );
      if (caret && p.contains(caret.startContainer)) {
        const el =
          caret.startContainer.parentElement?.closest<HTMLElement>(
            "[data-offset]",
          );
        if (el) {
          const r = document.createRange();
          r.setStart(el, 0);
          r.setEnd(caret.startContainer, caret.startOffset);
          offset = Number(el.dataset.offset) + r.toString().length;
        }
      }
      reported.current = { section, block, offset };
      onProgress(reported.current);
    }, 250);
  }
  const t = themes[s.paper];
  return (
    <div
      ref={ref}
      className="continuous-reader"
      style={{
        fontFamily: families[s.font],
        fontSize: s.size,
        lineHeight: leading[s.spacing],
        background: t.page,
        color: t.ink,
      }}
      onScroll={scroll}
    >
      {book.sections.map((sec, section) => sec.blocks.some(hasReadableContent) && (
        <section key={sec.id}>
          <div className="continuous-chapter">
            <small>{book.title}</small>
            <h2>{sec.title}</h2>
          </div>
          {sec.blocks.map((b, block) => {
            if (!hasReadableContent(b)) return null;
            if (b.type === "figure")
              return (
                <figure key={block}>
                  <BlobImage id={b.blobId} loadBlob={loadBlob} />
                </figure>
              );
            const f = {
              section,
              block,
              start: 0,
              end: b.text.length,
              text: b.text,
              type: b.type,
              drop: false,
              continuation: false,
            };
            return b.type === "h" ? (
              <h3 key={block}>
                {textRuns(f, book, annotations, s, onAnnotation, setFootnote)}
              </h3>
            ) : (
              <p key={block} data-paragraph={`${section}:${block}`}>
                {textRuns(f, book, annotations, s, onAnnotation, setFootnote)}
              </p>
            );
          })}
        </section>
      ))}
      {footnote && (
        <Modal title="Footnote" onClose={() => setFootnote(null)}>
          <p>{footnote}</p>
        </Modal>
      )}
    </div>
  );
}
