/// <reference lib="webworker" />
import { HF_BASE, PATH_MAP, TtsSession } from "@mintplex-labs/piper-tts-web";
import { voiceFiles } from "./voices";

/**
 * Two roles share this file. The "synth" worker turns sentences into speech; a short-lived "download"
 * worker fetches a voice into the origin private file system. Keeping them apart means downloading one
 * voice never stalls the voice that is reading, and a voice switch can discard the synth worker (and its
 * memory) without interrupting a download.
 */
type Request =
  | { type: "download"; req: number; voice: string }
  | { type: "warm"; req: number; voice: string }
  | { type: "generate"; id: number; text: string; voice: string }
  | { type: "cancel"; ids: number[] };

const ATTEMPTS = 4;
/** A transfer that delivers nothing for this long is abandoned and retried. */
const STALL_MS = 30000;
const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const message = (error: unknown) => String((error as Error)?.message || error || "Voice failed");

const piperDirectory = async (create: boolean) => (await navigator.storage.getDirectory()).getDirectoryHandle("piper", { create });

async function fileSize(directory: FileSystemDirectoryHandle, name: string) {
  try {
    return (await (await directory.getFileHandle(name)).getFile()).size;
  } catch {
    return 0;
  }
}

type Sink = { write(chunk: Uint8Array): Promise<void>; close(): Promise<void>; abort(): Promise<void> };
/** Streams into a file on disk. Safari's workers lack createWritable, so they use a sync access handle. */
async function openSink(directory: FileSystemDirectoryHandle, name: string): Promise<Sink> {
  const handle = await directory.getFileHandle(name, { create: true });
  if (typeof (handle as FileSystemFileHandle & { createWritable?: unknown }).createWritable === "function") {
    const writable = await handle.createWritable();
    return { write: chunk => writable.write(chunk as unknown as BufferSource), close: () => writable.close(), abort: () => writable.abort().catch(() => {}) };
  }
  const access = await (handle as FileSystemFileHandle & { createSyncAccessHandle(): Promise<{ truncate(n: number): void; write(b: BufferSource, o: { at: number }): number; flush(): void; close(): void }> }).createSyncAccessHandle();
  access.truncate(0);
  let at = 0;
  return {
    write: async chunk => {
      access.write(chunk as unknown as BufferSource, { at });
      at += chunk.byteLength;
    },
    close: async () => {
      access.flush();
      access.close();
    },
    abort: async () => {
      try {
        access.close();
      } catch {}
    },
  };
}

/** Fetches `url` into `name`, resuming nothing: each attempt starts the file over, and a short read is an error. */
async function fetchInto(directory: FileSystemDirectoryHandle, url: string, name: string, onProgress?: (loaded: number, total: number) => void) {
  let last: unknown;
  for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
    const controller = new AbortController();
    let timer = setTimeout(() => controller.abort(), STALL_MS);
    const sink = await openSink(directory, name);
    try {
      const response = await fetch(url, { signal: controller.signal });
      if (!response.ok || !response.body) throw new Error(`The download failed (${response.status || "no response"}).`);
      const total = Number(response.headers.get("Content-Length")) || 0;
      const reader = response.body.getReader();
      let loaded = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        clearTimeout(timer);
        timer = setTimeout(() => controller.abort(), STALL_MS);
        await sink.write(value);
        loaded += value.byteLength;
        onProgress?.(loaded, total);
      }
      if (total && loaded !== total) throw new Error("The download was cut short.");
      if (!loaded) throw new Error("The download was empty.");
      clearTimeout(timer);
      await sink.close();
      return;
    } catch (error) {
      clearTimeout(timer);
      await sink.abort();
      last = controller.signal.aborted ? new Error("The connection stalled.") : error;
      if (attempt < ATTEMPTS) await wait(700 * attempt * attempt);
    }
  }
  throw last instanceof Error ? last : new Error(message(last));
}

/** Whether a voice is fully on the device. The config is written last, so it marks a finished download. */
async function onDevice(voice: string) {
  try {
    const directory = await piperDirectory(false);
    const [model, config] = voiceFiles(voice);
    return (await fileSize(directory, model)) > 1_000_000 && (await fileSize(directory, config)) > 0;
  } catch {
    return false;
  }
}

