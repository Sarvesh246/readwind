/**
 * Reading pace as a robust Bayesian estimate of log speed.
 *
 * Each synced entry (one per device) keeps the legacy sufficient statistics (samples, words, seconds)
 * so older clients and the server merge keep working, plus an optional log-space posterior:
 *   lm = weighted mean of ln(words per minute), w = effective sample weight, v = weighted mean squared deviation.
 * The estimate starts from a population prior, shrinks toward the reader's own data as it arrives,
 * down-weights skimming/idle samples by their probability instead of hard cut-offs, and forgets old
 * habits with a half-life measured in reading time (never wall-clock time).
 */
export type PaceEntry = { samples: number; words: number; seconds: number; lm?: number; w?: number; v?: number; ra?: number; run?: number; cal?: number; cn?: number };
export type ReadingPace = Record<string, PaceEntry>;

/** Per-book entries share the synced pace record under this key prefix, so merging needs no new path. */
export const BOOK_PREFIX = "bk-";
const CAL_PREFIX = "cal-"; // calibration lives under its own key so its sample count (cn) drives the merge
export const PRIOR_WPM = 230;
const PRIOR_WEIGHT = 4; // pseudo-samples behind the prior
const HALF_LIFE_SECONDS = 6 * 3600; // of actual reading
const MAX_WEIGHT = 80; // keeps the estimate responsive however much history exists
const BASE_SIGMA = 0.35; // typical log-speed spread of one page
const MIN_SPEED = 50;
const MAX_SPEED = 700;

export function mergeReadingPace(a: ReadingPace = {}, b: ReadingPace = {}): ReadingPace {
  const merged = { ...a };
  for (const [id, entry] of Object.entries(b)) if (!merged[id] || entry.samples > merged[id].samples) merged[id] = entry;
  return merged;
}

/** Log-space summary of one entry; legacy entries are converted from their word and second totals. */
function summary(entry: PaceEntry): { lm: number; w: number; v: number } | undefined {
  if (entry.lm !== undefined && entry.w !== undefined && entry.w > 0 && Number.isFinite(entry.lm))
    return { lm: entry.lm, w: entry.w, v: entry.v ?? BASE_SIGMA ** 2 };
  if (entry.seconds > 0 && entry.words > 0) {
    const speed = (entry.words * 60) / entry.seconds;
    return { lm: Math.log(Math.min(MAX_SPEED, Math.max(MIN_SPEED, speed))), w: Math.min(entry.samples, 30), v: BASE_SIGMA ** 2 };
  }
}

type Posterior = { mean: number; weight: number; sigma: number };
export function posterior(pace: ReadingPace = {}): Posterior {
  let weight = 0,
    sum = 0,
    spread = 0;
  for (const [id, entry] of Object.entries(pace)) {
    if (id.startsWith(BOOK_PREFIX) || id.startsWith(CAL_PREFIX)) continue;
    const s = summary(entry);
    if (!s) continue;
    weight += s.w;
    sum += s.w * s.lm;
    spread += s.w * s.v;
  }
  const mean = (PRIOR_WEIGHT * Math.log(PRIOR_WPM) + sum) / (PRIOR_WEIGHT + weight);
  const sigma = weight >= 8 ? Math.max(0.15, Math.min(0.8, Math.sqrt(spread / weight))) : BASE_SIGMA;
  return { mean, weight, sigma };
}

export function readingSpeed(pace: ReadingPace = {}) {
  return Math.max(MIN_SPEED, Math.min(MAX_SPEED, Math.exp(posterior(pace).mean)));
}

/** Speed range (80% credible interval) so the UI can say how sure it is. */
export function readingSpeedRange(pace: ReadingPace = {}) {
  const p = posterior(pace);
  const se = p.sigma / Math.sqrt(PRIOR_WEIGHT + Math.min(p.weight, 400));
  const clamp = (x: number) => Math.max(MIN_SPEED, Math.min(MAX_SPEED, x));
  return { low: clamp(Math.exp(p.mean - 1.28 * se)), median: clamp(Math.exp(p.mean)), high: clamp(Math.exp(p.mean + 1.28 * se)), samples: p.weight };
}
/** True while too little has been read for a precise time estimate. */
export const paceIsEstimating = (pace: ReadingPace = {}) => posterior(pace).weight < 5;

