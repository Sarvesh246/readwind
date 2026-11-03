# Readwind: free Supabase backend

Status (2026-11-02): production runs on Supabase. Neon hit its transfer quota (HTTP 402 on database and auth), so the app was recovered from the owner's device caches and moved to a free Supabase project. Neon is still there, untouched, as a source of record.

## What is live

- App: https://readwind.vercel.app (Vercel, Node 24.x). `READWIND_BACKEND=supabase` selects the new path; the Neon path stays in the code.
- Supabase project `rjpjykhrtolqzjckeowf` (Readwind, us-east-2) in the secondary account's Personal Projects organization. Private bucket `folio-books`. The Primary account and NorthFrame were not touched; Email Scraper is paused.
- The owner signs in with a new Supabase Auth user. The server maps it through `folio_identities` to the original library owner id, so existing IndexedDB caches and object prefixes keep working. The old Neon password was not migrated; there is a Change password control in the account UI.

## What was recovered

- Personal library: 6 books, 5 saved positions, 1 annotation, 3 reading-log records (both original devices), a 2-day streak, reading pace and settings. All of it came from the computer's cached data; nothing was invented.
- Files: 197 files, 43,951,506 bytes, every referenced file present with a SHA-256 readback. The six original PDFs parse and their page counts match.
- Shared catalog: 583 of 748 validated packages restored (5,823 files, ~756 MB). The other 165 are larger and were left out to stay inside the free 1 GB storage budget; all 748 valid packages remain on the maintainer's machine. Nothing needing permission review was published.
- Free-tier headroom: personal + catalog is about 800 MB, roughly 200 MB under the budget.

## Limits you should know about

- **Phone cache is not recovered yet.** Both devices were signed out. The phone's own cache has not been inspected. Signing in on the same phone browser/PWA runs an automatic archive-and-merge (`/api/recovery`, `lib/readwind/device-recovery.ts`) before the first sync. Until then the server answers library reads with 428 for that device so an empty pull cannot overwrite the phone's cache.
- **Cloud-only records are unverified.** Anything that existed only in Neon (not in a device cache) cannot be guaranteed. The Neon snapshot `snap-bold-lake-b5bls2rm` is a provider snapshot, not a row export or an object backup. Don't delete the Neon project or the snapshot.
- Supabase's leaked-password protection is off (advisor WARN, a paid-tier feature).
- Free projects pause after a week of inactivity.

## How it fits together

- `lib/readwind/postgres.ts`: Postgres driver through the Supabase pooler with strict TLS (pinned CA), tenant context and advisory locks tied to one transaction. Gotcha: Postgres infers jsonb parameter types, so the serializer must not double-encode strings that are already JSON.
- `lib/readwind/supabase-auth.ts`: same-origin auth adapter with opaque HttpOnly cookies; provider tokens are encrypted in `folio_sessions`. Every request re-checks the provider session through `readwind_session_live` (service role only).
- `supabase/functions/readwind-storage`: permanent private-storage bridge with its own token/HMAC auth. Keep it deployed.
- `db/supabase.sql`: forced row-level security; the runtime and publisher roles can't bypass it.
- Sync traffic: the library endpoint supports ETag/304, and a books revision so progress-only changes don't re-send book text. Idle and hidden tabs stop polling after two minutes and back off on errors.

## Catalog worker

The Windows task "Readwind catalog preparation" is disabled and the publisher is configured with `AUTO_PUBLISH=false`. Leave it that way until there is a deliberate policy for which of the 165 deferred books to publish.

## Verification done

Isolated real-Supabase accounts (uploads, range reads, cross-account denial, conflicts, deletion cleanup, password change, revocation, books-revision delta), recovery retry in Chromium and WebKit, a recovered six-book cache with a real login, and an authenticated smoke check on the production deployment. That historical migration run had 216 tests. The November 3 implementation passes 230 tests with bounded concurrency; see QA.md for current commands.

## Still open

- Completed: the temporary `readwind-recovery-import` function now returns HTTP 410.
- Phone recovery (above) and, optionally, a later Neon export to reconcile cloud-only records. See `neon-export-access-request.md`; nothing has been sent and the restored app doesn't depend on it.


November 3 update: the temporary recovery import bridge is already closed (HTTP 410). No cleanup deployment is needed for that bridge. Owner-scoped local recovery archives are retained until verified recovery plus backup or explicit account deletion; phone-only recovery still requires the original phone browser/PWA. See README for current build, storage, backup and maintenance commands.
