/** Piper LJ Speech voice, trained on a public-domain dataset. */
export const DEFAULT_NATURAL_VOICE = "en_US-ljspeech-medium";
export const NATURAL_VOICES = [{ id: DEFAULT_NATURAL_VOICE, name: "LJ", gender: "Female", accent: "American", grade: "", feel: "Piper voice" }] as const;
export const naturalVoice = (id?: string) => NATURAL_VOICES.find(voice => voice.id === id) || NATURAL_VOICES[0];
export const NATURAL_DOWNLOAD_MB = 80;
