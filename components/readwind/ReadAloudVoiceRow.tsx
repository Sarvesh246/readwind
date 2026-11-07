"use client";
import { Headphones } from "lucide-react";
import { useAudiobook } from "./Audiobook";
import { naturalVoice } from "@/lib/readwind/voices";

/** Comfort-sheet entry to the read-aloud voice settings. */
export function ReadAloudVoiceRow() {
  const a = useAudiobook();
  if (!a?.supported) return null;
  const current =
    a.settings.engine === "natural" && a.download.state === "ready"
      ? `Natural · ${naturalVoice(a.settings.naturalVoice).name}`
      : a.settings.engine === "system"
        ? "Device voice"
        : "Not chosen yet";
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
