"use client";
import { useMemo, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import type { Book } from "@/lib/readwind/types";
import type { Library as LibraryData } from "@/lib/readwind/useLibrary";
import { wordProgress, labelAt, start } from "@/lib/readwind/anchors";
import { BlobImage } from "./Page";
import { CoverTitle } from "./CoverTitle";
import {ResponsiveBookTitle} from './ResponsiveBookTitle';
import { Icon } from "./Icon";
import { ReadwindLockup } from "./Logo";
import { ThemeToggleButton } from "./Theme";
import { CoverEditor } from "./CoverPicker";
import { hasReadableContent } from '@/lib/readwind/content';
export function Cover({
  book,
  loadBlob,
  className = "",
  titleMax = 22,
}: {
  book: Book;
  loadBlob: (id: string) => Promise<Blob | undefined>;
  className?: string;
  titleMax?: number;
}) {
  return (
    <div
      className={`shelf-cover ${className}`}
      style={{ background: book.cover.color, color: book.cover.fg }}
    >
      {(book.cover.kind === "pdfPage" || book.cover.kind === "image") &&
      book.cover.blobId ? (
        <BlobImage
          id={book.cover.blobId}
          loadBlob={loadBlob}
          alt={`${book.title} cover`}
          className="pdf-cover"
        />
      ) : (
        <>
          <CoverTitle text={book.title} maxSize={titleMax} />
          <span>{book.author}</span>
        </>
      )}
    </div>
  );
}
// The featured cover with two more books fanned out behind it on hover.
function CoverFan({
  book,
  others,
  loadBlob,
}: {
  book: Book;
  others: Book[];
  loadBlob: (id: string) => Promise<Blob | undefined>;
}) {
  return (
    <motion.div
      className="cover-fan"
      initial="rest"
      animate="rest"
      whileHover="fan"
    >
      <Cover
        book={book}
        loadBlob={loadBlob}
        className="continue-cover"
        titleMax={34}
      />
      {others.slice(0, 2).map((b, i) => (
        <motion.div
          key={b.id}
          className="fan-card"
          style={{ zIndex: -1 - i, transformOrigin: "50% 100%" }}
          variants={{
            rest: { rotate: 0, x: 0, opacity: 0 },
            fan: {
              rotate: (i ? 1 : -1) * (7 + i * 5),
              x: (i ? 1 : -1) * (22 + i * 10),
              opacity: 1,
            },
          }}
          transition={{ type: "spring", stiffness: 260, damping: 17 }}
        >
          <Cover book={b} loadBlob={loadBlob} className="continue-cover" />
        </motion.div>
      ))}
    </motion.div>
  );
}
// A real line from the opening of the book, cut at a sentence or word boundary.
function openingLine(book: Book) {
  const text =
    book.sections
      .flatMap((s) => s.blocks)
      .find((b) => b.type === "p" && hasReadableContent(b) && (b.text || "").length > 60)?.text || "";
  const stop = text.slice(0, 230).search(/[.!?;:]["”’]?\s/);
  if (stop > 50) return text.slice(0, stop + 1);
  if (text.length <= 170) return text;
  return `${text.slice(0, 170).replace(/\s+\S*$/, "")}…`;
}
const readTime = (book: Book, speed = 230) => {
  const words = book.sections
    .flatMap((s) => s.blocks)
    .filter(hasReadableContent)
    .reduce((n, b) => n + (b.type === "figure" ? 0 : b.text.split(/\s+/).length), 0);
  const minutes = Math.max(1, Math.ceil(words / speed));
  if (!words) return "Reading time unavailable";
  return minutes < 90 ? `${minutes} min read` : `${Math.round(minutes / 6) / 10} hr read`;
};
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
    [coverBook, setCoverBook] = useState<Book | null>(null),
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
  const reading = current ? wordProgress(current, at, l.readingSpeed) : null;
  const notes = current
    ? l.annotations.filter(
        (a) => a.bookId === current.id && a.kind === "highlight",
      )
    : [];
  const lastHighlight = [...notes].sort((a, b) => b.updatedAt - a.updatedAt)[0];
  const started = !!progress && (reading?.pct ?? 0) > 0;
  const fanBooks = l.books.filter((b) => b.id !== current?.id);
  const coverTarget = coverBook
    ? l.books.find((b) => b.id === coverBook.id) || coverBook
    : null;
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
        <button
          className="button primary library-import"
          onClick={() => navigate("/import")}
        >
          <Icon name="plus" size={18} />
          Import PDF
        </button>
        <div className="library-utility">
          <ThemeToggleButton />
          <button
            className="account-button"
            aria-label={l.guest ? "Sign in to your account" : "Your account"}
            onClick={onAccount}
            title={name || "Sign in"}
          >
            {l.guest ? "Sign in" : <Icon name="user" size={18} />}
          </button>
        </div>
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
          <motion.section
            className="continue-card"
            aria-label={started ? "Continue reading" : "Start reading"}
            initial={{ opacity: 0, y: 28 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ type: "spring", stiffness: 130, damping: 19 }}
          >
            <button
              className="cover-button"
              aria-label={`Read ${current.title}`}
              onClick={() => navigate(`/book/${current.id}`)}
            >
              <CoverFan
                book={current}
                others={fanBooks}
                loadBlob={l.loadBlob}
              />
            </button>
            <div className="continue-copy">
              <div className="eyebrow">
                {started ? "Continue reading" : "Start reading"}
              </div>
              <ResponsiveBookTitle text={current.title}/>
              <div className="chapter-label">
                {started
                  ? `Chapter ${at.section + 1} · ${current.sections[at.section]?.title}`
                  : `${current.author} · ${current.printPageCount} pages · ${readTime(current, l.readingSpeed)}`}
              </div>
              {started && (
                <div className="continue-progress">
                  <div className="progress-track">
                    <motion.div
                      initial={{ width: 0 }}
                      animate={{ width: `${reading!.pct * 100}%` }}
                      transition={{ duration: 0.9, ease: [0.22, 1, 0.36, 1], delay: 0.25 }}
                      style={{ transition: "none" }}
                    />
                  </div>
                  <div>
                    <span>
                      Page {labelAt(current, at)} of {current.printPageCount}
                    </span>
                    <span title="Estimated from your reading pace">About {reading!.bookMinutes} min left in book</span>
                  </div>
                </div>
              )}
              <div className="continue-actions">
                <button
                  className="button ink"
                  onClick={() => navigate(`/book/${current.id}`)}
                >
                  {started ? "Resume" : "Start reading"}
                </button>
                {notes.length > 0 && (
                  <button
                    className="button"
                    onClick={() => navigate(`/book/${current.id}/notebook`)}
                  >
                    {notes.length} notes & highlights
                  </button>
                )}
              </div>
            </div>
            <figure className="last-highlight">
              <figcaption className="eyebrow">
                {lastHighlight ? "Your last highlight" : "From the opening"}
              </figcaption>
              <blockquote className={lastHighlight ? undefined : "opening-quote"}>
                {lastHighlight ? (
                  <mark>{lastHighlight.quote}</mark>
                ) : (
                  <>
                    “{openingLine(current)}”
                    <cite>
                      {current.author}, {current.title}
                    </cite>
                  </>
                )}
              </blockquote>
              <div>
                {lastHighlight
                  ? `p. ${labelAt(current, lastHighlight.range.start)} · ${new Date(lastHighlight.createdAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })}`
                  : "Select a passage as you read. Keep what stays with you."}
              </div>
            </figure>
          </motion.section>
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
              <p>Import your first PDF, or start with a few classics.</p>
              <div className="inline-actions">
                <button
                  className="button primary"
                  onClick={() => navigate("/import")}
                >
                  Import PDF
                </button>
                <button className="button" onClick={() => void l.addClassics()}>
                  Add the classics
                </button>
              </div>
            </div>
          )}
          {!l.ready && <p role="status">Opening your library…</p>}
          <div className="shelf-grid">
            {books.map((b, i) => {
              const p = l.progress.find((p) => p.bookId === b.id),
                info = wordProgress(b, p?.at || start, l.readingSpeed);
              return (
                <motion.div
                  key={b.id}
                  className="shelf-cell"
                  layout="position"
                  initial={{ opacity: 0, y: 22 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{
                    type: "spring",
                    stiffness: 210,
                    damping: 22,
                    delay: Math.min(i, 12) * 0.05,
                  }}
                >
                  <button
                    className="shelf-item"
                    aria-label={`Read ${b.title}`}
                    onClick={() => navigate(`/book/${b.id}`)}
                  >
                    <Cover book={b} loadBlob={l.loadBlob} />
                    <div className="shelf-status">
                      <div className="shelf-progress">
                        <motion.div
                          initial={{ width: 0 }}
                          animate={{ width: `${info.pct * 100}%` }}
                          transition={{ duration: 0.8, ease: [0.22, 1, 0.36, 1], delay: 0.3 }}
                          style={{ transition: "none" }}
                        />
                      </div>
                      <span title="Full-book progress and estimated time at your reading pace">
                        {info.pct > 0
                          ? `${Math.round(info.pct * 100)}% · ${info.bookMinutes} min left`
                          : `Not started · ${readTime(b, l.readingSpeed)}`}
                      </span>
                    </div>
                  </button>
                  <div className="shelf-actions">
                    <button
                      className="button shelf-cover-action"
                      aria-label={`Change cover for ${b.title}`}
                      onClick={() => setCoverBook(b)}
                    >
                      <Icon name="image" size={14} />
                      Cover
                    </button>
                    <button
                      className="button shelf-delete"
                      aria-label={`Delete ${b.title}`}
                      onClick={() => {
                        if (window.confirm(`Delete “${b.title}” and its notes from your library?`)) void l.deleteBook(b.id).catch(e=>window.alert(e.message));
                      }}
                    >
                      Delete
                    </button>
                  </div>
                </motion.div>
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
              ? "Guest shelf · saved on this device · sign in to sync"
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
      {coverTarget && (
        <CoverEditor
          book={coverTarget}
          library={l}
          onClose={() => setCoverBook(null)}
        />
      )}
      <AnimatePresence>
        {dragging && (
          <motion.div
            className="drop-overlay"
            initial={{ opacity: 0, scale: 0.96 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.98 }}
            transition={{ type: "spring", stiffness: 300, damping: 26 }}
          >
            <motion.div
              animate={{ y: [0, -8, 0] }}
              transition={{ duration: 1.4, repeat: Infinity, ease: "easeInOut" }}
            >
              <Icon name="upload" size={40} />
            </motion.div>
            <h2>Drop your next good read.</h2>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
