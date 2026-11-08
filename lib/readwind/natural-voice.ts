"use client";
import { DEFAULT_NATURAL_VOICE, NATURAL_VOICES, isNaturalVoice, voiceFiles } from "./voices";
import workerVersion from "./piper-worker-version.json";
/**
 * Main-thread side of the natural voice: one shared worker, a request queue, and WAV blobs that play
 * through an ordinary <audio> element.
 */

/** 16-bit mono WAV, which every browser's audio element plays. */
export function encodeWav(samples: Float32Array, rate: number): ArrayBuffer {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);
  const text = (at: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(at + i, s.charCodeAt(i));
  };
  text(0, "RIFF");
  view.setUint32(4, 36 + samples.length * 2, true);
  text(8, "WAVE");
  text(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, rate, true);
  view.setUint32(28, rate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  text(36, "data");
  view.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return buffer;
}

export type Clip = { url: string; seconds: number; /** Generation time ÷ audio length; above 1 the phone is slower than speech. */ load: number };

type ClipRequestState = { resolve: (c: Clip) => void; reject: (e: Error) => void; voice: string };
type JobState = { resolve: () => void; reject: (e: Error) => void; onProgress?: (loaded: number, total: number) => void };

/** A worker that says nothing for this long while work is queued is presumed hung and replaced. */
const STALL_MS = 90000;
const LIST_KEY = "readwind-piper-voices";
const LEGACY_KEY = "readwind-piper-ljspeech";

let synth: Worker | null = null;
let synthVoice: string | null = null;
let downloader: Worker | null = null;
let nextId = 1;
let lastActivity = 0;
let watchdog: ReturnType<typeof setInterval> | undefined;
const clips = new Map<number, ClipRequestState>();
const jobs = new Map<number, JobState>();

const spawn = () => new Worker(`/piper/worker-${workerVersion.version}.mjs`, { type: "module" });
const failure = (text?: string) => new Error(text || "The voice stopped.");

/** Stops the speech worker and frees its memory; the next request starts a fresh one. */
function retireSynth(reason: Error) {
  const w = synth;
  synth = null;
  synthVoice = null;
  w?.terminate();
  for (const p of clips.values()) p.reject(reason);
  clips.clear();
}

function watch() {
  if (watchdog) return;
  watchdog = setInterval(() => {
    if (!clips.size) {
      clearInterval(watchdog);
      watchdog = undefined;
    } else if (Date.now() - lastActivity > STALL_MS) retireSynth(failure("The voice stopped responding."));
  }, 10000);
}

function handle(m: { type: string; id?: number; req?: number; buffer?: ArrayBuffer; ms?: number; message?: string; loaded?: number; total?: number }) {
  lastActivity = Date.now();
  if (m.type === "progress") {
    if (m.req !== undefined) jobs.get(m.req)?.onProgress?.(m.loaded ?? 0, m.total ?? 0);
  } else if (m.type === "ready" && m.req !== undefined) {
    const j = jobs.get(m.req);
    jobs.delete(m.req);
    j?.resolve();
  } else if (m.type === "audio" && m.id !== undefined) {
    const p = clips.get(m.id);
    clips.delete(m.id);
    if (!p || !m.buffer) return;
    const view = new DataView(m.buffer);
    const seconds = (m.buffer.byteLength - 44) / view.getUint32(28, true);
    const url = URL.createObjectURL(new Blob([m.buffer], { type: "audio/wav" }));
    p.resolve({ url, seconds, load: seconds ? (m.ms ?? 0) / 1000 / seconds : 1 });
  } else if (m.type === "error") {
    if (m.id !== undefined) {
      const p = clips.get(m.id);
      clips.delete(m.id);
      p?.reject(failure(m.message));
    } else if (m.req !== undefined) {
      const j = jobs.get(m.req);
      jobs.delete(m.req);
      j?.reject(failure(m.message));
    }
  }
}

function synthFor(voice: string) {
  // One voice per worker: switching voices starts over, so a model that is no longer used does not stay in memory.
  if (synth && synthVoice !== voice) retireSynth(failure("cancelled"));
  if (synth) return synth;
  const w = spawn();
  const crashed = (text?: string) => {
    if (synth !== w) return;
    synth = null;
    synthVoice = null;
    w.terminate();
    for (const p of clips.values()) p.reject(failure(text));
    clips.clear();
    for (const [key, j] of jobs)
      if (j.onProgress === undefined) {
        jobs.delete(key);
        j.reject(failure(text));
      }
  };
  w.onmessage = event => synth === w && handle(event.data);
  w.onerror = event => crashed(event.message);
  w.onmessageerror = () => crashed();
  synth = w;
  synthVoice = voice;
  lastActivity = Date.now();
  return w;
}

