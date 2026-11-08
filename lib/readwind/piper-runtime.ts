import runtime from "./piper-runtime-version.json";

export const piperCacheName = `piper-runtime-${runtime.version}`;
export const piperRuntimeFiles = [
  "/piper/piper_phonemize.data",
  "/piper/piper_phonemize.wasm",
  "/piper/ort-wasm-simd.wasm",
  "/piper/ort-wasm.wasm",
];

/** Store the exact runtime used by this build, including the non-SIMD fallback. */
export async function cachePiperRuntime() {
  const cache = await caches.open(piperCacheName);
  for (const url of piperRuntimeFiles) {
    if (await cache.match(url)) continue;
    for (let attempt = 1; ; attempt++) {
      try {
        // Bypass older controlling workers and HTTP caches during an update.
        const response = await fetch(`${url}?v=${runtime.version}`);
        if (!response.ok) throw new Error(`Runtime download failed (${response.status}).`);
        await cache.put(url, response);
        break;
      } catch (error) {
        if (attempt >= 4) throw error;
        await new Promise(resolve => setTimeout(resolve, 500 * attempt));
      }
    }
  }
}
