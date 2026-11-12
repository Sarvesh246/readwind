"use client";
import type { Anchor, Book } from "@/lib/readwind/types";
import { labelAt } from "@/lib/readwind/anchors";
import { Icon } from "./Icon";

export type FailedChange = {
  id: string;
  entity: "book" | "progress" | "annotation" | "settings" | "delete-book";
  bookId?: string;
  value: unknown;
  alternate?: unknown;
  error?: string;
};

type Row = { label: string; mine: string; theirs: string };
type Summary = { title: string; context?: string; rows: Row[] };
type Bag = Record<string, unknown>;

const bag = (value: unknown): Bag => (value && typeof value === "object" ? (value as Bag) : {});
const when = (value: unknown) =>
  typeof value === "number" && value > 0
    ? new Date(value).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })
    : "—";

/** Turns any stored value into words a reader would use. */
function show(value: unknown, key = ""): string {
  if (value === undefined || value === null || value === "") return "—";
  if (typeof value === "boolean") return value ? "On" : "Off";
  if (typeof value === "number") return /(At|Time)$/.test(key) ? when(value) : String(value);
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.length ? `${value.length} ${value.length === 1 ? "item" : "items"}` : "None";
  return "Customised";
}

const differ = (a: unknown, b: unknown) => JSON.stringify(a ?? null) !== JSON.stringify(b ?? null);

function compare(mine: Bag, theirs: Bag, labels: Record<string, string>, format: Record<string, (v: unknown) => string> = {}): Row[] {
  const rows: Row[] = [];
  for (const [key, label] of Object.entries(labels)) {
    if (!differ(mine[key], theirs[key])) continue;
    const f = format[key] ?? ((v: unknown) => show(v, key));
    rows.push({ label, mine: f(mine[key]), theirs: f(theirs[key]) });
  }
  return rows;
}

const settingLabels: Record<string, string> = {
  paper: "Page colour",
  font: "Font",
  size: "Text size",
  spacing: "Line spacing",
  turn: "Page turn style",
  wideLayout: "Page layout",
  warmLight: "Warm light",
  restNudge: "Rest reminders",
  focusParagraph: "Focus on one paragraph",
  confirmBookDeletion: "Ask before deleting books",
  dayStartHour: "Reading day starts at",
  colorNames: "Highlight colour names",
  goals: "Reading goals",
  listen: "Listening settings",
  readingPace: "Reading pace",
};

export function summarize(change: FailedChange, books: Book[]): Summary {
  const mine = bag(change.value);
  const theirs = bag(change.alternate);
  const book = books.find((b) => b.id === change.bookId);
  const bookName = book ? `“${book.title}”` : "a book";
  const anchorLabel = (value: unknown) => {
    const at = bag(value) as Partial<Anchor>;
    if (typeof at.section !== "number") return "—";
    if (!book) return `Chapter ${at.section + 1}`;
    return `Page ${labelAt(book, at as Anchor)}`;
  };

  switch (change.entity) {
    case "annotation": {
      const quote = String(mine.quote || theirs.quote || "").trim();
      const kind = (mine.kind || theirs.kind) === "bookmark" ? "Bookmark" : "Highlight";
      return {
        title: `${kind} in ${bookName}`,
        context: quote ? `“${quote.length > 140 ? `${quote.slice(0, 140).replace(/\s+\S*$/, "")}…` : quote}”` : undefined,
        rows: compare(mine, theirs, { note: "Your note", color: "Colour", deleted: "Status", updatedAt: "Last edited" }, {
          note: (v) => (v ? String(v) : "No note"),
          color: (v) => (v ? String(v).replace(/^./, (c) => c.toUpperCase()) : "—"),
          deleted: (v) => (v ? "Removed" : "Kept"),
        }),
      };
    }
    case "progress":
      return {
        title: `Reading place in ${bookName}`,
        rows: [
          ...(differ(mine.at, theirs.at) ? [{ label: "Where you stopped", mine: anchorLabel(mine.at), theirs: anchorLabel(theirs.at) }] : []),
          ...compare(mine, theirs, { updatedAt: "Last read", wordsRead: "Words read" }),
        ],
      };
    case "book":
      return {
        title: `Details for ${bookName}`,
        rows: compare(mine, theirs, { title: "Title", author: "Author", lastOpenedAt: "Last opened" }),
      };
    case "settings":
      return { title: "Your reading settings", rows: compare(mine, theirs, settingLabels) };
    case "delete-book":
      return { title: `Removing ${bookName}`, rows: [] };
  }
}

export function SyncDifferences({
  change,
  books,
  onKeepThis,
  onKeepOther,
}: {
  change: FailedChange;
  books: Book[];
  onKeepThis: () => void;
  onKeepOther: () => void;
}) {
  const { title, context, rows } = summarize(change, books);
  const comparable = change.alternate !== undefined && change.alternate !== null;
  return (
    <article className="sync-diff" role="alert">
      <header className="sync-diff-head">
        <span className="sync-diff-icon" aria-hidden="true"><Icon name="cloud" size={18} /></span>
        <div>
          <h3>{title}</h3>
          <p>{comparable ? "This was changed on two devices, so we need you to pick which version to keep." : "We couldn’t save this change yet."}</p>
        </div>
      </header>
      {context && <blockquote className="sync-diff-quote">{context}</blockquote>}
      {comparable ? (
        <>
          {rows.length > 0 ? (
            <div className="sync-diff-table" role="table" aria-label="What’s different">
              <div className="sync-diff-columns" role="row">
                <span role="columnheader" />
                <span role="columnheader">This device</span>
                <span role="columnheader">Other device</span>
              </div>
              {rows.map((row) => (
                <div className="sync-diff-row" role="row" key={row.label}>
                  <span className="sync-diff-label" role="rowheader">{row.label}</span>
                  <span className="sync-diff-value" role="cell" data-side="This device">{row.mine}</span>
                  <span className="sync-diff-value" role="cell" data-side="Other device">{row.theirs}</span>
                </div>
              ))}
            </div>
          ) : (
            <p className="sync-diff-same">The two versions look the same on the surface. Either choice is safe.</p>
          )}
          <div className="sync-diff-actions">
            <button className="button" onClick={onKeepThis}>Keep this device’s version</button>
            <button className="button" onClick={onKeepOther}>Use the other device’s version</button>
          </div>
        </>
      ) : (
        change.error && <p className="sync-diff-same">{change.error}</p>
      )}
    </article>
  );
}
