/** Shared limits apply to bytes actually read, including chunked requests. */

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export async function readBytes(request: Request, limit: number) {
  const length = request.headers.get("content-length");

  if (length && (!/^\d+$/.test(length) || Number(length) > limit)) {
    throw new HttpError(413, "Request is too large.");
  }

  const reader = request.body?.getReader();

  if (!reader) return new Uint8Array();

  const chunks: Uint8Array[] = [];

  let size = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();

      if (done) break;

      size += value.byteLength;

      if (size > limit) {
        await reader.cancel();
        throw new HttpError(413, "Request is too large.");
      }

      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(size);

  let offset = 0;

  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }

  return bytes;
}

export async function readJson(
  request: Request,
  limit: number,
): Promise<unknown> {
  if (request.headers.get("content-type")?.split(";")[0] !== "application/json")
    throw new HttpError(415, "Expected JSON.");

  try {
    return JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(
        await readBytes(request, limit),
      ),
    );
  } catch (e) {
    if (e instanceof HttpError) throw e;
    throw new HttpError(400, "Invalid JSON.");
  }
}

export function safeRoute<T extends unknown[]>(
  handler: (...args: T) => Promise<Response>,
) {
  return async (...args: T) => {
    try {
      return await handler(...args);
    } catch (e) {
      if (e instanceof HttpError)
        return Response.json(
          { error: e.message },
          { status: e.status, headers: { "Cache-Control": "no-store" } },
        );

      if (typeof e === "object" && e && "code" in e && e.code === "23514")
        return Response.json(
          { error: "Account quota reached. Remove some content and retry." },
          { status: 413 },
        );

      console.error(
        "Readwind request failed",
        e instanceof Error ? e.name : "UnknownError",
      );

      return Response.json(
        { error: "Service unavailable. Please retry." },
        { status: 503, headers: { "Cache-Control": "no-store" } },
      );
    }
  };
}

export const safeId = /^[a-zA-Z0-9_-]{1,120}$/;

export function sameOrigin(request: Request) {
  return (
    request.headers.get("origin") === new URL(request.url).origin &&
    request.headers.get("sec-fetch-site") !== "cross-site"
  );
}

export const securityHeaders: Record<string, string> = {
  "X-Content-Type-Options": "nosniff",

  "X-Frame-Options": "DENY",

  "Referrer-Policy": "no-referrer",

  "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=()",

  "Cross-Origin-Opener-Policy": "same-origin",

  "Strict-Transport-Security": "max-age=31536000; includeSubDomains",

  "Content-Security-Policy":
    "default-src 'self'; script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; font-src 'self'; connect-src 'self'; worker-src 'self' blob:; frame-src 'none'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'",
};
