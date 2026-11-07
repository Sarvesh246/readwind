/// <reference lib="webworker" />
import { HF_BASE, PATH_MAP, TtsSession } from "@mintplex-labs/piper-tts-web";
import { fetchInto } from "./piper-download";
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

const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const ATTEMPTS = 4;
const message = (error: unknown) => String((error as Error)?.message || error || "Voice failed");
/** Names the step that failed, so a report says "model couldn't start" rather than just "voice failed". */
const step = async <T,>(label: string, work: () => Promise<T>): Promise<T> => {
  try {
    return await work();
  } catch (error) {
    throw new Error(`${label}: ${message(error)}`);
  }
};

const piperDirectory = async (create: boolean) =>
  (await navigator.storage.getDirectory()).getDirectoryHandle("piper", {
    create,
  });

async function fileSize(directory: FileSystemDirectoryHandle, name: string) {
  try {
    return (await (await directory.getFileHandle(name)).getFile()).size;
  } catch {
    return 0;
  }
}

/** Whether a voice is fully on the device. The config is written last, so it marks a finished download. */
async function onDevice(voice: string) {
  try {
    const directory = await piperDirectory(false);
    const [model, config] = voiceFiles(voice);
    return (
      (await fileSize(directory, model)) > 1_000_000 &&
      (await fileSize(directory, config)) > 0
    );
  } catch {
    return false;
  }
}

const downloads = new Map<string, Promise<void>>();
function ensureVoice(
  voice: string,
  onProgress?: (loaded: number, total: number) => void,
) {
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
      if (!(await onDevice(voice)))
        throw new Error(
          "The voice could not be saved on this device. Free some space and try again.",
        );
    })().finally(() => downloads.delete(voice));
    downloads.set(voice, running);
  }
  return running;
}

/** The runtime files are served by this app; keep them in a cache so the voice also starts offline. */
async function cacheRuntime() {
  const cache = await caches.open("piper-runtime");
  for (const url of [
    "/piper/piper_phonemize.data",
    "/piper/piper_phonemize.wasm",
    "/piper/ort-wasm-simd.wasm",
  ]) {
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
  await step("Voice runtime files unavailable", cacheRuntime);
  await ensureVoice(voice, (loaded, total) =>
    postMessage({ type: "progress", loaded, total }),
  );
  const create = () =>
    TtsSession.create({
      voiceId: voice,
      wasmPaths: {
        onnxWasm: "/piper/",
        piperData: "/piper/piper_phonemize.data",
        piperWasm: "/piper/piper_phonemize.wasm",
      },
    });
  // Downloads are verified (exact length, config written last), so a failure here is the runtime, not the
  // file: try once more, and never delete a voice the person spent 63 MB downloading.
  let failure: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    TtsSession._instance = null;
    try {
      return await step("The voice model couldn’t start", create);
    } catch (error) {
      failure = error;
      await wait(400);
    }
  }
  TtsSession._instance = null;
  throw failure;
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
self.addEventListener("unhandledrejection", (event) => event.preventDefault());

let chain: Promise<unknown> = Promise.resolve();
const cancelled = new Set<number>();
self.onmessage = (event: MessageEvent<Request>) => {
  const request = event.data;
  if (request.type === "download") {
    ensureVoice(request.voice, (loaded, total) =>
      postMessage({ type: "progress", req: request.req, loaded, total }),
    )
      .then(() => postMessage({ type: "ready", req: request.req }))
      .catch((error) =>
        postMessage({
          type: "error",
          req: request.req,
          message: message(error),
        }),
      );
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
        .catch((error) =>
          postMessage({
            type: "error",
            req: request.req,
            message: message(error),
          }),
        ),
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
      (self as unknown as { window: unknown }).window = {
        location: self.location,
        encodeURIComponent,
      };
      const audio = await step("Speaking failed", () => tts.predict(request.text));
      const buffer = await audio.arrayBuffer();
      if (cancelled.delete(request.id)) return;
      postMessage(
        {
          type: "audio",
          id: request.id,
          buffer,
          ms: performance.now() - started,
        },
        { transfer: [buffer] },
      );
    } catch (error) {
      postMessage({ type: "error", id: request.id, message: message(error) });
    }
  });
};
