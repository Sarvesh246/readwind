"use client";
import { useState } from "react";
import { Check, Download, Loader2, Play, Sparkles, Trash2 } from "lucide-react";
import { Modal } from "./Modal";
import { useAudiobook } from "./Audiobook";
import { NATURAL_DOWNLOAD_MB, NATURAL_VOICES, DEFAULT_NATURAL_VOICE } from "@/lib/readwind/voices";
import { naturalVoiceSupported } from "@/lib/readwind/natural-voice";

const SAMPLE = "It was a bright cold day in April, and I settled in with a good book and nowhere else to be.";
type Filter<T extends string> = "All" | T;

/** Choose between on-device natural voices and the system voice, then pick and preview a voice. */
export function VoiceSettings() {
  const a = useAudiobook()!;
  const [gender, setGender] = useState<Filter<"Female" | "Male">>("All");
  const [accent, setAccent] = useState<Filter<"American" | "British">>("All");
  const [previewing, setPreviewing] = useState<string | null>(null);
  const [previewError, setPreviewError] = useState("");
  const chosen = a.settings.engine;
  const natural = a.download.state === "ready";
  const current = a.settings.naturalVoice || DEFAULT_NATURAL_VOICE;
  const sample = a.chunk?.kind === "text" && a.chunk.say.length > 40 ? a.chunk.say : SAMPLE;
  const voices = NATURAL_VOICES.filter(v => (gender === "All" || v.gender === gender) && (accent === "All" || v.accent === accent));
  const preview = (id: string) => {
    setPreviewing(id);
    setPreviewError("");
    a.previewNatural(id, sample)
      .catch(() => setPreviewError("Couldn’t play the preview. Try again."))
      .finally(() => setPreviewing(null));
  };
  const lang = (typeof navigator !== "undefined" ? navigator.language : "en").split("-")[0].toLowerCase();
  const systemVoices = [...a.voices].sort ( (a, b) => Number(/premium|enhanced/i.test(b.name)) - Number(/premium|enhanced/i.test(a.name)) || Number(b.lang.toLowerCase().startsWith(lang)) - Number(a.lang.toLowerCase().startsWith(lang)) );
  return (
    <Modal title="Read-aloud voice" className="voice-modal" onClose={() => a.openVoicePanel(false)}>
      {!chosen && <p className="voice-intro">Choose how books are read to you. You can change this any time.</p>}
      <div className="engine-cards" role="radiogroup" aria-label="Voice type">
        <div className="engine-card" aria-checked={chosen === "natural" && natural} role="radio" tabIndex={-1}>
          <div className="engine-card-head">
            <Sparkles size={18} aria-hidden="true" />
            <strong>Piper voice</strong>

          </div>
          <p>An English voice generated on your device. Download once to listen offline.</p>
          {!naturalVoiceSupported() ? (
            <p className="engine-note">This device can’t run natural voices.</p>
          ) : a.download.state === "loading" ? (
            <div className="engine-progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(a.download.progress * 100)} aria-label="Downloading natural voices">
              <div style={{ transform: `scaleX(${a.download.progress})` }} />
              <span>
                <Loader2 size={14} className="spin" aria-hidden="true" /> Downloading… {Math.round(a.download.progress * 100)}%
              </span>
            </div>
          ) : natural ? (
            chosen === "natural" ? (
              <span className="engine-chosen">
                <Check size={15} aria-hidden="true" /> In use
              </span>
            ) : (
              <button className="button ink" onClick={() => a.chooseEngine("natural")}>
                Use natural voices
              </button>
            )
          ) : (
            <>
              <button className="button ink" onClick={a.downloadNatural}>
                <Download size={16} aria-hidden="true" /> Download Piper voice · about {NATURAL_DOWNLOAD_MB} MB
              </button>
              {a.download.state === "error" && (
                <p className="engine-note is-error">
                  The download stopped. Check your connection and try again.
                  {a.download.error && <small className="engine-error-detail">{a.download.error}</small>}
                </p>
              )}
              <p className="engine-note">Best on Wi-Fi. Your browser may remove downloaded files when storage is low.</p>
            </>
          )}
        </div>
        {(
          <div className="engine-card" aria-checked={chosen === "system" || (chosen === "natural" && !natural)} role="radio" tabIndex={-1}>
            <div className="engine-card-head">
              <strong>Device voice</strong>
            </div>
            <p>Use voices available on this device, including enhanced voices when the browser provides them. On iPhone, download voices in Settings → Accessibility → Spoken Content → Voices.</p>
            {chosen === "system" ? (
              <span className="engine-chosen">
                <Check size={15} aria-hidden="true" /> In use
              </span>
            ) : (
              <button className="button" onClick={() => a.chooseEngine("system")}>
                Use device voice
              </button>
            )}
          </div>
        )}
      </div>

      {natural && (chosen === "natural" || !chosen) && (
        <section className="voice-picker" aria-label="Natural voices">
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
          <ul className="voice-list">
            {voices.map(v => (
              <li key={v.id} className="voice-row" aria-current={current === v.id}>
                <button
                  className="voice-choose"
                  onClick={() => {
                    a.setNaturalVoice(v.id);
                    if (chosen !== "natural") a.chooseEngine("natural");
                  }}
                >
                  <strong>
                    {v.name}
                    {v.grade.startsWith("A") && <span className="voice-best">Most natural</span>}
                  </strong>
                  <span>
                    {v.feel} · {v.accent} · {v.gender === "Female" ? "Female" : "Male"}
                  </span>
                </button>
                {current === v.id && <Check size={16} className="voice-check" aria-label="Selected" />}
                <button className="icon-button" onClick={() => preview(v.id)} disabled={!!previewing} aria-label={`Preview ${v.name}`}>
                  {previewing === v.id ? <Loader2 size={15} className="spin" /> : <Play size={15} />}
                </button>
              </li>
            ))}
            {!voices.length && <li className="muted voice-empty">No voices match. Try “Any”.</li>}
          </ul>
          {previewing && <p className="engine-note">The first preview takes a few seconds while the voice wakes up.</p>}
          {previewError && <p className="engine-note is-error">{previewError}</p>}
        </section>
      )}

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

      {natural && (
        <button className="text-button voice-remove" onClick={a.removeNatural}>
          <Trash2 size={14} aria-hidden="true" /> Remove Piper voice
        </button>
      )}
    </Modal>
  );
}
