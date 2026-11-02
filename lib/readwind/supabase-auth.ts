import { EncryptJWT, jwtDecrypt, decodeJwt, base64url } from "jose";
import { postgresClient } from "./postgres";
import { HttpError } from "./security";
import { supabaseSessionLive } from "./supabase-storage";

type ProviderUser = {
  id: string;
  email: string;
  email_confirmed_at?: string;
  user_metadata?: { name?: string; full_name?: string };
};
type Tokens = {
  access_token: string;
  refresh_token: string;
  expires_at: number;
};
type ProviderTokens = Tokens & { expires_in?: number; user?: ProviderUser };
export type ReadwindSession = {
  tokenHash: string;
  tokens: Tokens;
  user: { id: string; name: string; email: string; emailVerified: boolean };
  expiresAt: string;
};
const lifetime = 30 * 86400;
function settings() {
  const url = process.env.SUPABASE_URL,
    key = process.env.SUPABASE_ANON_KEY,
    secret = process.env.READWIND_SESSION_SECRET;
  if (!url || !key || !secret)
    throw new Error("Supabase authentication is not configured");
  const encryptionKey = base64url.decode(secret);
  if (encryptionKey.length !== 32)
    throw new Error("Invalid session encryption key");
  return { url: url.replace(/\/$/, ""), key, encryptionKey };
}
export async function provider(
  path: string,
  options: { body?: unknown; token?: string; method?: string } = {},
) {
  const { url, key } = settings();
  const response = await fetch(`${url}/auth/v1${path}`, {
    method: options.method || (options.body === undefined ? "GET" : "POST"),
    headers: {
      apikey: key,
      Authorization: `Bearer ${options.token || key}`,
      "Content-Type": "application/json",
    },
    ...(options.body === undefined
      ? {}
      : { body: JSON.stringify(options.body) }),
    cache: "no-store",
    signal: AbortSignal.timeout(10000),
    redirect: "error",
  });
  const text = await response.text();
  let data: Record<string, unknown>;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    throw new Error("Invalid authentication response");
  }
  if (!response.ok) {
    if (response.status >= 500)
      throw new HttpError(
        503,
        "Sign-in is temporarily unavailable. Please retry.",
      );
    const code = data.error_code || data.code;
    const message =
      code === "email_not_confirmed"
        ? "Please verify your email before signing in."
        : String(
            data.msg ||
              data.message ||
              data.error_description ||
              "Could not complete authentication.",
          );
    const error = new HttpError(response.status === 429 ? 429 : 400, message);
    Object.assign(error, { providerCode: code });
    throw error;
  }
  return data;
}
async function hash(value: string) {
  return Array.from(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)),
    ),
  )
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
async function seal(tokens: Tokens, expires: Date) {
  return new EncryptJWT({ ...tokens })
    .setProtectedHeader({ alg: "dir", enc: "A256GCM" })
    .setIssuedAt()
    .setExpirationTime(Math.floor(expires.getTime() / 1000))
    .encrypt(settings().encryptionKey);
}
function tokenValues(data: ProviderTokens): Tokens {
  if (!data.access_token || !data.refresh_token)
    throw new Error("Incomplete authentication response");
  return {
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expires_at:
      data.expires_at ||
      Math.floor(Date.now() / 1000) + (data.expires_in || 3600),
  };
}
function cookieName(request: Request) {
  return new URL(request.url).protocol === "https:"
    ? "__Host-readwind-session"
    : "readwind-session";
}
function cookieValue(request: Request) {
  const name = cookieName(request);
  const values = (request.headers.get("cookie") || "")
    .split(";")
    .map((x) => x.trim())
    .filter((x) => x.startsWith(name + "="));
  if (values.length !== 1) return null;
  const value = values[0].slice(name.length + 1);
  return /^[A-Za-z0-9_-]{43}$/.test(value) ? value : null;
}
export function sessionCookie(request: Request, value = "") {
  return `${cookieName(request)}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${value ? lifetime : 0}${new URL(request.url).protocol === "https:" ? "; Secure" : ""}`;
}
export async function createSession(request: Request, data: ProviderTokens) {
  const tokens = tokenValues(data);
  const verified = (await provider("/user", {
    token: tokens.access_token,
  })) as unknown as ProviderUser;
  if (!verified.email_confirmed_at)
    throw new HttpError(403, "Please verify your email before signing in.");
  const token = base64url.encode(crypto.getRandomValues(new Uint8Array(32))),
    tokenHash = await hash(token);
  const expires = new Date(Date.now() + lifetime * 1000),
    encrypted = await seal(tokens, expires);
  await postgresClient()`INSERT INTO folio_sessions(token_hash,auth_user_id,tokens,expires_at) VALUES(${tokenHash},${verified.id},${encrypted},${expires})`;
  const session = await resolveSession(request, token);
  if (!session) throw new Error("Could not confirm the new session");
  return { session, cookie: sessionCookie(request, token) };
}
export async function resolveSession(
  request: Request,
  suppliedToken?: string,
): Promise<ReadwindSession | null> {
  if (request.headers.has("authorization")) return null;
  const token = suppliedToken || cookieValue(request);
  if (!token) return null;
  const tokenHash = await hash(token),
    db = postgresClient();
  const rows =
    await db`SELECT auth_user_id,tokens,expires_at FROM folio_sessions WHERE token_hash=${tokenHash} AND expires_at>now()`;
  if (!rows.length) return null;
  let row = rows[0];
  let tokens: Tokens;
  try {
    tokens = (await jwtDecrypt(row.tokens, settings().encryptionKey))
      .payload as unknown as Tokens;
  } catch {
    await db`DELETE FROM folio_sessions WHERE token_hash=${tokenHash}`;
    return null;
  }
  if (tokens.expires_at * 1000 < Date.now() + 60000) {
    // Only refreshes need a lock. Ordinary PDF/image reads must not reserve
    // database connections while waiting for the provider's live checks.
    const refreshed = await db.begin(async (transaction) => {
      const locked =
        await transaction`SELECT auth_user_id,tokens,expires_at FROM folio_sessions WHERE token_hash=${tokenHash} AND expires_at>now() FOR UPDATE`;
      if (!locked.length) return null;
      const currentRow = locked[0];
      let current: Tokens;
      try {
        current = (
          await jwtDecrypt(currentRow.tokens, settings().encryptionKey)
        ).payload as unknown as Tokens;
      } catch {
        await transaction`DELETE FROM folio_sessions WHERE token_hash=${tokenHash}`;
        return null;
      }
      if (current.expires_at * 1000 < Date.now() + 60000) {
        try {
          current = tokenValues(
            (await provider("/token?grant_type=refresh_token", {
              body: { refresh_token: current.refresh_token },
            })) as unknown as ProviderTokens,
          );
        } catch (error) {
          if (error instanceof HttpError && error.status === 400) {
            await transaction`DELETE FROM folio_sessions WHERE token_hash=${tokenHash}`;
            return null;
          }
          throw error;
        }
        await transaction`UPDATE folio_sessions SET tokens=${await seal(current, new Date(currentRow.expires_at))},updated_at=now() WHERE token_hash=${tokenHash}`;
      }
      return { row: currentRow, tokens: current };
    });
    if (!refreshed) return null;
    row = refreshed.row;
    tokens = refreshed.tokens;
  }
  let user: ProviderUser;
  try {
    user = (await provider("/user", {
      token: tokens.access_token,
    })) as unknown as ProviderUser;
  } catch (error) {
    if (error instanceof HttpError && error.status === 400) {
      await db`DELETE FROM folio_sessions WHERE token_hash=${tokenHash}`;
      return null;
    }
    throw error;
  }
  if (user.id !== row.auth_user_id || !user.email_confirmed_at) {
    await db`DELETE FROM folio_sessions WHERE token_hash=${tokenHash}`;
    return null;
  }
  const sessionId = decodeJwt(tokens.access_token).session_id;
  if (typeof sessionId !== "string" || !/^[0-9a-f-]{36}$/i.test(sessionId))
    return null;
  // A signed access token can outlive sign-out. Check the provider's live session too.
  if (!(await supabaseSessionLive(sessionId, user.id))) {
    await db`DELETE FROM folio_sessions WHERE token_hash=${tokenHash}`;
    return null;
  }
  const identities =
    await db`SELECT i.owner_id,s.expires_at FROM folio_sessions s LEFT JOIN folio_identities i ON i.auth_user_id=s.auth_user_id WHERE s.token_hash=${tokenHash} AND s.auth_user_id=${user.id}::uuid AND s.expires_at>now()`;
  if (!identities.length) return null;
  if (
    !identities[0].owner_id &&
    process.env.READWIND_RECOVERY_ACCOUNT_EMAIL?.toLowerCase() ===
      user.email.toLowerCase()
  )
    throw new HttpError(
      503,
      "Your recovered library is not linked yet. Please retry.",
    );
  return {
    tokenHash,
    tokens,
    expiresAt: new Date(identities[0].expires_at).toISOString(),
    user: {
      id: identities[0]?.owner_id || user.id,
      email: user.email,
      name:
        user.user_metadata?.name ||
        user.user_metadata?.full_name ||
        user.email.split("@")[0],
      emailVerified: true,
    },
  };
}
function json(data: unknown, cookie?: string, status = 200) {
  return Response.json(data, {
    status,
    headers: {
      "Cache-Control": "private, no-store",
      Vary: "Cookie",
      ...(cookie ? { "Set-Cookie": cookie } : {}),
    },
  });
}
export async function handleSupabaseAuth(
  request: Request,
  name: string,
  data: Record<string, unknown> = {},
) {
  if (name === "get-session") {
    const session = await resolveSession(request);
    return json(
      session
        ? { user: session.user, session: { expiresAt: session.expiresAt } }
        : null,
      session ? undefined : sessionCookie(request),
    );
  }
  if (name === "sign-out") {
    const session = await resolveSession(request);
    if (session) {
      await provider("/logout?scope=local", {
        method: "POST",
        token: session.tokens.access_token,
      });
      await postgresClient()`DELETE FROM folio_sessions WHERE token_hash=${session.tokenHash}`;
    }
    return json({ success: true }, sessionCookie(request));
  }
  if (name === "change-password") {
    const session = await resolveSession(request);
    if (!session) throw new HttpError(401, "Please sign in again.");
    if (
      typeof data.currentPassword !== "string" ||
      typeof data.newPassword !== "string" ||
      data.newPassword.length < 12 ||
      data.newPassword.length > 128
    )
      throw new HttpError(
        400,
        "Enter your current password and a new password with 12–128 characters.",
      );
    const check = (await provider("/token?grant_type=password", {
      body: { email: session.user.email, password: data.currentPassword },
    })) as unknown as ProviderTokens;
    await provider("/logout?scope=local", {
      method: "POST",
      token: check.access_token,
    });
    await provider("/user", {
      method: "PUT",
      token: session.tokens.access_token,
      body: { password: data.newPassword },
    });
    return json({ success: true });
  }
  if (name === "sign-in/email" || name === "sign-up/email") {
    let result: ProviderTokens;
    try {
      result = (await provider(
        name === "sign-in/email" ? "/token?grant_type=password" : "/signup",
        {
          body: {
            email: data.email,
            password: data.password,
            ...(name === "sign-up/email" ? { data: { name: data.name } } : {}),
          },
        },
      )) as unknown as ProviderTokens;
    } catch (error) {
      if (
        (error as { providerCode?: string }).providerCode ===
        "email_not_confirmed"
      )
        return json(
          {
            code: "EMAIL_NOT_VERIFIED",
            message: "Please verify your email before signing in.",
          },
          undefined,
          403,
        );
      throw error;
    }
    if (!result.access_token)
      return json({
        user: result.user
          ? { email: result.user.email, emailVerified: false }
          : null,
      });
    const created = await createSession(request, result);
    return json({ user: created.session.user }, created.cookie);
  }
  if (name === "email-otp/send-verification-otp") {
    await provider("/resend", { body: { email: data.email, type: "signup" } });
    return json({ success: true });
  }
  if (name === "email-otp/verify-email") {
    const result = (await provider("/verify", {
      body: { type: "signup", email: data.email, token: data.otp },
    })) as unknown as ProviderTokens;
    const created = await createSession(request, result);
    return json({ user: created.session.user }, created.cookie);
  }
  if (
    name === "email-otp/request-password-reset" ||
    name === "request-password-reset"
  ) {
    await provider("/recover", { body: { email: data.email } });
    return json({ success: true });
  }
  if (name === "email-otp/reset-password") {
    const result = (await provider("/verify", {
      body: { type: "recovery", email: data.email, token: data.otp },
    })) as unknown as ProviderTokens;
    await provider("/user", {
      method: "PUT",
      token: result.access_token,
      body: { password: data.password },
    });
    return json({ success: true });
  }
  if (name === "reset-password" && typeof data.token === "string") {
    await provider("/user", {
      method: "PUT",
      token: data.token,
      body: { password: data.newPassword },
    });
    return json({ success: true });
  }
  throw new HttpError(404, "Unknown auth route.");
}
