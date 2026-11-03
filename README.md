# Readwind

Readwind is an account-based PDF reading app for picking up a book across devices. It stores books, reading positions, highlights, notes, and settings in a private Supabase backend, and caches downloaded books for offline reading.

## Development

Requires Node.js 24.x.

```sh
npm ci
# Configure .env.local and .dev.vars using .env.example.
npm run db:migrate
npm run dev
```

```sh
npm run typecheck
npm test
npm run build
```

The app uses React, TypeScript, Next.js on Vercel (with an alternate Vinext/Cloudflare build), Supabase Postgres and Auth, private object storage, and Dexie. Source lives in `components/readwind`, `lib/readwind`, and `app/api`. Environment files and local test data are excluded from Git.

## Optional classics

A new shelf starts empty. From the empty library you can explicitly add six public-domain classics (Walden, Meditations, The Art of War, The Odyssey, Frankenstein, Pride and Prejudice). Each one is the real opening of the book, roughly 7,000 to 10,000 words, taken from Project Gutenberg. Nothing on the shelf is pre-read or pre-highlighted, and nothing is added to an account automatically. To regenerate `lib/readwind/classics.json`, download the source texts and run `node scripts/build-classics.mjs <folder>`.

## Reading PDFs

Imported books open in original layout by default. PDF.js renders their pages with the original fonts, dimensions, images, and spacing. The reader supports zoom, page navigation, bookmarks, text selection, highlights, notes, and downloading the original file. Only the current page or spread is rendered.

Adjustable text is an optional conversion with selectable fonts, themes, spacing, and page turns. The importer checks for columns, scans, rotated or right-to-left text, and unreliable character mappings. Review converted text before relying on it for complex layouts. OCR is optional; choose the document language before import. Original scans remain available without OCR.

PDF import accepts files up to 20 MiB. Password-protected PDFs require their password when opened; passwords are never stored. Corrupt files, missing fonts, and poor scans can still prevent accurate display or extraction. DRM-protected ebooks are not supported.

## Accounts and storage

Use the same Readwind account on each device. API routes enforce ownership, and account sessions use HTTP-only cookies. Reading positions use revisions to detect concurrent changes. Offline changes remain in a persistent queue until the device reconnects.

The database and object-storage identifiers retain their original names for compatibility with existing accounts. Changing the product name does not reset books or reading history.

The PWA manifest and icons use Readwind branding. Install through a supported browser after opening the hosted app. Installation and gestures still need verification on physical iOS and Android devices.

## Backend setup

Run the SQL migration against the intended Supabase database and configure the values in `.env.example`. Configure a production SMTP provider for account verification and recovery before opening registration broadly. The hosted app currently uses managed authentication and a private access gate.

`npm run test:cloud` checks account isolation, reading-position conflicts, and private uploads against a running local server. It creates synthetic test accounts and writes test credentials under the ignored `work` directory. See `QA.md` for validation notes and remaining limitations.


## Production and offline builds

`npm run build:next` is the Vercel production build, including the generated offline worker. `npm run build` supports Vinext/Cloudflare separately. Both use `scripts/offline-worker.js` as the worker template. Never commit a generated precache manifest. Worker updates wait until existing app windows close; they do not touch IndexedDB. The app shell includes PDF workers, standard fonts and character maps. Across launches, downloaded account books require opt-in offline access (30 days, personal devices only); the current tab retains access for up to 24 hours. Reconnection revalidates authentication.

Private PDFs/EPUBs use signed object uploads. Extracted book JSON is limited to 3,500,000 UTF-8 bytes before queuing; API JSON is limited to 4,000,000 bytes, below Vercel's platform boundary. Oversized books must be split before import. The same boundary applies to device recovery; oversized legacy snapshots are preserved for export rather than silently discarded.

## Backups and recovery

Choose all books or selected books in the account dialog. New `.readwind` archives use independently authenticated encrypted frames and SHA-256 attachment hashes, supporting up to 650 MiB without base64 attachment expansion. Compatible browsers stream exports directly to a chosen file; other browsers use a Blob download and can export selected subsets. Attachments are loaded one at a time and encrypted in 1 MiB frames. Existing encrypted/plain JSON backups remain readable. Keep the password: it cannot be recovered. Restore validates the entire archive before a single IndexedDB transaction applies it; a failed transaction leaves the existing library intact. Matching book/note IDs replace local records, other books remain, and reading logs/pace are merged. Cloud conflicts require a choice in the account dialog. Local restoration is atomic; cloud synchronization remains resumable.

Recovery archives stay owner-scoped after sign-out and have no automatic age-based deletion policy. Remove them only after verified recovery and an independent backup, or explicit account deletion. Phone-only data is not verified recovered until the original phone browser/PWA reconnects with the same account. The temporary recovery-import bridge already returns HTTP 410.

## Storage and operations

`READWIND_STORAGE=s3` selects S3-compatible object storage; otherwise the Supabase backend uses the private Supabase storage bridge. Reconfirm production provider selection before changing capacity. `READWIND_PROJECT_STORAGE_BUDGET_BYTES` is the verified project allocation; migrations reserve 20% headroom and maintain one transactional counter for private-file reservations and catalog-version allocations, including manifests. A zero project budget rejects new allocations. Recovery reuses private reservations. Removing a browser download preserves cloud records and refuses unsynced/shared pending attachments.

Vercel schedules `/api/maintenance` daily at 16:30 UTC; configure a random `CRON_SECRET` in the deployment environment. The service-only cleanup prunes bounded ephemeral rows and leaves personal/recovery data untouched.

Run `node --env-file=<private-operator-env> scripts/storage-report.mjs` for private/catalog/recovery/database totals. Provider dashboards supply actual transfer and billing figures. Run `node --env-file=<private-operator-env> scripts/maintain-readwind.mjs` from an operator scheduler daily; it prunes at most 500 expired app sessions and 500 old rate-limit rows, excluding all books, notes and recovery archives. Configure `MIGRATION_DATABASE_URL` only in the private operator environment. Never give the browser administrator credentials.

Published versioned catalog assets permit shared caching for five minutes. Withdrawal takes effect after that bounded cache window; owned withdrawn editions remain behind authentication. Immediate withdrawal requires purging the delivery cache. Private/unpublished assets use `private, no-store`. Discovery keeps a public index cache and explicitly revalidates its ETag.

Account settings list app sessions, revoke one/other sessions, and offer password-confirmed account deletion after export/sync. Offline copies cannot be remotely erased. Deletion removes private objects in bounded batches, then personal rows/recovery archives and the provider identity; shared catalog records remain. A durable deletion marker blocks ordinary account access during retries. If provider deletion succeeds but final cleanup is interrupted, an operator can retry the service-only deletion action for that marked identity. Test deletion only with disposable accounts.

Failed uploads, signing, and verification retain attachment objects and their bounded quota reservations for retry. Upload cancellation cannot delete a file, including from older tabs. Explicit book deletion (including a locally queued book) or account deletion releases these reservations; failed attempts may therefore count toward storage usage until retried or explicitly deleted.
