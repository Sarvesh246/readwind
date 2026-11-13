"use client";
import { useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, Minus, Plus, Target } from "lucide-react";
import type { BookLike, ShelfBook, Progress, Settings } from "@/lib/readwind/types";
import type { ReadingLog } from "@/lib/readwind/reading-log";
import { dayKey, dayNumber, dayFromNumber } from "@/lib/readwind/reading-log";
import { wordProgress, start } from "@/lib/readwind/anchors";
import {
  finishPlan,
  goalPresets,
  MAX_GOAL,
  monthOf,
  mostlyListening,
  setGoal,
  todayGoal,
  unitLabel,
  usualMinutes,
  weekOf,
  type GoalUnit,
} from "@/lib/readwind/goals";
import { voiceWpm } from "@/lib/readwind/speech";
import { bookDensity } from "@/lib/readwind/anchors";
import { Modal } from "./Modal";

const WEEKDAYS = ["M", "T", "W", "T", "F", "S", "S"];
const longDate = (key: string) =>
  new Date(dayNumber(key) * 86400000).toLocaleDateString(undefined, { month: "short", day: "numeric", timeZone: "UTC" });

/** A progress ring; it closes and glows once when the goal is met. */
export function GoalRing({ fraction, met, size = 44, stroke = 4, children }: { fraction: number; met: boolean; size?: number; stroke?: number; children?: React.ReactNode }) {
  const r = (size - stroke) / 2,
    c = 2 * Math.PI * r;
  return (
    <span className={`goal-ring ${met ? "is-met" : ""}`} style={{ width: size, height: size }}>
      <svg viewBox={`0 0 ${size} ${size}`} width={size} height={size} aria-hidden="true">
        <circle cx={size / 2} cy={size / 2} r={r} strokeWidth={stroke} className="goal-ring-track" />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          strokeWidth={stroke}
          className="goal-ring-fill"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - Math.min(1, Math.max(0, fraction)))}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </svg>
      {children && <span className="goal-ring-label">{children}</span>}
    </span>
  );
}

type GoalSource = {
  books: ShelfBook[];
  progress: Progress[];
  readingLog?: ReadingLog;
  readingSpeed: number;
  settings: Settings;
  saveSettings: (value: Settings) => Promise<void>;
};

const fmtValue = (unit: GoalUnit, value: number) => (unit === "minutes" ? Math.floor(value) : Math.floor(value));

/** Header chip on the library: today's ring and "14 / 20 min". */
export function GoalChip({ library: l, onClick }: { library: GoalSource; onClick: () => void }) {
  const t = todayGoal(l.settings.goals, l.readingLog);
  if (!t) return null;
  return (
    <button className={`goal-chip ${t.met ? "is-met" : ""}`} onClick={onClick} aria-label={`Today's goal: ${fmtValue(t.unit, t.value)} of ${unitLabel(t.unit, t.target)}${t.met ? ", done" : ""}`}>
      <GoalRing fraction={t.fraction} met={t.met} size={22} stroke={3} />
      <span>
        {t.met ? unitLabel(t.unit, t.target) : `${fmtValue(t.unit, t.value)}/${unitLabel(t.unit, t.target)}`}
      </span>
    </button>
  );
}

