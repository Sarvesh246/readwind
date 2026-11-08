"use client";
import { useEffect, useRef, useState } from "react";
import type { RefObject } from "react";
import { idleLimitMs, isEngaged } from "./useReadingPace";

/** Warm light runs from 7pm to 6am local time. */
export const WARM_START_HOUR = 19;
export const WARM_END_HOUR = 6;
export const isWarmHour = (date: Date) => {
  const hour = date.getHours();
  return hour >= WARM_START_HOUR || hour < WARM_END_HOUR;
};

/** Re-checks the clock every minute so warm light can switch on mid-session, not only on the next render. */
export function useWarmHour(enabled: boolean) {
  // Starts false so the server render and first client render agree; the first tick sets the real value.
  const [warmHour, setWarmHour] = useState(false);
  useEffect(() => {
    if (!enabled) return;
    const tick = () => setWarmHour(isWarmHour(new Date()));
    const first = setTimeout(tick, 0);
    const id = setInterval(tick, 60_000);
    return () => {
      clearTimeout(first);
      clearInterval(id);
    };
  }, [enabled]);
  return enabled && warmHour;
}

const INPUT_EVENTS = ["pointerdown", "keydown", "wheel", "touchstart", "scroll"] as const;

/** Time of the last pointer, key, wheel or scroll input, for idle checks that run on a timer. */
export function useLastInput(): RefObject<number> {
  const last = useRef(0);
  useEffect(() => {
    last.current = performance.now();
    const input = () => {
      last.current = performance.now();
    };
    for (const e of INPUT_EVENTS) window.addEventListener(e, input, { capture: true, passive: true });
    return () => {
      for (const e of INPUT_EVENTS) window.removeEventListener(e, input, { capture: true });
    };
  }, []);
  return last;
}

/**
 * Whether to keep the screen awake right now.
 * `bookOpen`: the book is open with no panel over it. `visible`: the tab is showing.
 * `sinceInputMs`: time since the last touch, key or scroll. `idleMs`: how long a silence still counts as reading.
 */
export function shouldHoldWakeLock(bookOpen: boolean, visible: boolean, sinceInputMs: number, idleMs: number): boolean {
  return bookOpen && visible && sinceInputMs >= 0 && sinceInputMs < idleMs;
}

type WakeLockSentinelLike = { released: boolean; release(): Promise<void> };
type WakeLockNavigator = Navigator & { wakeLock?: { request(type: "screen"): Promise<WakeLockSentinelLike> } };

/** Keeps the phone screen from dimming mid-page, and lets it go once the reader stops engaging. */
export function useWakeLock(bookOpen: boolean, lastInput: RefObject<number>, wpm: number) {
  useEffect(() => {
    const api = (navigator as WakeLockNavigator).wakeLock;
    if (!api) return;
    let lock: WakeLockSentinelLike | null = null,
      pending = false,
      stopped = false;
    const wantsLock = () => shouldHoldWakeLock(
        bookOpen,
        document.visibilityState === "visible",
        performance.now() - lastInput.current,
        idleLimitMs(wpm),
      );
    const check = () => {
      const want = wantsLock();
      const held = !!lock && !lock.released;
      if (want && !held && !pending) {
        pending = true;
        api
          .request("screen")
          .then(sentinel => {
            if (stopped || !wantsLock()) void sentinel.release().catch(() => {});
            else lock = sentinel;
          })
          .catch(() => {})
          .finally(() => {
            pending = false;
          });
      } else if (!want && held) {
        void lock!.release().catch(() => {});
        lock = null;
      }
    };
    check();
    // The browser drops the lock whenever the tab hides, so re-check as soon as it returns.
    const id = setInterval(check, 10_000);
    document.addEventListener("visibilitychange", check);
    for (const event of INPUT_EVENTS) window.addEventListener(event, check, { passive: true });
    return () => {
      stopped = true;
      clearInterval(id);
      document.removeEventListener("visibilitychange", check);
      for (const event of INPUT_EVENTS) window.removeEventListener(event, check);
      if (lock && !lock.released) void lock.release().catch(() => {});
    };
  }, [bookOpen, lastInput, wpm]);
}

/** Same rule the pace tracker uses: visible, and either focused or touched within the idle limit. */
export const isReading = (sinceInputMs: number, wpm: number) =>
  isEngaged(document.visibilityState === "visible", document.hasFocus(), sinceInputMs, idleLimitMs(wpm));
