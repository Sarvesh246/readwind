import { describe, expect, it, vi } from "vitest";
import { fetchInto } from "../lib/readwind/piper-download";

/** A fake private file system that records what was written, per file. */
function disk() {
  const written: Record<string, number[]> = {};
  const aborted: string[] = [];
  const directory = {
    getFileHandle: async (name: string) => ({
      createWritable: async () => {
        written[name] = [];
        return {
          write: async (chunk: Uint8Array) => void written[name].push(...chunk),
          close: async () => {},
          abort: async () => void aborted.push(name),
        };
      },
    }),
  } as unknown as FileSystemDirectoryHandle;
  return { directory, written, aborted };
}

const body = (chunks: number[][], then?: () => Promise<never>) => {
  let i = 0;
  return {
    getReader: () => ({
      read: async () => {
        if (i < chunks.length) return { done: false, value: new Uint8Array(chunks[i++]) };
        if (then) await then();
        return { done: true, value: undefined };
      },
    }),
  };
};
const reply = (chunks: number[][], length?: number, init: { ok?: boolean; status?: number } = {}) => ({
  ok: init.ok ?? true,
  status: init.status ?? 200,
  headers: { get: (k: string) => (k === "Content-Length" ? String(length ?? chunks.flat().length) : null) },
  body: body(chunks),
});

describe("downloading into device storage", () => {
  it("writes every chunk and reports progress against the total", async () => {
    const { directory, written } = disk();
    vi.stubGlobal("fetch", vi.fn(async () => reply([[1, 2], [3, 4, 5]])));
    const progress = vi.fn();
    await fetchInto(directory, "https://x/model.onnx", "model.onnx", progress, { backoff: 0 });
    expect(written["model.onnx"]).toEqual([1, 2, 3, 4, 5]);
    expect(progress).toHaveBeenLastCalledWith(5, 5);
  });

  it("starts the file over and tries again after a dropped connection", async () => {
    const { directory, written, aborted } = disk();
    const fetcher = vi
      .fn()
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockResolvedValueOnce(reply([[9, 9, 9]]));
    vi.stubGlobal("fetch", fetcher);
    await fetchInto(directory, "https://x/model.onnx", "model.onnx", undefined, { backoff: 0 });
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(aborted).toEqual(["model.onnx"]);
    expect(written["model.onnx"]).toEqual([9, 9, 9]);
  });

  it("does not accept a short read as a finished download", async () => {
    const { directory } = disk();
    vi.stubGlobal("fetch", vi.fn(async () => reply([[1, 2]], 100)));
    await expect(fetchInto(directory, "https://x/model.onnx", "model.onnx", undefined, { backoff: 0 })).rejects.toThrow("cut short");
  });

  it("retries a server error and then reports it", async () => {
    const { directory } = disk();
    const fetcher = vi.fn(async () => reply([], 0, { ok: false, status: 503 }));
    vi.stubGlobal("fetch", fetcher);
    await expect(fetchInto(directory, "https://x/model.onnx", "model.onnx", undefined, { backoff: 0 })).rejects.toThrow("503");
    expect(fetcher).toHaveBeenCalledTimes(4);
  });

  it("gives up on a connection that goes quiet", async () => {
    const { directory } = disk();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: { signal: AbortSignal }) => ({
        ok: true,
        status: 200,
        headers: { get: () => "10" },
        body: body([[1]], () => new Promise<never>((_, reject) => init.signal.addEventListener("abort", () => reject(new Error("aborted"))))),
      })),
    );
    await expect(fetchInto(directory, "https://x/model.onnx", "model.onnx", undefined, { backoff: 0, stall: 20 })).rejects.toThrow("stalled");
  });
});
