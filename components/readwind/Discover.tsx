"use client";
/* eslint-disable @next/next/no-img-element -- The worker already creates small immutable cover thumbnails. */
import { useEffect, useMemo, useRef, useState } from "react";
import type { Library } from "@/lib/readwind/useLibrary";
import {
  recommendCatalog,
  searchCatalog,
  type CatalogEntry,
} from "@/lib/readwind/catalog";
import { Modal } from "./Modal";
import { Icon } from "./Icon";
import { ThemeToggleButton } from "./Theme";
type SearchPage = {
  items: CatalogEntry[];
  total: number;
  nextOffset: number | null;
};
function rememberView(query: string, limit: number) {
  try {
    sessionStorage.setItem(
      "readwind-discover",
      JSON.stringify({ query, limit, scroll: window.scrollY }),
    );
  } catch {}
}
export function Discover({
  library: l,
  navigate,
}: {
  library: Library;
  navigate: (path: string) => void;
}) {
  const [query, setQuery] = useState(""),
    [entries, setEntries] = useState<CatalogEntry[]>([]),
    [loaded, setLoaded] = useState(false),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(false),
    [result, setResult] = useState<SearchPage | null>(null),
    [details, setDetails] = useState<CatalogEntry | null>(null),
    [jobs, setJobs] = useState<
      Record<string, { percent: number; error?: string }>
    >({}),
    [limit, setLimit] = useState(24);
  const sequence = useRef(0),
    alive = useRef(true),
    inflight = useRef(new Set<string>()),
    scroll = useRef(0),
    restoring = useRef(true),
    leaving = useRef(false),
    restoredSearch = useRef<{ query: string; limit: number } | null>(null),
    input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    alive.current = true;
    let stopped = false;
    const controller = new AbortController();
    try {
      const saved = JSON.parse(
        sessionStorage.getItem("readwind-discover") || "{}",
      );
      if (typeof saved.query === "string") setQuery(saved.query);
      scroll.current = Number(saved.scroll) || 0;
      restoredSearch.current = {
        query: typeof saved.query === "string" ? saved.query : "",
        limit:
          Number.isInteger(saved.limit) &&
          saved.limit >= 24 &&
          saved.limit <= 10000
            ? saved.limit
            : 24,
      };
      const cached = JSON.parse(
        sessionStorage.getItem("readwind-catalog-index") || "[]",
      );
      if (Array.isArray(cached)) setEntries(cached);
    } catch {}
    void fetch("/api/catalog/index", { signal: controller.signal })
      .then(async (r) => {
        if (!r.ok) {
          const data = (await r.json()) as { error?: string };
          throw new Error(data.error || "Could not load books.");
        }
        return r.json() as Promise<{ items: CatalogEntry[] }>;
      })
      .then((data) => {
        if (stopped) return;
        setEntries(data.items);
        setLoaded(true);
        setError("");
        try {
          sessionStorage.setItem(
            "readwind-catalog-index",
            JSON.stringify(data.items),
          );
        } catch {}
      })
      .catch((e) => {
        if (!stopped) {
          setLoaded(true);
          setError(e.message);
        }
      });
    return () => {
      stopped = true;
      alive.current = false;
      controller.abort();
    };
  }, []);
  useEffect(() => {
    const save = () => {
      if (!restoring.current && !leaving.current) rememberView(query, limit);
    };
    window.addEventListener("scroll", save, { passive: true });
    save();
    return () => window.removeEventListener("scroll", save);
  }, [query, limit]);
  useEffect(() => {
    if (!loaded || !restoring.current) return;
    const frame = requestAnimationFrame(() => {
      window.scrollTo(0, scroll.current);
      restoring.current = false;
      window.dispatchEvent(new Event("scroll"));
    });
    return () => cancelAnimationFrame(frame);
  }, [loaded, limit]);
  function leave(path: string) {
    rememberView(query, limit);
    leaving.current = true;
    navigate(path);
  }
  useEffect(() => {
    const run = ++sequence.current,
      controller = new AbortController();
    setResult(null);
    setLoading(!!query.trim());
    const target =
      restoredSearch.current?.query === query
        ? restoredSearch.current.limit
        : 24;
    if (restoredSearch.current?.query === query) restoredSearch.current = null;
    setLimit(target);
    if (!query.trim()) return;
    const timer = setTimeout(() => {
      setLoading(true);
      void (async () => {
        let page: SearchPage;
        const items: CatalogEntry[] = [];
        let offset = 0;
        do {
          const r = await fetch(
            `/api/catalog?q=${encodeURIComponent(query)}&offset=${offset}`,
            { signal: controller.signal },
          );
          if (!r.ok)
            throw new Error("Search could not connect. Showing saved matches.");
          page = (await r.json()) as SearchPage;
          if (run !== sequence.current || !alive.current) return;
          items.push(...page.items);
          if (page.nextOffset === null || page.nextOffset <= offset) break;
          offset = page.nextOffset;
        } while (items.length < target);
        return { ...page, items };
      })()
        .then((data) => {
          if (data && run === sequence.current && alive.current) {
            setResult(data);
            setError("");
          }
        })
        .catch((e) => {
          if (run === sequence.current && e.name !== "AbortError")
            setError(e.message);
        })
        .finally(() => {
          if (run === sequence.current) setLoading(false);
        });
    }, 150);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query]);
  const recommendations = useMemo(
    () => recommendCatalog(entries, l.books, l.progress, limit),
    [entries, l.books, l.progress, limit],
  );
  const cached = useMemo(() => searchCatalog(entries, query), [entries, query]);
  const items = query.trim()
    ? result?.items || cached.slice(0, limit)
    : recommendations.items.map((i) => i.entry);
  const total = query.trim()
    ? (result?.total ?? cached.length)
    : entries.length;
  async function add(entry: CatalogEntry) {
    if (inflight.current.has(entry.id)) return;
    inflight.current.add(entry.id);
    setJobs((old) => ({ ...old, [entry.id]: { percent: 0 } }));
    try {
      await l.addCatalogBook(entry.id, (percent) => {
        if (alive.current)
          setJobs((old) => ({ ...old, [entry.id]: { percent } }));
      });
      if (alive.current)
        setJobs((old) => {
          const next = { ...old };
          delete next[entry.id];
          return next;
        });
    } catch (e) {
      if (alive.current)
        setJobs((old) => ({
          ...old,
          [entry.id]: { percent: 0, error: (e as Error).message },
        }));
    } finally {
      inflight.current.delete(entry.id);
    }
  }
  async function more() {
    if (!result || result.nextOffset === null) {
      setLimit((n) => n + 24);
      return;
    }
    const run = sequence.current;
    setLoading(true);
    try {
      const r = await fetch(
        `/api/catalog?q=${encodeURIComponent(query)}&offset=${result.nextOffset}`,
      );
      if (!r.ok) throw new Error("Could not load more books. Please retry.");
      const data = (await r.json()) as SearchPage;
      if (alive.current && run === sequence.current)
        setLimit(result.items.length + data.items.length);
      if (alive.current && run === sequence.current)
        setResult((previous) =>
          previous
            ? { ...data, items: [...previous.items, ...data.items] }
            : data,
        );
    } catch (e) {
      if (alive.current && run === sequence.current)
        setError((e as Error).message);
    } finally {
      if (alive.current && run === sequence.current) setLoading(false);
    }
  }
  const action = (entry: CatalogEntry) => {
    const owned = l.books.find((b) => b.catalog?.editionId === entry.id),
      job = jobs[entry.id];
    return (
      <div className="catalog-action">
        {job && !job.error ? (
          <button
            className="button"
            disabled
            aria-label={`Adding ${entry.title}`}
          >
            {job.percent}%
          </button>
        ) : owned ? (
          <button className="button" onClick={() => leave(`/book/${owned.id}`)}>
            Read<span className="sr-only"> {entry.title}</span>
          </button>
        ) : (
          <button className="button" onClick={() => void add(entry)}>
            {job?.error ? "Retry" : "Add"}
            <span className="sr-only"> {entry.title}</span>
          </button>
        )}
        {job?.error && <small role="alert">{job.error}</small>}
      </div>
    );
  };
  return (
    <main className="app-shell discover-screen">
      <header className="document-header">
        <button
          className="icon-button"
          aria-label="Back to library"
          onClick={() => leave("/")}
        >
          <Icon name="back" />
        </button>
        <h1>Add book</h1>
        <ThemeToggleButton />
      </header>
      <div className="discover-content">
        <div className="discover-tabs">
          <span aria-current="page">Find books</span>
          <button onClick={() => leave("/import")}>Upload a file</button>
        </div>
        <div className="discover-search">
          <label htmlFor="catalog-search">Find your next book</label>
          <div>
            <Icon name="search" size={19} />
            <input
              ref={input}
              id="catalog-search"
              type="search"
              autoComplete="off"
              placeholder="Search books, authors, or subjects"
              value={query}
              maxLength={300}
              onChange={(e) => setQuery(e.target.value)}
            />
            {query && (
              <button
                aria-label="Clear search"
                onClick={() => {
                  setQuery("");
                  input.current?.focus();
                }}
              >
                ×
              </button>
            )}
          </div>
        </div>
        <div className="discover-heading">
          <h2>
            {query.trim()
              ? "Search results"
              : recommendations.personalized
                ? "For you"
                : "Explore books"}
          </h2>
          <p className="muted" role="status" aria-live="polite">
            {query.trim()
              ? `${total} ${total === 1 ? "book" : "books"}${loading ? " · Searching…" : ""}`
              : "Complete books, ready to read."}
          </p>
        </div>
        {error && (
          <div className="catalog-message" role="alert">
            <p>{error}</p>
            <button className="button" onClick={() => window.location.reload()}>
              Try again
            </button>{" "}
            <button className="button" onClick={() => leave("/import")}>
              Upload a file
            </button>
          </div>
        )}
        {!loaded && !entries.length ? (
          <div
            className="catalog-grid"
            aria-label="Loading books"
            aria-busy="true"
          >
            {Array.from({ length: 6 }, (_, i) => (
              <div className="catalog-row catalog-skeleton" key={i}>
                <div />
                <span />
              </div>
            ))}
          </div>
        ) : (
          <div className="catalog-grid">
            {items.map((entry) => (
              <article className="catalog-row" key={entry.id}>
                <button
                  className="catalog-cover"
                  aria-label={`Details for ${entry.title}`}
                  onClick={() => setDetails(entry)}
                >
                  <img
                    src={`/api/catalog/assets/${encodeURIComponent(entry.coverId)}`}
                    alt={`${entry.title} cover`}
                    width="56"
                    height="84"
                    loading="lazy"
                  />
                </button>
                <div className="catalog-copy">
                  <button
                    className="catalog-title"
                    onClick={() => setDetails(entry)}
                  >
                    {entry.title}
                  </button>
                  <p>{entry.author}</p>
                  {!query.trim() &&
                    recommendations.items.find((i) => i.entry.id === entry.id)
                      ?.reason && (
                      <small>
                        {
                          recommendations.items.find(
                            (i) => i.entry.id === entry.id,
                          )?.reason
                        }
                      </small>
                    )}
                </div>
                {action(entry)}
              </article>
            ))}
          </div>
        )}
        {loaded && !items.length && !error && (
          <div className="catalog-empty">
            <h3>
              {query.trim()
                ? "No matching books yet."
                : "Books are being prepared."}
            </h3>
            <p>
              {query.trim()
                ? "Only complete books available to add appear here. You can also upload your own copy."
                : "You can upload a PDF or EPUB while the collection grows."}
            </p>
            <button className="button" onClick={() => leave("/import")}>
              Upload a file
            </button>
          </div>
        )}
        {((query.trim() &&
          (result ? result.nextOffset !== null : cached.length > limit)) ||
          (!query.trim() && recommendations.items.length >= limit)) && (
          <button
            className="button catalog-more"
            disabled={loading}
            onClick={() => void more()}
          >
            {loading ? "Loading…" : "Load more"}
          </button>
        )}
      </div>
      {details && (
        <Modal
          title={details.title}
          className="catalog-details"
          onClose={() => setDetails(null)}
        >
          <div className="catalog-detail-book">
            <img
              src={`/api/catalog/assets/${encodeURIComponent(details.coverId)}`}
              alt={`${details.title} cover`}
              width="100"
              height="150"
            />
            <p>{details.author}</p>
          </div>
          <dl>
            <dt>Edition</dt>
            <dd>{details.edition}</dd>
            <dt>Publisher</dt>
            <dd>{details.publisher || details.source}</dd>
            <dt>Source</dt>
            <dd>
              <a href={details.sourceUrl} target="_blank" rel="noreferrer">
                {details.source}
              </a>
            </dd>
            <dt>License</dt>
            <dd>{details.license}</dd>
            <dt>Subjects</dt>
            <dd>{details.subjects.join(", ")}</dd>
          </dl>
          {details.coverNote && <p className="muted">{details.coverNote}</p>}
          <p className="muted">
            Opens in adjustable text.
            {details.format === "pdf"
              ? " Original PDF is also available while reading."
              : ""}
          </p>
          {action(details)}
        </Modal>
      )}
    </main>
  );
}
