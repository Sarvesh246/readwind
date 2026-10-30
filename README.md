# Readwind

Readwind is an account-based PDF reading app for picking up a book across devices. It stores books, reading positions, highlights, notes, and settings in a private Neon backend, and caches downloaded books for offline reading.

## Development

Requires Node.js 22.13 or later.

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

The app uses React, TypeScript, Vinext, Cloudflare Workers, Neon Postgres and Auth, private object storage, and Dexie. Source lives in `components/readwind`, `lib/readwind`, and `app/api`. Environment files and local test data are excluded from Git.

## Optional classics

A new shelf starts empty. From the empty library you can explicitly add six public-domain classics (Walden, Meditations, The Art of War, The Odyssey, Frankenstein, Pride and Prejudice). Each one is the real opening of the book, roughly 7,000 to 10,000 words, taken from Project Gutenberg. Nothing on the shelf is pre-read or pre-highlighted, and nothing is added to an account automatically. To regenerate `lib/readwind/classics.json`, download the source texts and run `node scripts/build-classics.mjs <folder>`.

## Reading PDFs

Imported books open in original layout by default. PDF.js renders their pages with the original fonts, dimensions, images, and spacing. The reader supports zoom, page navigation, bookmarks, text selection, highlights, notes, and downloading the original file. Only the current page or spread is rendered.

Adjustable text is an optional conversion with selectable fonts, themes, spacing, and page turns. The importer checks for columns, scans, rotated or right-to-left text, and unreliable character mappings. Review converted text before relying on it for complex layouts. OCR is optional; choose the document language before import. Original scans remain available without OCR.

PDF import accepts files up to 50 MB. Password-protected PDFs require their password when opened; passwords are never stored. Corrupt files, missing fonts, and poor scans can still prevent accurate display or extraction. DRM-protected ebooks are not supported.

## Accounts and storage

Use the same Readwind account on each device. API routes enforce ownership, and account sessions use HTTP-only cookies. Reading positions use revisions to detect concurrent changes. Offline changes remain in a persistent queue until the device reconnects.

The database and object-storage identifiers retain their original names for compatibility with existing accounts. Changing the product name does not reset books or reading history.

The PWA manifest and icons use Readwind branding. Install through a supported browser after opening the hosted app. Installation and gestures still need verification on physical iOS and Android devices.

## Backend setup

Run the SQL migration against your Neon database and configure the values in `.env.example`. Configure a production SMTP provider for account verification and recovery before opening registration broadly. The hosted app currently uses managed authentication and a private access gate.

`npm run test:cloud` checks account isolation, reading-position conflicts, and private uploads against a running local server. It creates synthetic test accounts and writes test credentials under the ignored `work` directory. See `QA.md` for validation notes and remaining limitations.
