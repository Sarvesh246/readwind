import { describe, expect, it } from "vitest";
import { OcrPool, ocrWorkerCount, type OcrWorker } from "../lib/readwind/ocr";
import { importJobState, type ImportJob } from "../lib/readwind/import-jobs";

const fakeWorker = () => {
  const worker = { terminated: false, terminate: async () => { worker.terminated = true; } };
  return worker as unknown as OcrWorker & { terminated: boolean };
};
const tick = () => new Promise(resolve => setTimeout(resolve, 0));

describe("ocrWorkerCount", () => {
  it("uses half the cores, capped, and one worker on low-memory devices", () => {
    expect(ocrWorkerCount(16, 8)).toBe(3);
    expect(ocrWorkerCount(4, 8)).toBe(2);
    expect(ocrWorkerCount(2, undefined)).toBe(1);
    expect(ocrWorkerCount(1, undefined)).toBe(1);
    expect(ocrWorkerCount(16, 2)).toBe(1);
  });
});

describe("OcrPool", () => {
  it("creates workers on demand, never beyond its size, and reuses idle ones", async () => {
    let created = 0, running = 0, peak = 0;
    const pool = new OcrPool(async () => { created++; return fakeWorker(); }, 2);
    expect(pool.started).toBe(false);
    await Promise.all(Array.from({ length: 6 }, () => pool.run(async () => {
      running++; peak = Math.max(peak, running);
      await tick();
      running--;
    })));
    expect(created).toBe(2);
    expect(peak).toBe(2);
    await pool.run(async () => {});
    expect(created).toBe(2);
    await pool.terminate();
  });

  it("releases the worker when a job throws", async () => {
    const pool = new OcrPool(async () => fakeWorker(), 1);
    await expect(pool.run(async () => { throw new Error("boom"); })).rejects.toThrow("boom");
    await expect(pool.run(async () => "next")).resolves.toBe("next");
    await pool.terminate();
  });

  it("terminates workers and rejects queued jobs on cancel", async () => {
    const made: ReturnType<typeof fakeWorker>[] = [];
    const pool = new OcrPool(async () => { const w = fakeWorker(); made.push(w); return w; }, 1);
    const first = pool.run(async () => { await tick(); await tick(); });
    const queued = pool.run(async () => "never");
    const cancelled = expect(queued).rejects.toMatchObject({ name: "AbortError" });
    await tick();
    await pool.terminate();
    await first;
    await cancelled;
    expect(made.every(w => w.terminated)).toBe(true);
    await expect(pool.run(async () => 1)).rejects.toMatchObject({ name: "AbortError" });
  });

  it("fails queued jobs instead of hanging when no worker can be created", async () => {
    const pool = new OcrPool(async () => { throw new Error("no wasm"); }, 1);
    const results = await Promise.allSettled([pool.run(async () => 1), pool.run(async () => 2)]);
    expect(results.map(r => r.status)).toEqual(["rejected", "rejected"]);
  });
});

describe("importJobState", () => {
  const job = (patch: Partial<ImportJob>): ImportJob => ({
    id: "a", title: "Book", percent: 40, message: "Recognizing", status: "running", deviceId: "d", age: 0, ...patch,
  });
  it("flags a running import that stopped reporting as interrupted", () => {
    expect(importJobState(job({ age: 5 }))).toBe("running");
    expect(importJobState(job({ age: 120 }))).toBe("interrupted");
  });
  it("keeps finished and failed states regardless of age", () => {
    expect(importJobState(job({ status: "ready", age: 600 }))).toBe("ready");
    expect(importJobState(job({ status: "failed", age: 600 }))).toBe("failed");
  });
});