export function validPaceSample(words: number, seconds: number) {
  const speed = (words * 60) / seconds;
  return Number.isFinite(words) && Number.isFinite(seconds) && words >= 20 && words <= 1600 && seconds >= 8 && seconds <= 180 && speed >= MIN_SPEED && speed <= MAX_SPEED;
}

const gauss = (z: number) => Math.exp(-0.5 * z * z);
/**
 * Probability that a sample reflects reading (as opposed to skimming or an unnoticed pause), given the
 * current estimate. Early on the estimate is only a prior, so the floor stays high and a genuinely fast
 * or slow reader is learned quickly instead of being mistaken for an anomaly.
 */
export function readingProbability(y: number, mean: number, sigma: number, weight: number) {
  const reading = 0.8 * gauss((y - mean) / sigma);
  const skim = 0.1 * gauss((y - mean - 0.9) / (sigma + 0.15));
  const idle = 0.1 * gauss((y - mean + 0.9) / (sigma + 0.15));
  const r = reading / (reading + skim + idle || 1);
  const floor = weight < 3 ? 0.8 : weight < 8 ? 0.4 : 0;
  return Math.max(floor, r);
}

type Base = { mean: number; sigma: number; weight: number };
/** Folds one sample into an entry, weighting it by how likely it is real reading against `base`. */
function fold(pace: ReadingPace, id: string, words: number, seconds: number, base: Base, discardable: boolean): ReadingPace {
  if (!validPaceSample(words, seconds)) return pace;
  const old = pace[id] || { samples: 0, words: 0, seconds: 0 };
  const y = Math.log((words * 60) / seconds);
  let r = readingProbability(y, base.mean, base.sigma, base.weight);
  // A lone fast or slow page is an anomaly, but several in a row that agree with each other are a real
  // change in how this person reads (new book, new device, new habits), so they are believed.
  const off = Math.abs(y - base.mean) > 0.3;
  const prior = old.ra;
  const agrees = off && prior !== undefined && Math.abs(y - prior) < 0.45;
  // One ordinary page inside a run only weakens it; it does not erase the evidence.
  const run = off ? (agrees ? (old.run ?? 0) + 1 : 1) : Math.max(0, (old.run ?? 0) - 1);
  const ra = off ? (agrees ? 0.7 * prior! + 0.3 * y : y) : run > 0 ? prior : undefined;
  if (run >= 4) r = Math.max(r, 0.95);
  // A near-certain skim or pause is discarded outright once a real baseline exists.
  if (discardable && base.weight >= 8 && r < 0.05 && run < 4)
    // Remember the anomaly (not its speed) so a genuine change of habit is recognised after a few pages.
    return pace[id] ? { ...pace, [id]: { ...old, ra, run } } : pace;
  // Legacy totals keep their bounded-history behaviour for older clients.
  const legacyWeight = old.seconds > 0 ? Math.min(1, Math.max(0, 7200 - seconds) / old.seconds) : 1;
  const prev = summary(old);
  const decay = Math.pow(2, -seconds / HALF_LIFE_SECONDS);
  // Once a change of habit is confirmed, old history is shrunk so the new pace takes hold within pages.
  const w0 = prev ? Math.min(run >= 4 ? 25 : MAX_WEIGHT, prev.w * decay) : 0;
  const nw = w0 + r;
  const lm = prev ? (w0 * prev.lm + r * y) / nw : y;
  const dev = (y - lm) ** 2;
  const v = prev ? Math.max(0.01, (w0 * prev.v + r * dev) / nw) : BASE_SIGMA ** 2;
  return {
    ...pace,
    [id]: { ...old, samples: old.samples + 1, words: old.words * legacyWeight + words, seconds: old.seconds * legacyWeight + seconds, lm, w: nw, v, ra, run },
  };
}

