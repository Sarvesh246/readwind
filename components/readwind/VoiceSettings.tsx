"use client";
import "@/app/readwind-settings.css";
import { useState } from "react";
import {
  Check,
  Download,
  Headphones,
  Loader2,
  Play,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import { Modal } from "./Modal";
import { useAudiobook } from "./Audiobook";
import { NATURAL_VOICES, type NaturalVoice } from "@/lib/readwind/voices";
import { naturalVoiceSupported } from "@/lib/readwind/natural-voice";

const SAMPLE =
  "It was a bright cold day in April, and I settled in with a good book and nowhere else to be.";
type Filter<T extends string> = "All" | T;

/** Choose between on-device Piper voices and the system voice, then download, preview and pick a voice. */
export function VoiceSettings() {
  const a = useAudiobook()!;
  const [gender, setGender] = useState<Filter<"Female" | "Male">>("All");
  const [accent, setAccent] = useState<Filter<"American" | "British">>("All");
  const [previewing, setPreviewing] = useState<string | null>(null);
  const [previewError, setPreviewError] = useState("");
  const chosen = a.settings.engine;
  const hasNatural = a.downloaded.length > 0;
  const naturalOn = chosen === "natural" && hasNatural;
  const sample =
    a.chunk?.kind === "text" && a.chunk.say.length > 40 ? a.chunk.say : SAMPLE;
  const voices = NATURAL_VOICES.filter(
    (v) =>
      (gender === "All" || v.gender === gender) &&
      (accent === "All" || v.accent === accent),
  );
  const busy = a.download.state === "loading";
  const storedMb = NATURAL_VOICES.filter((v) =>
    a.downloaded.includes(v.id),
  ).reduce((sum, v) => sum + v.mb, 0);
  const preview = (id: string) => {
    setPreviewing(id);
    setPreviewError("");
    a.previewNatural(id, sample)
      .catch(error => setPreviewError(`Couldn’t play the preview. Try again.${error?.message ? ` (${String(error.message).slice(0, 160)})` : ""}`))
      .finally(() => setPreviewing(null));
  };
  const lang = (typeof navigator !== "undefined" ? navigator.language : "en")
    .split("-")[0]
    .toLowerCase();
  const systemVoices = [...a.voices].sort(
    (x, y) =>
      Number(/premium|enhanced/i.test(y.name)) -
        Number(/premium|enhanced/i.test(x.name)) ||
      Number(y.lang.toLowerCase().startsWith(lang)) -
        Number(x.lang.toLowerCase().startsWith(lang)),
  );

  const voiceRow = (v: NaturalVoice) => {
    const onDevice = a.downloaded.includes(v.id);
    const active = naturalOn && a.naturalVoiceId === v.id;
    const loading = busy && a.download.voice === v.id;
    const failed = a.download.state === "error" && a.download.voice === v.id;
    return (
      <li
        key={v.id}
        className="voice-row voice-row-piper"
        aria-current={active}
        data-downloaded={onDevice}
      >
        <div className="voice-row-main">
          <div className="voice-name">
            <strong>{v.name}</strong>
            <span>{v.accent} · {v.gender}</span>
            <span>{v.feel}{v.grade ? " · High quality" : ""}</span>
          </div>
          <div className="voice-actions">
            {onDevice && (
              <button
                className="icon-button"
                onClick={() => preview(v.id)}
                disabled={!!previewing}
                aria-label={`Preview ${v.name}`}
              >
                {previewing === v.id ? (
                  <Loader2 size={15} className="spin" />
                ) : (
                  <Play size={15} />
                )}
              </button>
            )}
            {onDevice && active && (
              <Check size={16} className="voice-check" aria-label="In use" />
            )}
            {onDevice && !active && (
              <button
                className="button small"
                onClick={() => a.selectNaturalVoice(v.id)}
                aria-label={`Use ${v.name}`}
              >
                Use
              </button>
            )}
            {onDevice && (
              <button
                className="icon-button"
                onClick={() => a.removeNatural(v.id)}
                aria-label={`Remove ${v.name} from this device`}
                title="Remove from this device"
              >
                <Trash2 size={15} />
              </button>
            )}
            {!onDevice && !loading && (
              <button
                className="button small"
                onClick={() => a.downloadNatural(v.id)}
                disabled={busy}
                aria-label={`${failed ? "Try again: download" : "Download"} ${v.name}, about ${v.mb} megabytes`}
              >
                <Download size={14} aria-hidden="true" />{" "}
                {failed ? "Retry" : `${v.mb} MB`}
              </button>
            )}
          </div>
        </div>
        {loading && (
          <div className="voice-progress">
            <div
              className="engine-progress"
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round(a.download.progress * 100)}
              aria-label={`Downloading ${v.name}`}
            >
              <div style={{ transform: `scaleX(${a.download.progress})` }} />
              <span>
                <Loader2 size={14} className="spin" aria-hidden="true" />{" "}
                Downloading… {Math.round(a.download.progress * 100)}%
              </span>
            </div>
            <button
              className="icon-button"
              onClick={a.cancelDownload}
              aria-label="Cancel download"
            >
              <X size={15} />
            </button>
          </div>
        )}
        {failed && (
          <p className="engine-note is-error">
            The download didn’t finish. Check your connection and try again.
            {a.download.error && (
              <small className="engine-error-detail">{a.download.error}</small>
            )}
          </p>
        )}
      </li>
    );
  };

  return (
    <Modal
      title="Read-aloud voice"
      className="settings-modal voice-modal"
      onClose={() => a.openVoicePanel(false)}
    >
      <div className="settings-body voice-body">
        <section className="voice-section" aria-labelledby="device-voice-title">
          <div className="voice-section-heading">
            <Headphones size={18} aria-hidden="true" />
            <h3 id="device-voice-title">Device voice</h3>
            {chosen === "system" && <span className="voice-in-use"><Check size={14} aria-hidden="true" /> In use</span>}
            {chosen !== "system" && (
              <button className="button small" aria-label="Use device voice" onClick={() => a.chooseEngine("system")}>Use</button>
            )}
          </div>
          <p>Use the voices provided by your device. On iPhone, find more under Settings → Accessibility → Spoken Content → Voices.</p>
          {chosen === "system" && systemVoices.length > 0 && (
            <details className="voice-device-picker">
              <summary>{a.voice?.name || "Choose a device voice"}</summary>
              <ul className="voice-list" aria-label="Device voices">
                {systemVoices.map((v) => (
                  <li key={v.uri} className="voice-row" aria-current={a.voice?.uri === v.uri}>
                    <button className="voice-choose" aria-pressed={a.voice?.uri === v.uri} onClick={() => a.setVoice(v.uri)}>
                      <strong>{v.name}</strong>
                      <span>{v.lang}{v.local ? " · on this device" : " · online"}</span>
                    </button>
                    {a.voice?.uri === v.uri && <Check size={16} className="voice-check" aria-hidden="true" />}
                    <button className="icon-button" onClick={() => a.preview(v.uri, sample)} aria-label={`Preview ${v.name}`}>
                      <Play size={15} aria-hidden="true" />
                    </button>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </section>
        <section className="voice-section" aria-labelledby="piper-voices-title">
          <div className="voice-section-heading">
            <Sparkles size={18} aria-hidden="true" />
            <h3 id="piper-voices-title">Piper voices</h3>
            {naturalOn && <span className="voice-in-use"><Check size={14} aria-hidden="true" /> In use</span>}
          </div>
          {!naturalVoiceSupported() ? (
            <p>Piper voices are unavailable on this device.</p>
          ) : (
            <>
              <p>Download a natural voice once to listen offline.</p>
              <div className="voice-filters">
                <label>
                  Voice gender
                  <select value={gender} onChange={event => setGender(event.target.value as typeof gender)}>
                    <option value="All">Any gender</option>
                    <option>Female</option>
                    <option>Male</option>
                  </select>
                </label>
                <label>
                  Accent
                  <select value={accent} onChange={event => setAccent(event.target.value as typeof accent)}>
                    <option value="All">Any accent</option>
                    <option>American</option>
                    <option>British</option>
                  </select>
                </label>
              </div>
              {previewing && <p className="engine-note" role="status">Preparing the voice preview…</p>}
              {previewError && <p className="engine-note is-error" role="alert">{previewError}</p>}
              <ul className="voice-list voice-catalog" aria-label="Piper voices">
                {voices.map(voiceRow)}
                {!voices.length && <li className="voice-empty">No voices match these filters.</li>}
              </ul>
              {hasNatural && (
                <button className="text-button voice-remove" onClick={() => a.removeNatural()}>
                  <Trash2 size={14} aria-hidden="true" /> Remove all downloaded voices ({storedMb} MB)
                </button>
              )}
            </>
          )}
        </section>
      </div>
    </Modal>
  );
}
