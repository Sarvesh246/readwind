/**
 * Daily reading activity behind streaks and stats.
 * Keys are `YYYY-MM-DD.deviceId` so each device only ever grows its own counters and
 * devices merge without conflicts (take the larger counter per key).
 */
export type LogEntry = { pages: number; words: number; seconds: number };
export type ReadingLog = Record<string, LogEntry>;

export const KEEP_DAYS = 730;
export const logKey = /^\d{4}-\d{2}-\d{2}\.[a-zA-Z0-9_-]{1,120}$/;

const pad = (n: number) => String(n).padStart(2, "0");
/** Local calendar day, so "daily" matches the reader's own midnight. */
export function dayKey(date: Date = new Date()) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}
export function dayNumber(key: string) {
  const [y, m, d] = key.split("-").map(Number);
  return Math.round(Date.UTC(y, m - 1, d) / 86400000);
}
export function dayFromNumber(n: number) {
  const d = new Date(n * 86400000);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

function newest(a: LogEntry, b: LogEntry): LogEntry {
  return { pages: Math.max(a.pages, b.pages), words: Math.max(a.words, b.words), seconds: Math.max(a.seconds, b.seconds) };
}
export function pruneLog(log: ReadingLog, today = dayKey()): ReadingLog {
  const cutoff = dayFromNumber(dayNumber(today) - KEEP_DAYS);
  const out: ReadingLog = {};
  for (const [key, value] of Object.entries(log)) if (key.slice(0, 10) >= cutoff) out[key] = value;
  return out;
}
export function mergeReadingLog(a: ReadingLog = {}, b: ReadingLog = {}): ReadingLog {
  const merged: ReadingLog = { ...a };
  for (const [key, entry] of Object.entries(b)) merged[key] = merged[key] ? newest(merged[key], entry) : entry;
  return pruneLog(merged);
}
export function addActivity(log: ReadingLog, device: string, credit: LogEntry, now = new Date()): ReadingLog {
  const key = `${dayKey(now)}.${device}`;
  const old = log[key] || { pages: 0, words: 0, seconds: 0 };
  return pruneLog(
    {
      ...log,
      [key]: {
        pages: old.pages + credit.pages,
        words: Math.round(old.words + credit.words),
        seconds: Math.round(old.seconds + credit.seconds),
      },
    },
    dayKey(now),
  );
}

export type Day = { day: string; pages: number; words: number; seconds: number };
export function dailyTotals(log: ReadingLog = {}): Map<string, Day> {
  const days = new Map<string, Day>();
  for (const [key, e] of Object.entries(log)) {
    const day = key.slice(0, 10);
    const t = days.get(day) || { day, pages: 0, words: 0, seconds: 0 };
    t.pages += e.pages;
    t.words += e.words;
    t.seconds += e.seconds;
    days.set(day, t);
  }
  for (const [day, t] of days) if (t.pages < 1) days.delete(day);
  return days;
}

export type Streak = { current: number; longest: number; readToday: boolean; atRisk: boolean; total: number };
/** A streak survives until the end of the day after the last day read. */
export function streakOf(days: Iterable<string>, today = dayKey()): Streak {
  const nums = [...new Set([...days].map(dayNumber))].sort((a, b) => a - b);
  const set = new Set(nums);
  const t = dayNumber(today);
  const readToday = set.has(t);
  let current = 0;
  for (let n = readToday ? t : t - 1; set.has(n); n--) current++;
  let longest = 0,
    run = 0;
  for (let i = 0; i < nums.length; i++) {
    run = i && nums[i] === nums[i - 1] + 1 ? run + 1 : 1;
    longest = Math.max(longest, run);
  }
  return { current, longest, readToday, atRisk: current > 0 && !readToday, total: nums.length };
}

export type Stats = {
  words: number;
  seconds: number;
  pages: number;
  activeDays: number;
  bestDay?: Day;
  avgSecondsPerDay: number;
  last7: Day[];
  weekdays: number[];
  firstDay?: string;
};
export function statsOf(log: ReadingLog = {}, today = dayKey()): Stats {
  const days = dailyTotals(log);
  let words = 0,
    seconds = 0,
    pages = 0,
    bestDay: Day | undefined,
    firstDay: string | undefined;
  const weekdays = [0, 0, 0, 0, 0, 0, 0];
  for (const d of days.values()) {
    words += d.words;
    seconds += d.seconds;
    pages += d.pages;
    if (!bestDay || d.seconds > bestDay.seconds) bestDay = d;
    if (!firstDay || d.day < firstDay) firstDay = d.day;
    weekdays[new Date(dayNumber(d.day) * 86400000).getUTCDay()] += d.seconds;
  }
  const t = dayNumber(today);
  const last7 = Array.from({ length: 7 }, (_, i) => {
    const day = dayFromNumber(t - 6 + i);
    return days.get(day) || { day, pages: 0, words: 0, seconds: 0 };
  });
  return {
    words,
    seconds,
    pages,
    activeDays: days.size,
    bestDay,
    avgSecondsPerDay: days.size ? seconds / days.size : 0,
    last7,
    weekdays,
    firstDay,
  };
}

/**
 * Turns page movement into credit. A turned page always counts for the streak, but
 * words and time only count when the pace is plausible so flipping can't inflate stats.
 */
export class ActivityTracker {
  private baseline?: { words: number; time: number };
  reset() {
    this.baseline = undefined;
  }
  observe(words: number, time: number): LogEntry | undefined {
    const before = this.baseline;
    if (!before) {
      this.baseline = { words, time };
      return;
    }
    const delta = words - before.words;
    if (delta < 0) {
      this.baseline = { words, time };
      return;
    }
    if (delta < 20) return;
    const seconds = (time - before.time) / 1000;
    this.baseline = { words, time };
    const speed = seconds > 0 ? (delta * 60) / seconds : Infinity;
    if (delta <= 1600 && seconds >= 4 && seconds <= 180 && speed <= 900)
      return { pages: 1, words: delta, seconds };
    return { pages: 1, words: 0, seconds: 0 };
  }
}
