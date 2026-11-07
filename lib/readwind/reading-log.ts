/**
 * Daily reading activity behind streaks and stats.
 * Keys are `YYYY-MM-DD.deviceId` so each device only ever grows its own counters and
 * devices merge without conflicts (take the larger counter per key).
 */
/** `listenSeconds` is the part of `seconds` spent listening; it counts toward goals and streaks the same way. */
export type LogEntry = { pages: number; words: number; seconds: number; listenSeconds?: number };
export type ReadingLog = Record<string, LogEntry>;

export const KEEP_DAYS = 730;
export const logKey = /^\d{4}-\d{2}-\d{2}\.[a-zA-Z0-9_-]{1,120}$/;

const pad = (n: number) => String(n).padStart(2, "0");
/** Local calendar day, so "daily" matches the reader's own midnight. */
let defaultStartHour = 0;
/** The reader's chosen day start (0-6 am), applied wherever a day label is made. */
export const setDayStartHour = (hour: number) => {
  defaultStartHour = Number.isInteger(hour) && hour >= 0 && hour <= 6 ? hour : 0;
};
export function dayKey(date: Date = new Date(), startHour = defaultStartHour) {
  // Night readers can start their day at e.g. 4 am; the label is fixed when the activity is written.
  if (startHour) date = new Date(date.getTime() - startHour * 3600000);
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
  const merged: LogEntry = { pages: Math.max(a.pages, b.pages), words: Math.max(a.words, b.words), seconds: Math.max(a.seconds, b.seconds) };
  const listened = Math.max(a.listenSeconds || 0, b.listenSeconds || 0);
  if (listened) merged.listenSeconds = listened;
  return merged;
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
/**
 * Entries written by this version carry `_v2` in their key so a day already counted by the old
 * "any page" rule is never rewritten or downgraded. Each also carries the id of the app session that
 * wrote it, so a counter has exactly one writer: restoring a backup, reusing a device id or running two
 * tabs can never make two histories share a counter, and the key-wise max merge is exact (it behaves as
 * an append-only ledger with one segment per device, day and session).
 */
export const V2_SUFFIX = "_v2";
let session = "s0";
export const setLogSession = (id: string) => {
  session = id.replace(/[^a-zA-Z0-9]/g, "").slice(0, 12) || "s0";
};
export function addActivity(log: ReadingLog, device: string, credit: LogEntry, now = new Date(), startHour = defaultStartHour): ReadingLog {
  const day = dayKey(now, startHour);
  const key = `${day}.${device}${V2_SUFFIX}_${session}`;
  const old = log[key] || { pages: 0, words: 0, seconds: 0 };
  return pruneLog(
    {
      ...log,
      [key]: {
        pages: old.pages + credit.pages,
        words: Math.round(old.words + credit.words),
        seconds: Math.round(old.seconds + credit.seconds),
        ...(old.listenSeconds || credit.listenSeconds
          ? { listenSeconds: Math.round((old.listenSeconds || 0) + (credit.listenSeconds || 0)) }
          : {}),
      },
    },
    day,
  );
}

export type Day = { day: string; pages: number; words: number; seconds: number; counts?: boolean };
/** A day counts toward the streak after a minute of engaged reading and a real page's worth of words. */
export const QUALIFY_SECONDS = 60;
export const QUALIFY_WORDS = 100;
/**
 * Every day with real reading, with `counts` saying whether it qualifies for the streak. Days written
 * by older versions count on one page (they are never re-judged); newer days need engaged time and
 * words, summed across devices. Days more than one day in the future (a wrong clock) are ignored.
 */
export function dailyTotals(log: ReadingLog = {}, today = dayKey()): Map<string, Day> {
  const days = new Map<string, Day>();
  const legacy = new Set<string>();
  const limit = dayFromNumber(dayNumber(today) + 1);
  for (const [key, e] of Object.entries(log)) {
    const day = key.slice(0, 10);
    if (day > limit) continue;
    const t = days.get(day) || { day, pages: 0, words: 0, seconds: 0 };
    t.pages += e.pages;
    t.words += e.words;
    t.seconds += e.seconds;
    if (!key.includes(V2_SUFFIX) && e.pages >= 1) legacy.add(day);
    days.set(day, t);
  }
  for (const [day, t] of days) {
    if (t.pages < 1 && t.seconds < 1) days.delete(day);
    else t.counts = legacy.has(day) || (t.seconds >= QUALIFY_SECONDS && t.words >= QUALIFY_WORDS);
  }
  return days;
}
/** Only the days that keep a streak alive. */
export function qualifyingDays(days: Map<string, Day>): Map<string, Day> {
  return new Map([...days].filter(([, d]) => d.counts));
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
  const days = dailyTotals(log, today);
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
 * Turns page movement into credit. Time is capped at what the page plausibly needed (so a screen left
 * on never earns hours), flipping past a page earns nothing, and words already credited in this
 * session are not credited again, so going back and forth cannot inflate stats or a streak.
 */
type Span = [number, number];
export class ActivityTracker {
  private baseline?: { words: number; time: number };
  private seen: Span[] = [];
  /** Re-anchors after a pause or interruption; `full` also forgets what this session already read. */
  reset(full = false) {
    this.baseline = undefined;
    if (full) this.seen = [];
  }
  private fresh(start: number, end: number) {
    let overlap = 0;
    for (const [a, b] of this.seen) overlap += Math.max(0, Math.min(end, b) - Math.max(start, a));
    return Math.max(0, end - start - overlap);
  }
  private remember(start: number, end: number) {
    const merged: Span[] = [];
    let cur: Span = [start, end];
    for (const span of [...this.seen].sort((x, y) => x[0] - y[0])) {
      if (span[1] < cur[0] || span[0] > cur[1]) merged.push(span);
      else cur = [Math.min(cur[0], span[0]), Math.max(cur[1], span[1])];
    }
    merged.push(cur);
    this.seen = merged.sort((x, y) => x[0] - y[0]);
  }
  observe(words: number, time: number, wpm = 230): LogEntry | undefined {
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
    // A jump through contents, search or the slider is navigation, not reading.
    if (delta > 1600) return;
    const expected = (delta * 60) / Math.max(50, Math.min(700, wpm));
    if (seconds < Math.max(3, expected * 0.25)) return; // flipped past
    const fresh = this.fresh(before.words, words);
    if (fresh < 1) return; // already credited this session
    const credited = Math.min(seconds, expected * 2.5, 180);
    if ((fresh * 60) / credited > 900) return;
    this.remember(before.words, words);
    return { pages: 1, words: fresh, seconds: credited };
  }
}
