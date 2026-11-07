"use client";
import { useState } from "react";
import { Check, Download, Loader2, Play, Sparkles, Trash2, X } from "lucide-react";
import { Modal } from "./Modal";
import { useAudiobook } from "./Audiobook";
import { NATURAL_VOICES, type NaturalVoice } from "@/lib/readwind/voices";
import { naturalVoiceSupported } from "@/lib/readwind/natural-voice";

const SAMPLE = "It was a bright cold day in April, and I settled in with a good book and nowhere else to be.";
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
  const sample = a.chunk?.kind === "text" && a.chunk.say.length > 40 ? a.chunk.say : SAMPLE;
  const voices = NATURAL_VOICES.filter(v => (gender === "All" || v.gender === gender) && (accent === "All" || v.accent === accent));
  const busy = a.download.state === "loading";
  const storedMb = NATURAL_VOICES.filter(v => a.downloaded.includes(v.id)).reduce((sum, v) => sum + v.mb, 0);
  const preview = (id: string) => {
    setPreviewing(id);
    setPreviewError("");
    a.previewNatural(id, sample)
      .catch(() => setPreviewError("Couldn’t play the preview. Try again."))
      .finally(() => setPreviewing(null));
  };
  const lang = (typeof navigator !== "undefined" ? navigator.language : "en").split("-")[0].toLowerCase();
  const systemVoices = [...a.voices].sort((x, y) => Number(/premium|enhanced/i.test(y.name)) - Number(/premium|enhanced/i.test(x.name)) || Number(y.lang.toLowerCase().startsWith(lang)) - Number(x.lang.toLowerCase().startsWith(lang)));

  const voiceRow = (v: NaturalVoice) => {
    const onDevice = a.downloaded.includes(v.id);
    const active = naturalOn && a.naturalVoiceId === v.id;
    const loading = busy && a.download.voice === v.id;
    const failed = a.download.state === "error" && a.download.voice === v.id;
    return (
      <li key={v.id} className="voice-row voice-row-piper" aria-current={active}>
        <div className="voice-row-main">
          <button className="voice-choose" disabled={!onDevice} onClick={() => a.selectNaturalVoice(v.id)} aria-label={onDevice ? `Use ${v.name}` : undefined}>
            <strong>
              {v.name}
              {v.grade && <span className="voice-best">Most natural</span>}
            </strong>
            <span>
              {v.accent} · {v.gender} · {v.feel}
            </span>
          </button>
          <div className="voice-actions">
            {onDevice && (
              <button className="icon-button" onClick={() => preview(v.id)} disabled={!!previewing} aria-label={`Preview ${v.name}`}>
                {previewing === v.id ? <Loader2 size={15} className="spin" /> : <Play size={15} />}
              </button>
            )}
            {onDevice && active && <Check size={16} className="voice-check" aria-label="In use" />}
            {onDevice && !active && (
              <button className="button small" onClick={() => a.selectNaturalVoice(v.id)}>
                Use
              </button>
            )}
            {onDevice && (
              <button className="icon-button" onClick={() => a.removeNatural(v.id)} aria-label={`Remove ${v.name} from this device`} title="Remove from this device">
                <Trash2 size={15} />
              </button>
            )}
            {!onDevice && !loading && (
              <button className="button small" onClick={() => a.downloadNatural(v.id)} disabled={busy} aria-label={`${failed ? "Try again: download" : "Download"} ${v.name}, about ${v.mb} megabytes`}>
                <Download size={14} aria-hidden="true" /> {failed ? "Retry" : `${v.mb} MB`}
              </button>
            )}
          </div>
        </div>
        {loading && (
          <div className="voice-progress">
            <div className="engine-progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(a.download.progress * 100)} aria-label={`Downloading ${v.name}`}>
              <div style={{ transform: `scaleX(${a.download.progress})` }} />
              <span>
                <Loader2 size={14} className="spin" aria-hidden="true" /> Downloading… {Math.round(a.download.progress * 100)}%
              </span>
            </div>
            <button className="icon-button" onClick={a.cancelDownload} aria-label="Cancel download">
              <X size={15} />
            </button>
          </div>
        )}
        {failed && (
          <p className="engine-note is-error">
            The download didn’t finish. Check your connection and try again.
            {a.download.error && <small className="engine-error-detail">{a.download.error}</small>}
          </p>
        )}
      </li>
    );
  };

  return (
    <Modal title="Read-aloud voice" className="voice-modal" onClose={() => a.openVoicePanel(false)}>
      {!chosen && <p className="voice-intro">Choose how books are read to you. You can change this any time from the player.</p>}
      <div className="engine-cards" role="radiogroup" aria-label="Voice type">
        <div className="engine-card" aria-checked={naturalOn} role="radio" tabIndex={-1}>
          <div className="engine-card-head">
            <Sparkles size={18} aria-hidden="true" />
            <strong>Piper voices</strong>
            {naturalOn && <span className="engine-badge">In use</span>}
          </div>
          <p>Natural voices generated on your device. Download the ones you like once (about 63 MB each) and they work offline.</p>
          {!naturalVoiceSupported() ? (
            <p className="engine-note">This device can’t run Piper voices. The device voice below works everywhere.</p>
          ) : (
            <>
              <div className="voice-filters">
                <div className="segmented" role="group" aria-label="Voice gender">
                  {(["All", "Female", "Male"] as const).map(g => (
                    <button key={g} aria-pressed={gender === g} onClick={() => setGender(g)}>
                      {g === "All" ? "Any" : g}
                    </button>
                  ))}
                </div>
                <div className="segmented" role="group" aria-label="Accent">
                  {(["All", "American", "British"] as const).map(x => (
                    <button key={x} aria-pressed={accent === x} onClick={() => setAccent(x)}>
                      {x === "All" ? "Any accent" : x}
                    </button>
                  ))}
                </div>
              </div>
              <ul className="voice-list" aria-label="Piper voices">
                {voices.map(voiceRow)}
                {!voices.length && <li className="muted voice-empty">No voices match. Try “Any”.</li>}
              </ul>
              {previewing && <p className="engine-note">The first preview takes a few seconds while the voice wakes up.</p>}
              {previewError && <p className="engine-note is-error">{previewError}</p>}
              <p className="engine-note">Best on Wi-Fi. Your browser may remove downloaded files when storage is low; Readwind will tell you if that happens.</p>
              {hasNatural && (
                <button className="text-button voice-remove" onClick={() => a.removeNatural()}>
                  <Trash2 size={14} aria-hidden="true" /> Remove all downloaded voices ({storedMb} MB)
                </button>
              )}
            </>
          )}
        </div>
        <div className="engine-card" aria-checked={chosen === "system" || (chosen === "natural" && !hasNatural)} role="radio" tabIndex={-1}>
          <div className="engine-card-head">
            <strong>Device voice</strong>
            {chosen === "system" && <span className="engine-badge">In use</span>}
          </div>
          <p>Use voices available on this device, including enhanced voices when the browser provides them. On iPhone, download voices in Settings → Accessibility → Spoken Content → Voices.</p>
          {chosen !== "system" && (
            <button className="button" onClick={() => a.chooseEngine("system")}>
              Use device voice
            </button>
          )}
        </div>
      </div>

      {chosen === "system" && systemVoices.length > 0 && (
        <section className="voice-picker" aria-label="Device voices">
          <ul className="voice-list">
            {systemVoices.map(v => (
              <li key={v.uri} className="voice-row" aria-current={a.voice?.uri === v.uri}>
                <button className="voice-choose" onClick={() => a.setVoice(v.uri)}>
                  <strong>{v.name}</strong>
                  <span>
                    {v.lang}
                    {v.local ? " · on this device" : " · online"}
                  </span>
                </button>
                {a.voice?.uri === v.uri && <Check size={16} className="voice-check" aria-label="Selected" />}
                <button className="icon-button" onClick={() => a.preview(v.uri, sample)} aria-label={`Preview ${v.name}`}>
                  <Play size={15} />
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </Modal>
  );
}