/** Goals section of the stats panel. */
export function GoalsPanel({ library: l }: { library: GoalSource }) {
  const today = dayKey();
  const goals = l.settings.goals;
  const [editing, setEditing] = useState(false);
  const [month, setMonth] = useState(() => {
    const d = new Date(dayNumber(today) * 86400000);
    return { y: d.getUTCFullYear(), m: d.getUTCMonth() };
  });
  const t = todayGoal(goals, l.readingLog, today);
  const week = useMemo(() => weekOf(goals, l.readingLog, today), [goals, l.readingLog, today]);
  const cells = useMemo(() => monthOf(goals, l.readingLog, month.y, month.m, today), [goals, l.readingLog, month, today]);
  const save = (next: Parameters<typeof setGoal>[1]) => void l.saveSettings({ ...l.settings, goals: setGoal(goals, next, today) });

  if (!goals || editing)
    return goals || editing ? (
      <section className="goals-panel" aria-label="Reading goal">
        <GoalEditor library={l} onDone={() => setEditing(false)} />
      </section>
    ) : (
      <section className="goals-panel goals-empty" aria-label="Reading goal">
        <Target size={18} aria-hidden="true" />
        <p>Set a gentle daily goal? Listening counts too.</p>
        <div className="chip-row">
          {goalPresets.minutes.slice(0, 3).map(n => (
            <button key={n} className="chip" onClick={() => save({ unit: "minutes", target: n, weeklyDays: 5 })}>
              {n} min
            </button>
          ))}
          <button className="text-button" onClick={() => setEditing(true)}>
            Custom…
          </button>
        </div>
      </section>
    );

  const monthName = new Date(Date.UTC(month.y, month.m, 1)).toLocaleDateString(undefined, { month: "long", year: "numeric", timeZone: "UTC" });
  const shift = (d: number) => setMonth(({ y, m }) => ({ y: m + d < 0 ? y - 1 : m + d > 11 ? y + 1 : y, m: (m + d + 12) % 12 }));
  const isCurrentMonth = today.startsWith(`${month.y}-${String(month.m + 1).padStart(2, "0")}`);
  return (
    <section className="goals-panel" aria-label="Reading goal">
      <div className="goals-today">
        <GoalRing fraction={t?.fraction || 0} met={!!t?.met} size={72} stroke={6}>
          {t ? (t.met ? "✓" : fmtValue(t.unit, t.value)) : 0}
        </GoalRing>
        <div className="goals-today-copy">
          <span className="eyebrow">Today’s goal</span>
          <strong>{t?.met ? `${unitLabel(goals.unit, goals.target)}, done` : `${t ? fmtValue(t.unit, t.value) : 0} of ${unitLabel(goals.unit, goals.target)}`}</strong>
          <span>
            {week.done ? `This week’s rhythm is done: ${week.met} of ${week.needed} days` : `${week.met} of ${week.needed} days this week`}
          </span>
        </div>
        <button className="button" onClick={() => setEditing(true)}>
          Edit goal
        </button>
      </div>
      <ol className="goals-week" aria-label="This week">
        {week.cells.map((c, i) => (
          <li key={c.day} data-state={c.state} title={`${longDate(c.day)} · ${c.state === "met" ? "goal met" : c.state === "read" ? "read, goal not met" : c.state === "future" ? "" : c.state === "today" ? "today" : "no reading"}`}>
            <i aria-hidden="true" />
            <span>{WEEKDAYS[i]}</span>
          </li>
        ))}
      </ol>
      <div className="goals-month">
        <div className="goals-month-head">
          <button className="icon-button" onClick={() => shift(-1)} aria-label="Previous month">
            <ChevronLeft size={16} />
          </button>
          <strong>{monthName}</strong>
          <button className="icon-button" onClick={() => shift(1)} disabled={isCurrentMonth} aria-label="Next month">
            <ChevronRight size={16} />
          </button>
        </div>
        <div className="goals-month-grid" role="img" aria-label={`${cells.filter(c => c?.state === "met").length} days met the goal in ${monthName}`}>
          {WEEKDAYS.map((d, i) => (
            <b key={`h${i}`}>{d}</b>
          ))}
          {cells.map((c, i) => (c ? <i key={c.day} data-state={c.state} data-today={c.day === today || undefined} title={longDate(c.day)} /> : <span key={`p${i}`} />))}
        </div>
        <p className="chart-note goals-legend">
          <i data-state="met" /> Goal met <i data-state="read" /> Read
        </p>
      </div>
    </section>
  );
}

function GoalEditor({ library: l, onDone }: { library: GoalSource; onDone: () => void }) {
  const current = l.settings.goals;
  const [unit, setUnit] = useState<GoalUnit>(current?.unit || "minutes");
  const [target, setTarget] = useState(current?.target || 20);
  const [weeklyDays, setWeeklyDays] = useState(current?.weeklyDays || 5);
  const [showInReader, setShowInReader] = useState(current?.showInReader ?? false);
  const [celebrate, setCelebrate] = useState(current?.celebrate ?? true);
  const recent = [...l.books].sort((a, b) => b.lastOpenedAt - a.lastOpenedAt)[0];
  const step = unit === "minutes" ? 5 : 1;
  const pagesFor = (minutes: number) => Math.max(1, Math.round((minutes * l.readingSpeed) / 250));
  const minutesFor = (pages: number) => Math.max(1, Math.round((pages * 250) / l.readingSpeed));
  const preview =
    unit === "minutes"
      ? `At your pace, ${target} min ≈ ${pagesFor(target)} pages${recent ? ` of ${recent.title}` : ""}.`
      : `At your pace, ${target} pages ≈ ${minutesFor(target)} min of reading or listening.`;
  const switchUnit = (u: GoalUnit) => {
    if (u === unit) return;
    setTarget(u === "pages" ? Math.min(MAX_GOAL.pages, pagesFor(target)) : Math.min(MAX_GOAL.minutes, minutesFor(target)));
    setUnit(u);
  };
  const save = () => {
    void l.saveSettings({ ...l.settings, goals: setGoal(current, { unit, target, weeklyDays, showInReader, celebrate }) });
    onDone();
  };
  return (
    <div className="goal-editor">
      <div className="goal-editor-row">
        <span className="player-label">Daily goal</span>
        <div className="segmented" role="group" aria-label="Goal unit">
          <button aria-pressed={unit === "minutes"} onClick={() => switchUnit("minutes")}>
            Minutes
          </button>
          <button aria-pressed={unit === "pages"} onClick={() => switchUnit("pages")}>
            Pages
          </button>
        </div>
      </div>
      <div className="goal-editor-row">
        <div className="chip-row">
          {goalPresets[unit].map(n => (
            <button key={n} className="chip" aria-pressed={target === n} onClick={() => setTarget(n)}>
              {unitLabel(unit, n)}
            </button>
          ))}
        </div>
        <div className="stepper" role="group" aria-label="Adjust goal">
          <button className="icon-button" onClick={() => setTarget(v => Math.max(1, v - step))} aria-label="Less">
            <Minus size={15} />
          </button>
          <output aria-live="polite">{unitLabel(unit, target)}</output>
          <button className="icon-button" onClick={() => setTarget(v => Math.min(MAX_GOAL[unit], v + step))} aria-label="More">
            <Plus size={15} />
          </button>
        </div>
      </div>
      <p className="goal-preview">{preview}</p>
      <div className="goal-editor-row">
        <span className="player-label">Days a week</span>
        <div className="chip-row days" role="group" aria-label="Days a week">
          {[1, 2, 3, 4, 5, 6, 7].map(n => (
            <button key={n} className="chip" aria-pressed={weeklyDays === n} onClick={() => setWeeklyDays(n)}>
              {n}
            </button>
          ))}
        </div>
      </div>
      <p className="goal-preview">Missing the other days breaks nothing. Your streak is counted separately.</p>
      <label className="switch-row player-toggle">
        <input type="checkbox" className="switch" checked={showInReader} onChange={e => setShowInReader(e.target.checked)} />
        <span>Show time to goal under the page</span>
      </label>
      <label className="switch-row player-toggle">
        <input type="checkbox" className="switch" checked={celebrate} onChange={e => setCelebrate(e.target.checked)} />
        <span>A quiet note when I reach it</span>
      </label>
      <div className="goal-editor-actions">
        <button className="button" onClick={onDone}>
          Cancel
        </button>
        <button className="button ink" onClick={save}>
          Save goal
        </button>
      </div>
    </div>
  );
}

