import { describe, expect, it } from "vitest";
import { HANDLE_CLEARANCE, nativeMenuSide, placeToolbar } from "@/lib/readwind/selection-placement";

const vh = 800;
const h = 52;

describe("selection toolbar placement", () => {
  it("guesses the native menu is below in the top half and above in the bottom half", () => {
    expect(nativeMenuSide(100, 140, vh)).toBe("below");
    expect(nativeMenuSide(600, 640, vh)).toBe("above");
  });

  it("puts our toolbar above a top-half selection", () => {
    const r = placeToolbar({ anchor: { x: 200, y: 352, top: 300, bottom: 340 }, height: h, viewportHeight: vh });
    expect(r.side).toBe("above");
    expect(r.top + h).toBeLessThanOrEqual(300 - HANDLE_CLEARANCE);
  });

  it("puts our toolbar below a bottom-half selection", () => {
    const r = placeToolbar({ anchor: { x: 200, y: 652, top: 500, bottom: 640 }, height: h, viewportHeight: vh });
    expect(r.side).toBe("below");
    expect(r.top).toBeGreaterThanOrEqual(640 + HANDLE_CLEARANCE);
  });

  it("always lands on the opposite side across the whole viewport when there is room", () => {
    for (let top = 160; top <= 560; top += 10) {
      const bottom = top + 40;
      const r = placeToolbar({ anchor: { x: 0, y: bottom, top, bottom }, height: h, viewportHeight: vh });
      expect(r.side).toBe(nativeMenuSide(top, bottom, vh) === "below" ? "above" : "below");
    }
  });

  it("falls back to the other side when the opposite side has no room", () => {
    const r = placeToolbar({ anchor: { x: 0, y: 60, top: 20, bottom: 50 }, height: h, viewportHeight: vh });
    expect(r.side).toBe("below");
    expect(r.top).toBeGreaterThanOrEqual(50);
  });

  it("stays inside the viewport and handles missing anchors", () => {
    const r = placeToolbar({ anchor: { x: 0, y: 790, top: 760, bottom: 790 }, height: h, viewportHeight: vh });
    expect(r.top).toBeLessThanOrEqual(vh - h - 12);
    expect(placeToolbar({ anchor: null, height: h, viewportHeight: vh }).top).toBeGreaterThanOrEqual(12);
    expect(placeToolbar({ anchor: { x: 0, y: 300 }, height: h, viewportHeight: vh }).top).toBe(300);
  });
});
