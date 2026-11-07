import { describe, it, expect } from "vitest";
import { addActivity, mergeReadingLog } from "../lib/readwind/reading-log";
import { setGoal, goalOn, todayGoal, weekOf, monthOf, finishPlan, mostlyListening, weekDays } from "../lib/readwind/goals";
import { settings } from "../lib/readwind/schemas";
import { defaults } from "../lib/readwind/types";

const at = (day: string, h = 12) => new Date(`${day}T${String(h).padStart(2, "0")}:00:00`);

describe("goal definitions", () => {
  it("judges past days by the goal that applied then", () => {
    let g = setGoal(undefined, { unit: "minutes", target: 20 }, "2026-11-01");
    g = setGoal(g, { unit: "pages", target: 10 }, "2026-11-05");
    expect(goalOn(g, "2026-10-31")).toBeNull();
    expect(goalOn(g, "2026-11-03")).toEqual({ unit: "minutes", target: 20 });
    expect(goalOn(g, "2026-11-06")).toEqual({ unit: "pages", target: 10 });
  });
  it("replaces a same-day change instead of stacking it, and clamps targets", () => {
    let g = setGoal(undefined, { unit: "minutes", target: 20 }, "2026-11-06");
    g = setGoal(g, { unit: "minutes", target: 9999 }, "2026-11-06");
    expect(g.history).toHaveLength(1);
    expect(g.target).toBe(600);
  });
  it("passes the settings schema", () => {
    const g = setGoal(undefined, { unit: "minutes", target: 30, weeklyDays: 4 }, "2026-11-06");
    expect(settings.parse({ ...defaults, goals: g }).goals).toEqual(g);
  });
});

describe("goal progress", () => {
  const goals = setGoal(undefined, { unit: "minutes", target: 20, weeklyDays: 2 }, "2026-11-01");
  it("counts listening toward the same goal as reading", () => {
    let log = addActivity({}, "phone", { pages: 3, words: 700, seconds: 600 }, at("2026-11-06"));
    log = addActivity(log, "phone", { pages: 2, words: 500, seconds: 660, listenSeconds: 660 }, at("2026-11-06"));
    const t = todayGoal(goals, log, "2026-11-06")!;
    expect(t.value).toBeCloseTo(21);
    expect(t.met).toBe(true);
  });
  it("fills a Monday-first week and knows when the weekly rhythm is done", () => {
    expect(weekDays("2026-11-06")[0]).toBe("2026-11-02");
    let log = addActivity({}, "d", { pages: 5, words: 1500, seconds: 1300 }, at("2026-11-02"));
    log = addActivity(log, "d", { pages: 1, words: 200, seconds: 120 }, at("2026-11-03"));
    log = addActivity(log, "d", { pages: 5, words: 1500, seconds: 1300 }, at("2026-11-04"));
    const w = weekOf(goals, log, "2026-11-06");
    expect(w.cells.map(c => c.state)).toEqual(["met", "read", "met", "missed", "today", "future", "future"]);
    expect(w.done).toBe(true);
  });
  it("marks month days met, read or none", () => {
    const log = addActivity({}, "d", { pages: 5, words: 1500, seconds: 1300 }, at("2026-11-02"));
    const cells = monthOf(goals, log, 2026, 10, "2026-11-06");
    // 1 November 2026 is a Sunday, the last column of a Monday-first week.
    expect(cells.slice(0, 7)).toEqual([null, null, null, null, null, null, { day: "2026-11-01", state: "none" }]);
    expect(cells[7]).toEqual({ day: "2026-11-02", state: "met" });
    expect(cells.at(-1)).toEqual({ day: "2026-11-30", state: "future" });
  });
  it("keeps listening time through a device merge", () => {
    const a = addActivity({}, "d", { pages: 1, words: 300, seconds: 100, listenSeconds: 100 }, at("2026-11-06"));
    const merged = mergeReadingLog(a, a);
    expect(Object.values(merged)[0].listenSeconds).toBe(100);
    expect(mostlyListening(merged, "2026-11-06")).toBe(true);
  });
});

describe("finish-by plans", () => {
  it("spreads the remaining words over the days left, counting today", () => {
    expect(finishPlan(23000, 230, "2026-11-10", "2026-11-06")).toMatchObject({ daysLeft: 5, minutesPerDay: 20, overdue: false });
  });
  it("flags plans far beyond the usual daily time and past dates", () => {
    expect(finishPlan(60000, 200, "2026-11-07", "2026-11-06", 15).unrealistic).toBe(true);
    expect(finishPlan(1000, 200, "2026-11-01", "2026-11-06").overdue).toBe(true);
  });
});
