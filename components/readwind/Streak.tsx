"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { Flame } from "./Flame";
import { Icon } from "./Icon";
import { Modal } from "./Modal";
import { dayFromNumber, dayKey, dayNumber, type Day, type Streak } from "@/lib/readwind/reading-log";

const SEEN = "rw-streak-seen";
const pad = (n: number) => String(n).padStart(2, "0");
const minutes = (s: number) => Math.max(0, Math.round(s / 60));

export function StreakChip({ streak, onClick }: { streak: Streak; onClick: () => void }) {
  const label = streak.current
    ? streak.readToday
      ? `${streak.current}-day reading streak. Read today.`
      : `${streak.current}-day reading streak. Read today to keep it going.`
    : "Start a reading streak";
  return (
    <button
      type="button"
      className="streak-chip"
      data-state={streak.readToday ? "lit" : streak.current ? "risk" : "idle"}
      aria-label={label}
      title={label}
      onClick={onClick}
    >
      <Flame size={17} lit={streak.readToday} />
      <span className="streak-count">{streak.current}</span>
    </button>
  );
}

function week(days: Map<string, Day>, today: string) {
  const t = dayNumber(today);
  return Array.from({ length: 7 }, (_, i) => {
    const day = dayFromNumber(t - 6 + i);
    return { day, read: days.has(day), today: day === today };
  });
}

/** Plays once per day, the first time the dashboard is visible after the day's first page. */
export function StreakCelebration({
  streak,
  days,
  onClose,
}: {
  streak: Streak;
  days: Map<string, Day>;
  onClose: () => void;
}) {
  const today = dayKey();
  const first = streak.current <= 1;
  const strip = useMemo(() => week(days, today), [days, today]);
  useEffect(() => {
    const t = setTimeout(onClose, 6500);
    return () => clearTimeout(t);
  }, [onClose]);
  return (
    <Modal title="Streak" onClose={onClose} className="streak-celebration">
      <div className="celebrate" onClick={onClose}>
        <div className="celebrate-flame">
          <span className="celebrate-glow" />
          {Array.from({ length: 10 }, (_, i) => (
            <i key={i} className="spark" style={{ "--a": `${i * 36 + (i % 2 ? 10 : -6)}deg`, "--d": `${0.55 + (i % 3) * 0.12}s` } as React.CSSProperties} />
          ))}
          <Flame size={92} />
        </div>
        <div className="celebrate-count" aria-live="polite">
          <span className="count-roll">
            <span className="count-old">{Math.max(0, streak.current - 1)}</span>
            <span className="count-new">{streak.current}</span>
          </span>
        </div>
        <h3>{first ? "Streak started" : "day streak"}</h3>
        <p>
          {first
            ? "You read today. Come back tomorrow to keep it going."
            : streak.current === streak.longest
              ? "Your longest run yet. Keep it burning."
              : "Another page, another day. Nicely done."}
        </p>
        <div className="celebrate-week" aria-label="Last seven days">
          {strip.map((d, i) => (
            <span key={d.day} className={`week-dot ${d.read ? "read" : ""} ${d.today ? "today" : ""}`} style={{ "--i": i } as React.CSSProperties}>
              {new Date(dayNumber(d.day) * 86400000).toLocaleDateString(undefined, { weekday: "narrow", timeZone: "UTC" })}
            </span>
          ))}
        </div>
        <button className="button primary celebrate-continue" onClick={onClose} autoFocus>
          Continue
        </button>
      </div>
    </Modal>
  );
}

/** Reads and writes the once-per-day marker; storage can be blocked, so it fails quiet. */
export function useStreakCelebration(streak: Streak, ready: boolean) {
  const [show, setShow] = useState(false);
  const checked = useRef(false);
  useEffect(() => {
    if (!ready || checked.current || !streak.readToday) return;
    let seen = "";
    try {
      seen = localStorage.getItem(SEEN) || "";
    } catch {}
    if (seen === dayKey()) {
      checked.current = true;
      return;
    }
    checked.current = true;
    const t = setTimeout(() => {
      setShow(true);
      try {
        localStorage.setItem(SEEN, dayKey());
      } catch {}
    }, 500);
    return () => {
      clearTimeout(t);
      checked.current = false;
    };
  }, [ready, streak.readToday]);
  return { show, close: () => setShow(false) };
}

