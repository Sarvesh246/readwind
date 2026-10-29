"use client";
import type { Settings } from "@/lib/readwind/types";
import { themes, families } from "@/lib/readwind/types";
import { Modal } from "./Modal";
export function Segments({
  value,
  options,
  onChange,
  label,
}: {
  value: string;
  options: string[];
  onChange: (v: string) => void;
  label: string;
}) {
  return (
    <div className="segments" role="group" aria-label={label}>
      {options.map((o) => (
        <button key={o} aria-pressed={o === value} onClick={() => onChange(o)}>
          {o}
        </button>
      ))}
    </div>
  );
}
export function Comfort({
  settings: s,
  onChange,
  onClose,
}: {
  settings: Settings;
  onChange: (s: Settings) => void;
  onClose: () => void;
}) {
  const set = <K extends keyof Settings>(k: K, v: Settings[K]) =>
    onChange({ ...s, [k]: v });
  return (
    <Modal title="Reading comfort" onClose={onClose} className="comfort-modal">
      <div className="comfort-row">
        <span>Paper</span>
        <div className="paper-options">
          {Object.entries(themes).map(([name, t]) => (
            <button
              key={name}
              aria-label={name}
              aria-pressed={s.paper === name}
              style={{ background: t.page, color: t.ink }}
              onClick={() => set("paper", name as Settings["paper"])}
            >
              Aa
            </button>
          ))}
        </div>
      </div>
      <div className="comfort-row">
        <span>Type</span>
        <div className="segments">
          {Object.entries(families).map(([name, f]) => (
            <button
              key={name}
              aria-pressed={s.font === name}
              style={{ fontFamily: f }}
              onClick={() => set("font", name as Settings["font"])}
            >
              {name}
            </button>
          ))}
        </div>
      </div>
      <div className="comfort-row">
        <span>Size</span>
        <div className="size-control">
          <button
            aria-label="Smaller text"
            onClick={() => set("size", Math.max(14, s.size - 1))}
          >
            A
          </button>
          <output>{s.size}</output>
          <button
            aria-label="Larger text"
            onClick={() => set("size", Math.min(28, s.size + 1))}
          >
            A
          </button>
        </div>
      </div>
      <div className="comfort-row">
        <span>Line spacing</span>
        <Segments
          label="Line spacing"
          value={s.spacing}
          options={["Snug", "Normal", "Airy"]}
          onChange={(v) => set("spacing", v as Settings["spacing"])}
        />
      </div>
      <div className="comfort-row">
        <span>Page turn</span>
        <Segments
          label="Page turn"
          value={s.turn}
          options={["Curl", "Slide", "Scroll"]}
          onChange={(v) => set("turn", v as Settings["turn"])}
        />
      </div>
      <div className="comfort-row">
        <span>Sideways & desktop</span>
        <Segments
          label="Sideways and desktop layout"
          value={s.wideLayout === "spread" ? "Two pages" : "One page"}
          options={["Two pages", "One page"]}
          onChange={(v) =>
            set("wideLayout", v === "Two pages" ? "spread" : "single")
          }
        />
      </div>
      <hr />
      {(
        [
          [
            "warmLight",
            "Warm light after sunset",
            "Shifts paper warmer as it gets late",
          ],
          [
            "restNudge",
            "Rest-eyes nudge",
            "Every 20 min: look 20 ft away for 20 s",
          ],
          [
            "focusParagraph",
            "Focus paragraph",
            "Gently dims everything but where you are",
          ],
        ] as const
      ).map(([key, title, hint]) => (
        <div className="toggle-row" key={key}>
          <div>
            <strong>{title}</strong>
            <small>{hint}</small>
          </div>
          <button
            role="switch"
            aria-label={title}
            aria-checked={s[key]}
            className="switch"
            onClick={() => set(key, !s[key])}
          >
            <span />
          </button>
        </div>
      ))}
      <button className="button primary comfort-done" onClick={onClose}>
        Done
      </button>
    </Modal>
  );
}
