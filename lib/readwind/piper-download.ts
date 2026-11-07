/**
 * Streams a file from the network into the origin private file system. Kept free of the speech library so
 * it can be tested with a fake disk and a fake network.
 */
export const ATTEMPTS = 4;
/** A transfer that delivers nothing for this long is abandoned and retried. */
export const STALL_MS = 30000;
const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

type Sink = {
  write(chunk: Uint8Array): Promise<void>;
  close(): Promise<void>;
  abort(): Promise<void>;
};
/** Streams into a file on disk. Safari's workers lack createWritable, so they use a sync access handle. */
export async function openSink(
  directory: FileSystemDirectoryHandle,
  name: string,
): Promise<Sink> {
  const handle = await directory.getFileHandle(name, { create: true });
  if (
    typeof (handle as FileSystemFileHandle & { createWritable?: unknown })
      .createWritable === "function"
  ) {
    const writable = await handle.createWritable();
    return {
      write: (chunk) => writable.write(chunk as unknown as BufferSource),
      close: () => writable.close(),
      abort: () => writable.abort().catch(() => {}),
    };
  }
  const access = await (
    handle as FileSystemFileHandle & {
      createSyncAccessHandle(): Promise<{
        truncate(n: number): void;
        write(b: BufferSource, o: { at: number }): number;
        flush(): void;
        close(): void;
      }>;
    }
  ).createSyncAccessHandle();
  access.truncate(0);
  let at = 0;
  return {
    write: async (chunk) => {
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
export async function fetchInto(
  directory: FileSystemDirectoryHandle,
  url: string,
  name: string,
  onProgress?: (loaded: number, total: number) => void,
  { backoff = 700, stall = STALL_MS }: { backoff?: number; stall?: number } = {},
) {
  let last: unknown;
  for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
    const controller = new AbortController();
    let timer = setTimeout(() => controller.abort(), stall);
    const sink = await openSink(directory, name);
    try {
      const response = await fetch(url, { signal: controller.signal });
      if (!response.ok || !response.body)
        throw new Error(
          `The download failed (${response.status || "no response"}).`,
        );
      const total = Number(response.headers.get("Content-Length")) || 0;
      const reader = response.body.getReader();
      let loaded = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        clearTimeout(timer);
        timer = setTimeout(() => controller.abort(), stall);
        await sink.write(value);
        loaded += value.byteLength;
        onProgress?.(loaded, total);
      }
      if (total && loaded !== total)
        throw new Error("The download was cut short.");
      if (!loaded) throw new Error("The download was empty.");
      clearTimeout(timer);
      await sink.close();
      return;
    } catch (error) {
      clearTimeout(timer);
      await sink.abort();
      last = controller.signal.aborted
        ? new Error("The connection stalled.")
        : error;
      if (attempt < ATTEMPTS) await wait(backoff * attempt * attempt);
    }
  }
  throw last instanceof Error ? last : new Error(String(last || "The download failed."));
}

