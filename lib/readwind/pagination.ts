import type { Anchor, Book, Settings, Block } from "./types";
import { compare, labelAt } from "./anchors";
import { families, leading } from "./types";
import {contentsRanges} from './reading-layout';
import {appendStyledText} from './rich-text';
import {blockLayout} from './block-layout';
import { hasReadableContent } from './content';
export type Geometry = {
  bookW: number;
  bookH: number;
  pw: number;
  padX: number;
  padTop: number;
  padBottom: number;
  textH: number;
  spread: boolean;
  fill: boolean;
  fs: number;
  lh: number;
};
export type Fragment = {
  section: number;
  block: number;
  start: number;
  end: number;
  text: string;
  type: Block["type"];
  blobId?: string;
  drop: boolean;
  continuation: boolean;
};
export type ScreenPage = {
  start: Anchor;
  end: Anchor;
  fragments: Fragment[];
  chapterStart: boolean;
  chapterTitle: string;
  folio: string;
  blank?: boolean;
};
/** Long chapter titles get a smaller display size so they stay on the page. */
export function chapterTitleSize(fs: number, title: string) {
  const length = title.trim().length;
  const factor = length > 60 ? 1.35 : length > 34 ? 1.55 : 1.9;
  return Math.round(fs * factor);
}
export function chapterLayout(g: Geometry, title: string) {
  return {
    paddingTop: Math.round(Math.min(g.fs * 3.2, g.textH * .10)),
    paddingBottom: Math.round(Math.min(g.fs * 1.4, g.textH * .04)),
    gap: Math.round(Math.min(14, g.textH * .04)),
    titleSize: Math.min(chapterTitleSize(g.fs, title), Math.max(18, Math.round(g.textH * .16))),
  };
}
export function geometry(
  aw: number,
  ah: number,
  settings: Pick<Settings, "size" | "spacing">,
  fill: boolean,
  spread: boolean,
  footer = true,
): Geometry {
  const fs = fill && aw > ah ? Math.max(14, settings.size - 2) : settings.size;
  const availH = Math.max(240, ah - (footer ? 56 : 0) - (fill ? 0 : 24));
  const bookW = fill
    ? aw
    : spread
      ? Math.min(aw - 48, availH * 1.56, 1500)
      : Math.min(aw - 48, availH * 0.78);
  const bookH = fill ? availH : spread ? bookW / 1.56 : availH;
  const pw = spread ? bookW / 2 : bookW;
  const measure = Math.min(pw - Math.max(22, pw * 0.1) * 2, fs * 36);
  const padX = Math.round((pw - measure) / 2),
    padTop = Math.round(Math.max(18, bookH * 0.055)),
    padBottom = Math.round(Math.max(14, bookH * 0.04));
  return {
    bookW,
    bookH,
    pw,
    padX,
    padTop,
    padBottom,
    textH: bookH - padTop - padBottom - 66,
    spread,
    fill,
    fs,
    lh: leading[settings.spacing],
  };
}
export function figureHeight(block:Block,g:Geometry,chapterStart=false){
  const natural=block.type==='figure' && block.aspectRatio?(g.pw-2*g.padX)/block.aspectRatio:300;
  if(block.type==='figure' && block.fullPage)return Math.min(g.textH*.97,natural);
  return Math.min(g.textH*(chapterStart ? .55 : .85),Math.max(g.fs*3,natural));
}
export function pageIndex(pages: ScreenPage[], at: Anchor, spread: boolean) {
  let i = pages.findIndex(
    (p) => !p.blank && compare(at, p.start) >= 0 && compare(at, p.end) < 0,
  );
  if (i < 0) {
    i = 0;
    pages.forEach((p, j) => {
      if (!p.blank && compare(p.start, at) <= 0) i = j;
    });
  }
  return spread ? i - (i % 2) : i;
}
const cache = new Map<string, ScreenPage[]>();
export async function paginate(
  book: Book,
  g: Geometry,
  settings: Pick<Settings, "font">,
  signal?: AbortSignal,
): Promise<ScreenPage[]> {
  const key = [
    "reading-layout-v5",
    book.id,
    book.revision || book.addedAt,
    g.pw,
    g.bookH,
    g.fs,
    g.lh,
    settings.font,
    g.spread,
  ].join("|");
  if (cache.has(key)) return cache.get(key)!;
  await Promise.all([
    document.fonts.load(`${g.fs}px ${families[settings.font].split(",")[0]}`),
    document.fonts.load(`italic ${Math.round(g.fs * 1.9)}px Literata`),
    document.fonts.load("11px Inter"),
  ]);
  await document.fonts.ready;
  const root = document.createElement("div");
  root.className = "pagination-measure";
  Object.assign(root.style, {
    position: "fixed",
    left: "-20000px",
    top: "0",
    width: `${g.pw - 2 * g.padX}px`,
    fontFamily: families[settings.font],
    fontSize: `${g.fs}px`,
    lineHeight: String(g.lh),
    textAlign: "justify",
    hyphens: "auto",
    fontVariantNumeric: "oldstyle-nums",
    visibility: "hidden",
    contain: "layout style",
    pointerEvents: "none",
  });
  root.lang = "en";
  document.body.appendChild(root);
  const pages: ScreenPage[] = [];
  try {
    for (let si = 0; si < book.sections.length; si++) {
      const sec = book.sections[si];
      if (!sec.blocks.some(hasReadableContent)) continue;
      let bi = 0,
        offset = 0,
        first = true;
      if (g.spread && sec.heading && pages.length % 2 === 0)
        pages.push({
          start: { section: si, block: 0, offset: 0 },
          end: { section: si, block: 0, offset: 0 },
          fragments: [],
          chapterStart: false,
          chapterTitle: "",
          folio: "",
          blank: true,
        });
      while (bi < sec.blocks.length) {
        while (bi < sec.blocks.length && !hasReadableContent(sec.blocks[bi])) bi++;
        if (bi === sec.blocks.length) break;
        if (signal?.aborted) throw new DOMException("Cancelled", "AbortError");
        root.replaceChildren();
        const opening=sec.blocks[bi];
        const pg: ScreenPage = {
          start: { section: si, block: bi, offset },
          end: { section: si, block: bi, offset },
          fragments: [],
          chapterStart: first && sec.heading && !(opening.type==='figure' && opening.fullPage),
          chapterTitle: sec.title,
          folio: "",
        };
        if (pg.chapterStart) {
          const layout = chapterLayout(g, sec.title);
          const h = document.createElement("div");
          h.className = "chapter-heading";
          h.style.cssText = `padding-top:${layout.paddingTop}px;padding-bottom:${layout.paddingBottom}px;display:flex;flex-direction:column;align-items:center;gap:${layout.gap}px;text-align:center`;
          const label = document.createElement("div");
          label.style.cssText =
            "font:11px Inter;letter-spacing:.24em;text-transform:uppercase";
          label.textContent = book.title;
          const title = document.createElement("h2");
          title.style.cssText = `font-size:${layout.titleSize}px;font-weight:400;font-style:italic;line-height:1.15;margin:0`;
          title.textContent = sec.title;
          const rule = document.createElement("div");
          rule.style.cssText = "width:36px;height:1px";
          h.appendChild(label);
          h.appendChild(title);
          h.appendChild(rule);
          root.appendChild(h);
        }
        const top = root.getBoundingClientRect().top;
        while (bi < sec.blocks.length) {
          if (!hasReadableContent(sec.blocks[bi])) { bi++; offset = 0; continue; }
          const block = sec.blocks[bi],
            text = block.text || "";
          const para = document.createElement(block.type === "h" ? "h3" : "p");
          const tocEntries=contentsRanges(book,si,bi);
          const drop =
            g.textH >= 260 &&
            pg.chapterStart &&
            pg.fragments.length === 0 &&
            offset === 0 &&
            block.type === "p" && !block.layout && !tocEntries;
          const toc = !!tocEntries;
          para.style.cssText = `white-space:pre-line;overflow-wrap:anywhere;margin:${block.type==='quote'?'.6em 1em':'0'};text-indent:${offset || drop || block.type !== "p" || toc ? "0" : "1.4em"};${toc ? 'text-align:left;' : ''}${block.type === "h" ? "font-weight:500;font-size:1.2em;line-height:1.3;padding:12px 0;" : ""}`;
          Object.assign(para.style,blockLayout(block));para.dir='auto';
          function setText(end: number) {
            para.replaceChildren();
            if (block.type === "figure") {
              const figure = document.createElement("div");
              figure.style.height = `${figureHeight(block,g,pg.chapterStart && pg.fragments.length===0)}px`;
              para.appendChild(figure);
              return;
            }
            if(tocEntries){
              for(const entry of tocEntries){const a=Math.max(offset,entry.start),b=Math.min(end,entry.end);if(b<=a)continue;
                const row=document.createElement('span');row.style.cssText='display:block;margin-bottom:.55em';appendStyledText(row,text,a,b,block.styles);para.appendChild(row);
              }
              return;
            }
            let begin = offset;
            if (drop && text[begin]) {
              const d = document.createElement("span");
              d.style.cssText =
                "float:left;font-size:3.3em;line-height:.82;padding:.06em .08em 0 0";
              d.textContent = text[begin];
              para.appendChild(d);
              begin++;
            }
            for (const m of book.pageMarks.filter(
              (m) =>
                m.at.section === si &&
                m.at.block === bi &&
                m.at.offset > begin &&
                m.at.offset < end,
            )) {
              appendStyledText(para,text,begin,m.at.offset,block.styles);
              const mark = document.createElement("span");
              mark.className = "print-marker";
              mark.textContent = m.label;
              para.appendChild(mark);
              begin = m.at.offset;
            }
            appendStyledText(para,text,begin,end,block.styles);
          }
          setText(text.length);
          root.appendChild(para);
          const fits = () =>
            root.getBoundingClientRect().bottom - top <= g.textH + 0.5;
          if(block.type==='h' && pg.fragments.length && root.getBoundingClientRect().bottom-top+g.fs*g.lh*2>g.textH){para.remove();break;}
          if (fits()) {
            pg.fragments.push({
              section: si,
              block: bi,
              start: offset,
              end: text.length,
              text: text.slice(offset),
              type: block.type,
              blobId: block.type === "figure" ? block.blobId : undefined,
              drop,
              continuation: offset > 0,
            });
            bi++;
            offset = 0;
            continue;
          }
          if (block.type === "figure") {
            if (pg.fragments.length) {
              para.remove();
              break;
            }
            pg.fragments.push({
              section: si,
              block: bi,
              start: 0,
              end: 0,
              text: "",
              type: "figure",
              blobId: block.blobId,
              drop: false,
              continuation: false,
            });
            bi++;
            break;
          }
          const ends = Array.from(
            text.slice(offset).matchAll(/\S+\s*/g),
            (m) => offset + m.index! + m[0].length,
          );
          let lo = 0,
            hi = ends.length;
          while (lo < hi) {
            const mid = Math.ceil((lo + hi) / 2);
            setText(ends[mid - 1]);
            if (fits()) lo = mid;
            else hi = mid - 1;
          }
          if (lo === 0 && pg.fragments.length) {
            para.remove();
            break;
          }
          let end = ends[Math.max(0, lo - 1)] || text.length;
          // A URL or an unusually long token can span several pages at large type.
          if(lo===0 && !pg.fragments.length){
            const charEnds:number[]=[];let pos=offset;
            for(const char of text.slice(offset,end)){pos+=char.length;charEnds.push(pos);}
            let a=0,b=charEnds.length;
            while(a<b){const mid=Math.ceil((a+b)/2);setText(charEnds[mid-1]);if(fits())a=mid;else b=mid-1;}
            end=charEnds[Math.max(0,a-1)] || end;
          }
          // Keep at least two lines on either side of a split when space allows.
          if (lo > 0 && end < text.length) {
            setText(text.length);
            const range = document.createRange();
            range.selectNodeContents(para);
            const fullLines = [
              ...new Set(
                Array.from(range.getClientRects())
                  .filter((r) => r.width > 0)
                  .map((r) => Math.round(r.top)),
              ),
            ];
            setText(end);
            range.selectNodeContents(para);
            const kept = [
              ...new Set(
                Array.from(range.getClientRects())
                  .filter((r) => r.width > 0)
                  .map((r) => Math.round(r.top)),
              ),
            ];
            if (kept.length === 1 && pg.fragments.length) {
              para.remove();
              break;
            }
            if (fullLines.length - kept.length === 1 && kept.length > 2) {
              const limit = kept[kept.length - 1];
              while (lo > 1) {
                lo--;
                setText(ends[lo - 1]);
                range.selectNodeContents(para);
                if (
                  Array.from(range.getClientRects()).every(
                    (r) => r.top < limit - 1,
                  )
                ) {
                  end = ends[lo - 1];
                  break;
                }
              }
            }
          }
          pg.fragments.push({
            section: si,
            block: bi,
            start: offset,
            end,
            text: text.slice(offset, end),
            type: block.type,
            drop,
            continuation: offset > 0,
          });
          offset = end;
          if (offset >= text.length) {
            bi++;
            offset = 0;
          }
          break;
        }
        const last = pg.fragments.at(-1);
        if (!last) break;
        pg.end = { section: si, block: last.block, offset: last.end };
        const a = labelAt(book, pg.chapterStart?{section:si,block:0,offset:0}:pg.start),
          b = labelAt(book, {
            ...pg.end,
            offset: Math.max(0, pg.end.offset - 1),
          });
        pg.folio = a === b ? a : `${a}–${b}`;
        pages.push(pg);
        first = false;
        if (pages.length % 4 === 0)
          await new Promise<void>((resolve) => setTimeout(resolve, 0));
      }
    }
    cache.set(key, pages);
    if (cache.size > 12) cache.delete(cache.keys().next().value!);
    return pages;
  } finally {
    root.remove();
  }
}
