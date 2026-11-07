/// <reference lib="webworker" />
import { TtsSession } from "@mintplex-labs/piper-tts-web";
import { DEFAULT_NATURAL_VOICE } from "./voices";

type Request = { type: "load" } | { type: "generate"; id: number; text: string; voice: string } | { type: "cancel"; ids: number[] };
let model: Promise<TtsSession> | null = null;
function load() {
  model ??= (async () => {
    const cache = await caches.open("piper-runtime");
    for (const url of ["/piper/piper_phonemize.data", "/piper/piper_phonemize.wasm", "/piper/ort-wasm-simd.wasm"]) {
      if (!(await cache.match(url))) await cache.add(url);
    }
    return TtsSession.create({
      voiceId: DEFAULT_NATURAL_VOICE,
      wasmPaths: { onnxWasm: "/piper/", piperData: "/piper/piper_phonemize.data", piperWasm: "/piper/piper_phonemize.wasm" },
      progress: p => postMessage({ type: "progress", loaded: p.loaded, total: p.total }),
    });
  })().catch(error => { model = null; TtsSession._instance = null; throw error; });
  return model;
}
self.addEventListener("unhandledrejection", event => {
  postMessage({ type: "error", id: activeId, message: String(event.reason?.message || event.reason || "Voice failed") });
});
let activeId: number | undefined;
let chain: Promise<unknown> = Promise.resolve();
const cancelled = new Set<number>();
self.onmessage = (event: MessageEvent<Request>) => {
  const message = event.data;
  if (message.type === "load") {
    void load().then(() => postMessage({ type: "ready" })).catch(error => postMessage({ type: "error", message: String(error?.message || error) }));
    return;
  }
  if (message.type === "cancel") { for (const id of message.ids) cancelled.add(id); return; }
  chain = chain.then(async () => {
    if (cancelled.delete(message.id)) return;
    try {
      activeId = message.id;
      const tts = await load();
      const started = performance.now();
      // Vite assumes window exists when bundling the phonemizer for the browser.
      // Its location probe only needs these two properties in a worker.
      (self as unknown as { window: unknown }).window = { location: self.location, encodeURIComponent };
      const audio = await tts.predict(message.text);
      const buffer = await audio.arrayBuffer();
      if (cancelled.delete(message.id)) return;
      postMessage({ type: "audio", id: message.id, buffer, ms: performance.now() - started }, { transfer: [buffer] });
    } catch (error) { postMessage({ type: "error", id: message.id, message: String((error as Error)?.message || error) }); }
  });
};
