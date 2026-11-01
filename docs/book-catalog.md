# Book catalog

Discovery is available at `/discover`. It shows only published, prepared editions. Catalog books open in adjustable text; PDF sources retain original-layout reading. EPUB/HTML books use chapter navigation and reading progress, without invented print page labels. When discovery is disabled, Add book opens the upload screen directly. EPUB uploads use the same structured converter as catalog preparation.

## Local preparation

Requires Node 22.13+ with `node:sqlite`, installed project dependencies, and Playwright Chromium. Use the lockfile (`npm ci`); install the pinned browser with `npx playwright install chromium`, then run `node scripts/prepare-assets.mjs`.

```powershell
npm run catalog -- discover gutenberg 100 0
npm run catalog -- discover thoth 100 0
npm run catalog -- discover oapen 100 0
npm run catalog -- prepare 100
npm run catalog -- inspect
npm run catalog -- inspect pg-1342
```

Discovery uses Gutenberg's machine-readable CSV/RDF catalog and generated ebook files, Thoth's GraphQL metadata for Open Book Publishers, and OAPEN's full-text metadata API. Respect each provider's access policy. A provider returning an access error stays unavailable; the worker does not bypass access controls. OAPEN exports can also be loaded with `ingest-oapen <JSON export>`.

Jobs and files live under ignored `work/catalog` by default. The SQLite queue records stages and bounded retries. Successful source downloads and prepared books survive process restarts. Only one preparation worker can own the queue. A dead process's lease can be reclaimed on restart. Each conversion gets a bounded browser lifetime. No application server or inbound public access to your computer is required.

```powershell
npm run catalog -- ingest C:\Books\approved-editions.json
npm run catalog -- validate edition-id
npm run catalog -- retry edition-id
npm run catalog -- prepare 10
```

`ingest https://...` creates a held candidate; it cannot publish without metadata, source approval, full-book evidence, and suitable permissions. A local manifest is an object or array with `id` (up to 80 safe ASCII characters), `provider`, `trusted`, `fullText`, `title`, `author`, `language`, `edition`, `publisher`, `source`, `sourceUrl`, `downloadUrl`, `format`, `license`, `subjects`, and `evidence`. Optional fields include `localPath`, `expectedSha256`, `coverUrl`, `coverLicense`, `coverNote`, `coverEditionEvidence`, and an explicit HTTPS `hosts` allowlist. Formats are `epub`, `pdf`, and single-document `html` with local image resources fetched by the worker. Multi-page websites must be assembled from a verified complete source inventory before ingestion; a chapter URL is not a full book.

Use `provider: "approved"` for an operator-reviewed source; `evidence.fullBookEvidence` and `evidence.permissionUrl` are mandatory. Do not mark an unknown URL trusted just because its filename matches a title. Supported automatic permission gates accept US-public-domain records, CC0, CC BY, and CC BY-SA; other licenses require separate review. Cover rights are distinct from metadata rights. Alternate-edition covers require a note and evidence. Source EPUB covers are retained; missing, tiny, or explicitly generated covers are held. No covers are invented by Readwind. Recognized Gutenberg service notices are moved intact to the end of the reading version; the original file and notice fragment links are preserved.

To correct a held record, run `ingest <manifest> --replace`, then prepare again. Replacing a held record starts a separate checkpoint generation and preserves earlier local evidence. Published editions cannot be replaced this way; use a new edition ID. Conversion changes must increment `preparationVersion`; stale conversion checkpoints are rebuilt before publication. Stable section, note, and asset IDs make repeat preparation reproducible; a published version with differing content is rejected, never overwritten.

`review.json` alongside each source records conversion conflicts and missing resources. `prepared.json` contains the prepared book, assets, provenance, source checksum, conversion version, and retention report. The initial launch target is 100 English books across genres and eras, but a count never overrides these gates. The bundled classic openings are excerpts and are not catalog sources.

## Validation and publication

Source evidence and conversion retention are separate checks. Trusted provenance and edition metadata establish source identity; reading order, content documents, resources, internal navigation, text/numeric retention, OCR/fidelity results, and real covers establish conversion eligibility. These checks do not prove that an arbitrary PDF is complete or that every OCR character is correct. Unresolved cases stay out of search.

The worker generates small WebP thumbnails from actual source covers. Full covers, original files, reading assets, and prepared manifests are immutable shared objects. Search records contain metadata, not book bodies. Existing private uploads remain owner-scoped. Deleting a library copy does not delete shared catalog objects. Imported versions remain pinned, preserving highlights and reading positions after catalog updates.

