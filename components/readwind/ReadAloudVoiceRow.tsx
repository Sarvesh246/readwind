"use client";
import { AudioLines, Headphones } from "lucide-react";
import { useAudiobook, voiceLabel } from "./Audiobook";

/** Library header entry: voice settings are reachable without starting a book. */
export function VoiceHeaderButton() {
  const a = useAudiobook();
  if (!a?.supported) return null;
  return (
    <button type="button" className="icon-button voice-header-button" aria-label="Read-aloud voice settings" title={`Read-aloud voice: ${voiceLabel(a)}`} onClick={() => a.openVoicePanel(true)}>
      <AudioLines size={18} aria-hidden="true" />
    </button>
  );
}

/** Comfort-sheet entry to the read-aloud voice settings. */
export function ReadAloudVoiceRow() {
  const a = useAudiobook();
  if (!a?.supported) return null;
  const current = voiceLabel(a);
  return (
    <div className="toggle-row">
      <div>
        <strong>Read-aloud voice</strong>
        <small>{current}</small>
      </div>
      <button className="button small" onClick={() => a.openVoicePanel(true)}>
        <Headphones size={15} aria-hidden="true" /> Choose
      </button>
    </div>
  );
}
