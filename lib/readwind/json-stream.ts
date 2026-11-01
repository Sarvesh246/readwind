/** Preserve the JSON API while sending large books through a streaming response. */
export function streamJson(value: unknown, init: ResponseInit = {}) {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  let offset = 0;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (offset >= bytes.length) {
        controller.close();
        return;
      }
      const end = Math.min(bytes.length, offset + 65536);
      controller.enqueue(bytes.subarray(offset, end));
      offset = end;
    },
  });
  const headers = new Headers(init.headers);
  headers.set("Content-Type", "application/json; charset=utf-8");
  headers.delete("Content-Length");
  return new Response(body, { ...init, headers });
}
