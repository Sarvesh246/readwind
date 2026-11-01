import { gunzipSync } from "node:zlib";
import { download, defaultHosts } from "./network.mjs";
export function csvRows(text) {
  const rows = [];
  let row = [],
    cell = "",
    quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '"') {
      if (quoted && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else quoted = !quoted;
    } else if (ch === "," && !quoted) {
      row.push(cell);
      cell = "";
    } else if (ch === "\n" && !quoted) {
      row.push(cell.replace(/\r$/, ""));
      rows.push(row);
      row = [];
      cell = "";
    } else cell += ch;
  }
  if (cell || row.length) {
    row.push(cell);
    rows.push(row);
  }
  const headers = rows.shift() || [];
  return rows.map((row) =>
    Object.fromEntries(headers.map((h, i) => [h, row[i] || ""])),
  );
}
const allowedLicense = (license) =>
  /creativecommons\.org\/(licenses\/by(?:-sa)?\/|publicdomain\/zero\/)|^CC[- ]BY(?:[- ]SA)?(?:[- ]4\.0)?$|Public domain in the USA/i.test(
    license || "",
  );
export function validateCandidate(record) {
  const errors = [];
  for (const key of [
    "id",
    "title",
    "author",
    "source",
    "sourceUrl",
    "downloadUrl",
    "license",
    "edition",
    "language",
  ])
    if (typeof record[key] !== "string" || !record[key].trim())
      errors.push(`Missing ${key}`);
  if (!/^[a-zA-Z0-9_-]{1,80}$/.test(record.id || ""))
    errors.push("Invalid edition ID");
  if (
    record.aliases !== undefined &&
    (!Array.isArray(record.aliases) ||
      record.aliases.length > 20 ||
      record.aliases.some(
        (alias) =>
          typeof alias !== "string" || !alias.trim() || alias.length > 500,
      ))
  )
    errors.push("Invalid alternate titles");
  if (/^(unknown|anonymous|n\/?a)$/i.test(record.author?.trim() || ""))
    errors.push("Verified author attribution is required.");
  if (/^index of (?:the )?project gutenberg\b/i.test(record.title || ""))
    errors.push("A navigation index is not a complete book.");
  if (
    Array.isArray(record.subjects) &&
    record.subjects.some(
      (subject) =>
        typeof subject === "string" &&
        (/--\s*Periodicals\s*$/i.test(subject) ||
          /^(?:Booksellers|Publishers)['’]?\s+catalog(?:ue)?s\b/i.test(
            subject,
          )),
    )
  )
    errors.push(
      "Periodical issues and publishers' sales catalogs require separate collection review.",
    );
  if (!["epub", "pdf", "html"].includes(record.format))
    errors.push("Unsupported source format");
  if (
    record._generation !== undefined &&
    (!Number.isSafeInteger(record._generation) || record._generation < 0)
  )
    errors.push("Invalid checkpoint generation");
  for (const key of ["sourceUrl", "downloadUrl", "coverUrl"])
    if (record[key]) {
      try {
        const url = new URL(record[key]);
        if (url.protocol !== "https:" || url.username || url.password)
          errors.push(`Invalid ${key}`);
      } catch {
        errors.push(`Invalid ${key}`);
      }
    }
  if (
    record.hosts !== undefined &&
    (!Array.isArray(record.hosts) ||
      record.hosts.some(
        (h) => typeof h !== "string" || !/^[a-z0-9.-]+$/i.test(h),
      ))
  )
    errors.push("Invalid source host allowlist");
  if (record.language !== "en") errors.push("English-only launch");
  if (
    !["gutenberg", "thoth", "oapen", "approved"].includes(record.provider) ||
    record.trusted !== true ||
    record.fullText !== true
  )
    errors.push("Source needs approval and full-book evidence");
  if (!allowedLicense(record.license))
    errors.push("Redistribution/conversion permission needs review");
  if (
    record.provider === "approved" &&
    (!record.evidence?.fullBookEvidence || !record.evidence?.permissionUrl)
  )
    errors.push("Operator approval needs completeness and permission evidence");
  if (record.coverUrl && !record.coverLicense)
    errors.push("External cover permission needs review");
  if (
    /all rights reserved|used with permission/i.test(record.coverCaption || "")
  )
    errors.push("Cover permission exclusions need review");
  if (record.coverLicense && !allowedLicense(record.coverLicense))
    errors.push("Cover license needs review");
  if (record.coverNote && !record.coverEditionEvidence)
    errors.push("Alternate cover edition needs evidence");
  if (
    /\b(sample|preview|excerpt|abridged|incomplete|partial)\b|\b\d+(?:st|nd|rd|th)?\s+\d*\s*pages\b|\b(?:vol(?:ume)?|part)\.?\s*(?:\d+|[ivx]+)\b|\bin (?:\d+|two|three|four|five|six|seven|eight|nine|ten) volumes\b/i.test(
      `${record.edition || ""} ${record.title || ""} ${record.evidence?.catalogTitle || ""}`,
    )
  )
    errors.push("Not an approved complete edition");
  return { passed: errors.length === 0, errors };
}
export async function discoverGutenberg(limit = 100, offset = 0) {
  const response = await download(
    "https://www.gutenberg.org/cache/epub/feeds/pg_catalog.csv.gz",
    { maxBytes: 15 * 1024 * 1024 },
  );
  const rows = csvRows(
    gunzipSync(response.bytes, {
      maxOutputLength: 80 * 1024 * 1024,
    }).toString(),
  );
  const selected = rows
      .filter(
        (r) =>
          r.Language === "en" &&
          r.Type === "Text" &&
          r.Authors &&
          !/\b(periodical|magazine|journal|declaration|constitution|collected works)\b/i.test(
            r.Title,
          ),
      )
      .slice(offset, offset + limit),
    records = [];
  for (const r of selected) {
    const id = r["Text#"];
    const rdf = (
      await download(`https://www.gutenberg.org/cache/epub/${id}/pg${id}.rdf`)
    ).bytes.toString();
    const license = rdf.match(/<dcterms:rights>([^<]+)</)?.[1] || "";
    if (!/Public domain in the USA/i.test(license)) continue;
    records.push({
      id: `pg-${id}`,
      provider: "gutenberg",
      trusted: true,
      fullText: true,
      title: r.Title.replace(/\s+/g, " ").slice(0, 500),
      author: r.Authors.slice(0, 500),
      language: "en",
      edition: `Project Gutenberg ${id}`,
      publisher: "Project Gutenberg",
      source: "Project Gutenberg",
      sourceUrl: `https://www.gutenberg.org/ebooks/${id}`,
      downloadUrl: `https://www.gutenberg.org/cache/epub/${id}/pg${id}-images-3.epub`,
      format: "epub",
      license,
      subjects: (r.Subjects || r.Bookshelves || "Literature")
        .split(";")
        .map((s) => s.trim())
        .slice(0, 30),
      evidence: {
        catalogId: id,
        catalogCopyright: license,
        fullTextDesignation: "Text",
        catalogTitle: r.Title,
        catalogAuthor: r.Authors,
      },
      hosts: defaultHosts,
    });
  }
  return records;
}
export async function discoverThoth(limit = 50, offset = 0) {
  const query = `{books(limit:${Math.min(100, limit)},offset:${offset},publishers:["85fd969a-a16c-480b-b641-cb9adf979c3b"],workStatus:ACTIVE){workId workStatus edition publicationDate license landingPage coverUrl coverCaption titles{fullTitle canonical} contributions{fullName contributionType} languages{languageCode} subjects{subjectCode} imprint{publisher{publisherName}} publications{publicationType file{cdnUrl sha256} locations{fullTextUrl}}}}`;
  const response = await download("https://api.thoth.pub/graphql", {
      method: "POST",
      body: JSON.stringify({ query }),
    }),
    data = JSON.parse(response.bytes.toString());
  if (data.errors)
    throw new Error(`Thoth metadata request failed: ${data.errors[0].message}`);
  return data.data.books
    .filter(
      (w) =>
        w.workStatus === "ACTIVE" &&
        w.languages.some((l) => ["ENG", "EN"].includes(l.languageCode)) &&
        allowedLicense(w.license),
    )
    .flatMap((w) => {
      const choices = w.publications
        .filter((p) => ["EPUB", "PDF"].includes(p.publicationType))
        .sort((a, b) =>
          a.publicationType === "EPUB"
            ? -1
            : b.publicationType === "EPUB"
              ? 1
              : 0,
        );
      const publication = choices.find(
        (p) => p.file?.cdnUrl || p.locations.some((l) => l.fullTextUrl),
      );
      if (!publication) return [];
      const url =
        publication.file?.cdnUrl ||
        publication.locations.find(
          (l) =>
            l.fullTextUrl &&
            l.fullTextUrl.includes("books.openbookpublishers.com"),
        )?.fullTextUrl;
      if (!url) return [];
      const publisher = w.imprint.publisher.publisherName;
      if (publisher !== "Open Book Publishers") return [];
      return [
        {
          id: `thoth-${w.workId}`,
          provider: "thoth",
          trusted: true,
          fullText: true,
          title: (w.titles.find((t) => t.canonical) || w.titles[0])?.fullTitle,
          author: w.contributions
            .filter((c) => ["AUTHOR", "EDITOR"].includes(c.contributionType))
            .map((c) => c.fullName)
            .join(", "),
          language: "en",
          edition: `${w.publicationDate || ""} · Edition ${w.edition || 1}`,
          publisher,
          source: "Open Book Publishers / Thoth",
          sourceUrl: w.landingPage,
          downloadUrl: url,
          format: publication.publicationType.toLowerCase(),
          license: w.license,
          subjects: w.subjects.map((s) => s.subjectCode).slice(0, 30),
          expectedSha256: publication.file?.sha256 || undefined,
          coverUrl: w.coverUrl,
          coverLicense: w.license,
          coverCaption: w.coverCaption,
          evidence: {
            workId: w.workId,
            status: w.workStatus,
            fullTextDesignation: "book publication",
            license: w.license,
          },
          hosts: defaultHosts,
        },
      ];
    });
}
export function oapenRecords(rows) {
  return rows.flatMap((row) => {
    const metadata = row.metadata || [],
      values = (key) =>
        metadata.filter((m) => m.key === key).map((m) => m.value),
      first = (key) => values(key)[0] || "";
    const format =
      (row.bitstreams || []).find((b) => /\.epub$/i.test(b.name)) ||
      (row.bitstreams || []).find((b) => /\.pdf$/i.test(b.name));
    if (!format) return [];
    const language = first("dc.language.iso");
    return [
      {
        id: `oapen-${String(row.uuid || row.id).replace(/[^a-zA-Z0-9_-]/g, "-")}`,
        provider: "oapen",
        trusted: true,
        fullText:
          /book|monograph/i.test(first("dc.type")) &&
          !/chapter/i.test(first("dc.type")),
        title: first("dc.title"),
        author: values("dc.contributor.author")
          .concat(values("dc.contributor.editor"))
          .join(", "),
        language: ["en", "eng", "English"].includes(language) ? "en" : language,
        edition: first("dc.date.issued") || String(row.uuid || row.id),
        publisher: first("dc.publisher"),
        source: "OAPEN",
        sourceUrl: `https://library.oapen.org/handle/${row.handle}`,
        downloadUrl: new URL(format.retrieveLink, "https://library.oapen.org")
          .href,
        format: /\.epub$/i.test(format.name) ? "epub" : "pdf",
        license: first("dc.rights.uri"),
        subjects: values("dc.subject"),
        evidence: {
          handle: row.handle,
          type: first("dc.type"),
          fullTextDesignation: format.name,
          license: first("dc.rights.uri"),
        },
        hosts: defaultHosts,
      },
    ];
  });
}
export async function discoverOapen(limit = 50, offset = 0) {
  const response = await download(
    `https://library.oapen.org/rest/search?query=dc.language.iso:eng&expand=metadata,bitstreams&limit=${Math.min(100, limit)}&offset=${offset}`,
  );
  const data = JSON.parse(response.bytes.toString());
  return oapenRecords(Array.isArray(data) ? data : data.items || []);
}
