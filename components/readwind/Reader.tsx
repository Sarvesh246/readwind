"use client";
import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useCallback,
} from "react";
import type { CSSProperties, PointerEvent as ReactPointerEvent } from "react";
import type { Book, Anchor, Annotation, Color } from "@/lib/readwind/types";
import { themes, colors, families, leading } from "@/lib/readwind/types";
import { geometry, paginate, pageIndex } from "@/lib/readwind/pagination";
import type { CurlRenderer } from "@/lib/readwind/curl";
import type { ScreenPage } from "@/lib/readwind/pagination";
import { compare, labelAt, wordProgress, start } from "@/lib/readwind/anchors";
import type { Library } from "@/lib/readwind/useLibrary";
import { ScrollReader } from "./ScrollReader";
import { Page, BlobImage } from "./Page";
import { Icon } from "./Icon";
import { Modal } from "./Modal";
import { SelectionToolbar } from "./SelectionToolbar";
import { Comfort, Segments } from "./Comfort";
import { hasReadableContent } from '@/lib/readwind/content';
type Turn = { dir: number; p: number; kind: "page" | "open" | "close" };
export function Reader({
  book,
  library: l,
  navigate,
}: {
  book: Book;
  library: Library;
  navigate: (url: string) => void;
}) {
  const s = l.settings,
    t = themes[s.paper];
  const root = useRef<HTMLDivElement>(null),
    box = useRef<HTMLDivElement>(null),
    leaf = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 1000, h: 700 }),
    [phone, setPhone] = useState(false),
    [compact, setCompact] = useState(false),
    [fill, setFill] = useState(false),
    [closed, setClosed] = useState(false),
    [chrome, setChrome] = useState(true),
    [full, setFull] = useState(false);
  const navigated = useRef(false);
  const saved = l.progress.find((p) => p.bookId === book.id);
  const [anchor, setAnchor] = useState<Anchor>(saved?.at || start),
    anchorRef = useRef(anchor),
    [pages, setPages] = useState<ScreenPage[]>([]),
    [busy, setBusy] = useState(true);
  const [panel, setPanel] = useState<
      "comfort" | "contents" | "search" | "original" | null
    >(null),
    [search, setSearch] = useState(""),
    [goPage, setGoPage] = useState(""),
    [message, setMessage] = useState("");
  const [turn, setTurn] = useState<Turn | null>(null),
    turnRef = useRef<Turn | null>(null),
    anim = useRef(0),
    [reduced, setReduced] = useState(false);
  const [selection, setSelection] = useState<{
      start: Anchor;
      end: Anchor;
      quote: string;
    } | null>(null),
    [editing, setEditing] = useState<Annotation | null>(null),
    [note, setNote] = useState("");
  const [selectionPoint, setSelectionPoint] = useState<{
    x: number;
    y: number;
  } | null>(null);
  const [selectMode, setSelectMode] = useState(false),
    [originalUrl, setOriginalUrl] = useState("");
  const curl = useRef<CurlRenderer | null>(null),
    pointerY = useRef(0.5);
  const drag = useRef<{
    x: number;
    y: number;
    rel: number;
    dx: number;
    started: boolean;
    dir: number;
    pointerId: number;
  } | null>(null);
  const spread = !phone && s.wideLayout === "spread" && s.turn !== "Scroll";
  const g = useMemo(
    () => geometry(size.w, size.h, s, fill, spread, true),
    [size, s.size, s.spacing, fill, spread, full],
  );
  const annotations = l.annotations.filter((a) => a.bookId === book.id);
  const index = pageIndex(pages, anchor, spread),
    first = pages[index]?.blank ? pages[index + 1] : pages[index];
  const last = spread ? pages[index + 1] || first : first;
  const a = s.turn === "Scroll" ? labelAt(book, anchor) : first ? labelAt(book, first.start) : labelAt(book, anchor),
    b = s.turn === "Scroll" ? a : last
      ? labelAt(book, { ...last.end, offset: Math.max(0, last.end.offset - 1) })
      : a;
  const visibleAnchor = s.turn === "Scroll" ? anchor : first?.start || anchor;
  const info = wordProgress(book, visibleAnchor);
  const bookmarked = annotations.find(a => a.kind === 'bookmark' && first &&
    compare(a.range.start, first.start) >= 0 && compare(a.range.start, first.end) < 0);
  const commitAnchor = useCallback(
    (at: Anchor) => {
      navigated.current = true;
      anchorRef.current = at;
      setAnchor(at);
      void l.saveProgress(book.id, at, wordProgress(book, at).before);
    },
    [book, l.saveProgress],
  );
  useLayoutEffect(() => {
    const media = () => {
      const p =
        window.innerWidth < 640 && window.innerHeight > window.innerWidth;
      setPhone(p);
      setCompact(window.innerWidth < 900 || window.innerHeight < 550);
      setFill(window.innerWidth < 900);
      return p;
    };
    setClosed(media());
    const ro = new ResizeObserver((entries) => {
      const r = entries[0].contentRect;
      setSize({ w: r.width, h: r.height });
    });
    if (root.current) ro.observe(root.current);
    window.addEventListener("resize", media);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", media);
    };
  }, []);
  useEffect(() => {
    const m = matchMedia("(prefers-reduced-motion: reduce)");
    const on = () => setReduced(m.matches);
    on();
    m.addEventListener("change", on);
    return () => m.removeEventListener("change", on);
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    setBusy(true);
    paginate(book, g, s, controller.signal)
      .then((p) => {
        if (!controller.signal.aborted) {
          setPages(p);
          setBusy(false);
        }
      })
      .catch((e) => {
        if (e.name !== "AbortError") {
          setMessage("Could not lay out this book. Try a smaller type size.");
          setBusy(false);
        }
      });
    return () => controller.abort();
  }, [book, g, s.font]);
  useEffect(() => {
    if (
      saved &&
      (!navigated.current || saved.deviceId !== localStorage.getItem("folio-device")) &&
      !l.conflict
    ) {
      setAnchor(saved.at);
      anchorRef.current = saved.at;
    }
  }, [saved?.updatedAt, saved?.revision, l.conflict]);
  useEffect(() => {
    const fs = () => setFull(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", fs);
    return () => document.removeEventListener("fullscreenchange", fs);
  }, []);
  useEffect(() => () => cancelAnimationFrame(anim.current), []);
  useEffect(() => {
    if (!s.restNudge) return;
    let active = 0,
      last = Date.now(),
      shown = 0;
    const id = setInterval(() => {
      const now = Date.now();
      if (document.visibilityState === "visible" && !closed && !panel) {
        active += now - last;
        if (active >= 20 * 60 * 1000) {
          setMessage("Rest your eyes. Look about 20 ft away for 20 seconds.");
          active = 0;
          shown = now;
        }
      }
      if (shown && now - shown > 20000) {
        setMessage("");
        shown = 0;
      }
      last = now;
    }, 1000);
    return () => clearInterval(id);
  }, [s.restNudge, closed, panel]);
  useEffect(() => {
    if (
      !turn ||
      turn.kind !== "page" ||
      s.turn !== "Curl" ||
      reduced ||
      !box.current ||
      !leaf.current
    )
      return;
    let cancelled = false;
    const raf = requestAnimationFrame(() => {
      import("@/lib/readwind/curl")
        .then(({ paperCurl }) =>
          paperCurl(box.current!, leaf.current!, {
            width: g.bookW,
            height: g.bookH,
            pageWidth: g.pw,
            spread,
            backward: spread && turn.dir === -1,
          }),
        )
        .then((renderer) => {
          if (!renderer) return;
          const active = turnRef.current;
          if (cancelled || !active || active.p > 0.3) {
            renderer.dispose();
            return;
          }
          curl.current = renderer;
          renderer.draw(
            spread ? active.p : active.dir === 1 ? active.p : 1 - active.p,
            pointerY.current,
          );
        })
        .catch(() => {});
    });
    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      curl.current?.dispose();
      curl.current = null;
    };
  }, [turn?.kind, turn?.dir, s.turn, reduced, g, spread]);
  const canTurn = (dir: number) =>
    dir > 0 ? index + (spread ? 2 : 1) < pages.length : index > 0;
  const updateTurn = (value: Turn | null) => {
    turnRef.current = value;
    setTurn(value);
  };
  const animate = (
    value: Turn,
    to: number,
    duration: number,
    done: () => void,
  ) => {
    cancelAnimationFrame(anim.current);
    const from = value.p,
      begin = performance.now(),
      D = reduced ? 150 : Math.max(160, duration * Math.abs(to - from));
    updateTurn(value);
    const step = (now: number) => {
      const k = Math.min(1, (now - begin) / D),
        e = k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2;
      const next = { ...value, p: from + (to - from) * e };
      turnRef.current = next;
      const q = spread ? next.p : value.dir === 1 ? next.p : 1 - next.p;
      curl.current?.draw(q, pointerY.current);
      if (box.current) {
        box.current.style.setProperty("--turn-q", String(q));
        box.current.style.setProperty(
          "--turn-sin",
          String(Math.sin(q * Math.PI)),
        );
        box.current.style.setProperty(
          "--fold-opacity",
          String(
            value.kind === "page"
              ? 1
              : Math.max(0, Math.min(1, (next.p - 0.55) / 0.45)),
          ),
        );
      }
      // Animate only the leaf transform; page text stays memoized. Opacity
      // goes on the front face, never the 3D leaf: opacity on the leaf forces
      // transform-style to flat and shows its mirrored backface.
      if (leaf.current) {
        const q = spread ? next.p : value.dir === 1 ? next.p : 1 - next.p;
        leaf.current.style.transform =
          s.turn === "Slide"
            ? `translateX(${-next.dir * next.p * 100}%)`
            : `rotateY(${(spread && value.dir === -1 ? 180 : -180) * q}deg)`;
        const frontFace = leaf.current.firstElementChild as HTMLElement | null;
        if (frontFace)
          frontFace.style.opacity = String(
            reduced
              ? 1 - next.p
              : value.kind === "page" &&
                  s.turn !== "Slide" &&
                  !spread &&
                  !fill &&
                  q > 0.55
                ? Math.max(0, 1 - (q - 0.55) / 0.45)
                : 1,
          );
      }
      if (value.kind !== "page" && box.current && spread)
        box.current.style.transform = `translateX(${(-g.pw / 2) * (1 - next.p)}px)`;
      if (k < 1) anim.current = requestAnimationFrame(step);
      else {
        anim.current = 0;
        curl.current?.dispose();
        curl.current = null;
        done();
        updateTurn(null);
      }
    };
    anim.current = requestAnimationFrame(step);
  };
  const finish = (value: Turn) => {
    if (value.kind === "open") {
      setClosed(false);
      return;
    }
    if (value.kind === "close") {
      setClosed(true);
      return;
    }
    let n = index + value.dir * (spread ? 2 : 1);
    if (pages[n]?.blank) n++;
    if (pages[n]) commitAnchor(pages[n].start);
  };
  const turnPage = (dir: number) => {
    if (anim.current || turnRef.current || busy || selection || editing) return;
    if (closed) {
      if (dir > 0) openClose();
      return;
    }
    if (!canTurn(dir)) return;
    const value: Turn = { dir, p: 0, kind: "page" };
    animate(value, 1, 720, () => finish(value));
  };
  const openClose = () => {
    if (anim.current || busy) return;
    const value: Turn = {
      dir: 1,
      p: closed ? 0 : 1,
      kind: closed ? "open" : "close",
    };
    animate(value, closed ? 1 : 0, closed ? 1100 : 950, () => finish(value));
  };
  function down(e: ReactPointerEvent) {
    if (
      selectMode ||
      s.turn === "Scroll" ||
      anim.current ||
      turnRef.current ||
      selection ||
      editing ||
      (e.target as HTMLElement).closest("button,a,[data-highlight]")
    )
      return;
    if (e.pointerType === 'mouse' && (e.target as HTMLElement).closest('.page-text')) return;
    const r = box.current!.getBoundingClientRect();
    drag.current = {
      x: e.clientX,
      y: e.clientY,
      rel: (e.clientX - r.left) / r.width,
      dx: 0,
      started: false,
      dir: 1,
      pointerId: e.pointerId,
    };
    // Capture after a horizontal drag begins, preserving taps on highlights.
  }
  function move(e: ReactPointerEvent) {
    const bounds = box.current?.getBoundingClientRect();
    if (bounds) pointerY.current = (e.clientY - bounds.top) / bounds.height;
    const d = drag.current;
    if (!d) return;
    d.dx = e.clientX - d.x;
    if (
      !d.started &&
      Math.abs(e.clientY - d.y) > Math.abs(d.dx) &&
      Math.abs(e.clientY - d.y) > 8
    ) {
      drag.current = null;
      return;
    }
    if (!d.started && Math.abs(d.dx) > 8 && !closed) {
      d.dir = d.dx < 0 ? 1 : -1;
      if (!canTurn(d.dir)) return;
      d.started = true;
      e.currentTarget.setPointerCapture(e.pointerId);
    }
    if (d.started) {
      const p = Math.max(0, Math.min(1, (-d.dx * d.dir) / (g.pw * 1.05)));
      updateTurn({ kind: "page", dir: d.dir, p });
      curl.current?.draw(
        spread ? p : d.dir === 1 ? p : 1 - p,
        pointerY.current,
      );
    }
  }
  function up(e: ReactPointerEvent) {
    const d = drag.current;
    drag.current = null;
    if (!d) return;
    if (d.started) {
      const value = turnRef.current!;
      const commit = value.p > 0.28;
      animate(value, commit ? 1 : 0, commit ? 560 : 380, () => {
        if (commit) finish(value);
      });
      return;
    }
    if (Math.abs(d.dx) > 8) return;
    if (closed) {
      openClose();
      return;
    }
    if (spread) {
      turnPage(d.rel < 0.5 ? -1 : 1);
    } else if (d.rel < 0.3) turnPage(-1);
    else if (d.rel > 0.62) turnPage(1);
    else setChrome((c) => !c);
  }
  function onSelect() {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || !sel.rangeCount) return;
    const r = sel.getRangeAt(0);
    if (!root.current?.contains(r.commonAncestorContainer)) return;
    const get = (node: Node, offset: number): Anchor | null => {
      const el = (
        node.nodeType === 3 ? node.parentElement : (node as HTMLElement)
      )?.closest<HTMLElement>("[data-offset]");
      if (!el) return null;
      const range = document.createRange();
      range.setStart(el, 0);
      try {
        range.setEnd(node, offset);
      } catch {
        return null;
      }
      return {
        section: Number(el.dataset.section),
        block: Number(el.dataset.block),
        offset: Number(el.dataset.offset) + range.toString().length,
      };
    };
    const sa = get(r.startContainer, r.startOffset),
      ea = get(r.endContainer, r.endOffset);
    if (sa && ea && sel.toString().trim()) {
      const bounds = r.getBoundingClientRect();
      setSelectionPoint({
        x: bounds.left + bounds.width / 2,
        y: Math.max(70, Math.min(window.innerHeight - 170, bounds.bottom + 12)),
      });
      setSelection({ start: sa, end: ea, quote: sel.toString().trim() });
      setNote("");
    }
  }
  const saveHighlight = async (color: Color) => {
    if (!selection) return;
    await l.saveAnnotation({
      id: crypto.randomUUID(),
      bookId: book.id,
      kind: "highlight",
      range: { start: selection.start, end: selection.end },
      quote: selection.quote,
      color,
      note,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      review: { due: Date.now() + 86400000, interval: 1 },
    });
    setSelection(null);
    setNote("");
    window.getSelection()?.removeAllRanges();
  };
  const bookmark = () => {
    const existing = bookmarked;
    void l.saveAnnotation(
      existing
        ? { ...existing, deleted: true }
        : {
            id: crypto.randomUUID(),
            bookId: book.id,
            kind: "bookmark",
            range: { start: first?.start || anchor, end: first?.start || anchor },
            quote: `Page ${a}`,
            color: "pink",
            note: "",
            createdAt: Date.now(),
            updatedAt: Date.now(),
          },
    );
  };
  const jump = (at: Anchor) => {
    commitAnchor(at);
    setClosed(false);
    setPanel(null);
  };
  const fullscreen = async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await document.documentElement.requestFullscreen();
    } catch {
      setFull((v) => !v);
    }
  };
  const results = useMemo(() => {
    if (search.trim().length < 2) return [];
    const q = search.toLowerCase(),
      out: { at: Anchor; text: string }[] = [];
    book.sections.forEach((sec, section) =>
      sec.blocks.forEach((b, block) => {
        if (!hasReadableContent(b)) return;
        const text = b.text || "";
        let offset = text.toLowerCase().indexOf(q);
        while (offset >= 0 && out.length < 60) {
          out.push({
            at: { section, block, offset },
            text: text.slice(Math.max(0, offset - 45), offset + q.length + 100),
          });
          offset = text.toLowerCase().indexOf(q, offset + q.length);
        }
      }),
    );
    return out;
  }, [search, book]);
  useEffect(() => {
    if (panel !== "original" || !book.sourcePdfBlobId) return;
    let alive = true,
      url = "";
    l.loadBlob(book.sourcePdfBlobId)
      .then((blob) => {
        if (blob && alive) {
          url = URL.createObjectURL(blob);
          setOriginalUrl(url);
        }
      })
      .catch((e) => setMessage(e.message));
    return () => {
      alive = false;
      URL.revokeObjectURL(url);
      setOriginalUrl("");
    };
  }, [panel, book.sourcePdfBlobId, l.loadBlob]);
  const P = (n: number) => pages[n] || null;
  let ul: ScreenPage | null = null,
    ur: ScreenPage | null = null,
    front: ScreenPage | null = null,
    back: ScreenPage | null = null,
    frontCover = false,
    urCover = false,
    backInside = false,
    hasLeaf = false;
  let shift = closed && spread ? -g.pw / 2 : 0,
    forward = turn?.dir !== -1;
  if (turn && turn.kind !== "page") {
    ur = spread ? P(index + 1) : P(index);
    frontCover = true;
    back = spread ? P(index) : null;
    backInside = !spread;
    hasLeaf = true;
    shift = spread ? (-g.pw / 2) * (1 - turn.p) : 0;
  } else if (closed) {
    urCover = true;
  } else if (turn) {
    hasLeaf = true;
    if (spread) {
      if (forward) {
        ul = P(index);
        ur = P(index + 3);
        front = P(index + 1);
        back = P(index + 2);
      } else {
        ul = P(index - 2);
        ur = P(index + 1);
        front = P(index);
        back = P(index - 1);
      }
    } else {
      ur = forward ? P(index + 1) : P(index);
      front = forward ? P(index) : P(index - 1);
    }
  } else {
    ul = spread ? P(index) : null;
    ur = spread ? P(index + 1) : P(index);
  }
  const q = turn ? (spread ? turn.p : forward ? turn.p : 1 - turn.p) : 0,
    qs = Math.sin(q * Math.PI),
    frontOpacity = !turn
      ? 1
      : reduced
        ? 1 - turn.p
        : turn.kind === "page" &&
            s.turn !== "Slide" &&
            !spread &&
            !fill &&
            q > 0.55
          ? Math.max(0, 1 - (q - 0.55) / 0.45)
          : 1;
  const stacks = (n: number, dir: number) =>
    Array.from(
      { length: n },
      (_, i) =>
        `${dir * (i + 1) * 1.6}px ${(i + 1) * 0.6}px 0 ${i % 2 ? t.page : t.edge}`,
    );
  const stack = [
    ...(spread && !closed ? stacks(1 + Math.round(info.pct * 6), -1) : []),
    ...stacks(1 + Math.round((1 - info.pct) * 6), 1),
    "0 1px 2px rgba(40,28,14,.08)",
    "0 8px 18px rgba(40,28,14,.08)",
    "0 26px 56px rgba(40,28,14,.12)",
  ].join(",");
  const foldW = Math.round(Math.max(40, Math.min(84, g.pw * 0.12))),
    [k, hi] = {
      Paper: [0.55, 0.2],
      Sepia: [0.58, 0.16],
      Dusk: [0.85, 0.04],
      Night: [0.95, 0.025],
    }[s.paper];
  const foldBg = `linear-gradient(to right,transparent 0%,rgba(0,0,0,${0.035 * k}) 22%,rgba(0,0,0,${0.1 * k}) 38%,rgba(0,0,0,${0.22 * k}) 46%,rgba(0,0,0,${0.34 * k}) 49.2%,rgba(0,0,0,${0.34 * k}) 50.8%,rgba(0,0,0,${0.2 * k}) 54%,rgba(0,0,0,${0.08 * k}) 63%,rgba(0,0,0,${0.025 * k}) 80%,transparent 100%)`;
  const renderPage = (
    page: ScreenPage | null,
    side: "left" | "right" | "single",
    extra: Partial<React.ComponentProps<typeof Page>> = {},
  ) => (
    <Page
      page={page}
      book={book}
      g={g}
      settings={s}
      side={side}
      annotations={annotations}
      loadBlob={l.loadBlob}
      onAnnotation={(a) => {
        setEditing(a);
        setNote(a.note);
      }}
      {...extra}
    />
  );
  const warm =
    s.warmLight && (new Date().getHours() >= 19 || new Date().getHours() < 6);
  return (
    <div
      className={`reader ${phone ? "phone-reader" : ""} ${fill ? "fill-reader" : ""} ${full ? "is-full" : ""} ${selectMode ? "selecting" : ""}`}
      style={
        {
          background: t.desk,
          color: t.muted,
          "--reader-page": t.page,
          "--reader-ink": t.ink,
          "--reader-desk": t.desk,
          "--reader-chip": t.chip,
          "--reader-on": t.on,
          "--reader-accent": t.accent,
        } as CSSProperties
      }
    >
      {!full && (
        <header
          className={`reader-header ${phone && !chrome ? "chrome-hidden" : ""}`}
        >
          <button
            className="icon-button"
            aria-label="Back to library"
            onClick={() => navigate("/")}
          >
            <Icon name="back" />
          </button>
          <div className="reader-title">
            {book.title} · {book.sections[visibleAnchor.section]?.title}
          </div>
          <div className="layout-control">
            <Segments
              label="Page layout"
              value={s.wideLayout === "spread" ? "Two pages" : "One page"}
              options={["Two pages", "One page"]}
              onChange={(v) =>
                void l.saveSettings({
                  ...s,
                  wideLayout: v === "Two pages" ? "spread" : "single",
                })
              }
            />
          </div>
          <nav aria-label="Reader tools">
            {book.sourcePdfBlobId && <button className="button small" onClick={()=>void l.saveReadingMode(book,'original')}>Original layout</button>}
            <button
              className="icon-button desktop-tool"
              aria-label="Contents and go to page"
              onClick={() => setPanel("contents")}
            >
              <Icon name="contents" />
            </button>
            <button
              className="icon-button desktop-tool"
              aria-label="Search in book"
              onClick={() => setPanel("search")}
            >
              <Icon name="search" />
            </button>
            <button
              className="icon-button"
              aria-label="Notebook"
              onClick={() => navigate(`/book/${book.id}/notebook`)}
            >
              <Icon name="notebook" />
            </button>
            <button
              className="icon-button aa"
              aria-label="Type and comfort settings"
              onClick={() => setPanel("comfort")}
            >
              Aa
            </button>
            <button
              className="icon-button desktop-tool"
              aria-label="Close or open the book"
              onClick={openClose}
            >
              <Icon name="book" />
            </button>
            <button
              className="icon-button desktop-tool"
              aria-label="Full screen"
              onClick={fullscreen}
            >
              <Icon name="full" />
            </button>
          </nav>
        </header>
      )}
      <main className="reader-main">
        <div
          ref={root}
          className="book-root"
          tabIndex={0}
          aria-label="Book. Arrow keys turn pages."
          onKeyDown={(e) => {
            if ((e.target as HTMLElement).closest("input,textarea,button"))
              return;
            if (["ArrowRight", "PageDown", " "].includes(e.key)) {
              e.preventDefault();
              turnPage(1);
            }
            if (["ArrowLeft", "PageUp"].includes(e.key)) {
              e.preventDefault();
              turnPage(-1);
            }
          }}
          onMouseUp={onSelect}
          onKeyUp={onSelect}
          onTouchEnd={() => setTimeout(onSelect, 80)}
        >
          {busy && (
            <div className="pagination-status" role="status">
              Setting your pages…
            </div>
          )}
          {s.turn === "Scroll" && !closed ? (
            <ScrollReader
              book={book}
              settings={s}
              anchor={anchor}
              onProgress={commitAnchor}
              annotations={annotations}
              loadBlob={l.loadBlob}
              onAnnotation={(a) => {
                setEditing(a);
                setNote(a.note);
              }}
            />
          ) : (
            <div
              ref={box}
              className="book-box"
              style={
                {
                  "--turn-q": q,
                  "--turn-sin": qs,
                  "--fold-opacity": closed ? 0 : 1,
                  width: g.bookW,
                  height: g.bookH,
                  transform: `translateX(${shift}px)`,
                  perspective: g.bookW * 2.2,
                  touchAction: selectMode ? "auto" : "pan-y",
                } as CSSProperties
              }
              onPointerDown={down}
              onPointerMove={move}
              onPointerUp={up}
              onPointerCancel={() => {
                drag.current = null;
                if (turnRef.current && !anim.current) updateTurn(null);
              }}
              onClick={(e) => {
                if ((e.target as HTMLElement).closest("[data-highlight]"))
                  return;
                if (e.detail === 1 && closed) openClose();
              }}
            >
              <div
                className="book-backdrop"
                style={{
                  left: spread && closed ? g.pw : 0,
                  width: spread && !closed ? g.bookW : g.pw,
                  boxShadow: fill ? "none" : stack,
                }}
              />
              {ul && (
                <div className="under-page" style={{ left: 0, width: g.pw }}>
                  {renderPage(ul, "left")}
                </div>
              )}
              {(ur || urCover) && (
                <div
                  className="under-page"
                  style={{ left: spread ? g.pw : 0, width: g.pw }}
                >
                  {renderPage(ur, spread ? "right" : "single", {
                    cover: urCover,
                  })}
                  <div
                    className="page-shade"
                    style={{
                      background: turn
                        ? `linear-gradient(to right,rgba(40,28,14,${0.11 * qs}),transparent 80%)`
                        : "none",
                    }}
                  />
                </div>
              )}
              {fill && !closed && <div className="fill-stack" />}
              {spread && (!closed || (turn && turn.kind !== "page")) && (
                <>
                  <div
                    className="center-fold"
                    style={{
                      left: g.pw - foldW / 2,
                      width: foldW,
                      background: foldBg,
                    }}
                  />
                  <div
                    className="crease-highlight"
                    style={{
                      left: g.pw - foldW * 0.18,
                      width: foldW * 0.36,
                      background: `linear-gradient(to right,transparent,rgba(255,255,255,${hi}) 14%,transparent 30%,transparent 70%,rgba(255,255,255,${hi * 0.8}) 86%,transparent)`,
                    }}
                  />
                  <div
                    className="spine-hairline"
                    style={{ left: g.pw - 0.5 }}
                  />
                  {!fill && (
                    <div
                      className="contact-dip"
                      style={{ left: g.pw - foldW, width: foldW * 2 }}
                    />
                  )}
                </>
              )}
              {hasLeaf && (
                <div
                  ref={leaf}
                  className={`turning-leaf ${reduced ? "reduced-leaf" : ""}`}
                  style={{
                    left: spread && forward ? g.pw : 0,
                    width: g.pw,
                    transformOrigin:
                      spread && !forward ? "right center" : "left center",
                    transform:
                      s.turn === "Slide"
                        ? `translateX(${-turn!.dir * turn!.p * 100}%)`
                        : `rotateY(${(spread && !forward ? 180 : -180) * q}deg)`,
                  }}
                >
                  <div className="leaf-face" style={{ opacity: frontOpacity }}>
                    {renderPage(
                      front,
                      spread ? (forward ? "right" : "left") : "single",
                      { cover: frontCover, decorative: true },
                    )}
                    <div
                      className="page-shade"
                      style={{
                        background: `linear-gradient(${spread && !forward ? "to right" : "to left"},rgba(40,28,14,${0.14 * q}),rgba(255,250,240,${0.07 * qs}) 24%,transparent 60%)`,
                      }}
                    />
                  </div>
                  {!reduced && s.turn !== "Slide" && (
                    <div className="leaf-face leaf-back">
                      {renderPage(
                        back,
                        spread ? (forward ? "left" : "right") : "single",
                        { inside: backInside, decorative: true },
                      )}
                      <div
                        className="page-shade"
                        style={{
                          background: `linear-gradient(to right,rgba(40,28,14,${0.15 * (1 - q)}),transparent 62%)`,
                        }}
                      />
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
          {(
            <footer
              className="book-footer"
              style={{ width: fill ? Math.min(g.bookW, 760) - 24 : g.bookW }}
            >
              <button
                className="icon-button"
                aria-label="Previous page"
                disabled={closed || index === 0}
                onClick={() => turnPage(-1)}
              >
                <Icon name="back" size={18} />
              </button>
              <div className="footer-content">
                <div className="reader-progress">
                  <div
                    style={{ width: `${info.pct * 100}%`, background: t.ink }}
                  />
                </div>
                <div className="footer-labels">
                  <span aria-live="polite">
                    {closed
                      ? `Closed · resume at p. ${a}`
                      : `${a === b ? "p." : "pp."} ${a === b ? a : `${a}–${b}`} of ${book.printPageCount}`}
                  </span>
                  <span>
                    {closed
                      ? "Tap the cover to open"
                      : `${info.minutes} min left in chapter`}
                  </span>
                </div>
              </div>
              <button
                className="icon-button"
                aria-label={closed ? "Open book" : "Next page"}
                disabled={!closed && !canTurn(1)}
                onClick={() => turnPage(1)}
              >
                <Icon name="next" size={18} />
              </button>
            </footer>
          )}
        </div>
        {!closed && (
          <div className="reader-bottom-tools">
            <button onClick={bookmark} aria-label={bookmarked ? 'Remove bookmark' : 'Bookmark this passage'} aria-pressed={!!bookmarked}>
              <Icon name="bookmark" size={16} />
            </button>
            <button
              aria-pressed={selectMode}
              aria-label={selectMode ? "Done selecting" : "Highlight / note"}
              onClick={() => { setSelectMode((v) => !v); if (!selectMode) setMessage("Select a passage, then choose a highlight color or Note."); }}
            >
              {selectMode ? (phone ? "Done" : "Done selecting") : (phone ? "Annotate" : "Highlight / note")}
            </button>
            {(compact || full) && (
              <>
                <button onClick={() => setPanel("contents")}>Contents</button>
                <button onClick={() => setPanel("search")}>Search</button>
              </>
            )}
            {full && <>
              <button onClick={() => setPanel('comfort')} aria-label="Type and comfort settings">Aa</button>
              <button onClick={() => navigate(`/book/${book.id}/notebook`)}>Notebook</button>
            </>}
            {compact && !full && <button onClick={fullscreen} aria-label="Full screen"><Icon name="full" size={16}/></button>}
            {book.sourcePdfBlobId && (!phone || full) && (
              <button onClick={() => setPanel("original")}>Original PDF</button>
            )}
            <span title={l.status}>
              {l.guest ? "Public-domain classics" : l.status}
            </span>
          </div>
        )}
        {full && (
          <button
            className="exit-full icon-button"
            aria-label="Exit full screen"
            onClick={fullscreen}
          >
            <Icon name="full" />
          </button>
        )}
      </main>
      {warm && <div className="warm-overlay" />}
      {message && (
        <button className="toast" onClick={() => setMessage("")}>
          {message}
        </button>
      )}
      {panel === "comfort" && (
        <Comfort
          settings={s}
          onChange={(v) => void l.saveSettings(v)}
          onClose={() => setPanel(null)}
        />
      )}
      {panel === "contents" && (
        <Modal title="Contents & go to page" onClose={() => setPanel(null)}>
          <form
            className="go-page"
            onSubmit={(e) => {
              e.preventDefault();
              const mark = book.pageMarks.find(
                (m) => m.label.toLowerCase() === goPage.trim().toLowerCase(),
              );
              if (mark) jump(mark.at);
              else setMessage("That printed page was not found in this book.");
            }}
          >
            <label>
              Print page
              <input
                value={goPage}
                onChange={(e) => setGoPage(e.target.value)}
                placeholder="113 or ix"
              />
            </label>
            <button className="button primary">Go</button>
          </form>
          <div className="contents-list">
            {book.sections.map((section, i) => (
              <button
                key={section.id}
                onClick={() => jump({ section: i, block: 0, offset: 0 })}
              >
                <span>{section.title}</span>
                <small>
                  p. {labelAt(book, { section: i, block: 0, offset: 0 })}
                </small>
              </button>
            ))}
          </div>
        </Modal>
      )}
      {panel === "search" && (
        <Modal title="Search in book" onClose={() => setPanel(null)}>
          <input
            autoFocus
            type="search"
            placeholder="Find a passage"
            aria-label="Search in book"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <div className="search-results">
            {results.map((r, i) => (
              <button key={i} onClick={() => jump(r.at)}>
                <small>p. {labelAt(book, r.at)}</small>
                <p>…{r.text}…</p>
              </button>
            ))}
            {search.length > 1 && !results.length && <p>No passages found.</p>}
          </div>
        </Modal>
      )}
      {panel === "original" && (
        <Modal
          title={`Original · p. ${a}`}
          className="original-modal"
          onClose={() => setPanel(null)}
        >
          {originalUrl ? (
            <>
              <iframe
                title="Original PDF"
                src={`${originalUrl}#page=${(book.pageMarks.find((m) => m.label === a)?.index || 0) + 1}`}
              />
              <a
                className="button"
                href={originalUrl}
                download={`${book.title}.pdf`}
              >
                Download original PDF
              </a>
            </>
          ) : (
            <p>Downloading your PDF…</p>
          )}
        </Modal>
      )}
      {selection && (
        <SelectionToolbar
          quote={selection.quote}
          note={note}
          onNote={setNote}
          position={selectionPoint}
          onColor={(c) => void saveHighlight(c)}
          onClose={() => {
            setSelection(null);
            window.getSelection()?.removeAllRanges();
          }}
          onSearch={() => {
            setSearch(selection.quote);
            setSelection(null);
            setPanel("search");
          }}
        />
      )}
      {editing && (
        <SelectionToolbar
          selectedColor={editing.color}
          quote={editing.quote}
          note={note}
          onNote={setNote}
          position={selectionPoint}
          onColor={(color) => {
            void l.saveAnnotation({ ...editing, color, note });
            setEditing(null);
          }}
          onDelete={() => {
            void l.saveAnnotation({ ...editing, deleted: true });
            setEditing(null);
          }}
          onClose={() => setEditing(null)}
          onSearch={() => {
            setSearch(editing.quote);
            setEditing(null);
            setPanel("search");
          }}
        />
      )}
    </div>
  );
}
