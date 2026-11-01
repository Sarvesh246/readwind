"use client";
import { useEffect, useRef } from "react";
import type { Book, Settings } from "@/lib/readwind/types";
import { Icon } from "./Icon";

type Props = {
  book: Book;
  chapter?: string;
  settings: Settings;
  hidden: boolean;
  closed: boolean;
  onLibrary: () => void;
  onLayout: (layout: Settings["wideLayout"]) => void;
  onOriginal: () => void;
  onOriginalPage: () => void;
  onContents: () => void;
  onSearch: () => void;
  onNotebook: () => void;
  onComfort: () => void;
  onCover: () => void;
  onFullScreen: () => void;
  onCloseBook: () => void;
};

/** Keep reading controls in consistent groups; secondary commands stay in More. */
export function ReaderHeader(props: Props) {
  const { book, settings } = props;
  const more = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    const closeOutside = (event: PointerEvent) => {
      if (!more.current?.contains(event.target as Node) && more.current)
        more.current.open = false;
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && more.current?.open) {
        more.current.open = false;
        more.current.querySelector("summary")?.focus();
      }
    };
    document.addEventListener("pointerdown", closeOutside);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", closeOutside);
      document.removeEventListener("keydown", escape);
    };
  }, []);
  return (
    <header
      className={`reader-header polished-reader-header ${props.hidden ? "chrome-hidden" : ""}`}
    >
      <button
        className="reader-back"
        aria-label="Back to library"
        title="Back to library"
        onClick={props.onLibrary}
      >
        <Icon name="back" size={18} />
        <span>Library</span>
      </button>
      <div className="reader-title">
        <strong title={book.title}>{book.title}</strong>
        <span title={props.chapter || book.author}>
          {props.chapter || book.author}
        </span>
      </div>
      <div className="reader-view-controls">
        {book.sourcePdfBlobId && (
          <div
            className="reader-view-switch"
            role="group"
            aria-label="Reading view"
          >
            <button
              aria-label="Adjustable text"
              aria-pressed="true"
              title="Adjustable text view"
              className="aa"
            >
              Aa<span>Text</span>
            </button>
            <button
              aria-label="Original layout"
              aria-pressed="false"
              title="Read the original PDF layout"
              onClick={props.onOriginal}
            >
              <Icon name="file" size={16} />
              <span>Original</span>
            </button>
          </div>
        )}
        {settings.turn === "Scroll" ? (
          <span
            className="reader-scroll-mode"
            title="Change page turn in reading comfort settings"
          >
            <Icon name="single" size={17} />
            Scroll view
          </span>
        ) : (
          <div
            className="layout-control reader-layout-control"
            role="group"
            aria-label="Page layout"
          >
            <button
              aria-label="Two pages"
              aria-pressed={settings.wideLayout === "spread"}
              title="Two pages"
              onClick={() => props.onLayout("spread")}
            >
              <Icon name="spread" size={17} />
              <span>Two pages</span>
            </button>
            <button
              aria-label="One page"
              aria-pressed={settings.wideLayout === "single"}
              title="One page"
              onClick={() => props.onLayout("single")}
            >
              <Icon name="single" size={17} />
              <span>One page</span>
            </button>
          </div>
        )}
      </div>
      <nav aria-label="Reader tools">
        <button
          className="reader-tool chapter-tool"
          aria-label={book.pagination==='flow'?'Contents':'Contents and go to page'}
          title={book.pagination==='flow'?'Contents':'Contents and go to page'}
          onClick={props.onContents}
        >
          <Icon name="contents" size={19} />
          <span>Contents</span>
        </button>
        <button
          className="reader-tool desktop-tool"
          aria-label="Search in book"
          title="Search in book"
          onClick={props.onSearch}
        >
          <Icon name="search" size={19} />
        </button>
        <button
          className="reader-tool"
          aria-label="Notebook"
          title="Your notes and highlights"
          onClick={props.onNotebook}
        >
          <Icon name="notebook" size={19} />
          <span>Notes</span>
        </button>
        <button
          className="reader-tool aa"
          aria-label="Type and comfort settings"
          title="Type and comfort settings"
          onClick={props.onComfort}
        >
          Aa
        </button>
        <button
          className="reader-tool desktop-tool"
          aria-label="Full screen"
          title="Full screen"
          onClick={props.onFullScreen}
        >
          <Icon name="full" size={18} />
        </button>
        <details className="reader-more" ref={more}>
          <summary
            aria-label="More reading options"
            title="More reading options"
          >
            <span aria-hidden="true">•••</span>
          </summary>
          <div
            className="reader-more-menu"
            onClick={(event) => {
              if (
                (event.target as HTMLElement).closest("button") &&
                more.current
              )
                more.current.open = false;
            }}
          >
            <p>Reading options</p>
            <button onClick={props.onComfort}>
              <span className="aa">Aa</span>Type & comfort
            </button>
            <button onClick={props.onNotebook}>
              <Icon name="notebook" size={18} />
              Notebook
            </button>
            <button onClick={props.onCover}>
              <Icon name="image" size={18} />
              Edit book
            </button>
            <button onClick={props.onCloseBook}>
              <Icon name="book" size={18} />
              {props.closed ? "Open book" : "Close book"}
            </button>
            {book.sourcePdfBlobId && (
              <>
                <button onClick={props.onOriginal}>
                  <Icon name="file" size={18} />
                  Switch to original layout
                </button>
                <button onClick={props.onOriginalPage}>
                  <Icon name="single" size={18} />
                  View original page
                </button>
              </>
            )}
          </div>
        </details>
      </nav>
    </header>
  );
}
