import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { encodeWav } from "../lib/readwind/natural-voice";

type Handler = ((event: { data?: unknown; message?: string }) => void) | null;
class FakeWorker {
  static all: FakeWorker[] = [];
  onmessage: Handler = null;
  onerror: Handler = null;
  onmessageerror: Handler = null;
  sent: Array<Record<string, unknown>> = [];
  terminated = false;
  constructor() {
    FakeWorker.all.push(this);
  }
  postMessage(message: Record<string, unknown>) {
    this.sent.push(message);
  }
  terminate() {
    this.terminated = true;
  }
  say(data: unknown) {
    this.onmessage?.({ data });
  }
}

/** A tiny stand-in for the origin private file system: just names and sizes. */
function storage(files: Record<string, number>) {
  let present = true;
  const directory = {
    getFileHandle: async (name: string) => {
      if (!(name in files)) throw new Error("NotFound");
      return { getFile: async () => ({ size: files[name] }) };
    },
    removeEntry: async (name: string) => {
      delete files[name];
    },
  };
  const root = {
    getDirectoryHandle: async () => {
      if (!present) throw new Error("NotFound");
      return directory;
    },
    removeEntry: async () => {
      present = false;
    },
  };
  return { getDirectory: async () => root, persist: async () => true };
}

const memory = new Map<string, string>();
let files: Record<string, number>;
const load = async () => {
  vi.resetModules();
  return import("../lib/readwind/natural-voice");
};
const wav = () => encodeWav(new Float32Array(24000), 24000);

beforeEach(() => {
  FakeWorker.all = [];
  memory.clear();
  files = {};
  vi.stubGlobal("Worker", FakeWorker);
  vi.stubGlobal("window", {});
  vi.stubGlobal("localStorage", { getItem: (k: string) => memory.get(k) ?? null, setItem: (k: string, v: string) => memory.set(k, v), removeItem: (k: string) => memory.delete(k) });
  vi.stubGlobal("navigator", { storage: storage(files) });
  vi.stubGlobal("caches", { delete: async () => true });
  vi.stubGlobal("URL", Object.assign(URL, { createObjectURL: () => "blob:clip", revokeObjectURL: () => {} }));
});
afterEach(() => vi.unstubAllGlobals());

describe("speech worker", () => {
  it("turns a sentence into a clip with its length and load", async () => {
    const voice = await load();
    const request = voice.generateClip("Hello there.", "en_US-amy-medium");
    const [worker] = FakeWorker.all;
    expect(worker.sent[0]).toMatchObject({ type: "generate", text: "Hello there.", voice: "en_US-amy-medium" });
    worker.say({ type: "audio", id: request.id, buffer: wav(), ms: 500 });
    const clip = await request;
    expect(clip.seconds).toBeCloseTo(1);
    expect(clip.load).toBeCloseTo(0.5);
  });

  it("fails every waiting sentence when the worker crashes, then starts a fresh worker", async () => {
    const voice = await load();
    const first = voice.generateClip("One.", "en_US-amy-medium");
    const second = voice.generateClip("Two.", "en_US-amy-medium");
    const [broken] = FakeWorker.all;
    broken.onerror?.({ message: "out of memory" });
    await expect(first).rejects.toThrow("out of memory");
    await expect(second).rejects.toThrow("out of memory");
    expect(broken.terminated).toBe(true);
    const again = voice.generateClip("Three.", "en_US-amy-medium");
    expect(FakeWorker.all).toHaveLength(2);
    FakeWorker.all[1].say({ type: "audio", id: again.id, buffer: wav(), ms: 100 });
    await expect(again).resolves.toMatchObject({ seconds: expect.any(Number) });
  });

  it("surfaces a single sentence's error without disturbing the others", async () => {
    const voice = await load();
    const bad = voice.generateClip("Bad.", "en_US-amy-medium");
    const good = voice.generateClip("Good.", "en_US-amy-medium");
    const [worker] = FakeWorker.all;
    worker.say({ type: "error", id: bad.id, message: "no text" });
    await expect(bad).rejects.toThrow("no text");
    worker.say({ type: "audio", id: good.id, buffer: wav(), ms: 100 });
    await expect(good).resolves.toBeTruthy();
    expect(worker.terminated).toBe(false);
  });

  it("starts over with a new worker when the voice changes, cancelling the old voice's sentences", async () => {
    const voice = await load();
    const old = voice.generateClip("Old.", "en_US-amy-medium");
    const next = voice.generateClip("New.", "en_GB-alan-medium");
    expect(FakeWorker.all).toHaveLength(2);
    expect(FakeWorker.all[0].terminated).toBe(true);
    await expect(old).rejects.toThrow("cancelled");
    FakeWorker.all[1].say({ type: "audio", id: next.id, buffer: wav(), ms: 100 });
    await expect(next).resolves.toBeTruthy();
  });

  it("cancels queued sentences and tells the worker", async () => {
    const voice = await load();
    const request = voice.generateClip("Skip me.", "en_US-amy-medium");
    voice.cancelClips([request.id]);
    await expect(request).rejects.toThrow("cancelled");
    expect(FakeWorker.all[0].sent.at(-1)).toEqual({ type: "cancel", ids: [request.id] });
  });

  it("ignores messages from a worker that has been replaced", async () => {
    const voice = await load();
    const request = voice.generateClip("Hi.", "en_US-amy-medium");
    const [stale] = FakeWorker.all;
    voice.resetNaturalVoice();
    await expect(request).rejects.toThrow("cancelled");
    expect(() => stale.say({ type: "audio", id: request.id, buffer: wav(), ms: 1 })).not.toThrow();
  });
});

