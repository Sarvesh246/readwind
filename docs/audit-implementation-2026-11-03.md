# November 3 audit implementation

Baseline: f00220d. The numbered entries correspond to the improvement audit supplied for this release.

| Item | Implementation |
| --- | --- |
| 1 | Await recovery and sync before sign-out; block pending work/conflicts/imports, recheck other-tab writes, retain owner-scoped recovery archives. Synced sign-out clears cached tables without racing a later database deletion. |
| 2 | Explicit opt-in owner identity across offline launches, 30-day expiry, separate cloud authentication, reconnect validation and sign-out clearing. Current-tab access expires after 24 hours. |
| 3 | Server progress uses the same readable-content/Unicode count; future client saves clamp legacy accumulated counts to that total. |
| 4 | Revision tokens on every page, checks before/after page reads and final verification, bounded restart, reconciliation only after completion. Pending book work is retained. |
| 5 | Conservative UTF-8 payload boundary before queueing/import completion: 3.5 MB book JSON, 4 MB API/recovery envelopes. Oversized sources must be split; existing device snapshots remain preserved for export. |
| 6 | Selected-book encrypted v2 archives, authenticated ordered frames, attachment hashes, lazy attachment loading, streaming file output where available, legacy readers, complete validation and atomic local restore. Browser Blob fallback and 650 MiB archive cap remain explicit. |
| 7 | Request/body deadlines, transient backoff/jitter, isolated permanent failures, visible errors/alternates, dependent-book blocking and truthful incomplete sync results. |
| 8 | Conditional annotation/book revisions, retained deletion tombstones, local/remote conflict review and explicit choice. |
| 9 | Account/browser usage, per-book download size/completion, safe remove-download, import capacity checks, operator storage report and shared transactional project allocation accounting. Supabase production confirmed; 20% project headroom configured. |
| 10 | Shared public caching for published versioned assets with a five-minute withdrawal window; protected assets remain no-store. Persistent discovery index plus explicit ETag validation. |
| 11 | Statement-scoped tenant-policy settings and session foreign-key index, deployed to the intended project; runtime/publisher roles retain their existing tenant/auth boundaries. |
| 12 | Owner-scoped progress/note maps, one shelf summary per update, cumulative block counts and constant-time progress lookup. Full content remains available locally for offline reading. |
| 13 | Original-PDF extracted/OCR text search, printed/PDF page labels and page jumps; dismissing search preserves place/zoom/annotations. |
| 14 | View-heading focus and polite route/save announcements; required-choice dialogs have no misleading close control. |
| 15 | Notebook text search, explicit reading status, named collections/tags and selected-book batch organization. Optional duplicate-source detection remains a future enhancement. |
| 16 | App-session listing/revocation and password-confirmed private account deletion with bounded file cleanup, retry marker, service-only identity cleanup and upload-reservation checks around signed uploads. Shared catalog data is retained. |
| 17 | Next and Vinext offline finalization (using Next's adapter lifecycle before Vercel packages static output), hashed production assets including workers/fonts/maps, updates waiting for existing windows, and CI against the Next build. No worker operation clears IndexedDB. |
| 18 | Compatible tooling override for the affected minimatch advisory; npm audits report zero entries. |
| 19 | Current backend/build/limits/backup/retention documentation and bounded daily ephemeral maintenance. The temporary recovery-import bridge is documented as already closed. |

## Verification

- 231 unit tests across 33 files; TypeScript; lint; Next production build.
- Built-app browser regression: new offline account tab, retained offline bookmark, blocked unsafe sign-out, precached chunks/PDF worker/character maps, original PDF search and offline rendering.
- Synthetic shelf: 100 long books and 10,000 annotations, search/sort exercised. Filter visibility approximately 536 ms on this machine, including UI transitions.
- Real disposable-account regression: session listing/revocation, bad-password rejection, private upload and quota accounting, file/recovery/identity deletion. Post-deletion queries returned zero associated records.
- Live RLS query plan uses an InitPlan/one-time tenant setting. The eight performance warnings and missing session index are resolved; existing/new unused-index notices are informational. No catalog index was dropped.
- Bounded maintenance endpoint returned HTTP 200. Both complete and production-only npm audits returned zero vulnerabilities.

## Operational boundaries

Physical installed iOS/Android PWAs, assistive-technology reading order and complete 200% zoom coverage still require device testing. Leaked-password protection remains disabled at the provider; no paid service was enabled. Phone-only recovery is still contingent on reconnecting the original phone browser/PWA. The implementation does not claim independent recovery of unavailable source-only data.

The public cache withdrawal policy is deliberately bounded to five minutes instead of a year-long immutable response. New oversized book imports fail early with a truthful message; they do not silently enter an unsyncable queue. Local restore is atomic; remote synchronization remains resumable and may require conflict choices. On browsers without writable-file support, export uses a Blob and selected-book subsets remain available to manage memory.