const downloads = new Map<string, Promise<void>>();
function ensureVoice(voice: string, onProgress?: (loaded: number, total: number) => void) {
  const path = PATH_MAP[voice as keyof typeof PATH_MAP];
  if (!path) return Promise.reject(new Error("That voice isn’t available."));
  let running = downloads.get(voice);
  if (!running) {
    running = (async () => {
      if (await onDevice(voice)) return;
      const directory = await piperDirectory(true);
      const [model, config] = voiceFiles(voice);
      await fetchInto(directory, `${HF_BASE}/${path}`, model, onProgress);
      await fetchInto(directory, `${HF_BASE}/${path}.json`, config);
      if (!(await onDevice(voice))) throw new Error("The voice could not be saved on this device. Free some space and try again.");
    })().finally(() => downloads.delete(voice));
    downloads.set(voice, running);
  }
  return running;
}

async function removeFiles(voice: string) {
  try {
    const directory = await piperDirectory(false);
    for (const name of voiceFiles(voice)) await directory.removeEntry(name).catch(() => {});
  } catch {}
}

/** The runtime files are served by this app; keep them in a cache so the voice also starts offline. */
async function cacheRuntime() {
  const cache = await caches.open("piper-runtime");
  for (const url of ["/piper/piper_phonemize.data", "/piper/piper_phonemize.wasm", "/piper/ort-wasm-simd.wasm"]) {
    if (await cache.match(url)) continue;
    for (let attempt = 1; ; attempt++) {
      try {
        await cache.add(url);
        break;
      } catch (error) {
        if (attempt >= ATTEMPTS) throw error;
        await wait(500 * attempt);
      }
    }
  }
}

let current: { voice: string; session: Promise<TtsSession> } | null = null;
async function createSession(voice: string) {
  await cacheRuntime();
  await ensureVoice(voice, (loaded, total) => postMessage({ type: "progress", loaded, total }));
  const create = () =>
    TtsSession.create({
      voiceId: voice,
      wasmPaths: { onnxWasm: "/piper/", piperData: "/piper/piper_phonemize.data", piperWasm: "/piper/piper_phonemize.wasm" },
    });
  TtsSession._instance = null;
  try {
    return await create();
  } catch (error) {
    // A file cut off by a closed tab or an evicted cache loads as garbage: discard it and fetch it fresh, once.
    TtsSession._instance = null;
    await removeFiles(voice);
    await ensureVoice(voice);
    try {
      return await create();
    } catch {
      TtsSession._instance = null;
      throw error;
    }
  }
}
function sessionFor(voice: string) {
  if (current?.voice === voice) return current.session;
  const session = createSession(voice);
  current = { voice, session };
  session.catch(() => {
    if (current?.session === session) current = null;
    TtsSession._instance = null;
  });
  return session;
}

// A stray rejection (for example from the wasm runtime) must not be reported as a failed request:
// every request already reports its own errors.
self.addEventListener("unhandledrejection", event => event.preventDefault());

let chain: Promise<unknown> = Promise.resolve();
const cancelled = new Set<number>();
self.onmessage = (event: MessageEvent<Request>) => {
  const request = event.data;
  if (request.type === "download") {
    ensureVoice(request.voice, (loaded, total) => postMessage({ type: "progress", req: request.req, loaded, total }))
      .then(() => postMessage({ type: "ready", req: request.req }))
      .catch(error => postMessage({ type: "error", req: request.req, message: message(error) }));
    return;
  }
  if (request.type === "cancel") {
    for (const id of request.ids) cancelled.add(id);
    return;
  }
  if (request.type === "warm") {
    chain = chain.then(() =>
      sessionFor(request.voice)
        .then(() => postMessage({ type: "ready", req: request.req }))
        .catch(error => postMessage({ type: "error", req: request.req, message: message(error) })),
    );
    return;
  }
  chain = chain.then(async () => {
    if (cancelled.delete(request.id)) return;
    try {
      const tts = await sessionFor(request.voice);
      if (cancelled.delete(request.id)) return;
      const started = performance.now();
      // Vite assumes window exists when bundling the phonemizer for the browser.
      // Its location probe only needs these two properties in a worker.
      (self as unknown as { window: unknown }).window = { location: self.location, encodeURIComponent };
      const audio = await tts.predict(request.text);
      const buffer = await audio.arrayBuffer();
      if (cancelled.delete(request.id)) return;
      postMessage({ type: "audio", id: request.id, buffer, ms: performance.now() - started }, { transfer: [buffer] });
    } catch (error) {
      postMessage({ type: "error", id: request.id, message: message(error) });
    }
  });
};
