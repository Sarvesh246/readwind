import { ReadwindDB, encodeFile } from "./db";
/** Carry books imported before sign-in into the account's pending upload queue. */
export async function migratePreview(userId: string) {
  const preview = new ReadwindDB("preview"),
    account = new ReadwindDB(userId);
  try {
    const books = await preview.books.filter((b) => !b.sample).toArray();
    if (!books.length) return;
    const ids = new Set(books.map((b) => b.id)),
      annotations = await preview.annotations
        .filter((a) => ids.has(a.bookId))
        .toArray(),
      progress = await preview.progress
        .filter((p) => ids.has(p.bookId))
        .toArray();
    const fileIds = new Set(
      books
        .flatMap((b) => [
          b.sourcePdfBlobId,
          b.cover.blobId,
          ...b.sections.flatMap((s) =>
            s.blocks.flatMap((b) => (b.type === "figure" ? [b.blobId] : [])),
          ),
        ])
        .filter(Boolean) as string[],
    );
    const cached = await preview.blobs
      .where("id")
      .anyOf([...fileIds])
      .toArray();
    const files = await Promise.all(cached.map(f => 'blob' in f ? encodeFile(f) : f));
    await account.transaction(
      "rw",
      [
        account.books,
        account.annotations,
        account.progress,
        account.blobs,
        account.pending,
      ],
      async () => {
        for (const book of books) {
          if (await account.books.get(book.id)) continue;
          await account.books.put(book);
          await account.pending.put({
            id: `book:${book.id}`,
            entity: "book",
            bookId: book.id,
            value: book,
          });
        }
        if (files.length) await account.blobs.bulkPut(files);
        for (const a of annotations) {
          if (await account.annotations.get(a.id)) continue;
          await account.annotations.put(a);
          await account.pending.put({
            id: `annotation:${a.id}`,
            entity: "annotation",
            bookId: a.bookId,
            value: a,
          });
        }
        for (const p of progress) {
          if (await account.progress.get(p.bookId)) continue;
          await account.progress.put({ ...p, revision: 0 });
          await account.pending.put({
            id: `progress:${p.bookId}`,
            entity: "progress",
            bookId: p.bookId,
            value: { ...p, revision: 0 },
          });
        }
      },
    );
    await preview.delete();
  } finally {
    preview.close();
    account.close();
  }
}
