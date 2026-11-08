import { afterEach, expect, it, vi } from "vitest";
import { cachePiperRuntime, piperCacheName, piperRuntimeFiles } from "../lib/readwind/piper-runtime";

afterEach(() => vi.unstubAllGlobals());

it("fetches versioned runtime files into the current cache and reuses them offline", async () => {
  const stored = new Map<string, Response>();
  const cache = { match: vi.fn(async (url: string) => stored.get(url)), put: vi.fn(async (url: string, response: Response) => { stored.set(url, response); }) };
  const open = vi.fn(async () => cache);
  const fetcher = vi.fn(async (url: string) => new Response(url));
  vi.stubGlobal("caches", { open });
  vi.stubGlobal("fetch", fetcher);
  await cachePiperRuntime();
  expect(open).toHaveBeenCalledWith(piperCacheName);
  expect([...stored.keys()]).toEqual(piperRuntimeFiles);
  expect(fetcher).toHaveBeenCalledTimes(4);
  expect(fetcher.mock.calls.every(([url]) => String(url).includes(`?v=${piperCacheName.slice('piper-runtime-'.length)}`))).toBe(true);
  fetcher.mockClear();
  await cachePiperRuntime();
  expect(fetcher).not.toHaveBeenCalled();
});