export function StreakCalendar({
  streak,
  days,
  onClose,
  onStats,
}: {
  streak: Streak;
  days: Map<string, Day>;
  onClose: () => void;
  onStats: () => void;
}) {
  const todayKey = dayKey();
  const now = new Date();
  const [cursor, setCursor] = useState({ y: now.getFullYear(), m: now.getMonth() });
  const first = [...days.keys()].sort()[0];
  const firstNum = first ? dayNumber(first) : undefined;
  const monthDays = new Date(cursor.y, cursor.m + 1, 0).getDate();
  const lead = new Date(cursor.y, cursor.m, 1).getDay();
  const monthKey = (d: number) => `${cursor.y}-${pad(cursor.m + 1)}-${pad(d)}`;
  const cells = Array.from({ length: lead + monthDays }, (_, i) => (i < lead ? null : i - lead + 1));
  const isCurrent = cursor.y === now.getFullYear() && cursor.m === now.getMonth();
  const earliest = first ? new Date(first + "T00:00:00") : now;
  const canBack = cursor.y * 12 + cursor.m > earliest.getFullYear() * 12 + earliest.getMonth();
  const readThisMonth = Array.from({ length: monthDays }, (_, i) => days.has(monthKey(i + 1))).filter(Boolean).length;
  const title = new Date(cursor.y, cursor.m, 1).toLocaleDateString(undefined, { month: "long", year: "numeric" });
  const step = (n: number) => setCursor(({ y, m }) => ({ y: y + Math.floor((m + n) / 12), m: (m + n + 12) % 12 }));
  const weekdays = Array.from({ length: 7 }, (_, i) => new Date(2023, 0, 1 + i).toLocaleDateString(undefined, { weekday: "narrow" }));
  return (
    <Modal title="Reading streak" onClose={onClose} className="streak-modal">
      <div className="streak-hero">
        <Flame size={46} lit={streak.readToday || streak.current > 0} className={streak.readToday ? "flicker" : ""} />
        <div>
          <strong>
            {streak.current}
            <small> day{streak.current === 1 ? "" : "s"}</small>
          </strong>
          <span>
            {streak.readToday
              ? "You’ve read today"
              : streak.current
                ? "Read today to keep it going"
                : "Read a page to start a streak"}
          </span>
        </div>
      </div>
      <dl className="streak-facts">
        <div>
          <dt>Longest</dt>
          <dd>{streak.longest}</dd>
        </div>
        <div>
          <dt>Month</dt>
          <dd>{readThisMonth}</dd>
        </div>
        <div>
          <dt>All time</dt>
          <dd>{streak.total}</dd>
        </div>
      </dl>
      <section className="streak-cal" aria-label={title}>
        <header>
          <button type="button" className="icon-button" aria-label="Previous month" disabled={!canBack} onClick={() => step(-1)}>
            <Icon name="back" size={18} />
          </button>
          <h3>{title}</h3>
          <button type="button" className="icon-button" aria-label="Next month" disabled={isCurrent} onClick={() => step(1)}>
            <Icon name="next" size={18} />
          </button>
        </header>
        <div className="cal-grid" role="grid">
          {weekdays.map((w, i) => (
            <span key={i} className="cal-dow" aria-hidden="true">
              {w}
            </span>
          ))}
          {cells.map((d, i) => {
            if (!d) return <span key={`e${i}`} />;
            const key = monthKey(d);
            const read = days.has(key);
            const n = dayNumber(key);
            const col = i % 7;
            const joinPrev = read && col > 0 && days.has(dayFromNumber(n - 1)) && d > 1;
            const joinNext = read && col < 6 && days.has(dayFromNumber(n + 1)) && d < monthDays;
            const future = key > todayKey;
            const missed = !read && !future && firstNum !== undefined && n > firstNum && key !== todayKey;
            const stat = days.get(key);
            return (
              <span
                key={key}
                role="gridcell"
                className={`cal-day ${read ? "read" : ""} ${key === todayKey ? "today" : ""} ${future ? "future" : ""} ${missed ? "missed" : ""} ${joinPrev ? "join-prev" : ""} ${joinNext ? "join-next" : ""}`}
                aria-label={`${new Date(cursor.y, cursor.m, d).toLocaleDateString(undefined, { month: "long", day: "numeric" })}${read ? `, read${stat ? ` ${minutes(stat.seconds) ? `${minutes(stat.seconds)} min` : ""}` : ""}` : future ? "" : ", not read"}`}
              >
                <b>{d}</b>
              </span>
            );
          })}
        </div>
        <p className="cal-legend">
          <i className="swatch read" /> Read <i className="swatch" /> Not yet
        </p>
      </section>
      <button type="button" className="button streak-stats-link" onClick={onStats}>
        See your reading stats
        <Icon name="next" size={16} />
      </button>
    </Modal>
  );
}
