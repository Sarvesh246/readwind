/**
 * Piper voices offered for on-device reading. Every one is a single-speaker "medium" model (about 63 MB),
 * downloaded only when chosen. Ids are Piper's own, so they double as the file names stored on the device.
 */
export type NaturalVoice = {
  id: string;
  name: string;
  gender: "Female" | "Male";
  accent: "American" | "British";
  /** A few words on how it sounds. */
  feel: string;
  /** Approximate download size in MB. */
  mb: number;
  /** Shown as "Most natural" in the picker. */
  grade?: "A";
};

/** The voice every earlier install used, so saved settings keep working. */
export const DEFAULT_NATURAL_VOICE = "en_US-ljspeech-medium";

export const NATURAL_VOICES: readonly NaturalVoice[] = [
  {
    id: "en_US-hfc_female-medium",
    name: "Hannah",
    gender: "Female",
    accent: "American",
    feel: "Clear and warm",
    mb: 63,
    grade: "A",
  },
  {
    id: "en_US-amy-medium",
    name: "Amy",
    gender: "Female",
    accent: "American",
    feel: "Bright and friendly",
    mb: 63,
  },
  {
    id: "en_US-lessac-medium",
    name: "Lessac",
    gender: "Female",
    accent: "American",
    feel: "Calm audiobook narrator",
    mb: 63,
    grade: "A",
  },
  {
    id: "en_US-kristin-medium",
    name: "Kristin",
    gender: "Female",
    accent: "American",
    feel: "Smooth and even",
    mb: 64,
  },
  {
    id: DEFAULT_NATURAL_VOICE,
    name: "LJ",
    gender: "Female",
    accent: "American",
    feel: "Classic reading voice",
    mb: 64,
  },
  {
    id: "en_US-hfc_male-medium",
    name: "Henry",
    gender: "Male",
    accent: "American",
    feel: "Clear and steady",
    mb: 63,
    grade: "A",
  },
  {
    id: "en_US-ryan-medium",
    name: "Ryan",
    gender: "Male",
    accent: "American",
    feel: "Relaxed and conversational",
    mb: 63,
    grade: "A",
  },
  {
    id: "en_US-joe-medium",
    name: "Joe",
    gender: "Male",
    accent: "American",
    feel: "Deep and calm",
    mb: 63,
  },
  {
    id: "en_US-kusal-medium",
    name: "Kusal",
    gender: "Male",
    accent: "American",
    feel: "Light and expressive",
    mb: 63,
  },
  {
    id: "en_GB-alba-medium",
    name: "Alba",
    gender: "Female",
    accent: "British",
    feel: "Scottish-tinged, gentle",
    mb: 63,
    grade: "A",
  },
  {
    id: "en_GB-jenny_dioco-medium",
    name: "Jenny",
    gender: "Female",
    accent: "British",
    feel: "Natural and warm",
    mb: 63,
    grade: "A",
  },
  {
    id: "en_GB-cori-medium",
    name: "Cori",
    gender: "Female",
    accent: "British",
    feel: "Measured storyteller",
    mb: 64,
  },
  {
    id: "en_GB-alan-medium",
    name: "Alan",
    gender: "Male",
    accent: "British",
    feel: "Classic British narrator",
    mb: 63,
    grade: "A",
  },
  {
    id: "en_GB-northern_english_male-medium",
    name: "Northern",
    gender: "Male",
    accent: "British",
    feel: "Northern English, friendly",
    mb: 63,
  },
];

export const naturalVoice = (id?: string): NaturalVoice =>
  NATURAL_VOICES.find((voice) => voice.id === id) ||
  NATURAL_VOICES.find((voice) => voice.id === DEFAULT_NATURAL_VOICE)!;
export const isNaturalVoice = (id?: string): id is string =>
  !!id && NATURAL_VOICES.some((voice) => voice.id === id);

/** Files Piper needs on the device for one voice. The names match what the library looks for. */
export const voiceFiles = (id: string) =>
  [`${id}.onnx`, `${id}.onnx.json`] as const;
