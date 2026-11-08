import { describe, expect, it } from "vitest";
import { isWarmHour, shouldHoldWakeLock } from "@/lib/readwind/reader-care";

const at = (hour: number, minute = 0) => new Date(2026, 10, 6, hour, minute);

describe("isWarmHour", () => {
  it("switches on at 7pm and stays on overnight", () => {
    expect(isWarmHour(at(18, 59))).toBe(false);
    expect(isWarmHour(at(19, 0))).toBe(true);
    expect(isWarmHour(at(23, 30))).toBe(true);
    expect(isWarmHour(at(0, 15))).toBe(true);
  });
  it("switches off at 6am", () => {
    expect(isWarmHour(at(5, 59))).toBe(true);
    expect(isWarmHour(at(6, 0))).toBe(false);
    expect(isWarmHour(at(12, 0))).toBe(false);
  });
});

describe("screen wake policy", () => {
  it("holds only while an open reader is visible and recently used", () => {
    expect(shouldHoldWakeLock(true, true, 100, 1000)).toBe(true);
    expect(shouldHoldWakeLock(false, true, 100, 1000)).toBe(false);
    expect(shouldHoldWakeLock(true, false, 100, 1000)).toBe(false);
    expect(shouldHoldWakeLock(true, true, 1000, 1000)).toBe(false);
    expect(shouldHoldWakeLock(true, true, -1, 1000)).toBe(false);
  });
});
