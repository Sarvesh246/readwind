import { neon } from "@neondatabase/serverless";
import { AwsClient } from "aws4fetch";
import { createHash } from "node:crypto";
export const digest = (bytes) =>
  createHash("sha256").update(bytes).digest("hex");
function paused(message) {
  const error = new Error(message);
  error.code = "CATALOG_PAUSED";
  return error;
}
function configuration() {
  if (process.env.READWIND_CATALOG_TARGET_VERIFIED !== "true")
    throw paused(
      "Publication paused: verify production project, database and free storage allowance first.",
    );
  const budget = Number(process.env.READWIND_CATALOG_BUDGET_BYTES),
    baseline = Number(process.env.READWIND_CATALOG_BASELINE_BYTES);
  if (
    !Number.isSafeInteger(budget) ||
    budget <= 0 ||
    !process.env.READWIND_CATALOG_BASELINE_BYTES?.trim() ||
    !Number.isSafeInteger(baseline) ||
    baseline < 0
  )
    throw paused(
      "Publication paused: set verified storage budget and existing-storage baseline.",
    );
  if (!process.env.CATALOG_DATABASE_URL)
    throw paused(
      "Set CATALOG_DATABASE_URL to the separate publication credential.",
    );
  const endpoint = new URL(process.env.AWS_ENDPOINT_URL_S3 || "");
  if (endpoint.protocol !== "https:")
    throw new Error("Storage must use HTTPS.");
  return {
    budget: Math.floor(budget * 0.8) - baseline,
    db: neon(process.env.CATALOG_DATABASE_URL),
    endpoint: endpoint.href.replace(/\/$/, ""),
    bucket: process.env.CATALOG_BUCKET || "folio-books",
  };
}
function client() {
  return new AwsClient({
    service: "s3",
    region: process.env.AWS_REGION || "us-east-2",
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  });
}
export async function publishPrepared(record, prepared) {
  const { budget, db, endpoint, bucket } = configuration();
  const manifest = Buffer.from(JSON.stringify(prepared.book)),
    hash = digest(manifest),
    manifestId = `manifest-${digest(prepared.book.catalog.version)}`,
    version = prepared.book.catalog.version;
  if (
    !prepared.report.passed ||
    !prepared.book.cover.blobId ||
    !prepared.assets.some((a) => a.id === prepared.book.cover.blobId)
  )
    throw new Error("Publication requires a passing report and a real cover.");
  for (const asset of prepared.assets) {
    const bytes = Buffer.from(asset.data, "base64");
    if (bytes.length !== asset.bytes || digest(bytes) !== asset.sha256)
      throw new Error("A checkpointed asset failed integrity validation.");
    const reference = prepared.book.catalog.assets.find(
      (a) => a.id === asset.id,
    );
    if (
      !reference ||
      reference.sha256 !== asset.sha256 ||
      reference.bytes !== asset.bytes ||
      reference.type !== asset.type
    )
      throw new Error("Prepared asset manifest does not match.");
  }
  if (prepared.book.catalog.assets.length !== prepared.assets.length)
    throw new Error("Prepared asset inventory is incomplete.");
  if (manifest.length > 12000000)
    throw new Error("Prepared metadata exceeds library limits.");
  const bytes =
    manifest.length + prepared.assets.reduce((n, a) => n + a.bytes, 0);
  if (prepared.assets.some((a) => a.bytes > 20971520 || a.bytes <= 0))
    throw new Error("An asset exceeds storage limits.");
  const entry = {
    id: record.id,
    workId: record.workId || record.id,
    title: record.title,
    author: record.author,
    language: record.language,
    subjects: record.subjects || [],
    edition: record.edition,
    publisher: record.publisher || record.source,
    source: record.source,
    sourceUrl: record.sourceUrl,
    license: record.license,
    coverId: prepared.coverThumbnailId || prepared.book.cover.blobId,
    coverNote: record.coverNote,
    version,
    bytes,
    format: record.format,
  };
  // Reserve the entire staged version under a global lock before uploading any bytes.
  const reservation = await db.transaction([
    db`SELECT pg_advisory_xact_lock(hashtextextended('readwind-catalog-budget',0))`,
    db`INSERT INTO folio_catalog_versions(id,edition_id,entry,manifest_id,manifest_sha256,report,bytes) SELECT ${version},${record.id},${JSON.stringify(entry)}::jsonb,${manifestId},${hash},${JSON.stringify(prepared.report)}::jsonb,${bytes} WHERE COALESCE((SELECT sum(bytes) FROM folio_catalog_versions WHERE id<>${version}),0)+${bytes}<=${budget} ON CONFLICT(id) DO UPDATE SET created_at=CASE WHEN folio_catalog_versions.ready THEN folio_catalog_versions.created_at ELSE now() END WHERE NOT folio_catalog_versions.cleaning RETURNING id,manifest_sha256,ready`,
  ]);
  const reserved = reservation[1][0];
  if (!reserved)
    throw paused(
      "Publication paused: free storage budget exhausted or staging cleanup in progress.",
    );
  if (reserved.manifest_sha256 !== hash)
    throw new Error("Immutable version already exists with different content.");
  for (const asset of prepared.assets)
    await db`INSERT INTO folio_catalog_assets(id,version_id,sha256,bytes,type) VALUES(${asset.id},${version},${asset.sha256},${asset.bytes},${asset.type}) ON CONFLICT(id) DO NOTHING`;
  const storage = client();
  const put = async (id, data, type) => {
    const url = `${endpoint}/${bucket}/catalog/${id}`;
    if (!reserved.ready) {
      const r = await storage.fetch(url, {
        method: "PUT",
        headers: {
          "Content-Type": type,
          "Content-Length": String(data.length),
        },
        body: data,
      });
      if (!r.ok)
        throw new Error(`Catalog storage upload failed (${r.status}).`);
    }
    const checked = await storage.fetch(url);
    if (
      !checked.ok ||
      digest(Buffer.from(await checked.arrayBuffer())) !== digest(data)
    )
      throw new Error("Published asset readback verification failed.");
  };
  for (const asset of prepared.assets)
    await put(asset.id, Buffer.from(asset.data, "base64"), asset.type);
  await put(manifestId, manifest, "application/json");
  await db.transaction([
    db`SELECT pg_advisory_xact_lock(hashtextextended('readwind-catalog-budget',0))`,
    db`UPDATE folio_catalog_versions SET published=false WHERE edition_id=${record.id} AND id<>${version}`,
    db`UPDATE folio_catalog_versions SET ready=true,published=true WHERE id=${version} AND NOT cleaning`,
  ]);
  return entry;
}
export async function unpublish(id) {
  const { db } = configuration();
  await db`UPDATE folio_catalog_versions SET published=false WHERE edition_id=${id}`;
}
export async function storageStatus() {
  const { db, budget } = configuration();
  const rows =
    await db`SELECT count(*) AS versions,coalesce(sum(bytes),0) AS bytes,count(*) FILTER(WHERE published) AS published FROM folio_catalog_versions`;
  return { ...rows[0], budget };
}
export async function cleanupStaging() {
  const { db, endpoint, bucket } = configuration(),
    storage = client();
  const claimed = await db.transaction([
    db`SELECT pg_advisory_xact_lock(hashtextextended('readwind-catalog-budget',0))`,
    db`UPDATE folio_catalog_versions SET cleaning=true WHERE NOT ready AND created_at<now()-interval '7 days' RETURNING id,manifest_id`,
  ]);
  const rows = claimed[1];
  for (const row of rows) {
    const assets =
      await db`SELECT id FROM folio_catalog_assets WHERE version_id=${row.id}`;
    for (const id of [row.manifest_id, ...assets.map((a) => a.id)]) {
      const r = await storage.fetch(`${endpoint}/${bucket}/catalog/${id}`, {
        method: "DELETE",
      });
      if (!r.ok && r.status !== 404) throw new Error("Staging cleanup failed.");
    }
    await db.transaction([
      db`DELETE FROM folio_catalog_assets WHERE version_id=${row.id}`,
      db`DELETE FROM folio_catalog_versions WHERE id=${row.id} AND NOT ready AND cleaning`,
    ]);
  }
  return rows.length;
}
