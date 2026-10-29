"use client";
import { useState } from "react";
import { colors, type Color } from "@/lib/readwind/types";
import { Icon } from "./Icon";
export function SelectionToolbar({
  quote,
  note,
  onNote,
  onColor,
  onDelete,
  onClose,
  position,
  onSearch,
  selectedColor = "yellow",
}: {
  quote: string;
  note: string;
  onNote: (s: string) => void;
  onColor: (c: Color) => void;
  onDelete?: () => void;
  onClose: () => void;
  position: { x: number; y: number } | null;
  onSearch: () => void;
  selectedColor?: Color;
}) {
  const [editing, setEditing] = useState(!!note),
    [more, setMore] = useState(false),
    [copied, setCopied] = useState(false);
  const left = position
    ? Math.max(12, Math.min(window.innerWidth - 366, position.x - 177))
    : Math.max(12, (window.innerWidth - 354) / 2);
  return (
    <div
      className="selection-ui"
      style={{
        left,
        top: position?.y || undefined,
        bottom: position ? undefined : 90,
      }}
      onKeyDown={(e) => {
        if (e.key === "Escape") onClose();
      }}
    >
      <div
        className="selection-toolbar"
        role="toolbar"
        aria-label={onDelete ? "Edit highlight" : "Highlight selected text"}
      >
        <div className="selection-swatches">
          {Object.entries(colors).map(([c, bg]) => (
            <button
              key={c}
              aria-label={`Highlight ${c}`}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => onColor(c as Color)}
            >
              <span style={{ background: bg }} />
            </button>
          ))}
        </div>
        <span className="selection-divider" />
        <button onClick={() => setEditing((v) => !v)}>Note</button>
        <a
          href={`https://en.wiktionary.org/wiki/${encodeURIComponent(quote.split(/\s+/)[0].replace(/[^\p{L}\p{N}]/gu, ""))}`}
          target="_blank"
          rel="noreferrer"
        >
          Define
        </a>
        <button
          aria-label="More selection actions"
          onClick={() => setMore((v) => !v)}
        >
          ···
        </button>
        <button
          aria-label="Dismiss selection"
          className="selection-dismiss"
          onClick={onClose}
        >
          <Icon name="close" size={14} />
        </button>
      </div>
      {editing && (
        <div className="selection-note">
          <label>
            Your thought
            <textarea
              autoFocus
              aria-label="Note for this passage"
              value={note}
              onChange={(e) => onNote(e.target.value)}
              placeholder="What does this bring to mind?"
            />
          </label>
          <button onClick={() => onColor(selectedColor)}>Save note</button>
        </div>
      )}
      {more && (
        <div className="selection-more">
          <button
            onClick={() =>
              navigator.clipboard
                .writeText(quote)
                .then(() => setCopied(true))
                .catch(() => {})
            }
          >
            {copied ? "Copied" : "Copy"}
          </button>
          <button
            onClick={() => {
              if (navigator.share)
                navigator.share({ text: quote }).catch(() => {});
              else
                navigator.clipboard
                  .writeText(quote)
                  .then(() => setCopied(true))
                  .catch(() => {});
            }}
          >
            Share
          </button>
          <button onClick={onSearch}>Search in book</button>
          {onDelete && <button onClick={onDelete}>Delete highlight</button>}
        </div>
      )}
    </div>
  );
}
