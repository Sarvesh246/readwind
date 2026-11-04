/**
 * Position safety helpers: which saved positions are deliberate, and when another device is far
 * enough ahead to be worth a "continue there?" prompt.
 */
export type StablePoint = { key: string; at: number };

/**
 * A position is "stable" once the reader has stayed on it for a few seconds, so dragging through a
 * progress bar or flipping pages never becomes the place a device resumes. The last few stable
 * positions are kept so a reader can return to where they were before an accidental jump.
 */
export class StablePositions {
  private pending?: { key: string; since: number };
  private history: StablePoint[] = [];
  constructor(private dwellMs = 4000, private keep = 5) {}
  /** Report the visible position; returns true when it has just become stable. */
  observe(key: string, now: number) {
    if (this.pending?.key !== key) {
      this.pending = { key, since: now };
      return false;
    }
    if (now - this.pending.since < this.dwellMs || this.history[0]?.key === key) return false;
    this.history = [{ key, at: now }, ...this.history].slice(0, this.keep);
    return true;
  }
  recent() {
    return this.history.slice();
  }
  /** The stable position before the current one, for "return to where I was". */
  previous() {
    return this.history[1];
  }
}

type Saved = { wordsRead: number; updatedAt: number; deviceId: string };
/**
 * Whether to prompt before resuming. Small differences resolve silently to the furthest-read spot;
 * a prompt appears only when the other device is ahead by more than about a chapter or ten minutes.
 */
export function shouldPromptContinue(local: Saved | undefined, remote: Saved | undefined, wpm = 230) {
  if (!local || !remote || local.deviceId === remote.deviceId) return false;
  const ahead = remote.wordsRead - local.wordsRead;
  return ahead >= Math.max(2000, wpm * 10) && remote.updatedAt >= local.updatedAt;
}

/** Furthest-read frontier: never moves backwards, whichever device wrote last. */
export const furthest = (a: number, b: number) => Math.max(a || 0, b || 0);
