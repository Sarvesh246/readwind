// iOS puts its native selection menu below a selection in the top half of the
// screen and above a selection in the bottom half. The page can't hide that
// menu, so our toolbar takes the opposite side and never sits under it.

export type SelectionAnchor = {
  x: number;
  y: number; // legacy: just below the selection
  top?: number;
  bottom?: number;
};

export type ToolbarSide = "above" | "below";

// Clears the native selection handles, which stick out past the text.
export const HANDLE_CLEARANCE = 32;
const MARGIN = 12;

export function nativeMenuSide(
  top: number,
  bottom: number,
  viewportHeight: number,
): ToolbarSide {
  return (top + bottom) / 2 < viewportHeight / 2 ? "below" : "above";
}

export function placeToolbar({
  anchor,
  height,
  viewportHeight,
}: {
  anchor: SelectionAnchor | null;
  height: number;
  viewportHeight: number;
}): { top: number; side: ToolbarSide } {
  const min = MARGIN;
  const max = Math.max(min, viewportHeight - height - MARGIN);
  const clamp = (v: number) => Math.max(min, Math.min(max, v));
  if (!anchor)
    return { top: clamp(viewportHeight - height - 90), side: "below" };
  if (anchor.top === undefined || anchor.bottom === undefined) {
    return { top: clamp(anchor.y), side: "below" };
  }
  const native = nativeMenuSide(anchor.top, anchor.bottom, viewportHeight);
  const above = anchor.top - HANDLE_CLEARANCE - height;
  const below = anchor.bottom + HANDLE_CLEARANCE;
  const fits = (side: ToolbarSide) =>
    side === "above" ? above >= min : below <= max;
  const preferred: ToolbarSide = native === "below" ? "above" : "below";
  const other: ToolbarSide = preferred === "above" ? "below" : "above";
  // If the opposite side is cramped (tall selection, tiny viewport) fall back
  // rather than clamping the toolbar on top of the text.
  const side = fits(preferred) ? preferred : fits(other) ? other : preferred;
  return { top: clamp(side === "above" ? above : below), side };
}
