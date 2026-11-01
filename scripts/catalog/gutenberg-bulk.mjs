import { createHash } from "node:crypto";
import { validateCandidate } from "./providers.mjs";
import { defaultHosts } from "./network.mjs";

/** @param {{limit?: number, excluded?: string[], priority?: (string|number)[]}} [options] */
export function bulkGutenbergCandidates(
  rows,
  rightsIndex,
  coverIndex,
  options = {},
) {
  const { limit = 1000, excluded = [], priority = [] } = options;
  if (
    rightsIndex.source !==
      "https://www.gutenberg.org/cache/epub/feeds/rdf-files.tar.zip" ||
    !/^[a-f0-9]{64}$/.test(rightsIndex.sha256 || "")
  )
    throw new Error(
      "Provide an indexed official Gutenberg RDF archive with its checksum.",
    );
  if (
    coverIndex.source !==
      "https://www.gutenberg.org/cache/epub/feeds/img_data.csv.gz" ||
    !/^[a-f0-9]{64}$/.test(coverIndex.sha256 || "")
  )
    throw new Error(
      "Provide the official cover inventory index with its checksum.",
    );
  if (!Number.isInteger(limit) || limit < 1 || limit > 10000)
    throw new Error("Choose 1–10000 candidates.");
  const existing = new Set(excluded),
    covers = new Set(coverIndex.ids),
    preferred = new Set(priority.map(String));
  const candidates = [];
  for (const row of rows) {
    const id = row["Text#"],
      license = rightsIndex.rights[id];
    if (
      !/^\d+$/.test(id) ||
      existing.has(`pg-${id}`) ||
      row.Language !== "en" ||
      row.Type !== "Text" ||
      !/^Public domain in the USA\.?$/i.test(license || "")
    )
      continue;
    // This is a discovery hint only: every downloaded cover still passes the worker's checks.
    if (!covers.has(id) && !preferred.has(id)) continue;
    const record = {
      id: `pg-${id}`,
      provider: "gutenberg",
      trusted: true,
      fullText: true,
      title: row.Title.replace(/\s+/g, " ").slice(0, 500),
      author: row.Authors.slice(0, 500),
      language: "en",
      edition: `Project Gutenberg ${id}`,
      publisher: "Project Gutenberg",
      source: "Project Gutenberg",
      sourceUrl: `https://www.gutenberg.org/ebooks/${id}`,
      downloadUrl: `https://www.gutenberg.org/cache/epub/${id}/pg${id}-images-3.epub`,
      format: "epub",
      license,
      subjects: (row.Subjects || row.Bookshelves || "Literature")
        .split(";")
        .map((s) => s.trim())
        .filter(Boolean)
        .slice(0, 30),
      evidence: {
        catalogId: id,
        catalogCopyright: license,
        fullTextDesignation: "Text",
        catalogTitle: row.Title,
        catalogAuthor: row.Authors,
        rightsArchive: rightsIndex.source,
        rightsArchiveSha256: rightsIndex.sha256,
        coverInventorySha256: coverIndex.sha256,
      },
      hosts: defaultHosts,
    };
    if (!validateCandidate(record).passed) continue;
    candidates.push({
      record,
      category:
        row.Bookshelves.split(";")
          .map((s) => s.trim())
          .find((s) => s.startsWith("Category:")) ||
        row.LoCC.split(";")[0] ||
        "Other",
      rank: createHash("sha256")
        .update(`readwind-broad-catalog:${id}`)
        .digest("hex"),
    });
  }
  const selected = [],
    works = new Set();
  const append = (candidate) => {
    const key = `${candidate.record.title.toLowerCase()}|${candidate.record.author.toLowerCase()}`;
    if (works.has(key)) return;
    works.add(key);
    selected.push(candidate.record);
  };
  for (const id of priority.map(String)) {
    const candidate = candidates.find((c) => c.record.id === `pg-${id}`);
    if (candidate && selected.length < limit) append(candidate);
  }
  const groups = new Map();
  for (const candidate of candidates.sort((a, b) =>
    a.rank.localeCompare(b.rank),
  )) {
    if (preferred.has(candidate.record.id.slice(3))) continue;
    if (!groups.has(candidate.category)) groups.set(candidate.category, []);
    groups.get(candidate.category).push(candidate);
  }
  while (selected.length < limit && groups.size) {
    for (const [category, group] of groups) {
      append(group.shift());
      if (!group.length) groups.delete(category);
      if (selected.length >= limit) break;
    }
  }
  return selected;
}
