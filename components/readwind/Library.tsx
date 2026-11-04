"use client";
import { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import type { Book } from "@/lib/readwind/types";
import type { Library as LibraryData } from "@/lib/readwind/useLibrary";
import { wordProgress, labelAt, start } from "@/lib/readwind/anchors";
import { BlobImage } from "./Page";
import { CoverTitle } from "./CoverTitle";
import {ResponsiveBookTitle} from './ResponsiveBookTitle';
import {DeleteBookPrompt} from './DeleteBookPrompt';
import { Icon } from "./Icon";
import { ImportingBook } from "./ImportingBook";
import { StreakCalendar, StreakCelebration, StreakChip, useStreakCelebration } from "./Streak";
import { dailyTotals, dayKey, streakOf } from "@/lib/readwind/reading-log";
import { deviceId } from "@/lib/readwind/db";
import { ReadwindLockup } from "./Logo";
import { ThemeToggleButton } from "./Theme";
import { BookEditor } from "./CoverPicker";
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
const readDuration=(minutes:number)=>{
  if(minutes<60)return `${minutes} min`;
  const hours=Math.floor(minutes/60),remaining=minutes%60;
  return `${hours} hr${remaining?` ${remaining} min`:''}`;
};
const readTime = (book: Book, speed = 230) => {
  const words = wordProgress(book,start,speed).total;
  const minutes = Math.max(1, Math.ceil(words / speed));
  if (!words) return "Reading time unavailable";
  return `${readDuration(minutes)} read`;
};
export function Library({
  library: l,
  navigate,
  onFile,
  onAccount,
  onStats,
  name,
  view = "library",
  catalogEnabled = false,
}: {
  library: LibraryData;
  navigate: (path: string) => void;
  onFile: (file: File) => void;
  onAccount: () => void;
  onStats: () => void;
  name?: string;
  view?: "library" | "collections";
  catalogEnabled?: boolean;
}) {
  const [calendar, setCalendar] = useState(false);
  const [selected,setSelected]=useState<string[]>([]);
  const closeMenu=(e:{currentTarget:Element})=>{e.currentTarget.closest('details')?.removeAttribute('open');};
  useEffect(()=>{
    const close=(e:Event)=>{document.querySelectorAll<HTMLDetailsElement>('details.card-menu[open]').forEach(d=>{if(!d.contains(e.target as Node))d.removeAttribute('open');});};
    const esc=(e:KeyboardEvent)=>{if(e.key==='Escape')document.querySelectorAll('details.card-menu[open]').forEach(d=>d.removeAttribute('open'));};
    document.addEventListener('pointerdown',close);document.addEventListener('keydown',esc);
    return()=>{document.removeEventListener('pointerdown',close);document.removeEventListener('keydown',esc);};
  },[]);
  const [batchError,setBatchError]=useState('');
  const organizeSelected=async(patch:Partial<Pick<Book,'readingStatus'|'tags'>>)=>{try{for(const b of l.books.filter(b=>selected.includes(b.id)))await l.saveBook({...b,...patch});setSelected([]);}catch(error){setBatchError((error as Error).message);}};
  const readDays = useMemo(() => dailyTotals(l.readingLog), [l.readingLog]);
  // Read per render so the chip rolls over at midnight on the next interaction.
  const today = dayKey();
  const streak = useMemo(() => streakOf(readDays.keys(), today), [readDays, today]);
  const celebration = useStreakCelebration(streak, l.ready);
  const [search, setSearch] = useState(""),
    [sort, setSort] = useState("Recent"),
    [collection, setCollection] = useState("All books"),
    [coverBook, setCoverBook] = useState<Book | null>(null),
    [dragging, setDragging] = useState(false);
  const [deletion,setDeletion]=useState<{owner:string;book:Book}|null>(null),[deleteError,setDeleteError]=useState('');
  const removeBook=(book:Book,dontAskAgain=false)=>{
    setDeletion(null);setDeleteError('');
    void l.deleteBook(book.id).catch(e=>setDeleteError((e as Error).message||'Could not delete this book. Please retry.'));
    if(dontAskAgain)void l.saveSettings({...l.settings,confirmBookDeletion:false}).catch(()=>setDeleteError('The book was removed, but your confirmation preference could not be saved.'));
  };
  const progressByBook=useMemo(()=>new Map(l.progress.map(p=>[p.bookId,p])),[l.progress]);
  const summaries=useMemo(()=>{
    const noteText=new Map<string,string>();
    for(const a of l.annotations)noteText.set(a.bookId,(noteText.get(a.bookId)||'')+' '+a.note+' '+a.quote);
    return new Map(l.books.map(b=>[b.id,{info:wordProgress(b,progressByBook.get(b.id)?.at || start,l.readingSpeed),text:(b.title+' '+b.author+' '+(noteText.get(b.id)||'')).toLowerCase()}]));
  },[l.books,l.annotations,progressByBook,l.readingSpeed]);
  const books = useMemo(
    () =>
      l.books
        .filter((b) => {
          const q = search.toLowerCase();
          const matches = summaries.get(b.id)!.text.includes(q);
          const percent = summaries.get(b.id)!.info.pct;
          const status=b.readingStatus || (percent>=.99?'finished':percent>0?'reading':'to-read');
          return (
            matches &&
            (collection === "All books" || b.tags?.includes(collection) ||
              (collection === "Reading" && status === "reading") ||
              (collection === "To read" && status === "to-read") ||
              (collection === "Finished" && status === "finished"))
          );
        })
        .sort((a, b) =>
          sort === "Title"
            ? a.title.localeCompare(b.title)
            : sort === "Progress"
              ? summaries.get(b.id)!.info.pct - summaries.get(a.id)!.info.pct
              : Math.max(
                  b.lastOpenedAt,
                  progressByBook.get(b.id)?.updatedAt || 0,
                ) -
                Math.max(
                  a.lastOpenedAt,
                  progressByBook.get(a.id)?.updatedAt || 0,
                ),
        ),
    [l.books, summaries, progressByBook, sort, search, collection],
  );
  const current = [...l.books].sort(
      (a, b) =>
        Math.max(
          b.lastOpenedAt,
          progressByBook.get(b.id)?.updatedAt || 0,
        ) -
        Math.max(
          a.lastOpenedAt,
          progressByBook.get(a.id)?.updatedAt || 0,
        ),
    )[0],
    progress = current
      ? progressByBook.get(current.id)
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
        {/* Client-side navigation via the app's own router; href stays for open-in-new-tab. */}
        {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
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
          aria-label="Add book"
          onClick={() => navigate(catalogEnabled?"/discover":"/import")}
        >
          <Icon name="plus" size={18} />
          <span className="import-label">Add book</span>
        </button>
        <div className="library-utility">
          <StreakChip streak={streak} onClick={() => setCalendar(true)} />
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
      {calendar && (
        <StreakCalendar
          streak={streak}
          days={readDays}
          onClose={() => setCalendar(false)}
          onStats={() => {
            setCalendar(false);
            onStats();
          }}
        />
      )}
      {celebration.show && !calendar && <StreakCelebration streak={streak} days={readDays} onClose={celebration.close} />}
      <main className="library-main">
        {view === "collections" && (
          <section className="collections-heading">
            <h1>Collections</h1>
            <p>A little order, so you can get back to reading.</p>
            <div className="collection-tabs">
              {["All books", "Reading", "To read", "Finished", ...new Set(l.books.flatMap(b=>b.tags || []))].map((c) => (
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
                  : `${current.author} · ${current.pagination==='flow'?'':`${current.printPageCount} pages · `}${readTime(current, l.readingSpeed)}`}
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
                      {current.pagination==='flow'?`${Math.round((reading?.pct||0)*100)}% read`:`Page ${labelAt(current, at)} of ${current.printPageCount}`}
                    </span>
                    <span title="Estimated from your reading pace">About {readDuration(reading!.bookMinutes)} left in book</span>
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
                    onClick={() => {
                      try { sessionStorage.removeItem("rw-notebook-from"); } catch {}
                      navigate(`/book/${current.id}/notebook`);
                    }}
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
                  ? `${current.pagination==='flow'?'Chapter '+(lastHighlight.range.start.section+1):'p. '+labelAt(current, lastHighlight.range.start)} · ${new Date(lastHighlight.createdAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })}`
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
          {l.ready && !l.books.length && !l.imports.length && (
            <div className="empty-library">
              <h2>A shelf of your own.</h2>
              <p>Find your next book, or upload a PDF or EPUB.</p>
              <div className="inline-actions">
                <button
                  className="button primary"
                  onClick={() => navigate(catalogEnabled?"/discover":"/import")}
                >
                  Add book
                </button>
                <button className="button" onClick={() => void l.addClassics()}>
                  Add the classics
                </button>
              </div>
            </div>
          )}
          {!l.ready && <p role="status">Opening your library…</p>}
          {deleteError&&<p className="form-error" role="alert">{deleteError}</p>}
          {l.settings.confirmBookDeletion===false&&<button className="delete-confirm-reset" onClick={()=>void l.saveSettings({...l.settings,confirmBookDeletion:true}).catch(()=>setDeleteError('Could not update deletion confirmations.'))}>Turn on deletion confirmations</button>}
          {!!selected.length&&<div className="bulk-bar" role="group" aria-label="Organize selected books"><span className="bulk-count">{selected.length} selected</span><button className="button" onClick={()=>void organizeSelected({readingStatus:'finished'})}>Mark finished</button><button className="button" onClick={()=>void organizeSelected({readingStatus:'to-read'})}>Mark to read</button><button className="button" onClick={()=>{const value=window.prompt('Set collections for selected books, separated by commas');if(value!==null)void organizeSelected({tags:[...new Set(value.split(',').map(t=>t.trim()).filter(Boolean))].slice(0,30)});}}>Set collections</button><button className="button ghost" onClick={()=>setSelected([])}>Clear selection</button></div>}
          {batchError&&<p role="alert">{batchError}</p>}
          <div className="shelf-grid">
            {l.imports.map((job) => (
              <ImportingBook key={job.id} job={job} thisDevice={job.deviceId === deviceId()} onDismiss={() => void l.clearImport(job.id)} />
            ))}
            <AnimatePresence initial={false} mode="popLayout">
            {books.map((b, i) => {
              const info = summaries.get(b.id)!.info;
              return (
                <motion.div
                  key={b.id}
                  data-book-id={b.id}
                  className="shelf-cell"
                  layout="position"
                  initial={{ opacity: 0, y: 22 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{opacity:0,scale:.92,y:8,pointerEvents:'none',transition:{duration:.18,delay:0,ease:'easeOut'}}}
                  transition={{
                    type: "spring",
                    stiffness: 210,
                    damping: 22,
                    delay: Math.min(i, 12) * 0.05,
                    layout:{type:'spring',stiffness:360,damping:32,delay:0},
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
                          ? `${Math.round(info.pct * 100)}% · ${readDuration(info.bookMinutes)} left`
                          : `Not started · ${readTime(b, l.readingSpeed)}`}
                      </span>
                    </div>
                  </button>
                  <label className="card-select" title="Select book"><input type="checkbox" aria-label={`Select ${b.title}`} checked={selected.includes(b.id)} onChange={e=>setSelected(ids=>e.target.checked?[...ids,b.id]:ids.filter(id=>id!==b.id))}/></label>
                  <details className="card-menu">
                    <summary aria-label={`Actions for ${b.title}`}><span aria-hidden="true">⋯</span></summary>
                    <div className="card-menu-panel" role="group" aria-label={`Actions for ${b.title}`}>
                      <span className="card-menu-label">Status</span>
                      {([['', 'Automatic'], ['to-read', 'To read'], ['reading', 'Reading'], ['finished', 'Finished']] as const).map(([value, label]) => (
                        <button key={value} type="button" className="card-menu-item" aria-pressed={(b.readingStatus || '') === value} onClick={e => { closeMenu(e); void l.saveBook({ ...b, readingStatus: (value || undefined) as Book['readingStatus'] }); }}>{label}</button>
                      ))}
                      <hr />
                      <button type="button" className="card-menu-item" onClick={e=>{closeMenu(e);const tags=window.prompt('Collections, separated by commas',b.tags?.join(', ') || '');if(tags!==null)void l.saveBook({...b,tags:[...new Set(tags.split(',').map(t=>t.trim()).filter(Boolean))].slice(0,30)});}}>Collections</button>
                      <button type="button" className="card-menu-item" aria-label={`Edit ${b.title}`} onClick={e => { closeMenu(e); setCoverBook(b); }}><Icon name="image" size={14} />Edit cover</button>
                      <button type="button" className="card-menu-item danger" aria-label={`Delete ${b.title}`} onClick={e => { closeMenu(e); setDeleteError('');if(l.settings.confirmBookDeletion===false)removeBook(b);else setDeletion({owner:l.paceOwner,book:b}); }}>Delete</button>
                    </div>
                  </details>
                </motion.div>
              );
            })}
            </AnimatePresence>
            <button className="drop-tile" onClick={() => navigate(catalogEnabled?"/discover":"/import")}>
              <Icon name="upload" size={28} />
              <span>
                <strong>
                  <span className="drop-fine">Drop a PDF or EPUB</span>
                  <span className="drop-coarse">Add a book</span>
                </strong>
                <br />
                It becomes a real book — chapters, type, the lot.
              </span>
            </button>
          </div>
          {search && !books.length && (
            <p>No books or notes match “{search}”.</p>
          )}
        </section>
        <footer className={`library-footer${l.guest?'':' has-sync'}`}>
          <span role="status" aria-live="polite">
            {l.guest
              ? "Guest shelf · saved on this device · sign in to sync"
              : l.status}
          </span>
          {l.guest ? (
            <button onClick={onAccount}>
              Make yourself at home <span aria-hidden="true">↗</span>
            </button>
          ) : (
            <button onClick={() => void l.sync(true)}>
              <Icon name="cloud" size={15} />
              Sync now
            </button>
          )}
        </footer>
      </main>
      {coverTarget && (
        <BookEditor
          book={coverTarget}
          library={l}
          onClose={() => setCoverBook(null)}
        />
      )}
      {deletion?.owner===l.paceOwner&&<DeleteBookPrompt key={deletion.book.id} title={deletion.book.title} onCancel={()=>setDeletion(null)} onDelete={skip=>removeBook(deletion.book,skip)}/>}
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
