/**
 * Memory-model scheduling for highlights (an FSRS-4.5 style model).
 * Each card has stability S (days until recall drops to 90%) and difficulty D (1-10). Recall
 * probability after t days is R = (1 + (19/81) t / S)^-0.5, and the next review is placed where R
 * falls to the reader's target retention, so easy passages fade into long gaps and hard ones return soon.
 * Cards saved by the old fixed ladder carry only {due, interval}; they are migrated on first review.
 */
export type Grade = 1 | 2 | 3 | 4; // again, hard, good, easy
export type Review = {
  due: number;
  interval: number;
  stability?: number;
  difficulty?: number;
  reps?: number;
  lapses?: number;
  last?: number;
};

const DAY = 86400000;
const FACTOR = 19 / 81;
const DECAY = -0.5;
export const MAX_INTERVAL = 3650;
export const DEFAULT_RETENTION = 0.9;
export const LEECH_LAPSES = 8;
// Published FSRS-4.5 defaults; fitting them to one reader needs hundreds of reviews, so they stay fixed.
const W = [0.4872, 1.4003, 3.7145, 13.8206, 5.1618, 1.2298, 0.8975, 0.031, 1.6474, 0.1367, 1.0461, 2.1072, 0.0793, 0.3246, 1.587, 0.2272, 2.8755];

const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));
export const retrievability = (elapsedDays: number, stability: number) => Math.pow(1 + (FACTOR * Math.max(0, elapsedDays)) / Math.max(0.01, stability), DECAY);
export const intervalFor = (stability: number, retention = DEFAULT_RETENTION) => (stability / FACTOR) * (Math.pow(retention, 1 / DECAY) - 1);

type Card = { id?: string; quote?: string; note?: string; review?: Review };

/** Longer passages and passages without the reader's own note are harder to bring back. */
function startingDifficulty(grade: Grade, card: Card) {
  const base = W[4] - W[5] * (grade - 3);
  const adjust = (card.quote && card.quote.length > 400 ? 0.6 : 0) - (card.note ? 0.5 : 0);
  return clamp(base + adjust, 1, 10);
}

/** State for a card, converting a legacy {due, interval} card into an equivalent memory state. */
export function memoryState(card: Card, now = Date.now()) {
  const r = card.review;
  if (!r) return undefined;
  if (r.stability !== undefined && r.difficulty !== undefined)
    return { stability: r.stability, difficulty: r.difficulty, reps: r.reps ?? 1, lapses: r.lapses ?? 0, last: r.last ?? r.due - r.interval * DAY };
  if (r.interval > 0) return { stability: Math.max(1, r.interval), difficulty: 5.5, reps: 1, lapses: 0, last: r.last ?? Math.min(now, r.due - r.interval * DAY) };
  return undefined;
}

/** Deterministic ±5% spread so cards created together do not all come due on one day. */
function fuzz(days: number, seed: string) {
  if (days < 7) return days;
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 16777619);
  const unit = ((h >>> 0) % 1000) / 1000 - 0.5;
  return days * (1 + 0.1 * unit);
}

export function review(card: Card, grade: Grade, now = Date.now(), retention = DEFAULT_RETENTION): Review {
  const prev = memoryState(card, now);
  let stability: number, difficulty: number, lapses = prev?.lapses ?? 0;
  if (!prev) {
    stability = W[grade - 1];
    difficulty = startingDifficulty(grade, card);
    if (grade === 1) lapses += 1;
  } else {
    const elapsed = Math.max(0, (now - prev.last) / DAY);
    const R = retrievability(elapsed, prev.stability);
    difficulty = clamp(W[7] * startingDifficulty(3, card) + (1 - W[7]) * (prev.difficulty - W[6] * (grade - 3)), 1, 10);
    if (grade === 1) {
      lapses += 1;
      stability = W[11] * Math.pow(prev.difficulty, -W[12]) * (Math.pow(prev.stability + 1, W[13]) - 1) * Math.exp(W[14] * (1 - R));
      stability = clamp(stability, 0.1, prev.stability);
    } else {
      const hard = grade === 2 ? W[15] : 1,
        easy = grade === 4 ? W[16] : 1;
      stability = prev.stability * (1 + Math.exp(W[8]) * (11 - prev.difficulty) * Math.pow(prev.stability, -W[9]) * (Math.exp(W[10] * (1 - R)) - 1) * hard * easy);
      stability = Math.max(stability, prev.stability + 0.05);
    }
  }
  let days = fuzz(intervalFor(stability, retention), `${card.id ?? ""}:${(prev?.reps ?? 0) + 1}`);
  // Again always returns tomorrow; Hard never schedules past a plain pass of the same card.
  days = grade === 1 ? 1 : Math.max(1, Math.round(days));
  days = Math.min(MAX_INTERVAL, days);
  return { due: now + days * DAY, interval: days, stability, difficulty, reps: (prev?.reps ?? 0) + 1, lapses, last: now };
}

/** Preview of how long each answer would defer the card, for the review buttons. */
export function previewIntervals(card: Card, now = Date.now(), retention = DEFAULT_RETENTION): Record<Grade, number> {
  const out = {} as Record<Grade, number>;
  for (const g of [1, 2, 3, 4] as Grade[]) out[g] = review(card, g, now, retention).interval;
  // Harder answers can never wait longer than easier ones.
  for (const g of [2, 3, 4] as Grade[]) out[g] = Math.max(out[g], out[(g - 1) as Grade]);
  return out;
}

export const isLeech = (card: Card) => (card.review?.lapses ?? 0) >= LEECH_LAPSES;

export function formatInterval(days: number) {
  if (days < 1) return "today";
  if (days === 1) return "tomorrow";
  if (days < 30) return `${days} days`;
  if (days < 365) return `${Math.round(days / 30)} mo`;
  return `${(days / 365).toFixed(1)} yr`;
}

/**
 * Today's queue: the most forgotten cards first, capped so a long absence returns as a manageable
 * daily set instead of a wall. New (never reviewed) highlights are due after their first day.
 */
export function dueQueue<T extends Card & { review?: Review }>(cards: T[], now = Date.now(), cap = 20): T[] {
  const due = cards.filter((c) => !c.review || c.review.due <= now);
  const score = (c: T) => {
    const m = memoryState(c, now);
    return m ? retrievability((now - m.last) / DAY, m.stability) : 0.5;
  };
  return due.sort((a, b) => score(a) - score(b)).slice(0, cap);
}