/** One device's pace sample. Words should be standard words (see bookDensity) so books compare fairly. */
export function addPaceSample(pace: ReadingPace, id: string, words: number, seconds: number): ReadingPace {
  return fold(pace, id, words, seconds, posterior(pace), true);
}

const BOOK_SHRINK = 8; // pages of a book needed before its own pace outweighs the reader's general pace
const bookSummary = (pace: ReadingPace, bookId: string) => {
  const e = pace[BOOK_PREFIX + bookId];
  return e ? summary(e) : undefined;
};
/** A sample counted for the book itself, judged against that book's pace once it has one. */
export function addBookPaceSample(pace: ReadingPace, bookId: string, words: number, seconds: number): ReadingPace {
  const own = bookSummary(pace, bookId),
    general = posterior(pace);
  const base: Base = own && own.w >= 3 ? { mean: own.lm, sigma: Math.max(0.15, Math.sqrt(own.v)), weight: own.w } : general;
  return fold(pace, BOOK_PREFIX + bookId, words, seconds, base, false);
}

/**
 * Words per minute for one book's own words. Standard speed is shrunk toward this book's pace as it
 * is read (dense or difficult books come out slower, easy ones faster), corrected by how much longer
 * reading really took than predicted, and converted back through the book's word density.
 */
export function speedForBook(pace: ReadingPace = {}, bookId = "", density = 1) {
  const g = posterior(pace),
    own = bookId ? bookSummary(pace, bookId) : undefined;
  const mean = own ? (BOOK_SHRINK * g.mean + own.w * own.lm) / (BOOK_SHRINK + own.w) : g.mean;
  const standard = Math.exp(mean - calibration(pace));
  return Math.max(MIN_SPEED / 4, Math.min(MAX_SPEED * 2, standard / Math.max(0.25, density)));
}

/**
 * Self-calibration: whenever a stretch of reading is finished, the actual engaged time is compared
 * with the time the estimate predicted. The log of that ratio (positive = slower than predicted) nudges
 * a correction that applies to time-left estimates, so pauses and page-turn overhead that clean
 * speed samples exclude are still accounted for.
 */
const CAL_MIN = -0.25,
  CAL_MAX = 0.5;
export function addCalibration(pace: ReadingPace, id: string, lnRatio: number): ReadingPace {
  if (!Number.isFinite(lnRatio)) return pace;
  const key = CAL_PREFIX + id;
  const old = pace[key] || { samples: 0, words: 0, seconds: 0 };
  const n = old.cn ?? 0;
  const step = Math.max(0.1, 1 / (n + 1));
  const cal = Math.max(CAL_MIN, Math.min(CAL_MAX, (old.cal ?? 0) + step * Math.max(-0.7, Math.min(0.7, lnRatio))));
  return { ...pace, [key]: { ...old, samples: n + 1, cal, cn: n + 1 } };
}
export function calibration(pace: ReadingPace = {}) {
  let n = 0,
    sum = 0;
  for (const [id, e] of Object.entries(pace)) {
    if (!id.startsWith(CAL_PREFIX) || e.cal === undefined) continue;
    const c = e.cn ?? 1;
    n += c;
    sum += c * e.cal;
  }
  return n ? Math.max(CAL_MIN, Math.min(CAL_MAX, sum / n)) : 0;
}

/** A reader-local baseline; never infer reading time from a saved position's age. */
export class PaceTracker {
  private baseline?: { words: number; time: number };
  reset() {
    this.baseline = undefined;
  }
  observe(words: number, time: number) {
    const before = this.baseline;
    if (!before) {
      this.baseline = { words, time };
      return;
    }
    const delta = words - before.words,
      seconds = (time - before.time) / 1000;
    if (delta === 0 && seconds <= 180) return;
    // Short pages pool into the next turn so poems and dialogue are measured, not discarded.
    if (delta > 0 && delta < 20 && seconds <= 180) return;
    this.baseline = { words, time };
    if (validPaceSample(delta, seconds)) return { words: delta, seconds };
  }
}
