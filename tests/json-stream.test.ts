import { it, expect } from "vitest";
import { streamJson } from "../lib/readwind/json-stream";
it("streams a book larger than the function payload limit without corrupting Unicode", async () => {
  const value = { text: "A complete book 😀 Ελληνικά ".repeat(200000) },
    response = streamJson(value, { headers: { "Cache-Control": "no-store" } });
  expect(response.headers.has("Content-Length")).toBe(false);
  const reader = response.body!.getReader(),
    chunks: Uint8Array[] = [];
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    expect(value.byteLength).toBeLessThanOrEqual(65536);
    chunks.push(value);
  }
  const blob = new Blob(chunks as BlobPart[]);
  expect(blob.size).toBeGreaterThan(4500000);
  expect(chunks.length).toBeGreaterThan(1);
  expect(JSON.parse(await blob.text())).toEqual(value);
});
