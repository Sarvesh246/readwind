"use client";
import { useState } from "react";
import type { Library } from "@/lib/readwind/useLibrary";
import type { Book, Color, Annotation } from "@/lib/readwind/types";
import { colors } from "@/lib/readwind/types";
import { labelAt, start } from "@/lib/readwind/anchors";
import { Icon } from "./Icon";
import { Modal } from "./Modal";
export function Notebook({
  library: l,
  book,
  navigate,
  onJump,
}: {
  library: Library;
  book?: Book;
  navigate: (path: string) => void;
  onJump: (book: Book, at: Annotation["range"]["start"]) => void;
}) {
  const [kind, setKind] = useState("Everything"),
    [color, setColor] = useState<Color | null>(null),
    [review, setReview] = useState(false),
    [revealed, setRevealed] = useState(false),
    [edit, setEdit] = useState<Annotation | null>(null),
    [note, setNote] = useState(""),
    [naming, setNaming] = useState(false);
  const all = l.annotations.filter((a) => !book || a.bookId === book.id),
    filtered = all.filter(
      (a) =>
        (kind === "Everything" ||
          (kind === "Highlights" && a.kind === "highlight") ||
          (kind === "Notes" && !!a.note) ||
          (kind === "Bookmarks" && a.kind === "bookmark")) &&
        (!color || a.color === color),
    );
  const due = all.filter(
      (a) =>
        // eslint-disable-next-line react-hooks/purity -- review due dates are relative to now
        a.kind === "highlight" && (!a.review || a.review.due <= Date.now()),
    ),
    card = due[0];
  const counts = {
    Everything: all.length,
    Highlights: all.filter((a) => a.kind === "highlight").length,
    Notes: all.filter((a) => a.note).length,
    Bookmarks: all.filter((a) => a.kind === "bookmark").length,
  };
  const groups = new Map<
    string,
    { title: string; book: Book; items: Annotation[] }
  >();
  filtered.forEach((a) => {
    const b = l.books.find((b) => b.id === a.bookId);
    if (!b) return;
    const key = `${b.id}:${a.range.start.section}`;
    if (!groups.has(key))
      groups.set(key, {
        title: `${book ? "" : `${b.title} · `}${b.sections[a.range.start.section]?.title || "Beginning"}`,
        book: b,
        items: [],
      });
    groups.get(key)!.items.push(a);
  });
  function download(format: "md" | "json") {
    const text =
      format === "json"
        ? JSON.stringify(all, null, 2)
        : `# ${book?.title || "Readwind"} — Notebook\n\n` +
          [...groups.values()]
            .map(
              (g) =>
                `## ${g.title}\n\n` +
                g.items
                  .map(
                    (a) =>
                      `> ${a.quote.replace(/\n/g, "\n> ")}\n\n${a.note ? `${a.note}\n\n` : ""}p. ${labelAt(g.book, a.range.start)} · ${new Date(a.createdAt).toISOString().slice(0, 10)}\n`,
                  )
                  .join("\n"),
            )
            .join("\n");
    const url = URL.createObjectURL(
      new Blob([text], {
        type: format === "md" ? "text/markdown" : "application/json",
      }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = `${book?.title || "Readwind"}-notebook.${format}`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  async function answer(again: boolean) {
    if (!card) return;
    const stages = [1, 3, 7, 16, 35],
      last = card.review?.interval || 0,
      next = again ? 1 : stages.find((n) => n > last) || 35;
    await l.saveAnnotation({
      ...card,
      review: { interval: next, due: Date.now() + next * 86400000 },
    });
    setRevealed(false);
  }
  return (
    <div className="app-shell notebook-screen">
      <header className="document-header">
        <button
          className="icon-button"
          aria-label="Back to library"
          onClick={() => navigate("/")}
        >
          <Icon name="back" />
        </button>
        <div className="document-title">
          <div className="eyebrow">Notebook</div>
          <h1>{book?.title || "From your shelf"}</h1>
        </div>
        <button className="button" onClick={() => download("md")}>
          Export to Markdown
        </button>
        <button
          className="icon-button"
          aria-label="Export notebook as JSON"
          onClick={() => download("json")}
        >
          <Icon name="download" />
        </button>
        {book && (
          <button
            className="button ink"
            onClick={() => navigate(`/book/${book.id}`)}
          >
            Back to page{" "}
            {labelAt(
              book,
              l.progress.find((p) => p.bookId === book.id)?.at || start,
            )}
          </button>
        )}
      </header>
      <div className="notebook-columns">
        <aside aria-label="Filters">
          <div className="notebook-filters">
            {Object.entries(counts).map(([k, count]) => (
              <button
                key={k}
                aria-pressed={kind === k}
                onClick={() => setKind(k)}
              >
                <span>{k}</span>
                <small>{count}</small>
              </button>
            ))}
          </div>
          <div className="color-filter">
            <div className="eyebrow">Color</div>
            <div className="highlight-colors">
              {Object.entries(colors).map(([c, bg]) => (
                <button
                  key={c}
                  aria-label={`${c} — ${l.settings.colorNames[c as Color]}`}
                  aria-pressed={color === c}
                  style={{ background: bg }}
                  onClick={() => setColor(color === c ? null : (c as Color))}
                />
              ))}
            </div>
            <button className="name-colors" onClick={() => setNaming(true)}>
              Name your colors once — they mean the same thing in every book.
            </button>
            {color && (
              <button className="text-button" onClick={() => setColor(null)}>
                Clear color filter
              </button>
            )}
          </div>
        </aside>
        <main className="notebook-entries">
          <section className="resurface-card">
            <div>
              <div className="eyebrow">Resurface</div>
              <h2>
                {due.length
                  ? `${due.length} highlights from your shelf are due for a revisit`
                  : "Your next good thought is waiting in a book"}
              </h2>
              <p>Spaced repetition, so what you read actually sticks.</p>
            </div>
            {due.length > 0 && (
              <button className="button" onClick={() => setReview(true)}>
                Start · {Math.max(1, Math.ceil(due.length * 0.5))} min
              </button>
            )}
          </section>
          {[...groups.entries()].map(([key, g]) => (
            <section className="notebook-chapter" key={key}>
              <h2>{g.title}</h2>
              {g.items.map((a) => (
                <article key={a.id}>
                  <span
                    className="color-dot"
                    style={{ background: colors[a.color] }}
                  />
                  <div>
                    <blockquote>{a.quote}</blockquote>
                    {a.note && <p>{a.note}</p>}
                    <div className="note-meta">
                      <span>
                        p. {labelAt(g.book, a.range.start)} ·{" "}
                        {a.kind === "bookmark"
                          ? "Bookmark"
                          : a.note
                            ? "Highlight + note"
                            : "Highlight"}{" "}
                        ·{" "}
                        {new Date(a.createdAt).toLocaleDateString(undefined, {
                          month: "short",
                          day: "numeric",
                        })}
                      </span>
                      <button onClick={() => onJump(g.book, a.range.start)}>
                        Open on page
                      </button>
                      <button
                        aria-label="Edit note"
                        onClick={() => {
                          setEdit(a);
                          setNote(a.note);
                        }}
                      >
                        Edit
                      </button>
                    </div>
                  </div>
                </article>
              ))}
            </section>
          ))}
          {!filtered.length && (
            <div className="empty-notebook">
              <h2>Keep what stays with you.</h2>
              <p>
                Highlight a passage, add a thought, or bookmark a page while
                reading. You’ll find it here.
              </p>
              {book && (
                <button
                  className="button ink"
                  onClick={() => navigate(`/book/${book.id}`)}
                >
                  Return to your book
                </button>
              )}
            </div>
          )}
        </main>
      </div>
      {review && (
        <Modal title="Resurface" onClose={() => setReview(false)}>
          {card ? (
            <>
              <div className="eyebrow">{due.length} remaining</div>
              <blockquote className="review-quote">{card.quote}</blockquote>
              {revealed && (
                <p>
                  {card.note ||
                    "Pause for a moment. What does this passage bring to mind?"}
                </p>
              )}
              <div className="inline-actions">
                {!revealed ? (
                  <button
                    className="button primary"
                    onClick={() => setRevealed(true)}
                  >
                    Reflect
                  </button>
                ) : (
                  <>
                    <button
                      className="button"
                      onClick={() => void answer(true)}
                    >
                      Again · tomorrow
                    </button>
                    <button
                      className="button primary"
                      onClick={() => void answer(false)}
                    >
                      Remembered
                    </button>
                  </>
                )}
              </div>
            </>
          ) : (
            <>
              <h3>A little more has stayed with you.</h3>
              <p>You’re up to date. Come back tomorrow.</p>
              <button
                className="button primary"
                onClick={() => setReview(false)}
              >
                Done
              </button>
            </>
          )}
        </Modal>
      )}
      {edit && (
        <Modal title="Edit note" onClose={() => setEdit(null)}>
          <blockquote>{edit.quote}</blockquote>
          <textarea
            aria-label="Your note"
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
          <div className="inline-actions">
            <button
              className="button primary"
              onClick={() => {
                void l.saveAnnotation({ ...edit, note });
                setEdit(null);
              }}
            >
              Save note
            </button>
            <button
              className="button"
              onClick={() => {
                void l.saveAnnotation({ ...edit, deleted: true });
                setEdit(null);
              }}
            >
              Delete
            </button>
          </div>
        </Modal>
      )}
      {naming && (
        <Modal title="Your highlight colors" onClose={() => setNaming(false)}>
          {Object.entries(colors).map(([c, bg]) => (
            <label className="color-name-row" key={c}>
              <span style={{ background: bg }} />
              <input
                aria-label={`${c} meaning`}
                maxLength={80}
                value={l.settings.colorNames[c as Color]}
                onChange={(e) =>
                  void l.saveSettings({
                    ...l.settings,
                    colorNames: {
                      ...l.settings.colorNames,
                      [c]: e.target.value,
                    },
                  })
                }
              />
            </label>
          ))}
          <button className="button primary" onClick={() => setNaming(false)}>
            Done
          </button>
        </Modal>
      )}
    </div>
  );
}