Before any production write, verify the actual Vercel project, deployed database branch, S3 endpoint/bucket, current service plan, storage allowance, existing usage, and request/transfer allowances. `.vercel/project.json` or a working local database connection alone does not establish the production mapping. Never enable a paid service to satisfy the catalog count.

Use a separate schema-owner connection for `npm run catalog:migrate`. The existing `db:migrate` applies the base library schema first. The catalog migration grants read-only catalog access to `readwind_runtime` if that role exists. If creating the role later, apply `db/runtime-role.sql` and the catalog migration again. Apply `db/catalog-worker-role.sql` once as a role administrator and set its password separately. Use that distinct publication credential for `CATALOG_DATABASE_URL`; do not expose it to the app runtime. The publisher needs catalog table writes; the app runtime must not receive those grants.

Keep publication credentials in ignored `work/catalog/worker.env`, loaded only by the catalog CLI and scheduled worker. The app runtime must not load this file. Required publication settings are documented in `.env.example`:

- `READWIND_CATALOG_TARGET_VERIFIED=true` only after matching the actual deployment resources.
- `CATALOG_DATABASE_URL` for catalog writes.
- Existing `AWS_*` object-storage credentials and optional `CATALOG_BUCKET` (default `folio-books`); configure the same catalog bucket in the app runtime if changing it.
- `READWIND_CATALOG_BUDGET_BYTES`: verified total free storage allowance.
- `READWIND_CATALOG_BASELINE_BYTES`: existing non-catalog usage; update it as private storage grows.

The worker subtracts that baseline and reserves 20% headroom. It serializes whole-version reservations before any uploads, counts unpublished staging and retained versions, verifies uploaded bytes by reading them back, then activates the catalog row atomically. Budget exhaustion stops publication. This byte accounting does not replace checking provider request/transfer quotas or controlling other applications using the same account.

```powershell
npm run catalog:migrate
npm run catalog -- storage
npm run catalog -- publish 100
npm run catalog -- cleanup
npm run catalog -- unpublish edition-id
```

Cleanup removes only uncompleted staging older than seven days. Completed versions are retained for existing readers. Unpublishing stops new discovery/additions and keeps the local job unpublished until explicitly retried. Covers/content of unpublished versions are available only to signed-in owners of a pinned library copy; already downloaded guest copies remain local.

Set `READWIND_CATALOG_ENABLED=true` in the verified app deployment only after the schema, credentials, and published batch are ready. Keep the flag off if activation prerequisites are unavailable. Catalog additions verify hashes before committing downloaded files to IndexedDB. The server's idempotent addition survives closing the importing browser; another device can load the pinned book. Deletion snapshots stop older add operations from resurrecting a later deletion. Backups include original source files and shared reading assets, subject to existing backup limits.

## Run at login

```powershell
powershell -File scripts/catalog/install-worker.ps1
powershell -File scripts/catalog/start-worker.ps1
powershell -File scripts/catalog/stop-worker.ps1
powershell -File scripts/catalog/install-worker.ps1 -Remove
```

The per-user scheduled task starts a hidden PowerShell runner. It prepares queued books locally; `READWIND_CATALOG_AUTO_PUBLISH` defaults to false. Published books remain available while the computer is off. Publication configuration is checked separately and never inferred from the scheduled task.

## Verification

Run `npm test`, `npm run typecheck`, `npx next build`, the portable `npm run build`, and the affected import/reader/sync/deletion/offline browser suites. Run `npm run test:catalog` against the local development server for EPUB conversion and Chromium/WebKit discovery checks at phone, tablet, and desktop sizes. Browser screenshots go to ignored `work/catalog-qa`.

Before enabling production, inspect representative complete source editions and their prepared opening, middle, ending, covers, contents, notes, and complex content. Record actual prepared/published counts and source-access failures. A pushed implementation, a running local worker, a prepared local collection, and a verified live catalog are separate completion checks.

Large catalog downloads and library pages use streamed JSON responses. Catalog metadata edits send only a small patch; the server retains or restores the immutable prepared body, so large books do not cross Vercel's request-body limit during synchronization.

Gutenberg generic numbered generated covers, unknown author attribution, and explicitly partial or incomplete titles are held for review, including when reusing preparation checkpoints. A source-provided image alone is insufficient evidence of a real edition cover.
