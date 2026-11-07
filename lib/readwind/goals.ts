import { dailyTotals, dayFromNumber, dayKey, dayNumber, type Day, type ReadingLog } from "./reading-log";

/**
 * Reading goals are definitions only. Progress is always derived from the reading log, so goals add
 * nothing that can conflict between devices, and listening counts exactly like reading because both
 * write the same log.
 */
export type GoalUnit = "minutes" | "pages";
export type GoalStep = { from: string; unit: GoalUnit; target: number };
export type Goals = {
  unit: GoalUnit;
  target: number;
  /** Days per week the goal should be met; missing the rest is fine. */
  weeklyDays: number;
  /** Every change, so past days are judged against the goal that applied then. */
  history: GoalStep[];
  /** "6 min to today's goal" beside the page position. */
  showInReader?: boolean;
  /** A quiet toast at the next page turn once today's goal is met. */
  celebrate?: boolean;
};
export const goalPresets: Record<GoalUnit, number[]> = { minutes: [10, 20, 30, 45], pages: [5, 10, 20, 30] };
export const MAX_GOAL: Record<GoalUnit, number> = { minutes: 600, pages: 500 };

const clampTarget = (unit: GoalUnit, target: number) => Math.max(1, Math.min(MAX_GOAL[unit], Math.round(target)));

/** Sets the goal from `today` on; earlier days keep the goal they had. */
export function setGoal(
  current: Goals | undefined,
  next: { unit: GoalUnit; target: number; weeklyDays?: number; showInReader?: boolean; celebrate?: boolean },
  today = dayKey(),
): Goals {
  const target = clampTarget(next.unit, next.target);
  const history = (current?.history || []).filter(step => step.from < today);
  history.push({ from: today, unit: next.unit, target });
  return {
    unit: next.unit,
    target,
    weeklyDays: Math.max(1, Math.min(7, Math.round(next.weeklyDays ?? current?.weeklyDays ?? 5))),
    history: history.slice(-200),
    showInReader: next.showInReader ?? current?.showInReader ?? false,
    celebrate: next.celebrate ?? current?.celebrate ?? true,
  };
}

/** The goal that applied on `day`, or null before the first goal was set. */
export function goalOn(goals: Goals | undefined, day: string): { unit: GoalUnit; target: number } | null {
  if (!goals?.history.length) return null;
  let found: GoalStep | undefined;
  for (const step of goals.history) if (step.from <= day && (!found || step.from >= found.from)) found = step;
  return found ? { unit: found.unit, target: found.target } : null;
}

export const amountOf = (day: Day | undefined, unit: GoalUnit) =>
  !day ? 0 : unit === "minutes" ? day.seconds / 60 : day.pages;

export type DayGoal = { day: string; unit: GoalUnit; target: number; value: number; fraction: number; met: boolean };
export function dayGoal(goals: Goals | undefined, days: Map<string, Day>, day: string): DayGoal | null {
  const goal = goalOn(goals, day);
  if (!goal) return null;
  const value = amountOf(days.get(day), goal.unit);
  return { day, ...goal, value, fraction: Math.min(1, value / goal.target), met: value >= goal.target };
}

/** Today's progress, or null with no goal set. */
export function todayGoal(goals: Goals | undefined, log: ReadingLog = {}, today = dayKey()) {
  return dayGoal(goals, dailyTotals(log, today), today);
}

/** Monday-first week containing `today`. */
export function weekDays(today = dayKey()) {
  const n = dayNumber(today);
  const weekday = (new Date(n * 86400000).getUTCDay() + 6) % 7;
  return Array.from({ length: 7 }, (_, i) => dayFromNumber(n - weekday + i));
}

export type WeekCell = { day: string; state: "met" | "read" | "missed" | "today" | "future" };
export function weekOf(goals: Goals | undefined, log: ReadingLog = {}, today = dayKey()) {
  const days = dailyTotals(log, today);
  const cells: WeekCell[] = weekDays(today).map(day => {
    const g = dayGoal(goals, days, day);
    if (g?.met) return { day, state: "met" };
    if (day > today) return { day, state: "future" };
    if (day === today) return { day, state: "today" };
    return { day, state: days.get(day)?.counts ? "read" : "missed" };
  });
  const met = cells.filter(c => c.state === "met").length;
  const needed = goals?.weeklyDays ?? 5;
  return { cells, met, needed, done: met >= needed };
}

export type MonthCell = { day: string; state: "met" | "read" | "none" | "future" } | null;
/** A Monday-first month grid; null cells pad the first week. */
export function monthOf(goals: Goals | undefined, log: ReadingLog = {}, year: number, month: number, today = dayKey()): MonthCell[] {
  const days = dailyTotals(log, today);
  const first = Date.UTC(year, month, 1) / 86400000;
  const length = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const pad = (new Date(first * 86400000).getUTCDay() + 6) % 7;
  const cells: MonthCell[] = Array.from({ length: pad }, () => null);
  for (let i = 0; i < length; i++) {
    const day = dayFromNumber(first + i);
    if (day > today) cells.push({ day, state: "future" });
    else if (dayGoal(goals, days, day)?.met) cells.push({ day, state: "met" });
    else cells.push({ day, state: days.get(day)?.counts ? "read" : "none" });
  }
  return cells;
}

/** Average minutes on days with real reading or listening over the last two weeks. */
export function usualMinutes(log: ReadingLog = {}, today = dayKey()) {
  const days = dailyTotals(log, today);
  const t = dayNumber(today);
  let total = 0,
    count = 0;
  for (let n = t - 14; n < t; n++) {
    const d = days.get(dayFromNumber(n));
    if (d?.counts) {
      total += d.seconds / 60;
      count++;
    }
  }
  return count ? total / count : 0;
}

/** Whether the reader mostly listened over the last week, so a finish-by plan uses the voice's pace. */
export function mostlyListening(log: ReadingLog = {}, today = dayKey()) {
  const cutoff = dayFromNumber(dayNumber(today) - 6);
  let listened = 0,
    all = 0;
  for (const [key, e] of Object.entries(log)) {
    if (key.slice(0, 10) < cutoff) continue;
    all += e.seconds;
    listened += e.listenSeconds || 0;
  }
  return all > 0 && listened / all > 0.5;
}

export type FinishPlan = {
  daysLeft: number;
  minutesPerDay: number;
  overdue: boolean;
  /** More than three times the reader's usual daily time. */
  unrealistic: boolean;
};
/** Daily time needed to finish by a date, counting today; recalculated every day from the remaining words. */
export function finishPlan(remainingWords: number, wpm: number, finishBy: string, today = dayKey(), usual = 0): FinishPlan {
  const daysLeft = dayNumber(finishBy) - dayNumber(today) + 1;
  const minutes = Math.max(0, remainingWords) / Math.max(50, wpm);
  if (daysLeft <= 0) return { daysLeft, minutesPerDay: Math.ceil(minutes), overdue: true, unrealistic: false };
  const minutesPerDay = Math.ceil(minutes / daysLeft);
  return { daysLeft, minutesPerDay, overdue: false, unrealistic: minutesPerDay > 3 * Math.max(usual, 10) };
}

export const unitLabel = (unit: GoalUnit, n: number) =>
  unit === "minutes" ? `${n} min` : `${n} page${n === 1 ? "" : "s"}`;
