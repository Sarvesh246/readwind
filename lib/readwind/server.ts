import { neon } from "@neondatabase/serverless";
import { AwsClient } from "aws4fetch";
import { HttpError, safeId, sameOrigin } from "./security";
export function sql(user?: string,serialize?:string) {
  if (!process.env.DATABASE_URL) throw new Error("Database is not configured");
  const db = neon(process.env.DATABASE_URL);
  if (!user) return db;
  // Tenant context and query execute on the same connection and transaction.
  return ((strings: TemplateStringsArray, ...values: unknown[]) =>
    db
      .transaction([
        db`SELECT set_config('readwind.owner', ${user}, true)`,
        ...(serialize?[db`SELECT pg_advisory_xact_lock(hashtextextended(${serialize},0))`]:[]),
        db(strings, ...values),
      ])
      .then((results) => results[results.length-1])) as typeof db;
}
export async function owner(request: Request) {
  // The browser uses cookies. Reject stateless bearer JWTs: they cannot provide
  // immediate session revocation. Never trust the SDK's signed session_data cache.
  if (request.headers.has("authorization")) return null;
  if (request.method !== "GET" && !sameOrigin(request)) return null;
  const cookie = request.headers
    .get("cookie")
    ?.split(";")
    .map((c) => c.trim())
    .filter((c) =>
      /^__Secure-neon-auth(?:\.[a-zA-Z0-9_-]+)?\.session_token=/.test(c),
    )
    .join("; ");
  if (!cookie || !process.env.NEON_AUTH_BASE_URL) return null;
  const ip = request.headers.get("cf-connecting-ip");
  if (ip) {
    const hash = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(ip)))).map(b=>b.toString(16).padStart(2,"0")).join("");
    // Limit forged/expired tokens too, before they cause upstream session lookups.
    await rateLimit(`session:${hash}`,240);
  }
  try {
    const url = new URL(
      process.env.NEON_AUTH_BASE_URL.replace(/\/$/, "") + "/get-session",
    );
    url.searchParams.set("disableCookieCache", "true");
    const response = await fetch(url, {
      headers: {
        cookie,
        origin: new URL(request.url).origin,
        "x-neon-auth-middleware": "true",
        ...(ip ? {"x-forwarded-for":ip} : {}),
      },
      cache: "no-store",
      signal: AbortSignal.timeout(10000),
      redirect: "error",
    });
    if (!response.ok) return null;
    const data = (await response.json()) as {
      user?: { id?: string; emailVerified?: boolean };
      session?: { expiresAt?: string };
    };
    const id = data.user?.id;
    if (
      !id ||
      !safeId.test(id) ||
      !data.user?.emailVerified ||
      !data.session?.expiresAt ||
      !Number.isFinite(Date.parse(data.session.expiresAt)) ||
      Date.parse(data.session.expiresAt) <= Date.now()
    )
      return null;
    return id;
  } catch {
    return null;
  }
}
/** Durable shared rate limit, atomic across Worker isolates. Fail closed on DB errors. */
export async function rateLimit(key: string, limit: number, seconds = 60) {
  const rows = await sql()`INSERT INTO folio_rate_limits(key,window_start,hits)
    VALUES(${key},now(),1) ON CONFLICT(key) DO UPDATE SET
    hits=CASE WHEN folio_rate_limits.window_start < now()-(${seconds} * interval '1 second') THEN 1 ELSE folio_rate_limits.hits+1 END,
    window_start=CASE WHEN folio_rate_limits.window_start < now()-(${seconds} * interval '1 second') THEN now() ELSE folio_rate_limits.window_start END
    RETURNING hits`;
  if (Number(rows[0].hits) > limit)
    throw new HttpError(429, "Too many requests. Please wait and retry.");
}
function bodyLength(body: BodyInit | null | undefined) {
  if (body == null) return null;
  if (typeof body === "string") return new TextEncoder().encode(body).byteLength;
  if (body instanceof ArrayBuffer) return body.byteLength;
  if (ArrayBuffer.isView(body)) return body.byteLength;
  if (typeof Blob !== "undefined" && body instanceof Blob) return body.size;
  return null;
}
function storageClient() {
  return new AwsClient({
    service: "s3",
    region: process.env.AWS_REGION || "us-east-2",
    accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
  });
}
function storageUrl(key: string) {
  if (
    key.split("/").length !== 2 ||
    key.split("/").some((segment) => !safeId.test(segment))
  )
    throw new HttpError(400, "Invalid storage path.");
  const endpoint = process.env.AWS_ENDPOINT_URL_S3!.replace(/\/$/, "");
  return `${endpoint}/${bucket}/${key.split("/").map(encodeURIComponent).join("/")}`;
}
export function storageFetch(key: string, init: RequestInit = {}) {
  // Validate the object path before touching credentials.
  const url = storageUrl(key);
  // Vercel's runtime streams outbound bodies without a Content-Length, which
  // Neon object storage rejects with NotImplemented (501). The bytes are
  // already materialized, so send the exact length and keep the object store
  // on its non-chunked path.
  const headers = new Headers(init.headers);
  const length = bodyLength(init.body);
  if (length !== null && !headers.has("content-length"))
    headers.set("content-length", String(length));
  return storageClient().fetch(url, { ...init, headers });
}
/** Short-lived URL so browsers can upload large books without the function body limit. */
export async function storagePresign(
  key: string,
  contentType: string,
  expires = 300,
) {
  const url = new URL(storageUrl(key));
  url.searchParams.set("X-Amz-Expires", String(expires));
  const signed = await storageClient().sign(url, {
    method: "PUT",
    headers: { "Content-Type": contentType },
    aws: { signQuery: true },
  });
  return {
    url: signed.url.toString(),
    headers: Object.fromEntries(signed.headers.entries()),
    expires,
  };
}
export const bucket = "folio-books";
export const unauthorized = () =>
  Response.json({ error: "Please sign in again." }, { status: 401 });
