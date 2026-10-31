"use client";
import { useMemo } from "react";
import { Flame } from "./Flame";
import { Modal } from "./Modal";
import { wordProgress, start } from "@/lib/readwind/anchors";
import { dailyTotals, dayFromNumber, dayKey, dayNumber, statsOf, streakOf, type ReadingLog } from "@/lib/readwind/reading-log";
import type { Annotation, Book, Progress } from "@/lib/readwind/types";

const number = new Intl.NumberFormat();
const compact = new Intl.NumberFormat(undefined, { notation: "compact", maximumFractionDigits: 1 });
const fmtWords = (n: number) => (n >= 100000 ? compact.format(n) : number.format(Math.round(n)));
export function fmtDuration(seconds: number) {
  const m = Math.round(seconds / 60);
  if (m < 1) return seconds > 0 ? "<1 min" : "0 min";
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  return m % 60 ? `${h} hr ${m % 60} min` : `${h} hr`;
}
/** Tile-sized duration: "9h 49m" instead of "9 hr 49 min". */
const fmtShort = (seconds: number) => {
  const m = Math.round(seconds / 60);
  if (m < 1) return seconds > 0 ? "<1m" : "0m";
  if (m < 60) return `${m}m`;
  return m % 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${Math.floor(m / 60)}h`;
};
const dateLabel = (key: string) =>
  new Date(dayNumber(key) * 86400000).toLocaleDateString(undefined, { month: "short", day: "numeric", timeZone: "UTC" });

type Source = {
  books: Book[];
  progress: Progress[];
  annotations: Annotation[];
  readingLog?: ReadingLog;
  readingSpeed: number;
  settings: { readingPace?: Record<string, unknown> };
};

export function ReadingStats({ library: l, onClose }: { library: Source; onClose: () => void }) {
  const today = dayKey();
  const days = useMemo(() => dailyTotals(l.readingLog), [l.readingLog]);
  const streak = useMemo(() => streakOf(days.keys(), today), [days, today]);
  const stats = useMemo(() => statsOf(l.readingLog, today), [l.readingLog, today]);
  const shelf = useMemo(() => {
    let finished = 0,
      reading = 0;
    for (const b of l.books) {
      const p = l.progress.find((x) => x.bookId === b.id);
      const pct = wordProgress(b, p?.at || start).pct;
      if (pct >= 0.99) finished++;
      else if (pct > 0) reading++;
    }
    return { finished, reading };
  }, [l.books, l.progress]);
  const highlights = l.annotations.filter((a) => a.kind === "highlight").length;
  const notes = l.annotations.filter((a) => a.note).length;
  const learned = Object.keys(l.settings.readingPace || {}).length > 0;
  const todayStat = days.get(today);

  const barMax = Math.max(600, ...stats.last7.map((d) => d.seconds));
  const weeks = 12;
  const todayNum = dayNumber(today);
  const todayDow = new Date(todayNum * 86400000).getUTCDay();
  const gridStart = todayNum - todayDow - (weeks - 1) * 7;
  const heat = Array.from({ length: weeks * 7 }, (_, i) => {
    const day = dayFromNumber(gridStart + i);
    return { day, seconds: days.get(day)?.seconds ?? 0, read: days.has(day), future: gridStart + i > todayNum };
  });
  const level = (d: { seconds: number; read: boolean }) => (!d.read ? 0 : d.seconds < 300 ? 1 : d.seconds < 900 ? 2 : d.seconds < 1800 ? 3 : 4);

  const tiles: { label: string; value: string; unit?: string; note: string }[] = [
    {
      label: "Speed",
      value: String(Math.round(l.readingSpeed)),
      unit: "wpm",
      note: learned ? "Learned from your pace" : "An estimate until you read more",
    },
    { label: "Words", value: fmtWords(stats.words), note: stats.words ? `About ${number.format(Math.max(1, Math.round(stats.words / 250)))} pages` : "Counted as you read" },
    { label: "Time", value: fmtShort(stats.seconds), note: stats.activeDays ? `${fmtDuration(stats.avgSecondsPerDay)} a typical day` : "Counted as you read" },
    { label: "Days read", value: String(stats.activeDays), note: stats.firstDay ? `Since ${dateLabel(stats.firstDay)}` : "Start with one page" },
    { label: "Best streak", value: String(streak.longest), unit: streak.longest === 1 ? "day" : "days", note: streak.current ? `${streak.current} going now` : "Read today to begin" },
    { label: "Finished", value: String(shelf.finished), unit: shelf.finished === 1 ? "book" : "books", note: shelf.reading ? `${shelf.reading} in progress` : "Your shelf awaits" },
    { label: "Highlights", value: String(highlights), note: notes ? `${notes} with a note` : "Select text to add one" },
    { label: "Best day", value: stats.bestDay ? fmtShort(stats.bestDay.seconds) : "—", note: stats.bestDay ? dateLabel(stats.bestDay.day) : "Not enough yet" },
  ];

  return (
    <Modal title="Reading stats" onClose={onClose} className="stats-modal">
      <section className="stats-hero">
        <div className="stats-streak">
          <Flame size={44} lit={streak.readToday || streak.current > 0} className={streak.readToday ? "flicker" : ""} />
          <div>
            <strong>
              {streak.current}
              <small> day{streak.current === 1 ? "" : "s"}</small>
            </strong>
            <span>{streak.readToday ? "Read today" : streak.current ? "Read today to keep it" : "No streak yet"}</span>
          </div>
        </div>
        <div className="stats-today">
          <span className="eyebrow">Today</span>
          <strong>{todayStat ? fmtDuration(todayStat.seconds) : "0 min"}</strong>
          <span>{todayStat && todayStat.words ? `${fmtWords(todayStat.words)} words` : "Nothing yet"}</span>
        </div>
      </section>

      <dl className="stats-grid">
        {tiles.map((t) => (
          <div key={t.label} className="stat-tile">
            <dt>{t.label}</dt>
            <dd>
              {t.value}
              {t.unit && <small>{t.unit}</small>}
            </dd>
            <p>{t.note}</p>
          </div>
        ))}
      </dl>

      <div className="stats-charts">
        <section aria-label="Last seven days">
          <h3>Last 7 days</h3>
          <div className="bars">
            {stats.last7.map((d) => (
              <div key={d.day} className={`bar ${d.day === today ? "today" : ""}`} title={`${dateLabel(d.day)} · ${fmtDuration(d.seconds)}`}>
                <span className="bar-value">{d.seconds ? Math.round(d.seconds / 60) || "<1" : ""}</span>
                <i style={{ "--p": Math.max(d.seconds ? 0.07 : 0.025, d.seconds / barMax) } as React.CSSProperties} />
                <b>{new Date(dayNumber(d.day) * 86400000).toLocaleDateString(undefined, { weekday: "narrow", timeZone: "UTC" })}</b>
              </div>
            ))}
          </div>
          <p className="chart-note">Minutes read each day</p>
        </section>
        <section aria-label="Last twelve weeks">
          <h3>Last 12 weeks</h3>
          <div className="heat" role="img" aria-label={`${heat.filter((d) => d.read).length} days read in the last twelve weeks`}>
            {heat.map((d) => (
              <i key={d.day} data-level={level(d)} data-future={d.future || undefined} title={`${dateLabel(d.day)} · ${d.read ? fmtDuration(d.seconds) : "not read"}`} />
            ))}
          </div>
          <p className="chart-note heat-legend">
            Less <i data-level="1" /> <i data-level="2" /> <i data-level="3" /> <i data-level="4" /> More
          </p>
        </section>
      </div>
      <p className="stats-foot">
        Words and time come from pages you actually read. Flipping quickly, skimming and idle gaps are left out, so these numbers stay honest.
      </p>
    </Modal>
  );
}
