import type { Book, Progress } from "./types";
export type CatalogEntry = {
  id: string;
  workId: string;
  title: string;
  aliases?: string[];
  author: string;
  language: string;
  subjects: string[];
  edition: string;
  publisher: string;
  source: string;
  sourceUrl: string;
  license: string;
  coverId: string;
  coverNote?: string;
  version: string;
  bytes: number;
  format: "pdf" | "epub" | "html";
};
export function catalogMetadataUpdate(book: Book) {
  return {
    kind: "catalog-metadata" as const,
    id: book.id,
    catalog: {
      editionId: book.catalog!.editionId,
      version: book.catalog!.version,
    },
    metadata: {
      title: book.title,
      author: book.author,
      addedAt: book.addedAt,
      lastOpenedAt: book.lastOpenedAt,
      cover: book.cover,
      customCoverBlobId: book.customCoverBlobId ?? null,
      readingMode: book.readingMode,
    },
  };
}
export const catalogKey = (text: string) =>
  text
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
export const authorKey = (text: string) =>
  catalogKey(text.replace(/\[[^\]]*\]/g, "").replace(/\b\d[\d?-]*\b/g, ""))
    .split(" ")
    .filter(Boolean)
    .sort()
    .join(" ");
export function searchCatalog(entries: CatalogEntry[], query: string) {
  const q = catalogKey(query);
  if (!q) return entries;
  return entries
    .map((entry) => {
      const titles = [entry.title, ...(entry.aliases || [])].map(catalogKey),
        a = catalogKey(entry.author),
        s = catalogKey(entry.subjects.join(" "));
      return {
        entry,
        rank: titles.some((t) => t === q)
          ? 0
          : titles.some((t) => t.startsWith(q))
            ? 1
            : titles.some((t) => t.includes(q))
              ? 2
              : a.includes(q) ||
                  q
                    .split(" ")
                    .every((token) =>
                      a.split(" ").some((word) => word.startsWith(token)),
                    )
                ? 3
                : s.includes(q)
                  ? 4
                  : 99,
      };
    })
    .filter((r) => r.rank < 99)
    .sort(
      (a, b) => a.rank - b.rank || a.entry.title.localeCompare(b.entry.title),
    )
    .map((r) => r.entry);
}
export function recommendCatalog(
  entries: CatalogEntry[],
  books: Book[],
  progress: Progress[],
  limit = 24,
) {
  const owned = new Set(
    books.flatMap((b) => (b.catalog ? [b.catalog.editionId] : [])),
  );
  const signals = books.flatMap((b) => {
    const matches = b.catalog
      ? [
          entries.find((e) => e.id === b.catalog!.editionId) || {
            id: b.catalog.editionId,
            title: b.title,
            author: b.author,
            subjects: b.catalog.subjects,
          },
        ]
      : entries.filter(
          (e) =>
            catalogKey(e.title) === catalogKey(b.title) &&
            authorKey(e.author) === authorKey(b.author),
        );
    if (matches.length !== 1 || b.sample) return [];
    const p = progress.find((p) => p.bookId === b.id);
    return [
      {
        entry: matches[0],
        weight:
          1 + (p?.wordsRead ? 3 : 0) + (b.lastOpenedAt > b.addedAt ? 1 : 0),
      },
    ];
  });
  const scored = entries
    .filter(
      (e) =>
        !owned.has(e.id) &&
        !books.some(
          (b) =>
            catalogKey(b.title) === catalogKey(e.title) &&
            authorKey(b.author) === authorKey(e.author),
        ),
    )
    .map((entry) => {
      let score = 0,
        reason = "";
      for (const s of signals) {
        if (authorKey(s.entry.author) === authorKey(entry.author)) {
          score += 5 * s.weight;
          reason = "More by this author";
        }
        const shared = entry.subjects.filter((t) =>
          s.entry.subjects.some((x) => catalogKey(t) === catalogKey(x)),
        );
        score += shared.length * s.weight;
        if (shared.length && !reason)
          reason = `Related to ${shared[0].toLowerCase()}`;
      }
      return { entry, score, reason };
    })
    .sort(
      (a, b) => b.score - a.score || a.entry.title.localeCompare(b.entry.title),
    );
  const selected: typeof scored = [],
    authors = new Map<string, number>(),
    topics = new Map<string, number>();
  // Reserve every fifth place for discovery; bound repeated authors and primary subjects.
  const pool = [...scored];
  while (selected.length < limit && pool.length) {
    let index =
      selected.length % 5 === 4 ? pool.findIndex((x) => x.score === 0) : -1;
    if (index < 0)
      index = pool.findIndex(
        (x) =>
          (authors.get(x.entry.author) || 0) < 2 &&
          (topics.get(x.entry.subjects[0]) || 0) < 6,
      );
    if (index < 0)
      index = pool.findIndex((x) => (authors.get(x.entry.author) || 0) < 2);
    if (index < 0) break;
    const [item] = pool.splice(index, 1);
    selected.push(item);
    authors.set(item.entry.author, (authors.get(item.entry.author) || 0) + 1);
    topics.set(
      item.entry.subjects[0],
      (topics.get(item.entry.subjects[0]) || 0) + 1,
    );
  }
  return { personalized: signals.length > 0, items: selected };
}
export function bookAssets(book: Book) {
  return [
    ...new Set(
      [
        ...(book.catalog?.assets.map((a) => a.id) || []),
        book.sourcePdfBlobId,
        book.sourceBlobId,
        book.cover.blobId,
        book.pdfCoverBlobId,
        book.customCoverBlobId,
        ...book.sections.flatMap((s) =>
          s.blocks.flatMap((b) => (b.type === "figure" ? [b.blobId] : [])),
        ),
      ].filter((x): x is string => !!x),
    ),
  ];
}
export function privateBookAssets(book: Book) {
  const shared = new Set(book.catalog?.assets.map((a) => a.id));
  return bookAssets(book).filter((id) => !shared.has(id));
}
export async function sha256(bytes: Uint8Array) {
  return [
    ...new Uint8Array(
      await crypto.subtle.digest("SHA-256", bytes as BufferSource),
    ),
  ]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
export async function verifiedAsset(
  response: Response,
  asset: { sha256: string; bytes: number; type: string },
) {
  if (!response.ok)
    throw new Error("Could not download this book. Please retry.");
  const reader = response.body?.getReader();
  if (!reader) throw new Error("Empty book file.");
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > asset.bytes) {
        await reader.cancel();
        throw new Error("Book file size did not match.");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  if (size !== asset.bytes || (await sha256(bytes)) !== asset.sha256)
    throw new Error("Book file verification failed. Please retry.");
  return new Blob([bytes], { type: asset.type });
}