/** Fetches a voice onto this device (a no-op if it is already there). Resolves when it is ready to use. */
export function downloadNaturalVoice(voice: string, onProgress?: (loaded: number, total: number) => void): Promise<void> {
  const w = spawn();
  downloader = w;
  const req = nextId++;
  const done = () => {
    w.terminate();
    if (downloader === w) downloader = null;
  };
  return new Promise<void>((resolve, reject) => {
    jobs.set(req, { resolve, reject, onProgress });
    w.onmessage = event => handle(event.data);
    w.onerror = event => {
      jobs.delete(req);
      reject(failure(event.message || "The download stopped."));
    };
    w.postMessage({ type: "download", req, voice });
  }).then(
    async () => {
      done();
      const stored = await refreshDownloadedVoices();
      if (!stored.includes(voice)) throw new Error("The voice could not be saved on this device. Free some space and try again.");
      // Ask the browser not to clear what was just downloaded when storage runs low.
      void navigator.storage?.persist?.().catch(() => {});
    },
    error => {
      done();
      throw error;
    },
  );
}

/** Stops a download in progress. Its promise rejects with "cancelled". */
export function cancelDownload() {
  downloader?.terminate();
  downloader = null;
  for (const [key, j] of jobs)
    if (j.onProgress) {
      jobs.delete(key);
      j.reject(failure("cancelled"));
    }
}

/** Starts loading a downloaded voice into the speech worker, so the first sentence is not slow. */
export function warmNaturalVoice(voice: string): Promise<void> {
  const w = synthFor(voice);
  const req = nextId++;
  return new Promise<void>((resolve, reject) => {
    jobs.set(req, { resolve, reject });
    w.postMessage({ type: "warm", req, voice });
  });
}

export type ClipRequest = Promise<Clip> & { id: number };
export function generateClip(text: string, voice: string): ClipRequest {
  const id = nextId++;
  // Pick the worker first: a voice change discards the old worker and cancels what it was holding.
  const worker = synthFor(voice);
  const request = new Promise<Clip>((resolve, reject) => {
    clips.set(id, { resolve, reject, voice });
    worker.postMessage({ type: "generate", id, text, voice });
    watch();
  }) as ClipRequest;
  request.id = id;
  return request;
}

/** Drops queued requests that have not started; their promises reject with "cancelled". */
export function cancelClips(ids: number[]) {
  const waiting = ids.filter(id => clips.has(id));
  if (!waiting.length) return;
  for (const id of waiting) {
    clips.get(id)!.reject(failure("cancelled"));
    clips.delete(id);
  }
  synth?.postMessage({ type: "cancel", ids: waiting });
}

/** Discards the speech worker (and its memory) after a failure, so the next sentence starts clean. */
export function resetNaturalVoice() {
  retireSynth(failure("cancelled"));
}

const readList = (): string[] => {
  try {
    const stored = JSON.parse(localStorage.getItem(LIST_KEY) || "null");
    if (Array.isArray(stored)) return stored.filter(isNaturalVoice);
    // Installs from before several voices were offered recorded one flag for the single voice.
    return localStorage.getItem(LEGACY_KEY) === "1" ? [DEFAULT_NATURAL_VOICE] : [];
  } catch {
    return [];
  }
};
const writeList = (voices: string[]) => {
  try {
    localStorage.setItem(LIST_KEY, JSON.stringify(voices));
    localStorage.removeItem(LEGACY_KEY);
  } catch {}
};

/** Voices recorded as on this device. Instant, but a guess until `refreshDownloadedVoices` checks the disk. */
export const downloadedVoices = (): string[] => readList();
export const naturalVoiceDownloaded = (voice?: string) => (voice ? readList().includes(voice) : readList().length > 0);

/** Looks at the device's storage, which the browser may have cleared, and returns the voices truly there. */
export async function refreshDownloadedVoices(): Promise<string[]> {
  if (!naturalVoiceSupported()) return [];
  const found: string[] = [];
  try {
    const directory = await (await navigator.storage.getDirectory()).getDirectoryHandle("piper");
    for (const voice of NATURAL_VOICES) {
      const [model, config] = voiceFiles(voice.id);
      try {
        const size = async (name: string) => (await (await directory.getFileHandle(name)).getFile()).size;
        if ((await size(model)) > 1_000_000 && (await size(config)) > 0) found.push(voice.id);
      } catch {}
    }
  } catch {}
  writeList(found);
  return found;
}

/** Removes one voice, or every voice and the cached runtime when no voice is given. */
export async function removeNaturalVoice(voice?: string) {
  if (!voice || voice === synthVoice) retireSynth(failure("Removed"));
  if (!voice) cancelDownload();
  try {
    const directory = await (await navigator.storage.getDirectory()).getDirectoryHandle("piper");
    if (voice) for (const name of voiceFiles(voice)) await directory.removeEntry(name).catch(() => {});
    else await (await navigator.storage.getDirectory()).removeEntry("piper", { recursive: true });
  } catch {}
  if (!voice) {
    const names = await caches.keys();
    await Promise.all(names.filter(name => name === "transformers-cache" || name === "kokoro-voices" || name === "piper-runtime" || name.startsWith("piper-runtime-")).map(name => caches.delete(name).catch(() => false)));
  }
  await refreshDownloadedVoices();
}

/** WebAssembly is required; very old iPhones without it can only use the system voice. */
export const naturalVoiceSupported = () =>
  typeof window !== "undefined" && typeof WebAssembly === "object" && typeof Worker !== "undefined" && typeof navigator.storage?.getDirectory === "function";
