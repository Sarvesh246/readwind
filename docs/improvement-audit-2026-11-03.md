# Readwind improvement audit — November 3, 2026

> **Status:** every numbered item below has since been implemented. See `audit-implementation-2026-11-03.md` for what shipped. This file is kept as the original findings.

Audit revision: `f00220d` on `main`. Production inspected: https://readwind.vercel.app. This audit adds documentation only; it does not change application behavior, deploy code, or mutate production accounts.

## Assessment

The reader has a sound baseline. All 219 unit tests, TypeScript, lint, and the Next.js production build passed. The deployed reader also passed the browser checks described below. The most valuable next work is protecting unsynced data, making offline account access reliable across launches, and tightening sync correctness. Reader features and library organization should follow those fixes.

Evidence labels:

- **Reproduced:** observed in an isolated browser or direct experiment during this audit.
- **Code-confirmed:** the relevant behavior is present in the inspected source; an end-to-end failure was not induced.
- **Risk:** a concrete failure path inferred from the source or hosting contract; requires targeted reproduction before implementation is considered verified.
- **Opportunity:** a proposed product or operational improvement, not a demonstrated defect.

P1 means protect data or core reading/sync behavior first. P2 means the next reliability, performance, or usability batch. P3 means lower urgency. Effort is relative: small, medium, or large; it is not a delivery estimate.

## Implement first

### 1. Protect pending changes before sign-out

**P1 · Code-confirmed · Medium**

`components/readwind/ReadwindApp.tsx:639` signs out and then clears every account IndexedDB table, deletes the account database, and deletes its durable recovery archive. It does not inspect `pending`, wait for a successful drain, or check whether recovery is complete. The account modal warns the user to sync first, but the button remains available during failed or incomplete sync.

An imported book, annotation, or reading position can exist only on this device when sign-out succeeds. Clearing those stores then removes that unsynced copy. Deleting a recovery archive also removes its safety copy.

Implement an awaited sign-out flow: inspect pending changes and recovery, attempt sync while authenticated, verify the queue is empty, and then revoke the session and clear downloads. When sync cannot finish, explain what remains and provide a safe export or explicit discard choice. Keep privacy-sensitive cached files scoped to their owner; do not solve this by exposing the previous account to another account. Preserve recovery archives until their completion/retention policy permits deletion.

Acceptance: slow upload, failed upload, unresolved progress conflict, and unfinished recovery cannot silently lose data through sign-out. A fully synced sign-out still clears account downloads.

### 2. Make offline account access survive a new tab or app launch

**P1 · Reproduced · Medium**

`ReadwindApp.tsx:576–609` removes the old persistent offline identity and restores an offline account only from `sessionStorage`, with a 24-hour limit. That storage belongs to the current tab. The cached account database remains on disk but a new offline tab cannot select it.

An isolated browser with mocked authentication and a synthetic account reproduced this against the deployed client:

| Action | Result |
| --- | --- |
| Load the synthetic account online | Account and cached book visible |
| Reload the same tab offline | Account and cached book visible |
| Open a fresh tab offline | Guest shelf; account book absent; offline identity null |

Implement a deliberate, persistent, owner-scoped offline-unlock mechanism that does not pretend to provide a valid cloud session. Revalidate on reconnection, clear or lock it on sign-out, and define expiry/shared-device behavior. Show when a book is available offline.

Acceptance: cold offline startup opens previously downloaded account books, retains offline edits, never grants cloud access without authentication, and never selects another account's data accidentally. Verify installed iOS and Android PWAs separately.

### 3. Use one word-count implementation for progress validation

**P1 · Reproduced calculation mismatch; code-confirmed rejection path · Small**

The client uses Unicode segmentation in `lib/readwind/word-count.ts` through `anchors.ts`. `app/api/sync/route.ts:36–44` uses whitespace-delimited `match(/\S+/g)` and rejects `wordsRead` above that total.

For `私は毎日図書館で本を読みます。今日は楽しいです。`, the client counted **13 words** and the server counted **1** in this audit. A sufficiently advanced position in a Chinese/Japanese book can therefore send a valid client count greater than the server's total. The server returns 400 and the pending change remains queued.

