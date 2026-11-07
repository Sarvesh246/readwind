/**
 * Paints the sentence (and word) being read aloud with the CSS Custom Highlight API. Highlights are
 * painted by the browser over existing text, so the memoized pages never re-render per sentence.
 * Browsers without the API simply show no highlight; playback is unaffected.
 */
type HighlightRegistry = { set(name: string, h: unknown): void; delete(name: string): void };
type HighlightCtor = new (...ranges: Range[]) => unknown;
const registry = () => (globalThis.CSS as unknown as { highlights?: HighlightRegistry } | undefined)?.highlights;
const Ctor = () => (globalThis as unknown as { Highlight?: HighlightCtor }).Highlight;
export const canHighlight = () => !!registry() && !!Ctor();

/** DOM ranges covering source characters `[start, end)` of one block, across every rendered copy. */
export function rangesFor(root: Element, section: number, block: number, start: number, end: number): Range[] {
  const out: Range[] = [];
  if (end <= start) return out;
  const spans = root.querySelectorAll<HTMLElement>(`[data-section="${section}"][data-block="${block}"][data-offset]`);
  for (const span of spans) {
    const base = Number(span.dataset.offset);
    const walker = document.createTreeWalker(span, NodeFilter.SHOW_TEXT);
    let pos = base;
    for (let node = walker.nextNode() as Text | null; node; node = walker.nextNode() as Text | null) {
      const from = pos,
        to = pos + node.data.length;
      pos = to;
      const a = Math.max(start, from),
        b = Math.min(end, to);
      if (a >= b) continue;
      const r = document.createRange();
      r.setStart(node, a - from);
      r.setEnd(node, b - from);
      out.push(r);
    }
  }
  return out;
}

export function paintHighlight(name: string, ranges: Range[]) {
  const reg = registry(),
    H = Ctor();
  if (!reg || !H) return;
  if (ranges.length) reg.set(name, new H(...ranges));
  else reg.delete(name);
}
export const clearHighlight = (name: string) => registry()?.delete(name);

/** Source offset under a point, for "read from here". */
export function offsetAtPoint(x: number, y: number): { section: number; block: number; offset: number } | null {
  type CaretDoc = Document & {
    caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null;
    caretRangeFromPoint?: (x: number, y: number) => Range | null;
  };
  const doc = document as CaretDoc;
  let node: Node | null = null,
    offset = 0;
  const pos = doc.caretPositionFromPoint?.(x, y);
  if (pos) {
    node = pos.offsetNode;
    offset = pos.offset;
  } else {
    const r = doc.caretRangeFromPoint?.(x, y);
    if (r) {
      node = r.startContainer;
      offset = r.startOffset;
    }
  }
  if (!node || node.nodeType !== Node.TEXT_NODE) return null;
  const span = (node.parentElement as HTMLElement | null)?.closest<HTMLElement>("[data-offset][data-section][data-block]");
  if (!span) return null;
  let before = 0;
  const walker = document.createTreeWalker(span, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n && n !== node; n = walker.nextNode()) before += (n as Text).data.length;
  return { section: Number(span.dataset.section), block: Number(span.dataset.block), offset: Number(span.dataset.offset) + before + offset };
}
