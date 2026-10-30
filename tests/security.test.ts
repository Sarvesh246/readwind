import { afterEach, describe, expect, it, vi } from "vitest";
import {
  readBytes,
  readJson,
  safeRoute,
  sameOrigin,
} from "../lib/readwind/security";
import { validateFile } from "../lib/readwind/file-validation";
import {
  decodeBackup,
  encryptBackup,
  readBackup,
} from "../lib/readwind/backup";
import { book } from "../lib/readwind/schemas";
import { owner, storageFetch } from "../lib/readwind/server";
const sample = {
  id: "book-1",
  title: "Book",
  author: "Author",
  sections: [
    {
      id: "section",
      title: "Chapter",
      heading: true,
      blocks: [{ type: "p", text: "A real paragraph." }],
    },
  ],
  pageMarks: [],
  cover: { kind: "typeset", color: "#222222", fg: "#ffffff" },
  addedAt: 1,
  lastOpenedAt: 1,
  printPageCount: 1,
};
const archive = () => ({
  format: "folio-backup-1",
  books: [sample],
  blobs: [],
  annotations: [],
  progress: [],
});
function streamed(chunks: string[]) {
  return new Request("https://readwind.test/api", {
    method: "POST",
    body: new ReadableStream({
      start(c) {
        for (const text of chunks) c.enqueue(new TextEncoder().encode(text));
        c.close();
      },
    }),
    duplex: "half",
  } as RequestInit);
}
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});
describe("streaming request limits", () => {
  it("rejects chunked overflow without a Content-Length", async () => {
    await expect(readBytes(streamed(["123", "456"]), 5)).rejects.toMatchObject({
      status: 413,
    });
  });
  it("enforces actual bytes even with a false short header", async () => {
    const request = streamed(["123456"]);
    request.headers.set("content-length", "1");
    await expect(readBytes(request, 5)).rejects.toMatchObject({ status: 413 });
  });
  it("rejects invalid lengths, malformed JSON, and wrong MIME types", async () => {
    const bad = streamed(["x"]);
    bad.headers.set("content-length", "NaN");
    await expect(readBytes(bad, 100)).rejects.toMatchObject({ status: 413 });
    await expect(
      readJson(
        new Request("https://test", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: "{",
        }),
        100,
      ),
    ).rejects.toMatchObject({ status: 400 });
    await expect(readJson(streamed(["{}"]), 100)).rejects.toMatchObject({
      status: 415,
    });
  });
  it("turns validation failures into controlled responses", async () => {
    const route = safeRoute(async (r: Request) => {
      await readBytes(r, 1);
      return new Response();
    });
    expect((await route(streamed(["xx"]))).status).toBe(413);
  });
});
describe("untrusted library archives", () => {
  it("accepts a valid text-only legacy archive", () => {
    expect(decodeBackup(archive()).data.books).toHaveLength(1);
  });
  it.each([
    "http://192.168.0.1/admin",
    "data:text/html;base64,PHNjcmlwdD4=",
    "data:image/svg+xml;base64,PHN2Zz4=",
  ])("rejects active or remote attachment %s", (data) => {
    expect(() =>
      decodeBackup({ ...archive(), blobs: [{ id: "file", data }] }),
    ).toThrow();
  });
  it("checks signatures even when an attacker claims a safe MIME", () => {
    expect(() =>
      validateFile(
        new TextEncoder().encode("<script>alert(1)</script>"),
        "application/pdf",
      ),
    ).toThrow();
  });
  it("rejects an image masquerading as the original PDF", () => {
    const data = "data:image/jpeg;base64,/9j/";
    expect(() =>
      decodeBackup({
        ...archive(),
        books: [{ ...sample, sourcePdfBlobId: "file", readingMode: "reflow" }],
        blobs: [{ id: "file", data }],
      }),
    ).toThrow(/PDF/);
  });
  it("rejects orphan annotations and duplicate book IDs", () => {
    expect(() =>
      decodeBackup({ ...archive(), books: [sample, sample] }),
    ).toThrow(/references/);
  });
  it("bounds nested text, arrays, and anchor coordinates", () => {
    expect(
      book.safeParse({
        ...sample,
        sections: Array(2001).fill(sample.sections[0]),
      }).success,
    ).toBe(false);
    expect(
      book.safeParse({
        ...sample,
        pageMarks: [
          {
            label: "1",
            index: 0,
            at: { section: 999999, block: 0, offset: 0 },
          },
        ],
      }).success,
    ).toBe(false);
    expect(
      book.safeParse({
        ...sample,
        sections: [
          {
            ...sample.sections[0],
            blocks: [{ type: "p", text: "x".repeat(200001) }],
          },
        ],
      }).success,
    ).toBe(false);
  });
  it("encrypts exports and detects tampering or wrong passwords", async () => {
    const encrypted = await encryptBackup(
      JSON.stringify(archive()),
      "a long backup password",
    );
    expect(encrypted).not.toContain("A real paragraph");
    const file = new File([encrypted], "backup.json");
    expect(
      (await readBackup(file, () => "a long backup password")).data.books,
    ).toHaveLength(1);
    await expect(
      readBackup(file, () => "an incorrect password"),
    ).rejects.toThrow(/password/);
    const damaged = JSON.parse(encrypted);
    damaged.data = "AAAA" + damaged.data.slice(4);
    await expect(
      readBackup(
        new File([JSON.stringify(damaged)], "backup.json"),
        () => "a long backup password",
      ),
    ).rejects.toThrow(/damaged/);
  });
});
describe("live authentication and path boundaries", () => {
  const cookie =
    "__Secure-neon-auth.session_token=real; __Secure-neon-auth.local.session_data=forged";
  const request = () =>
    new Request("https://readwind.test/api/library", { headers: { cookie } });
  it("never accepts forged cached session data without upstream validation", async () => {
    vi.stubEnv("NEON_AUTH_BASE_URL", "https://auth.test/neondb/auth");
    const fetcher = vi.fn().mockResolvedValue(Response.json(null));
    vi.stubGlobal("fetch", fetcher);
    expect(await owner(request())).toBeNull();
    expect(
      fetcher.mock.calls[0][0].searchParams.get("disableCookieCache"),
    ).toBe("true");
    expect(fetcher.mock.calls[0][1].headers.cookie).toBe(
      "__Secure-neon-auth.session_token=real",
    );
  });
  it.each([false, true])(
    "requires a verified active upstream session (%s)",
    async (verified) => {
      vi.stubEnv("NEON_AUTH_BASE_URL", "https://auth.test/neondb/auth");
      vi.stubGlobal(
        "fetch",
        vi
          .fn()
          .mockResolvedValue(
            Response.json({
              user: { id: "user-1", emailVerified: verified },
              session: {
                expiresAt: new Date(Date.now() + 60000).toISOString(),
              },
            }),
          ),
      );
      expect(await owner(request())).toBe(verified ? "user-1" : null);
    },
  );
  it("rejects revoked sessions and stateless bearer tokens", async () => {
    vi.stubEnv("NEON_AUTH_BASE_URL", "https://auth.test/neondb/auth");
    const fetcher = vi
      .fn()
      .mockResolvedValue(new Response(null, { status: 401 }));
    vi.stubGlobal("fetch", fetcher);
    expect(await owner(request())).toBeNull();
    expect(
      await owner(
        new Request("https://readwind.test/api/library", {
          headers: { authorization: "Bearer stolen" },
        }),
      ),
    ).toBeNull();
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("blocks cross-site mutations and storage dot segments", () => {
    expect(
      sameOrigin(
        new Request("https://readwind.test/api", {
          method: "POST",
          headers: { origin: "https://attacker.test" },
        }),
      ),
    ).toBe(false);
    expect(() => storageFetch("../file")).toThrow(/path/);
    expect(() => storageFetch("owner/../../file")).toThrow(/path/);
  });
});
