import { afterEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";
vi.mock("../lib/readwind/server", () => ({ rateLimit: vi.fn() }));
import { rateLimit } from "../lib/readwind/server";
import { GET, POST } from "../app/api/auth/[...path]/route";
const ctx = (...path: string[]) => ({ params: Promise.resolve({ path }) });
const post = (origin = "https://readwind.test", body = "{}") =>
  new Request("https://readwind.test/api/auth/sign-in/email", {
    method: "POST",
    headers: { origin, "content-type": "application/json" },
    body,
  }) as NextRequest;
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});
describe("auth proxy boundary", () => {
  it("returns SDK-readable service errors when the database prerequisites are missing",async()=>{
    vi.mocked(rateLimit).mockRejectedValueOnce(Object.assign(new Error("missing table"),{code:"42P01"}));
    const response=await POST(post(),ctx("sign-in","email"));
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({error:"Service unavailable. Please retry.",message:"Service unavailable. Please retry."});
  });

  it("blocks cross-origin POST before forwarding", async () => {
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    expect(
      (await POST(post("https://evil.test"), ctx("sign-in", "email"))).status,
    ).toBe(403);
    expect(fetcher).not.toHaveBeenCalled();
  });
  it.each([
    ["..", "admin"],
    ["%2e%2e", "token"],
    ["admin", "ban-user"],
    ["sign-in", "social"],
    ["token"],
  ])("rejects traversal and unused auth routes %j", async (...path) => {
    expect(
      (
        await GET(
          new Request("https://readwind.test/api/auth") as NextRequest,
          ctx(...path),
        )
      ).status,
    ).toBe(404);
  });
  it("rejects excessive unauthenticated bodies", async () => {
    expect(
      (
        await POST(
          post(
            "https://readwind.test",
            JSON.stringify({ password: "x".repeat(17000) }),
          ),
          ctx("sign-in", "email"),
        )
      ).status,
    ).toBe(413);
  });
  it("forwards a trusted origin with no Referer or cached session data, and hardens cookies", async () => {
    vi.stubEnv("NEON_AUTH_BASE_URL", "https://auth.test/neondb/auth");
    const fetcher = vi
      .fn()
      .mockResolvedValue(
        new Response("{}", {
          headers: {
            "set-cookie":
              "__Secure-neon-auth.session_token=real; Domain=auth.test; SameSite=None; Path=/neondb/auth",
          },
        }),
      );
    vi.stubGlobal("fetch", fetcher);
    const req = post();
    req.headers.set("referer", "https://readwind.test/?token=secret");
    req.headers.set(
      "cookie",
      "__Secure-neon-auth.session_token=real; __Secure-neon-auth.local.session_data=forged",
    );
    const response = await POST(req, ctx("sign-in", "email"));
    expect(response.status).toBe(200);
    const headers = fetcher.mock.calls[0][1].headers as Headers;
    expect(headers.get("origin")).toBe("https://readwind.test");
    expect(headers.get("referer")).toBeNull();
    expect(headers.get("cookie")).not.toContain("session_data");
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(response.headers.get("vary")).toBe("Cookie");
    expect(response.headers.get("set-cookie")).not.toContain("Domain=");
    expect(response.headers.get("set-cookie")).toContain("SameSite=Lax");
  });
  it("always disables the upstream session cache", async () => {
    vi.stubEnv("NEON_AUTH_BASE_URL", "https://auth.test/neondb/auth");
    const fetcher = vi.fn().mockResolvedValue(Response.json(null));
    vi.stubGlobal("fetch", fetcher);
    await GET(
      new Request("https://readwind.test/api/auth/get-session") as NextRequest,
      ctx("get-session"),
    );
    expect(
      fetcher.mock.calls[0][0].searchParams.get("disableCookieCache"),
    ).toBe("true");
  });
});
