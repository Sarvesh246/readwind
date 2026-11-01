import { DatabaseSync } from "node:sqlite";
import {
  mkdirSync,
  readFileSync,
  writeFileSync,
  existsSync,
  renameSync,
} from "node:fs";
import { resolve, join } from "node:path";
import { pathToFileURL } from "node:url";
import {
  discoverGutenberg,
  discoverThoth,
  discoverOapen,
  validateCandidate,
  oapenRecords,
} from "./providers.mjs";
import { download, defaultHosts } from "./network.mjs";
import { sourceCoverValidation } from "./source-cover.mjs";
import { prepare, closePreparation, preparationVersion } from "./prepare.mjs";
import {
  digest,
  publishPrepared,
  unpublish,
  storageStatus,
  cleanupStaging,
} from "./publish.mjs";
export function openQueue(
  directory = process.env.READWIND_CATALOG_WORK_DIR || "work/catalog",
) {
  const root = resolve(directory);
  mkdirSync(root, { recursive: true });
  const db = new DatabaseSync(join(root, "queue.sqlite"));
  db.exec(
    "PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000; CREATE TABLE IF NOT EXISTS jobs(id TEXT PRIMARY KEY,record TEXT NOT NULL,stage TEXT NOT NULL DEFAULT 'queued',attempts INTEGER NOT NULL DEFAULT 0,next_attempt INTEGER NOT NULL DEFAULT 0,error TEXT,updated INTEGER NOT NULL); CREATE TABLE IF NOT EXISTS locks(id TEXT PRIMARY KEY,expires INTEGER NOT NULL,pid INTEGER NOT NULL DEFAULT 0);",
  );
  if (
    !db
      .prepare("PRAGMA table_info(locks)")
      .all()
      .some((c) => c.name === "pid")
  )
    db.exec("ALTER TABLE locks ADD COLUMN pid INTEGER NOT NULL DEFAULT 0");
  return { db, root };
}
export function enqueue(queue, record, replace = false) {
  if (replace) {
    const existing = queue.db
      .prepare("SELECT stage FROM jobs WHERE id=?")
      .get(record.id);
    if (existing?.stage === "published")
      throw new Error(
        "Published editions are immutable; use a new edition ID.",
      );
    record = { ...record, _generation: Date.now() };
    queue.db.prepare("DELETE FROM jobs WHERE id=?").run(record.id);
  }
  const validation = validateCandidate(record);
  queue.db
    .prepare(
      "INSERT INTO jobs(id,record,stage,error,updated) VALUES(?,?,?,?,?) ON CONFLICT(id) DO NOTHING",
    )
    .run(
      record.id || `candidate-${digest(JSON.stringify(record)).slice(0, 24)}`,
      JSON.stringify(record),
      validation.passed ? "queued" : "review",
      validation.errors.join("; ") || null,
      Date.now(),
    );
}
const atomicJson = (path, value) => {
  writeFileSync(path + ".tmp", JSON.stringify(value));
  renameSync(path + ".tmp", path);
};
function identityMatches(expected, actual) {
  const words = (s) =>
    s
      .normalize("NFKD")
      .toLowerCase()
      .match(/\p{L}+/gu) || [];
  const a = words(expected),
    b = new Set(words(actual));
  return !!a.length && a.filter((w) => b.has(w)).length / a.length >= 0.75;
}
export function authorIdentityMatches(expected, actual) {
  const authors = expected
    .split(";")
    .filter(
      (name) =>
        !/\[(?:illustrator|editor|translator|contributor|compiler|photographer)\]/i.test(
          name,
        ),
    );
  return (
    authors.length > 0 &&
    authors.every((name) =>
      identityMatches(
        name.replace(/\([^)]*\)|\[[^\]]*\]|[\d,()-]/g, " "),
        actual,
      ),
    )
  );
}
export function finalizePrepared(record, prepared, sourceHash) {
  const version = `v${preparationVersion}-${record.id}-${sourceHash.slice(0, 20)}`,
    prefix = digest(version).slice(0, 16),
    ids = new Map(
      prepared.assets.map((a) => [
        a.id,
        `asset-${prefix}-${a.sha256.slice(0, 32)}`,
      ]),
    );
  for (const key of [
    "sourceBlobId",
    "sourcePdfBlobId",
    "pdfCoverBlobId",
    "customCoverBlobId",
  ])
    if (prepared.book[key]) prepared.book[key] = ids.get(prepared.book[key]);
  if (prepared.book.cover.blobId)
    prepared.book.cover.blobId = ids.get(prepared.book.cover.blobId);
  prepared.coverThumbnailId = ids.get(prepared.coverThumbnailId);
  const notes = new Map(
    (prepared.book.footnotes || []).map((n, i) => [n.id, `note-${i}`]),
  );
  for (const note of prepared.book.footnotes || [])
    note.id = notes.get(note.id);
  for (const [i, section] of prepared.book.sections.entries()) {
    section.id = `section-${i}`;
    for (const block of section.blocks) {
      if (block.type === "figure") block.blobId = ids.get(block.blobId);
      else
        for (const ref of block.footnoteRefs || [])
          ref.noteId = notes.get(ref.noteId);
    }
  }
  prepared.assets = [
    ...new Map(
      prepared.assets.map((a) => {
        a.id = ids.get(a.id);
        return [a.id, a];
      }),
    ).values(),
  ].sort((a, b) => a.id.localeCompare(b.id));
  Object.assign(prepared.book, {
    id: `prepared-${record.id}`,
    title: record.title,
    author: record.author,
    addedAt: 0,
    lastOpenedAt: 0,
    readingMode: "reflow",
    catalog: {
      editionId: record.id,
      version,
      assets: prepared.assets.map((a) => ({
        id: a.id,
        sha256: a.sha256,
        bytes: a.bytes,
        type: a.type,
      })),
      subjects: record.subjects || [],
    },
  });
  return prepared;
}
export async function runJob(queue, job, { publish = false } = {}) {
  const record = JSON.parse(job.record),
    validation = validateCandidate(record);
  if (!validation.passed) throw new Error(validation.errors.join("; "));
  const folder = join(
    queue.root,
    record.id,
    ...(record._generation ? [`revision-${record._generation}`] : []),
  );
  mkdirSync(folder, { recursive: true });
  const path = join(folder, `source.${record.format}`),
    preparedPath = join(folder, "prepared.json");
  const stage = (value) =>
    queue.db
      .prepare("UPDATE jobs SET stage=?,error=NULL,updated=? WHERE id=?")
      .run(value, Date.now(), record.id);
  if (!existsSync(path)) {
    stage("downloading");
    let bytes;
    if (record.localPath) bytes = readFileSync(resolve(record.localPath));
    else
      bytes = (
        await download(record.downloadUrl, {
          hosts: record.hosts || defaultHosts,
        })
      ).bytes;
    if (bytes.length > 20971520) throw new Error("Source exceeds 20 MB limit.");
    if (record.expectedSha256 && digest(bytes) !== record.expectedSha256)
      throw new Error("Source checksum differs from publisher metadata.");
    writeFileSync(path + ".tmp", bytes);
    renameSync(path + ".tmp", path);
  }
  const source = readFileSync(path);
  if (record.expectedSha256 && digest(source) !== record.expectedSha256)
    throw new Error("Saved source checksum differs from publisher metadata.");
  const coverValidation = sourceCoverValidation(record, source);
  if (!coverValidation.passed) {
    atomicJson(join(folder, "review.json"), coverValidation);
    stage("review");
    queue.db
      .prepare("UPDATE jobs SET error=? WHERE id=?")
      .run(coverValidation.errors.join("; "), record.id);
    return;
  }
  let prepared;
  const cached = existsSync(preparedPath)
    ? JSON.parse(readFileSync(preparedPath, "utf8"))
    : null;
  if (cached?.report.converterVersion === preparationVersion) {
    prepared = cached;
    if (prepared.report.sourceSha256 !== digest(source))
      throw new Error(
        "Checkpoint source has changed. Re-ingest as a new prepared version.",
      );
  } else {
    stage("preparing");
    let cover;
    if (record.coverUrl) {
      const r = await download(record.coverUrl, {
        hosts: record.hosts || defaultHosts,
        maxBytes: 5 * 1024 * 1024,
      });
      cover = { data: r.bytes.toString("base64"), type: r.type };
    }
    const resources = {};
    if (record.format === "html") {
      const html = source.toString();
      for (const match of html.matchAll(
        /<img\b[^>]*\bsrc=["']([^"']+)["']/gi,
      )) {
        const url = new URL(match[1], record.downloadUrl);
        const r = await download(url.href, {
          hosts: record.hosts || defaultHosts,
          maxBytes: 5 * 1024 * 1024,
        });
        const key = decodeURIComponent(
          new URL(match[1], "https://book.invalid/book.html").pathname.slice(1),
        );
        resources[key] = { data: r.bytes.toString("base64"), type: r.type };
      }
    }
    prepared = await prepare({
      data: source.toString("base64"),
      name: `${record.id}.${record.format}`,
      format: record.format,
      cover,
      resources,
    });
    const errors = [];
    if (!prepared.report.passed)
      errors.push("Conversion retention/fidelity checks did not pass.");
    if (!prepared.book.cover.blobId)
      errors.push("A real book cover is required.");
    if (!identityMatches(record.title, prepared.book.title))
      errors.push("Source title differs from provider metadata.");
    if (!authorIdentityMatches(record.author, prepared.book.author))
      errors.push("Source author differs from provider metadata.");
    if (
      prepared.warnings.some((w) =>
        /unresolved|missing|retention|cover/i.test(w),
      )
    )
      errors.push(...prepared.warnings);
    if (errors.length) {
      atomicJson(join(folder, "review.json"), {
        errors,
        report: prepared.report,
        warnings: prepared.warnings,
      });
      stage("review");
      queue.db
        .prepare("UPDATE jobs SET error=? WHERE id=?")
        .run(errors.join("; "), record.id);
      return;
    }
    finalizePrepared(record, prepared, digest(source));
    prepared.report = {
      ...prepared.report,
      sourceSha256: digest(source),
      sourceEvidence: record.evidence,
      sourceValidatedAt: new Date().toISOString(),
      converterVersion: preparationVersion,
    };
    await prepare({ validateOnly: prepared.book, assets: prepared.assets });
    atomicJson(preparedPath, prepared);
  }
  stage("prepared");
  if (publish) {
    await prepare({ validateOnly: prepared.book, assets: prepared.assets });
    stage("publishing");
    await publishPrepared(record, prepared);
    stage("published");
  }
  return prepared;
}
export async function drain(queue, { publish = false, limit = 100 } = {}) {
  const now = Date.now();
  queue.db.exec("BEGIN IMMEDIATE");
  try {
    const previous = queue.db
      .prepare("SELECT pid FROM locks WHERE id='worker'")
      .get();
    if (previous?.pid) {
      let running = false;
      try {
        process.kill(previous.pid, 0);
        running = true;
      } catch {}
      if (running) throw new Error("Another preparation worker is running.");
      queue.db.prepare("DELETE FROM locks WHERE id='worker'").run();
    }
    queue.db.prepare("DELETE FROM locks WHERE expires<?").run(now);
    const locked = queue.db
      .prepare(
        "INSERT OR IGNORE INTO locks(id,expires,pid) VALUES('worker',?,?)",
      )
      .run(now + 2 * 60 * 60 * 1000, process.pid);
    if (!locked.changes)
      throw new Error("Another preparation worker is running.");
    queue.db.exec("COMMIT");
  } catch (e) {
    queue.db.exec("ROLLBACK");
    throw e;
  }
  try {
    const jobs = queue.db
      .prepare(
        "SELECT * FROM jobs WHERE stage IN ('queued','downloading','preparing','publishing','retry') OR (stage='prepared' AND ?) ORDER BY updated LIMIT ?",
      )
      .all(publish ? 1 : 0, limit);
    for (const job of jobs) {
      if (job.next_attempt > Date.now()) continue;
      try {
        await runJob(queue, job, { publish });
        console.log(
          `${job.id}: ${queue.db.prepare("SELECT stage FROM jobs WHERE id=?").get(job.id).stage}`,
        );
      } catch (error) {
        if (error.code === "CATALOG_PAUSED") {
          queue.db
            .prepare(
              "UPDATE jobs SET stage='prepared',error=?,updated=? WHERE id=?",
            )
            .run(String(error.message).slice(0, 1000), Date.now(), job.id);
          console.error(error.message);
          break;
        }
        const attempts = job.attempts + 1;
        queue.db
          .prepare(
            "UPDATE jobs SET stage=?,attempts=?,next_attempt=?,error=?,updated=? WHERE id=?",
          )
          .run(
            attempts >= 3 ? "review" : "retry",
            attempts,
            Date.now() + Math.min(3600000, 30000 * 2 ** attempts),
            String(error.message).slice(0, 1000),
            Date.now(),
            job.id,
          );
        console.error(`${job.id}: ${error.message}`);
      }
      queue.db
        .prepare("UPDATE locks SET expires=? WHERE id='worker'")
        .run(Date.now() + 2 * 60 * 60 * 1000);
    }
  } finally {
    queue.db.prepare("DELETE FROM locks WHERE id='worker'").run();
    await closePreparation();
  }
}
export async function main(args = process.argv.slice(2)) {
  const [command, argument, value] = args,
    queue = openQueue();
  try {
    if (command === "discover") {
      const limit = Number(value || 100),
        offset = Number(args[3] || 0);
      if (!Number.isInteger(limit) || limit < 1 || limit > 1000)
        throw new Error("Choose a discovery batch of 1–1000.");
      const records =
        argument === "gutenberg"
          ? await discoverGutenberg(limit, offset)
          : argument === "thoth"
            ? await discoverThoth(limit, offset)
            : argument === "oapen"
              ? await discoverOapen(limit, offset)
              : null;
      if (!records) throw new Error("Choose gutenberg, thoth, or oapen.");
      for (const record of records) enqueue(queue, record);
      console.log(`${records.length} candidates queued.`);
    } else if (command === "ingest") {
      if (!argument)
        throw new Error("Provide a local JSON manifest or source URL.");
      if (/^https:\/\//.test(argument)) {
        enqueue(queue, {
          downloadUrl: argument,
          id: `candidate-${digest(argument).slice(0, 24)}`,
          trusted: false,
        });
        console.log("URL held for source approval.");
      } else {
        const records = JSON.parse(readFileSync(resolve(argument), "utf8"));
        for (const record of Array.isArray(records) ? records : [records])
          enqueue(queue, record, args.includes("--replace"));
      }
    } else if (command === "ingest-oapen") {
      for (const record of oapenRecords(
        JSON.parse(readFileSync(argument, "utf8")),
      ))
        enqueue(queue, record);
    } else if (["prepare", "publish"].includes(command))
      await drain(queue, {
        publish: command === "publish",
        limit: Number(argument || 100),
      });
    else if (command === "validate") {
      const jobs = queue.db
        .prepare("SELECT * FROM jobs WHERE id=?")
        .all(argument);
      for (const job of jobs)
        console.log(JSON.stringify(validateCandidate(JSON.parse(job.record))));
    } else if (command === "retry") {
      queue.db
        .prepare(
          "UPDATE jobs SET stage='queued',attempts=0,next_attempt=0,error=NULL WHERE id=? AND stage<>'published'",
        )
        .run(argument);
    } else if (command === "inspect") {
      console.log(
        JSON.stringify(
          argument
            ? queue.db
                .prepare("SELECT id,stage,attempts,error FROM jobs WHERE id=?")
                .all(argument)
            : queue.db
                .prepare(
                  "SELECT stage,count(*) AS count FROM jobs GROUP BY stage",
                )
                .all(),
          null,
          2,
        ),
      );
    } else if (command === "unpublish") {
      await unpublish(argument);
      queue.db
        .prepare("UPDATE jobs SET stage='unpublished' WHERE id=?")
        .run(argument);
    } else if (command === "storage")
      console.log(JSON.stringify(await storageStatus()));
    else if (command === "cleanup")
      console.log(`Removed ${await cleanupStaging()} abandoned stages.`);
    else if (command === "watch") {
      let stopping = false;
      for (const signal of ["SIGINT", "SIGTERM"])
        process.on(signal, () => {
          stopping = true;
        });
      while (!stopping) {
        await drain(queue, {
          publish: process.env.READWIND_CATALOG_AUTO_PUBLISH === "true",
          limit: 10,
        });
        await new Promise((r) => {
          const timer = setTimeout(r, 30000);
          if (stopping) {
            clearTimeout(timer);
            r();
          }
        });
      }
    } else
      throw new Error(
        "Commands: discover <provider> [limit] [offset], ingest <manifest|URL>, ingest-oapen <export>, validate <id>, prepare [limit], publish [limit], retry <id>, inspect [id], unpublish <id>, storage, cleanup, watch",
      );
  } finally {
    await closePreparation();
    queue.db.close();
  }
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
)
  main().catch((e) => {
    console.error(e.message);
    process.exitCode = 1;
  });