type FinishSource = GoalSource & {
  speedFor: (b: BookLike) => number;
  patchBook: (id: string, patch: { finishBy?: string }) => Promise<void>;
};

/** Words left and the pace a finish date should use: the voice's when the reader mostly listens. */
export function finishPace(l: FinishSource, book: BookLike) {
  const p = l.progress.find(x => x.bookId === book.id);
  const remaining = Math.max(0, wordProgress(book, start).total - wordProgress(book, p?.at || start).before);
  const listening = mostlyListening(l.readingLog);
  const wpm = listening ? voiceWpm(l.settings.listen?.rate || 1, bookDensity(book)) : l.speedFor(book);
  return { remaining, wpm, listening };
}

/** "≈ 18 min/day to finish by Dec 1", recalculated each day; empty with no date set. */
export function finishLine(l: FinishSource, book: BookLike) {
  if (!book.finishBy) return "";
  const { remaining, wpm } = finishPace(l, book);
  if (remaining <= 0) return "";
  const plan = finishPlan(remaining, wpm, book.finishBy, dayKey(), usualMinutes(l.readingLog));
  if (plan.overdue) return `Planned finish was ${longDate(book.finishBy)}`;
  return `≈ ${plan.minutesPerDay} min/day to finish by ${longDate(book.finishBy)}`;
}

export function FinishByEditor({ library: l, book, onClose }: { library: FinishSource; book: BookLike; onClose: () => void }) {
  const today = dayKey();
  const [date, setDate] = useState(book.finishBy || dayFromNumber(dayNumber(today) + 30));
  const { remaining, wpm, listening } = finishPace(l, book);
  const usual = usualMinutes(l.readingLog);
  const plan = remaining > 0 && /^\d{4}-\d{2}-\d{2}$/.test(date) ? finishPlan(remaining, wpm, date, today, usual) : null;
  const save = (value?: string) => {
    void l.patchBook(book.id, { finishBy: value });
    onClose();
  };
  return (
    <Modal title={`Finish ${book.title} by…`} className="finish-modal" onClose={onClose}>
      <input
        className="finish-date"
        type="date"
        value={date}
        min={today}
        onChange={e => setDate(e.target.value)}
        aria-describedby="finish-feasibility"
      />
      <p id="finish-feasibility" className={`finish-feasibility ${plan?.unrealistic ? "is-stretch" : ""}`} aria-live="polite">
        {remaining <= 0
          ? "You’ve already finished this book."
          : !plan
            ? "Choose a date."
            : plan.overdue
              ? "Choose today or a later date."
              : plan.unrealistic
                ? `That needs about ${plan.minutesPerDay} min a day, a lot more than your usual ${Math.max(1, Math.round(usual))}. A later date might feel better.`
                : `About ${plan.minutesPerDay} min a day over ${plan.daysLeft} day${plan.daysLeft === 1 ? "" : "s"}, at your ${listening ? "listening" : "reading"} pace.`}
      </p>
      <p className="goal-preview">If you fall behind, the daily time adjusts quietly. Nothing is ever marked late.</p>
      <div className="goal-editor-actions">
        {book.finishBy && (
          <button className="button" onClick={() => save(undefined)}>
            Remove date
          </button>
        )}
        <button className="button ink" disabled={!plan || plan.overdue} onClick={() => save(date)}>
          Set date
        </button>
      </div>
    </Modal>
  );
}