Use the same readable-content rules and `readingWordCount` helper on both sides. Continue validating position ownership and bounds. Check compatibility with previously stored counts.

Acceptance: Japanese, Chinese, mixed-script, and English books save and reload positions through the actual sync handler. A bad count still fails validation. No production account was modified to reproduce this.

### 4. Make paginated library pulls consistent across concurrent changes

**P1 · Risk from source inspection · Medium**

`app/api/library/route.ts:69–165` uses offset pagination and independently reads the current revisions and data. `lib/readwind/useLibrary.ts:275–388` combines pages and then treats the collected book IDs as authoritative, deleting local books absent from that set. There is no revision token that all pages must match, and no final revision check before reconciliation.

With more than ten books, a deletion before the current offset can shift a later book into the previous page. The next request can skip it. A concurrent mutation can also change whether later pages contain full book records or cached IDs. The client can commit a mixed snapshot and temporarily remove a book that still exists remotely.

Bind the pagination cursor to an account revision, reject/restart a pull if that revision changes, and reconcile only a complete consistent pull. Consider keyset pagination as part of the design, but keyset pagination alone does not guarantee a consistent snapshot. Validate the revision after the last page as well as before page reads.

Acceptance: insert/delete/edit between pages of a 25-book library cannot remove an unrelated local book, discard queued work, or commit mixed revisions. Add an equivalent annotations-pagination scenario.

### 5. Align large book payloads with the deployed hosting limit

**P1 for affected large books · Hosting-contract risk · Medium**

The application accepts up to 12,000,000 bytes of book JSON at `/api/library` and `/api/recovery`. New private books are posted as complete JSON, including extracted text and metadata. Signed object uploads already avoid routing the PDF itself through Vercel, but do not solve a large extracted-book JSON body.

