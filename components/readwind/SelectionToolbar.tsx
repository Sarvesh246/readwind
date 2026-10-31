"use client";
import { useLayoutEffect, useRef, useState } from "react";
import { colors, type Color } from "@/lib/readwind/types";
import { Icon } from "./Icon";
import { DefinitionCard } from "./DefinitionCard";
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
    [defining, setDefining] = useState(false),
    [copied, setCopied] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const [placement, setPlacement] = useState<{left: number; top: number; maxHeight: number; dock: "top" | "bottom"; cardTop: number; cardBottom: number; cardMax: number}>({left: 12, top: 80, maxHeight: 600, dock: "bottom", cardTop: 140, cardBottom: 12, cardMax: 320});
  useLayoutEffect(() => {
    const fit = () => {
      const el = ref.current;
      if (!el) return;
      const v = window.visualViewport;
      const width = v?.width || window.innerWidth, height = v?.height || window.innerHeight;
      const x = v?.offsetLeft || 0, y = v?.offsetTop || 0;
      const top = Math.max(12, Math.min(height - el.offsetHeight - 12, position?.y || height - el.offsetHeight - 90));
      // On phones the definition sits on whichever side of the toolbar has more room, so the selected word stays visible.
      const below = height - (top + el.offsetHeight + 8) - 12, above = top - 56 - 12;
      const dock = below >= Math.min(above, 280) ? "bottom" : "top";
      setPlacement({left: x + Math.max(12, Math.min(width - el.offsetWidth - 12, (position?.x || width / 2) - el.offsetWidth / 2)),
        top: y + top,
        maxHeight: Math.max(44, height - 24),
        dock,
        cardTop: y + top + el.offsetHeight + 8,
        cardBottom: window.innerHeight - (y + top - 56),
        cardMax: Math.max(160, Math.min(420, dock === "bottom" ? below : above))});
    };
    const observer = new ResizeObserver(fit);
    if (ref.current) observer.observe(ref.current);
    window.visualViewport?.addEventListener('resize', fit);
    window.visualViewport?.addEventListener('scroll', fit);
    window.addEventListener('resize', fit);
    fit();
    return () => { observer.disconnect(); window.visualViewport?.removeEventListener('resize', fit); window.visualViewport?.removeEventListener('scroll', fit); window.removeEventListener('resize', fit); };
  }, [position]);
  return (
    <div
      className="selection-ui"
      ref={ref}
      style={{left: placement.left, top: placement.top, maxHeight: placement.maxHeight, "--card-top": `${placement.cardTop}px`, "--card-bottom": `${placement.cardBottom}px`, "--card-max": `${placement.cardMax}px`} as React.CSSProperties}
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
              aria-pressed={selectedColor === c}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => onColor(c as Color)}
            >
              <span style={{ background: bg }} />
            </button>
          ))}
        </div>
        <span className="selection-divider" />
        <button
          onClick={() => {
            setEditing((v) => !v);
            setDefining(false);
          }}
        >
          Note
        </button>
        <button
          aria-expanded={defining}
          className={defining ? "is-open" : undefined}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => {
            setDefining((v) => !v);
            setEditing(false);
            setMore(false);
          }}
        >
          Define
        </button>
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
      {defining && <DefinitionCard key={quote} quote={quote} dock={placement.dock} />}
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
