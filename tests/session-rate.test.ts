import { afterEach, describe, expect, it, vi } from "vitest";
const query = vi.hoisted(()=>vi.fn());
vi.mock("@neondatabase/serverless",()=>({neon:()=>query}));
import { owner } from "../lib/readwind/server";
afterEach(()=>{vi.unstubAllGlobals();vi.unstubAllEnvs();vi.clearAllMocks();});
const request=()=>new Request("https://readwind.test/api/library",{headers:{cookie:"__Secure-neon-auth.session_token=untrusted","cf-connecting-ip":"192.0.2.1"}});
describe("session lookup throttle",()=>{
 it("throttles invalid tokens before contacting the provider",async()=>{
  vi.stubEnv("DATABASE_URL","postgres://unused");vi.stubEnv("NEON_AUTH_BASE_URL","https://auth.test/neondb/auth");
  query.mockResolvedValue([{hits:241}]);const fetcher=vi.fn();vi.stubGlobal("fetch",fetcher);
  await expect(owner(request())).rejects.toMatchObject({status:429});expect(fetcher).not.toHaveBeenCalled();
 });
 it("forwards the trusted edge IP for allowed session lookups",async()=>{
  vi.stubEnv("DATABASE_URL","postgres://unused");vi.stubEnv("NEON_AUTH_BASE_URL","https://auth.test/neondb/auth");
  query.mockResolvedValue([{hits:1}]);const fetcher=vi.fn().mockResolvedValue(Response.json(null));vi.stubGlobal("fetch",fetcher);
  expect(await owner(request())).toBeNull();expect(fetcher.mock.calls[0][1].headers["x-forwarded-for"]).toBe("192.0.2.1");
 });
});