describe("voices on this device", () => {
  it("trusts the disk: only voices with both files count", async () => {
    Object.assign(files, { "en_US-amy-medium.onnx": 63e6, "en_US-amy-medium.onnx.json": 4000, "en_GB-alan-medium.onnx": 63e6 });
    const voice = await load();
    expect(await voice.refreshDownloadedVoices()).toEqual(["en_US-amy-medium"]);
    expect(voice.downloadedVoices()).toEqual(["en_US-amy-medium"]);
    expect(voice.naturalVoiceDownloaded("en_GB-alan-medium")).toBe(false);
  });

  it("treats a truncated model as not downloaded", async () => {
    Object.assign(files, { "en_US-amy-medium.onnx": 1200, "en_US-amy-medium.onnx.json": 4000 });
    const voice = await load();
    expect(await voice.refreshDownloadedVoices()).toEqual([]);
  });

  it("keeps working for installs that recorded the single original voice", async () => {
    memory.set("readwind-piper-ljspeech", "1");
    const voice = await load();
    expect(voice.downloadedVoices()).toEqual(["en_US-ljspeech-medium"]);
    expect(await voice.refreshDownloadedVoices()).toEqual([]);
    expect(memory.has("readwind-piper-ljspeech")).toBe(false);
  });

  it("removes one voice and leaves the rest", async () => {
    Object.assign(files, { "en_US-amy-medium.onnx": 63e6, "en_US-amy-medium.onnx.json": 4000, "en_GB-alan-medium.onnx": 63e6, "en_GB-alan-medium.onnx.json": 4000 });
    const voice = await load();
    await voice.removeNaturalVoice("en_US-amy-medium");
    expect(voice.downloadedVoices()).toEqual(["en_GB-alan-medium"]);
  });
});

describe("downloading a voice", () => {
  const start = async () => {
    const voice = await load();
    const progress = vi.fn();
    const done = voice.downloadNaturalVoice("en_GB-alan-medium", progress);
    const worker = FakeWorker.all.at(-1)!;
    const request = worker.sent[0] as { req: number; type: string; voice: string };
    return { voice, done, worker, request, progress };
  };

  it("reports progress and resolves once the files are really on the device", async () => {
    const { done, worker, request, progress } = await start();
    expect(request).toMatchObject({ type: "download", voice: "en_GB-alan-medium" });
    worker.say({ type: "progress", req: request.req, loaded: 30, total: 60 });
    expect(progress).toHaveBeenCalledWith(30, 60);
    Object.assign(files, { "en_GB-alan-medium.onnx": 63e6, "en_GB-alan-medium.onnx.json": 4000 });
    worker.say({ type: "ready", req: request.req });
    await done;
    expect(worker.terminated).toBe(true);
  });

  it("fails, rather than claiming success, when the browser did not keep the files", async () => {
    const { done, worker, request } = await start();
    worker.say({ type: "ready", req: request.req });
    await expect(done).rejects.toThrow("could not be saved");
  });

  it("reports the worker's own error and cleans up, so a retry starts fresh", async () => {
    const { voice, done, worker, request } = await start();
    worker.say({ type: "error", req: request.req, message: "The connection stalled." });
    await expect(done).rejects.toThrow("stalled");
    expect(worker.terminated).toBe(true);
    void voice.downloadNaturalVoice("en_GB-alan-medium");
    expect(FakeWorker.all).toHaveLength(2);
  });

  it("can be cancelled", async () => {
    const { voice, done, worker } = await start();
    voice.cancelDownload();
    await expect(done).rejects.toThrow("cancelled");
    expect(worker.terminated).toBe(true);
  });

  it("does not stall the voice that is reading", async () => {
    const voice = await load();
    const reading = voice.generateClip("Reading on.", "en_US-amy-medium");
    void voice.downloadNaturalVoice("en_GB-alan-medium");
    expect(FakeWorker.all).toHaveLength(2);
    expect(FakeWorker.all[0].terminated).toBe(false);
    FakeWorker.all[0].say({ type: "audio", id: reading.id, buffer: wav(), ms: 100 });
    await expect(reading).resolves.toBeTruthy();
  });
});
