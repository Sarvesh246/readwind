"use client";
import { useSyncExternalStore } from "react";
import { DropdownMenu } from "radix-ui";
import { ActionMenu } from "./ActionMenu";
import type { Book, Settings } from "@/lib/readwind/types";
import { Icon } from "./Icon";
import { Headphones } from "lucide-react";

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
  /** Absent when this device has no speech voices, or the book is shown in its original layout. */
  onListen?: () => void;
  listening?: boolean;
  onComfort: () => void;
  onCover: () => void;
  onFullScreen: () => void;
  onCloseBook: () => void;
};

// Mirror the toolbar breakpoints so its hidden commands remain reachable in More.
const narrowToolbar = "(max-width: 899px)";
const compactLandscape = "(orientation: landscape) and (max-height: 550px)";
const landscapeWithoutContents = `${compactLandscape} and (width > 600px)`;
const toolbarQueries = [narrowToolbar, compactLandscape, landscapeWithoutContents];

function subscribeToToolbar(callback: () => void) {
  const queries = toolbarQueries.map(query => window.matchMedia(query));
  queries.forEach(query => query.addEventListener("change", callback));
  return () => queries.forEach(query => query.removeEventListener("change", callback));
}

function toolbarSnapshot() {
  if (window.matchMedia(landscapeWithoutContents).matches) return "compact";
  if (window.matchMedia(compactLandscape).matches) return "compact-with-contents";
  return window.matchMedia(narrowToolbar).matches ? "narrow" : "wide";
}

/** Keep reading controls in consistent groups; secondary commands stay in More. */
export function ReaderHeader(props: Props) {
  const { book, settings } = props;
  const toolbar = useSyncExternalStore(subscribeToToolbar, toolbarSnapshot, () => "wide" as const);
  const showHiddenTools = toolbar !== "wide";
  const showNotebook = toolbar === "compact" || toolbar === "compact-with-contents";
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
        {props.onListen && (
          <button
            className="reader-tool listen-tool"
            aria-label={props.listening ? "Pause reading aloud" : "Listen to this book"}
            aria-pressed={!!props.listening}
            title={props.listening ? "Pause reading aloud" : "Listen: read the book aloud from here"}
            onClick={props.onListen}
          >
            <Headphones size={18} strokeWidth={1.8} aria-hidden="true" />
            <span>Listen</span>
          </button>
        )}
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
        <ActionMenu label="More reading options" triggerClassName="reader-tool reader-more-trigger">
          {toolbar === "compact" && (
            <DropdownMenu.Item className="action-menu-item" onSelect={props.onContents}>
              <Icon name="contents" size={17} />
              Contents
            </DropdownMenu.Item>
          )}
          {showHiddenTools && (
            <DropdownMenu.Item className="action-menu-item" onSelect={props.onSearch}>
              <Icon name="search" size={17} />
              Search in book
            </DropdownMenu.Item>
          )}
          {showNotebook && (
            <DropdownMenu.Item className="action-menu-item" onSelect={props.onNotebook}>
              <Icon name="notebook" size={17} />
              Notebook
            </DropdownMenu.Item>
          )}
          {showHiddenTools && (
            <DropdownMenu.Item className="action-menu-item" onSelect={props.onFullScreen}>
              <Icon name="full" size={17} />
              Full screen
            </DropdownMenu.Item>
          )}
          {book.sourcePdfBlobId && (
            <>
              <DropdownMenu.Item className="action-menu-item" onSelect={props.onOriginal}>
                <Icon name="file" size={17} />
                Switch to original layout
              </DropdownMenu.Item>
              <DropdownMenu.Item className="action-menu-item" onSelect={props.onOriginalPage}>
                <Icon name="single" size={17} />
                View original page
              </DropdownMenu.Item>
            </>
          )}
          {(showHiddenTools || book.sourcePdfBlobId) && <DropdownMenu.Separator className="action-menu-divider" />}
          <DropdownMenu.Item className="action-menu-item" onSelect={props.onCover}>
            <Icon name="image" size={17} />
            Edit book
          </DropdownMenu.Item>
          <DropdownMenu.Item className="action-menu-item" onSelect={props.onCloseBook}>
            <Icon name="book" size={17} />
            {props.closed ? "Open book" : "Close book"}
          </DropdownMenu.Item>
        </ActionMenu>
      </nav>
    </header>
  );
}
