import { afterEach, describe, expect, it, vi } from "vitest";
import { storagePresign } from "../lib/readwind/server";

const keep = { ...process.env };
afterEach(() => {
  process.env = { ...keep };
  vi.restoreAllMocks();
});

function s3Env() {
  Object.assign(process.env, {
    READWIND_BACKEND: "supabase",
    READWIND_STORAGE: "s3",
    AWS_ENDPOINT_URL_S3: "https://s3.us-east-005.backblazeb2.com",
    AWS_REGION: "us-east-005",
    AWS_ACCESS_KEY_ID: "test-key-id",
    AWS_SECRET_ACCESS_KEY: "test-secret",
    READWIND_S3_BUCKET: "readwind-books",
  });
}

describe("S3-compatible file storage with the Supabase database", () => {
  it("signs a direct upload for the configured bucket and pins its exact size", async () => {
    s3Env();
    const fetched = vi.spyOn(globalThis, "fetch");
    const grant = await storagePresign("owner-1/file-1", "application/pdf", 300, 1234, "https://readwind.vercel.app");
    const url = new URL(grant.url);
    expect(url.host).toBe("s3.us-east-005.backblazeb2.com");
    expect(url.pathname).toBe("/readwind-books/owner-1/file-1");
    expect(url.searchParams.get("X-Amz-Expires")).toBe("300");
    expect(url.searchParams.get("X-Amz-SignedHeaders")).toContain("content-length");
    expect(grant.headers["content-length"]).toBe("1234");
    expect(fetched).not.toHaveBeenCalled();
  });

  it("rejects paths that could escape the owner prefix", async () => {
    s3Env();
    await expect(storagePresign("owner-1/../secret", "application/pdf", 300, 10)).rejects.toThrow();
    await expect(storagePresign("a/b/c", "application/pdf", 300, 10)).rejects.toThrow();
  });

  it("keeps using the Supabase bridge unless S3 storage is selected", async () => {
    Object.assign(process.env, { READWIND_BACKEND: "supabase", SUPABASE_URL: "https://example.supabase.co", READWIND_STORAGE_TOKEN: "t" });
    delete process.env.READWIND_STORAGE;
    const fetched = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      Response.json({ url: "https://example.supabase.co/signed", headers: {}, expires: 300 }),
    );
    await storagePresign("owner-1/file-1", "application/pdf", 300, 10, "https://readwind.vercel.app");
    expect(String(fetched.mock.calls[0][0])).toContain("/functions/v1/readwind-storage");
  });
});