[Vercel documents a 4.5 MB function request-body limit](https://vercel.com/docs/functions/limitations). An application parser allowance of 12 MB cannot increase that platform limit. The request path can therefore fail before Readwind's handler runs. This was not tested by sending an oversized production request.

Measure serialized byte size before queuing. Move large immutable book content into verified object storage or use a bounded chunk/manifest protocol, leaving small metadata and progress requests on the API. Preserve retry safety and private ownership checks. Keep streamed response behavior separate from request-body limits.

Acceptance: synthetic books on both sides of the platform boundary either sync successfully or fail before import with a clear, truthful message; recovery uses the same supported protocol.

## Next reliability and performance batch

### 6. Make full backups practical and restoration recoverable

**P2 · Code-confirmed · Medium/large**

`ReadwindApp.tsx:329–406` limits exported attachments to 55 MiB. `lib/readwind/backup.ts` limits plaintext backup JSON to 80 MiB, uses base64 attachments and encryption, and limits restoration to 100 books and 20 MiB per attachment. The database permits 500 MiB of private files per account. A valid library can therefore outgrow the only full-backup action. The failure message suggests a smaller export, but there is no book-selection export UI.

The exporter materializes all blobs/base64 strings and encrypted output in memory. Restore applies books and annotations incrementally while sync may run, so a storage or write failure can leave a partially restored library.

Add selected-book export first; then a versioned archive format with bounded memory, attachment hashes, and encryption. Validate the complete archive before applying changes. Make application atomic where feasible or resumable with a visible journal; explain merge/duplicate behavior before restoring. Keep existing backups readable.

Acceptance: export/restore a library above 55 MiB, wrong-password and corrupt-file rejection, preserved stats/settings/PDF annotations, and controlled recovery after a mid-restore failure.

### 7. Bound sync requests and isolate permanently failing queue items

**P2 · Code-confirmed · Medium**

`useLibrary.ts:74–78` gives API requests an account-lifetime abort signal but no per-request deadline. `sync()` processes a sequential queue and stops at the first thrown error. Its `running` flag remains set until the request settles. Server-side timeouts exist on several provider calls, but do not bound every client request or storage path.

Add request deadlines, explicit retry categories, backoff/jitter for transient errors, and a visible failed-item state for nonretryable validation errors. Do not skip dependent uploads/book creation or discard an invalid pending record silently. Give Sync now truthful feedback about conflicts and incomplete work.

Acceptance: a stalled request releases the sync lock; a bad annotation does not indefinitely block an unrelated book; retrying an upload does not duplicate it or lose newer edits.

### 8. Extend conflict protection to notes and book metadata

**P2 · Code-confirmed last-writer behavior · Medium**

Reading positions have revision conflict checks. Annotation writes in `app/api/sync/route.ts:66–86` overwrite on ID conflict and replace the timestamp with server receipt time. Book metadata patches read the current book and save an overlaid record without an expected metadata revision. An old offline note edit can overwrite a newer edit or deleted note when it arrives later. Two metadata edits can also overwrite each other.

Introduce revisions or per-field conditional updates for annotations and metadata. Preserve deletion tombstones and offer an understandable conflict choice or retained alternate version. Avoid using untrusted client clocks as the only ordering rule.

Acceptance: two offline devices editing/deleting the same note retain an explicit recoverable outcome; simultaneous title/cover changes do not silently overwrite unrelated fields.

### 9. Show storage usage and enforce a provider-aware capacity policy

**P2 · Measured storage; product/operational opportunity · Medium**

Read-only production aggregates returned **6,020 Supabase storage objects totaling 799,648,990 bytes**, including **197 private file records totaling 43,951,506 bytes**. This is a point-in-time object-byte sum, not a complete provider billing/egress report. The repository also supports an optional S3 storage backend; this audit did not read production secret environment values to establish whether future uploads use that option.

Add account usage, per-book downloaded size, download completion, available browser storage, and a remove-download action that preserves cloud books and pending edits. Add an operator capacity view that distinguishes private files, catalog, recovery copies, database size and transfer. If Supabase remains the storage target, reserve headroom across the whole project rather than relying only on the per-account 500 MiB quota. Reconfirm the active storage provider before changing limits.

Acceptance: low device/project capacity is detected before a long import; removing downloads never removes unsynced files; all file allocation/release paths use the same quota accounting.

### 10. Reduce catalog traffic at the CDN boundary

**P2 · Code-confirmed · Medium**

`app/api/catalog/assets/[id]/route.ts` performs a database lookup and a storage fetch on cache misses and marks all assets `private, max-age=31536000, immutable`, even for published catalog covers. Browser caching helps repeat visits, but new visitors do not share a public CDN cache. The service worker intentionally excludes API routes, so catalog API assets also lack its offline fallback.

Use a public immutable delivery/cache policy only for genuinely public, versioned published assets, with a defined unpublish/purge policy. Keep private and unpublished assets behind ownership checks and appropriate cookie/cache separation. Reuse the catalog index ETag explicitly and consider a persistent public index cache for offline discovery.

Acceptance: repeated published cover requests across separate clients hit shared caching; unpublished/private assets cannot be obtained through that public path; existing owned editions remain readable under the intended withdrawal policy.

### 11. Address live database performance advisories

**P2 · Confirmed by live Supabase advisors · Small/medium**

The November 3 advisor run reported:

- Eight `auth_rls_initplan` warnings on tenant policies: books, progress, annotations, settings, files, imports, recovery snapshots and account revisions.
- A missing covering index for `folio_sessions.auth_user_id`.
- An unused catalog search index, informational only.

Use statement-scoped scalar subqueries for tenant settings where appropriate, preserving transaction-local owner context and forced RLS. Add the session foreign-key index. Compare query plans on representative data and rerun account-isolation tests. Do not drop the catalog index merely because a newly recovered project has not recorded use yet.

Reference: [Supabase RLS performance guidance](https://supabase.com/docs/guides/database/postgres/row-level-security#call-functions-with-select).

Acceptance: advisor warnings addressed, query plans checked, runtime/publisher roles unchanged in privilege, and cross-account reads/writes still denied.

### 12. Reduce repeated full-book work on the library screen

**P2 · Code-confirmed repeated work; no large-library latency claim · Medium**

`components/readwind/Library.tsx:154–221` repeatedly searches progress arrays, filters all annotations per book, and calls `wordProgress` while filtering, sorting and rendering. `anchors.ts` caches individual block word counts, but `wordProgress` still walks every block on each call. Sorting by progress invokes it repeatedly. The client also loads full book bodies for the shelf.

Build owner-scoped maps for progress and notes and compute each book's summary once per relevant update. Add cumulative block counts for progress lookup. Longer term, separate shelf metadata from book content and load content on demand. Profile a 100-book synthetic shelf before choosing virtualization or workers.

Acceptance: search/sort remain responsive with long books and many annotations, progress stays correct, and opening a book still works offline.

## Reader and product improvements

### 13. Bring search to the original PDF reader

**P2 · Opportunity confirmed by UI/source inventory · Medium**

The reflow reader supports book search. `components/readwind/OriginalReader.tsx` has contents, page navigation, bookmarks, notes, zoom and download, but no in-document search tool. Original layout is the default for PDFs, making this a visible capability gap.

Add search results with printed/PDF page labels and jump-to-page behavior. Distinguish extracted/OCR text matches from exact original-PDF text matches; do not imply scans are searchable without OCR. Preserve zoom, current place and annotations when dismissing search.

### 14. Improve navigation accessibility and save feedback

**P2 · Code-confirmed implementation gap; assistive-technology testing needed · Medium**

`ReadwindApp.tsx` navigates with `history.pushState`, local state and `scrollTo`. It does not explicitly move focus to the new view's heading or announce the route. The original PDF footer and library sync text also lack the live save-status treatment present in the reflow reader. Mandatory progress conflict dialogs render the generic Close button with a no-op callback.

Add predictable focus placement and polite route announcements, consistent accessible save/error status, and remove misleading close actions from dialogs that require a choice. Audit text-layer reading order, highlight keyboard access, 200% zoom and small-screen controls with a screen reader. Existing automated browser geometry checks are not an accessibility certification.

### 15. Make collections, finding notes and reading status more useful

**P3 · Product opportunities · Medium, delivered separately**

Collections currently exposes the computed All books/Reading/To read/Finished filters, rather than user-created shelves. Notebook has kind/color filters and Markdown/JSON export, but no text search. Completion is inferred from reading position, which is not always equivalent to a reader deciding a book is finished.

Useful additions, in order: notebook text search; explicit mark finished/to read; named collections or tags; batch organization; optional duplicate-file detection during import. Retain the current simple default shelf and existing exports. These are independent features, not prerequisites for reliability fixes.

### 16. Add session management and account deletion before broader registration

**P2 for public rollout · Opportunity · Medium/large**

The account UI provides password change, backup/restore, sync and sign-out, but no active-device list, revoke-other-sessions control or self-service account deletion. The server already checks provider user and live session state on protected requests, which is a useful foundation.

Add clearly scoped session revocation and a deletion flow that handles private files, records, identity mappings and recovery archives. Respect shared catalog ownership and offline-device revocation behavior. Offer export before deletion and test with disposable accounts only.

## Release and maintenance improvements

### 17. Test the exact production build and offline worker

**P2 · Live/code-confirmed · Medium**

`npm run build` follows Vinext and `scripts/finalize-offline.mjs`, which generates a content-hashed worker and precaches built assets under `dist/client`. `vercel.json` instead runs `prepare-assets.mjs && next build` and never invokes that finalizer. The live `/sw.js` currently serves the static `readwind-v5` worker, precaching only `/`, manifest and favicon and caching assets opportunistically.

This audit's warm guest offline reload succeeded. Its cache after reading contained 16 requests and no PDF worker; this is evidence of opportunistic caching, not proof every original PDF fails offline. Assets needed only by unvisited features/fonts/character maps may be absent. The stock offline browser script imports as a guest and reloads the same tab, so it misses the fresh-account-tab failure in item 2.

Unify or explicitly support both build paths. Generate a Next-compatible offline asset manifest and safe update policy, then exercise the built Next/Vercel artifact. Add CI for unit tests, typecheck, lint, production build and focused reader/sync/offline regressions; no tracked `.github` workflow was found. Keep real-backend tests opt-in and isolated from the owner's account.

Acceptance: offline cold starts for guests/accounts; downloaded PDF/EPUB rendering; updates while a book has pending edits; missing worker/font recovery; browser restart; and an authenticated offline scenario. Never clear user IndexedDB to solve an app-shell update.

### 18. Address development dependency advisories without forced downgrades

**P2 maintenance · Confirmed npm audit result · Small/medium**

`npm audit --json` reported **16 moderate dependency entries**, attributable to the minimatch denial-of-service advisory through lint tooling. There were no high or critical entries. `npm audit --omit=dev --json` reported **zero production dependency vulnerabilities**. These are dependency entries, not 16 independent exploits in the live reader.

Update the affected tooling/transitive dependency compatibly and rerun lint/build. npm suggested major downgrades for some dependency chains, so do not run `npm audit fix --force` blindly. Keep the lockfile and track the advisory accurately.

### 19. Refresh operational docs and add bounded maintenance

**P3 · Code/live-confirmed documentation drift · Small**

- README still describes Neon as the backend and advertises 50 MB PDFs; current code rejects PDFs above 20 MiB and production uses Supabase authentication/database.
- QA.md records an older 17-test suite and previously failing lint, whereas this audit passed 219 tests and lint.
- `docs/free-backend-migration.md` still lists closing the recovery import bridge as open. Its deployed version 5 was inspected and contains only a handler returning HTTP 410. No cleanup deployment is needed for that bridge.
- No periodic pruning of old rate-limit rows or expired app sessions was found in the inspected code. Current aggregates are small: 17 rate-limit rows and zero expired app sessions. This is preventive maintenance, not a present storage incident.

Document the active build/deploy commands, provider selection, recovery retention and restore procedure. Add bounded pruning for ephemeral rows, excluding personal records and recovery snapshots unless their retention policy explicitly permits it. Keep pending phone/source recovery limits separate from verified production health.

## Verified strengths and current limits

The live Supabase project reported `ACTIVE_HEALTHY`. The security advisor returned one warning: leaked-password protection disabled. This audit did not enable paid services or infer that advisor output proves every application path secure. Forced RLS, tenant-scoped queries, encrypted provider-token storage, live-session checks, bounded request parsing, and inert private download headers are present in the inspected implementation. The temporary recovery import function has already been closed.

Validation performed:

| Check | Result and scope |
| --- | --- |
| Unit tests | 30 files, 219 tests passed |
| TypeScript | Passed |
| ESLint | Passed |
| `npx next build` | Passed; local metadataBase and Turbopack root warnings, no build failure |
| Production public responses | Home HTTP 200, security headers inspected, live service-worker source inspected |
| Production original PDF regression | Chromium + WebKit; desktop 1440×1000, phone 390×844, small phone 320×740; import, blank pages, notes, bookmarks, reload, themes and reflow passed |
| Production phone reflow regression | Chromium + WebKit + Firefox; phone 390×844; four paper themes, large text/Airy spacing, turns and bookmarks passed |
| Warm offline guest reading | Same-tab guest reader reload succeeded |
| Offline account regression | Synthetic identity and mocked API in isolated Chromium; same-tab success and fresh-tab fallback to guest reproduced |
| Word-count experiment | Same Japanese text counted 13 on client and 1 by server algorithm |
| Dependency audit | 16 moderate tooling-related entries; zero production entries; zero high/critical |
| Supabase read-only checks | Project health, edge-function source, security/performance advisors and aggregate storage/row counts |

Browser tests used isolated contexts and synthetic books. No personal browser profile, account password or recovered book contents were accessed. No production user mutations, schema changes, session revocations, deployments, load tests or destructive fault injection were performed. Fresh real-provider password-reset delivery, phone-only recovery, physical iOS/Android PWA behavior, network endurance and a full authenticated production security assessment remain outside these checks. The phone-only selection of the reader script was used; its generic console summary overstates the selected matrix, so the narrower scope above is authoritative.

## Suggested implementation batches

1. **Protect saved work:** items 1–4, plus sync failure handling in item 7. Add meaningful regressions for sign-out, cold offline startup, Unicode progress and concurrent pagination.
2. **Make limits and recovery trustworthy:** items 5, 6, 8 and 9; consistent payload limits, backups, conflict preservation and storage visibility.
3. **Reduce operating cost and release risk:** items 10–12 and 17–19; public-asset delivery, database tuning, shelf computations, exact-production CI/offline coverage and current docs.
4. **Improve everyday use:** items 13–16; PDF search, accessible navigation, notebook search/collections and account controls.

Complete and verify each batch independently. Preserve existing account ownership, original files, cached libraries and recovery snapshots throughout implementation.
