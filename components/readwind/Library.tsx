"use client";
import { useMemo, useState } from "react";
import type { Book } from "@/lib/readwind/types";
import type { Library as LibraryData } from "@/lib/readwind/useLibrary";
import { wordProgress, labelAt, start } from "@/lib/readwind/anchors";
import { BlobImage } from "./Page";
import { Icon } from "./Icon";
import { ReadwindLockup } from "./Logo";
export function Cover({
  book,
  loadBlob,
  className = "",
}: {
  book: Book;
  loadBlob: (id: string) => Promise<Blob | undefined>;
  className?: string;
}) {
  return (
    <div
      className={`shelf-cover ${className}`}
      style={{ background: book.cover.color, color: book.cover.fg }}
    >
      {book.cover.kind === "pdfPage" && book.cover.blobId ? (
        <BlobImage
          id={book.cover.blobId}
          loadBlob={loadBlob}
          alt={`${book.title} cover`}
          className="pdf-cover"
        />
      ) : (
        <>
          <div>{book.title}</div>
          <span>{book.author}</span>
        </>
      )}
    </div>
  );
}
export function Library({
  library: l,
  navigate,
  onFile,
  onAccount,
  name,
  view = "library",
}: {
  library: LibraryData;
  navigate: (path: string) => void;
  onFile: (file: File) => void;
  onAccount: () => void;
  name?: string;
  view?: "library" | "collections";
}) {
  const [search, setSearch] = useState(""),
    [sort, setSort] = useState("Recent"),
    [collection, setCollection] = useState("All books"),
    [dragging, setDragging] = useState(false);
  const books = useMemo(
    () =>
      l.books
        .filter((b) => {
          const q = search.toLowerCase();
          const matches = [
            b.title,
            b.author,
            ...l.annotations
              .filter((a) => a.bookId === b.id)
              .flatMap((a) => [a.note, a.quote]),
          ].some((t) => t.toLowerCase().includes(q));
          const p = l.progress.find((p) => p.bookId === b.id);
          const percent = wordProgress(b, p?.at || start).pct;
          return (
            matches &&
            (collection === "All books" ||
              (collection === "Reading" && percent > 0 && percent < 0.99) ||
              (collection === "To read" && percent === 0) ||
              (collection === "Finished" && percent >= 0.99))
          );
        })
        .sort((a, b) =>
          sort === "Title"
            ? a.title.localeCompare(b.title)
            : sort === "Progress"
              ? wordProgress(
                  b,
                  l.progress.find((p) => p.bookId === b.id)?.at || start,
                ).pct -
                wordProgress(
                  a,
                  l.progress.find((p) => p.bookId === a.id)?.at || start,
                ).pct
              : Math.max(
                  b.lastOpenedAt,
                  l.progress.find((p) => p.bookId === b.id)?.updatedAt || 0,
                ) -
                Math.max(
                  a.lastOpenedAt,
                  l.progress.find((p) => p.bookId === a.id)?.updatedAt || 0,
                ),
        ),
    [l.books, l.annotations, l.progress, sort, search, collection],
  );
  const current = [...l.books].sort(
      (a, b) =>
        Math.max(
          b.lastOpenedAt,
          l.progress.find((p) => p.bookId === b.id)?.updatedAt || 0,
        ) -
        Math.max(
          a.lastOpenedAt,
          l.progress.find((p) => p.bookId === a.id)?.updatedAt || 0,
        ),
    )[0],
    progress = current
      ? l.progress.find((p) => p.bookId === current.id)
      : undefined,
    at = progress?.at || start;
  const reading = current ? wordProgress(current, at) : null;
  const notes = current
    ? l.annotations.filter(
        (a) => a.bookId === current.id && a.kind === "highlight",
      )
    : [];
  const lastHighlight = [...notes].sort((a, b) => b.updatedAt - a.updatedAt)[0];
  function drop(e: React.DragEvent) {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) onFile(file);
  }
  return (
    <div
      className={`app-shell library-screen ${dragging ? "dragging" : ""}`}
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node))
          setDragging(false);
      }}
      onDrop={drop}
    >
      <header className="library-header">
        <a
          href="/"
          onClick={(e) => {
            e.preventDefault();
            navigate("/");
          }}
          className="wordmark"
          aria-label="Readwind"
        >
          <ReadwindLockup height={26} />
        </a>
        <nav aria-label="Main">
          <button
            className={view === "library" ? "active" : ""}
            onClick={() => navigate("/")}
          >
            Library
          </button>
          <button
            className={view === "collections" ? "active" : ""}
            onClick={() => navigate("/collections")}
          >
            Collections
          </button>
          <button onClick={() => navigate("/notebook")}>Notebook</button>
        </nav>
        <label className="library-search">
          <Icon name="search" size={18} />
          <span className="sr-only">Search your library</span>
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search books, notes, quotes"
          />
        </label>
        <button className="button primary" onClick={() => navigate("/import")}>
          <Icon name="plus" size={18} />
          Import PDF
        </button>
        <button
          className="account-button"
          aria-label={l.guest ? "Sign in to your account" : "Your account"}
          onClick={onAccount}
          title={name || "Sign in"}
        >
          {l.guest ? "Sign in" : <Icon name="user" size={18} />}
        </button>
      </header>
      <main className="library-main">
        {view === "collections" && (
          <section className="collections-heading">
            <h1>Collections</h1>
            <p>A little order, so you can get back to reading.</p>
            <div className="collection-tabs">
              {["All books", "Reading", "To read", "Finished"].map((c) => (
                <button
                  key={c}
                  className="button"
                  aria-pressed={collection === c}
                  onClick={() => setCollection(c)}
                >
                  {c}
                </button>
              ))}
            </div>
          </section>
        )}
        {current && view === "library" && (
          <section className="continue-card" aria-label="Continue reading">
            <button
              className="cover-button"
              aria-label={`Read ${current.title}`}
              onClick={() => navigate(`/book/${current.id}`)}
            >
              <Cover
                book={current}
                loadBlob={l.loadBlob}
                className="continue-cover"
              />
            </button>
            <div className="continue-copy">
              <div className="eyebrow">Continue reading</div>
              <h1>{current.title}</h1>
              <div className="chapter-label">
                Chapter {at.section + 1} · {current.sections[at.section]?.title}
              </div>
              <div className="continue-progress">
                <div className="progress-track">
                  <div style={{ width: `${reading!.pct * 100}%` }} />
                </div>
                <div>
                  <span>
                    Page {labelAt(current, at)} of {current.printPageCount}
                  </span>
                  <span>{reading!.minutes} min left in chapter</span>
                </div>
              </div>
              <div className="continue-actions">
                <button
                  className="button ink"
                  onClick={() => navigate(`/book/${current.id}`)}
                >
                  Resume
                </button>
                <button
                  className="button"
                  onClick={() => navigate(`/book/${current.id}/notebook`)}
                >
                  {notes.length} notes & highlights
                </button>
              </div>
            </div>
            <figure className="last-highlight">
              <figcaption className="eyebrow">
                {lastHighlight
                  ? "Your last highlight"
                  : "A little room to think"}
              </figcaption>
              <blockquote>
                {lastHighlight ? (
                  <mark>{lastHighlight.quote}</mark>
                ) : (
                  "“I went to the woods because I wished to live deliberately.”"
                )}
              </blockquote>
              <div>
                {lastHighlight
                  ? `p. ${labelAt(current, lastHighlight.range.start)} · ${new Date(lastHighlight.createdAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })}`
                  : "Select a passage as you read. Keep what stays with you."}
              </div>
            </figure>
          </section>
        )}
        <section className="shelf-section" aria-labelledby="shelf">
          <div className="shelf-heading">
            <h2 id="shelf">
              {view === "collections" ? collection : "Your shelf"}
            </h2>
            <div role="group" aria-label="Sort">
              {["Recent", "Title", "Progress"].map((v) => (
                <button
                  key={v}
                  aria-pressed={sort === v}
                  onClick={() => setSort(v)}
                >
                  {v}
                </button>
              ))}
            </div>
          </div>
          {l.ready && !l.books.length && (
            <div className="empty-library">
              <h2>A shelf of your own.</h2>
              <p>Import your first PDF, or settle in with the sample books.</p>
              <div className="inline-actions">
                <button
                  className="button primary"
                  onClick={() => navigate("/import")}
                >
                  Import PDF
                </button>
                <button className="button" onClick={() => void l.addSamples()}>
                  Add sample books
                </button>
              </div>
            </div>
          )}
          {!l.ready && <p role="status">Opening your library…</p>}
          <div className="shelf-grid">
            {books.map((b) => {
              const p = l.progress.find((p) => p.bookId === b.id),
                info = wordProgress(b, p?.at || start);
              return (
                <button
                  key={b.id}
                  className="shelf-item"
                  aria-label={`Read ${b.title}`}
                  onClick={() => navigate(`/book/${b.id}`)}
                >
                  <Cover book={b} loadBlob={l.loadBlob} />
                  <div className="shelf-status">
                    <div className="shelf-progress">
                      <div style={{ width: `${info.pct * 100}%` }} />
                    </div>
                    <span>
                      {info.pct > 0
                        ? `${Math.round(info.pct * 100)}% · ${info.minutes} min left`
                        : b.sample
                          ? "Sample · not started"
                          : "Not started"}
                    </span>
                  </div>
                </button>
              );
            })}
            <button className="drop-tile" onClick={() => navigate("/import")}>
              <Icon name="upload" size={28} />
              <span>
                <strong>Drop a PDF</strong>
                <br />
                It becomes a real book — chapters, type, the lot.
              </span>
            </button>
          </div>
          {search && !books.length && (
            <p>No books or notes match “{search}”.</p>
          )}
        </section>
        <footer className="library-footer">
          <span>
            {l.guest
              ? "Sample library · sign in to keep your books on every device"
              : l.status}
          </span>
          {l.guest ? (
            <button onClick={onAccount}>
              Make yourself at home <span aria-hidden="true">↗</span>
            </button>
          ) : (
            <button onClick={() => void l.sync()}>
              <Icon name="cloud" size={15} />
              Sync now
            </button>
          )}
        </footer>
      </main>
      {dragging && (
        <div className="drop-overlay">
          <Icon name="upload" size={40} />
          <h2>Drop your next good read.</h2>
        </div>
      )}
    </div>
  );
}
