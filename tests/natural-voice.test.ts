import { describe, it, expect } from "vitest";
import { encodeWav } from "../lib/readwind/natural-voice";
import { PATH_MAP } from "@mintplex-labs/piper-tts-web";
import { NATURAL_VOICES, naturalVoice, isNaturalVoice, voiceFiles, DEFAULT_NATURAL_VOICE } from "../lib/readwind/voices";
import { settings } from "../lib/readwind/schemas";
import { defaults, listenDefaults } from "../lib/readwind/types";

describe("WAV encoding", () => {
  it("writes a 16-bit mono PCM header and clamps samples", () => {
    const wav = new DataView(encodeWav(new Float32Array([0, 0.5, -1, 2]), 24000));
    const text = (at: number) => String.fromCharCode(...[0, 1, 2, 3].map(i => wav.getUint8(at + i)));
    expect(text(0)).toBe("RIFF");
    expect(text(8)).toBe("WAVE");
    expect(wav.getUint16(22, true)).toBe(1);
    expect(wav.getUint32(24, true)).toBe(24000);
    expect(wav.getUint32(40, true)).toBe(8);
    expect(wav.getInt16(46, true)).toBe(Math.floor(0.5 * 0x7fff));
    expect(wav.getInt16(48, true)).toBe(-0x8000);
    expect(wav.getInt16(50, true)).toBe(0x7fff);
  });
});

describe("natural voices", () => {
  it("offers both genders and accents, with the long-standing default still present", () => {
    expect(NATURAL_VOICES.some(v => v.id === DEFAULT_NATURAL_VOICE)).toBe(true);
    expect(naturalVoice("missing").id).toBe(DEFAULT_NATURAL_VOICE);
    for (const gender of ["Female", "Male"] as const)
      for (const accent of ["American", "British"] as const)
        expect(NATURAL_VOICES.filter(v => v.gender === gender && v.accent === accent).length).toBeGreaterThanOrEqual(2);
  });
  it("lists each voice once, with an id Piper can download and the settings schema accepts", () => {
    const ids = NATURAL_VOICES.map(v => v.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const v of NATURAL_VOICES) {
      expect(PATH_MAP[v.id as keyof typeof PATH_MAP], v.id).toBeTruthy();
      expect(v.id).toMatch(/^[a-zA-Z0-9_-]{1,80}$/);
      expect(v.mb).toBeGreaterThan(10);
      expect(isNaturalVoice(v.id)).toBe(true);
    }
    expect(isNaturalVoice("../evil")).toBe(false);
    expect(voiceFiles("en_GB-alan-medium")).toEqual(["en_GB-alan-medium.onnx", "en_GB-alan-medium.onnx.json"]);
  });
  it("saves the chosen engine and voice through the settings schema", () => {
    const listen = { ...listenDefaults, engine: "natural" as const, naturalVoice: DEFAULT_NATURAL_VOICE };
    expect(settings.parse({ ...defaults, listen }).listen).toEqual(listen);
    expect(() => settings.parse({ ...defaults, listen: { ...listen, naturalVoice: "../evil" } })).toThrow();
  });
});
