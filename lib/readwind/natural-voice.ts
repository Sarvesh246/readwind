"use client";
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
type Pending = { resolve: (c: Clip) => void; reject: (e: Error) => void };

const READY_KEY = "readwind-piper-ljspeech";
let worker: Worker | null = null;
let nextId = 1;
const pending = new Map<number, Pending>();
let loading: Promise<void> | null = null;
let progressListener: ((loaded: number, total: number) => void) | null = null;

function connect() {
  if (worker) return worker;
  worker = new Worker(new URL("./natural-voice.worker.ts", import.meta.url), { type: "module" });
  worker.onmessage = (event: MessageEvent) => {
    const m = event.data;
    if (m.type === "progress") progressListener?.(m.loaded, m.total);
    else if (m.type === "audio") {
      const p = pending.get(m.id);
      pending.delete(m.id);
      if (!p) return;
      const buffer = m.buffer as ArrayBuffer;
      const view = new DataView(buffer);
      const seconds = (buffer.byteLength - 44) / view.getUint32(28, true);
      const url = URL.createObjectURL(new Blob([buffer], { type: "audio/wav" }));
      p.resolve({ url, seconds, load: seconds ? m.ms / 1000 / seconds : 1 });
    } else if (m.type === "error" && m.id) {
      const p = pending.get(m.id);
      pending.delete(m.id);
      p?.reject(new Error(m.message));
    }
  };
  worker.onerror = event => {
    for (const p of pending.values()) p.reject(new Error(event.message || "The voice stopped."));
    pending.clear();
    worker?.terminate();
    worker = null;
    loading = null;
  };
  return worker;
}

/** Downloads (first time) or loads (from cache) the model; resolves when it can speak. */
export function loadNaturalVoice(onProgress?: (loaded: number, total: number) => void): Promise<void> {
  if (onProgress) progressListener = onProgress;
  if (loading) return loading;
  const w = connect();
  loading = new Promise<void>((resolve, reject) => {
    const listen = (event: MessageEvent) => {
      if (event.data.type === "ready") {
        w.removeEventListener("message", listen);
        try {
          localStorage.setItem(READY_KEY, "1");
        } catch {}
        resolve();
      } else if (event.data.type === "error" && !event.data.id) {
        w.removeEventListener("message", listen);
        loading = null;
        reject(new Error(event.data.message));
      }
    };
    w.addEventListener("message", listen);
    w.addEventListener("error", event => { w.removeEventListener("message", listen); loading = null; reject(new Error(event.message || "The voice stopped.")); }, { once: true });
    w.postMessage({ type: "load" });
  });
  return loading;
}

export type ClipRequest = Promise<Clip> & { id: number };
export function generateClip(text: string, voice: string): ClipRequest {
  const id = nextId++;
  const request = new Promise<Clip>((resolve, reject) => {
    pending.set(id, { resolve, reject });
    connect().postMessage({ type: "generate", id, text, voice });
  }) as ClipRequest;
  request.id = id;
  return request;
}

/** Drops queued requests that have not started; their promises reject with "cancelled". */
export function cancelClips(ids: number[]) {
  const waiting = ids.filter(id => pending.has(id));
  if (!waiting.length) return;
  for (const id of waiting) {
    pending.get(id)!.reject(new Error("cancelled"));
    pending.delete(id);
  }
  worker?.postMessage({ type: "cancel", ids: waiting });
}

/** Whether the model has been downloaded on this device (so choosing it needs no download). */
export function naturalVoiceDownloaded() {
  try {
    return localStorage.getItem(READY_KEY) === "1";
  } catch {
    return false;
  }
}

/** Removes the cached model and runtime, and stops the worker. */
export async function removeNaturalVoice() {
  worker?.terminate();
  worker = null;
  loading = null;
  for (const p of pending.values()) p.reject(new Error("Removed"));
  pending.clear();
  try {
    localStorage.removeItem(READY_KEY);
  } catch {}
  await Promise.all(["transformers-cache", "kokoro-voices", "piper-runtime"].map(name => caches.delete(name).catch(() => false)));
  try { const root = await navigator.storage.getDirectory(); await root.removeEntry("piper", { recursive: true }); } catch {}
}

/** WebAssembly is required; very old iPhones without it can only use the system voice. */
export const naturalVoiceSupported = () =>
  typeof window !== "undefined" && typeof WebAssembly === "object" && typeof Worker !== "undefined" && typeof navigator.storage?.getDirectory === "function";
