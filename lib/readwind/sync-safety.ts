/** Keep JSON below the platform limit, including recovery envelopes. */
export const MAX_BOOK_JSON_BYTES = 3_500_000;
export const MAX_API_JSON_BYTES = 4_000_000;
export function checkPayloadSize(value: unknown, limit = MAX_BOOK_JSON_BYTES) {
  if (new TextEncoder().encode(JSON.stringify(value)).byteLength > limit)
    throw new Error('This book has too much extracted content to sync safely (3.5 MB limit). Import a smaller book or split the source file. No cloud copy has been saved.');
}
export class SyncRequestError extends Error {
  constructor(public status: number, message: string) { super(message); }
  get permanent() { return [400,403,409,413,422].includes(this.status); }
}
/** Deadline includes consuming the body, so a stalled stream cannot hold the sync lock. */
export async function boundedFetch(input: RequestInfo | URL, init: RequestInit = {}, timeout = 45000) {
  const signal = AbortSignal.any([...(init.signal ? [init.signal] : []), AbortSignal.timeout(timeout)]);
  const response = await fetch(input, {...init, signal});
  const bytes = await response.arrayBuffer();
  return new Response(response.status===204 || response.status===304 ? null : bytes, {
    status: response.status, statusText: response.statusText, headers: response.headers,
  });
}
