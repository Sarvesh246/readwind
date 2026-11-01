import { describe, it, expect } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { publicAddress } from "../scripts/catalog/network.mjs";
import {
  csvRows,
  validateCandidate,
  oapenRecords,
} from "../scripts/catalog/providers.mjs";
import { openQueue, enqueue } from "../scripts/catalog/worker.mjs";
describe("catalog worker safety", () => {
  it("blocks loopback, private, link-local, mapped and reserved addresses", () => {
    for (const ip of [
      "127.0.0.1",
      "10.1.2.3",
      "192.168.0.1",
      "172.16.0.1",
      "169.254.169.254",
      "100.64.1.1",
      "::1",
      "::ffff:127.0.0.1",
      "fc00::1",
      "fe80::1",
      "2001:db8::1",
    ])
      expect(publicAddress(ip), ip).toBe(false);
    expect(publicAddress("1.1.1.1")).toBe(true);
  });
  it("parses quoted multiline provider metadata", () =>
    expect(csvRows('Title,Author\n"A, book","First\nLast"\n')).toEqual([
      { Title: "A, book", Author: "First\nLast" },
    ]));
  it("holds arbitrary URLs and non-adaptable licenses", () => {
    expect(
      validateCandidate({ downloadUrl: "https://example.org/book.pdf" }).passed,
    ).toBe(false);
    const record = {
      id: "a",
      title: "Book",
      author: "Author",
      source: "Publisher",
      sourceUrl: "https://example.org",
      downloadUrl: "https://example.org/a.epub",
      license: "https://creativecommons.org/licenses/by-nd/4.0/",
      edition: "Complete",
      language: "en",
      provider: "thoth",
      format: "epub",
      trusted: true,
      fullText: true,
    };
    expect(validateCandidate(record).passed).toBe(false);
    expect(
      validateCandidate({
        ...record,
        license: "https://creativecommons.org/licenses/by/4.0/",
      }).passed,
    ).toBe(true);
  });
  it("persists quarantines and deduplicates queue entries across restarts", () => {
    const dir = mkdtempSync(join(tmpdir(), "readwind-catalog-"));
    try {
      let q = openQueue(dir);
      enqueue(q, { id: "candidate", downloadUrl: "https://example.org/a" });
      enqueue(q, { id: "candidate", downloadUrl: "https://example.org/a" });
      q.db.close();
      q = openQueue(dir);
      expect(q.db.prepare("SELECT stage FROM jobs").all()).toEqual([
        { stage: "review" },
      ]);
      q.db.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
  it("never classifies an OAPEN chapter as a full book", () => {
    const rows = oapenRecords([
      {
        id: "1",
        handle: "1/2",
        metadata: [{ key: "dc.type", value: "chapter" }],
        bitstreams: [{ name: "a.pdf", retrieveLink: "/a.pdf" }],
      },
    ]);
    expect(rows[0].fullText).toBe(false);
  });
});
