import { rateLimit } from "@/lib/readwind/server";

import {
  readBytes,
  readJson,
  sameOrigin,
  safeRoute,
  HttpError,
} from "@/lib/readwind/security";

import type { NextRequest } from "next/server";

type Context = { params: Promise<{ path: string[] }> };

// Only the flows offered by Readwind are exposed. Never join arbitrary path segments.

const routes: Record<string, string> = {
  "get-session": "GET",
  "sign-in/email": "POST",
  "sign-up/email": "POST",
  "sign-out": "POST",

  "request-password-reset": "POST",
  "reset-password": "POST",

  "email-otp/request-password-reset": "POST",
  "email-otp/reset-password": "POST",

  "email-otp/verify-email": "POST",
  "email-otp/send-verification-otp": "POST",
};

const handle = safeRoute(async (req: NextRequest, ctx: Context) => {
  const path = (await ctx.params).path;

  if (path.some((s) => !/^[a-z-]+$/.test(s)))
    throw new HttpError(404, "Unknown auth route.");

  const name = path.join("/");

  if (routes[name] !== req.method)
    throw new HttpError(404, "Unknown auth route.");

  if (req.method !== "GET" && !sameOrigin(req))
    throw new HttpError(403, "Invalid request origin.");

  // A global cap bounds fake-account abuse even if the provider offers no CAPTCHA.

  // CF-Connecting-IP must be supplied by Cloudflare, never by an intermediate proxy.

  const ip = req.headers.get("cf-connecting-ip");

  await rateLimit("auth:global", 300);

  if (ip) {
    const hash = Array.from(
      new Uint8Array(
        await crypto.subtle.digest("SHA-256", new TextEncoder().encode(ip)),
      ),
    )
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");

    await rateLimit(`auth:${hash}`, 30);
  }

  let body: Uint8Array | undefined;

  if (req.method === "POST") {
    const data = (await readJson(req, 16384)) as Record<string, unknown>;

    if (!data || Array.isArray(data) || typeof data !== "object")
      throw new HttpError(400, "Invalid auth data.");

    if (name === "sign-up/email") {
      await rateLimit("signup:global", 20, 86400);

      if (
        typeof data.email !== "string" ||
        !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email) ||
        data.email.length > 254 ||
        /\.(invalid|localhost|test)$/i.test(data.email)
      )
        throw new HttpError(400, "Enter a valid email address.");
    }

    const password = data.newPassword ?? data.password;

    if (
      (name === "sign-up/email" || name.includes("reset-password")) &&
      password !== undefined &&
      (typeof password !== "string" ||
        password.length < 12 ||
        password.length > 128)
    )
      throw new HttpError(400, "Use a password with 12–128 characters.");

    // Reset callbacks cannot be directed to an attacker-controlled host.

    if (data.redirectTo !== undefined)
      data.redirectTo = new URL("/?reset=1", req.url).href;

    body = new TextEncoder().encode(JSON.stringify(data));
  } else {
    await readBytes(req, 0);
  }

  const base = process.env.NEON_AUTH_BASE_URL;

  if (!base) throw new Error("Auth is not configured");

  const upstream = new URL(base.replace(/\/$/, "") + "/" + name);

  if (name === "get-session")
    upstream.searchParams.set("disableCookieCache", "true");

  const headers = new Headers({
    origin: new URL(req.url).origin,
    "content-type": "application/json",
    "x-neon-auth-middleware": "true",
  });

  const cookie = req.headers
    .get("cookie")
    ?.split(";")
    .map((c) => c.trim())
    .filter((c) =>
      /^__Secure-neon-auth(?:\.[a-zA-Z0-9_-]+)?\.session_token=/.test(c),
    )
    .join("; ");

  if (cookie) headers.set("cookie", cookie);

  if (ip) headers.set("x-forwarded-for", ip);

  const result = await fetch(upstream, {
    method: req.method,
    headers,
    body: body as BodyInit | undefined,
    redirect: "error",
    cache: "no-store",
    signal: AbortSignal.timeout(10000),
  });

  const output = new Headers({
    "Content-Type": "application/json",
    "Cache-Control": "private, no-store",
    Vary: "Cookie",
    "X-Content-Type-Options": "nosniff",
  });

  for (const cookie of result.headers.getSetCookie()) {
    if (!cookie.startsWith("__Secure-neon-auth")) continue;

    output.append(
      "set-cookie",
      cookie
        .replace(/;\s*(Domain|SameSite|Path)=[^;]*/gi, "")
        .replace(/;\s*Partitioned/gi, "") +
        "; Path=/; Secure; HttpOnly; SameSite=Lax",
    );
  }

  return new Response(result.body, { status: result.status, headers: output });
});

export const GET = handle;

export const POST = handle;
