# Reader audit — 2026-10-29

The reader was inspected in code and in real browser renders. This update addresses the eight reported issues and the additional failures exposed by testing.

## Changes

- Removed generated empty-page text from new PDF imports. Existing imports suppress the old message without changing block indexes, so saved notes, highlights, positions, and print-page mappings remain valid. The library excerpt, search, and reading-time calculations also exclude that generated text.
- Replaced green-tinted dark surfaces with neutral charcoal and soft ivory text. Dusk uses the same neutral direction; Night keeps its existing black palette. Original-layout buttons, PDF links, subtitles, and colored highlights remain readable across papers.
- Removed the overlapping resume badge from the cover. The reading footer retains the opening/resume action and print-page information.
- Improved mouse selection, touch annotation mode, keyboard selection, bookmark state, note saving, and the selection toolbar. The toolbar fits small screens and responds to the visual viewport when the keyboard opens.
- Kept annotations, contents, search, comfort settings, notebook, page navigation, and exit controls available in full screen. Compact and landscape layouts retain essential tools and leave room for page turns.
- Matched chapter-heading measurements to rendered spacing and disabled large drop caps on short pages. This fixes clipping in landscape. Reflow retains the source print-page mapping as type size and line spacing change.
- Fixed late-arriving saved positions after reload, navigation to passages in scroll mode, and account authentication recovery after reconnecting.
- Fixed edits queued during an upload being left behind while status said synced. Conflict resolution now retains the latest local position, and a failed initial download cannot seed an account with replacement classics.
- Changed new IndexedDB file records to binary buffers, retaining support for existing Blob records. This fixes the WebKit PDF-import storage failure and preserves upload, download, guest-to-account migration, and backup behavior.
- Fixed generated offline-cache versioning and included standard PDF fonts in the built offline shell.

## Verification

| Check | Result |
| --- | --- |
| Unit tests | 17 passed |
| TypeScript | Passed |
| Vinext production build | Passed |
| Next.js production build used by Vercel | Passed |
| Reader browser matrix | Chromium, WebKit, Firefox × desktop 1440×1000, phone 390×844, small phone 320×740, landscape 844×390; four paper themes each |
| Reader interactions | Large text, Airy spacing, page turns, full screen, bookmarks, highlights, saved notes, notebook return-to-passage, slide and scroll modes |
| Actual DOM pagination | 12 layouts; every character retained, no duplicate/missing fragments, stable print-page anchors |
| Original PDF import | Chromium and WebKit at desktop, phone, small phone; actual PDF with blank/title/text pages, notes, bookmarks, reload retrieval, theme change, reflow |
| Mobile full screen | Chromium and WebKit at phone, small phone, landscape; tools remain accessible and pages retain turning margins |
| Library visuals | Desktop, tablet, phone, small phone in light and dark; empty notebook checked |
| Sync races | New edits drain after an in-flight request; latest local position survives conflict resolution |
| Live account backend | Separate accounts and independent sign-ins; account isolation, exact position retrieval, stale-write conflicts, notes, deletion tombstones, settings, private PDF upload/download |
| Offline production smoke test | Built app reopens a PDF offline, retains an offline bookmark through another offline reload, and retains position after reconnecting |
| Lint | New test/helper files pass. Existing tracked application sources have 13 errors versus 14 at the starting commit; no new error categories/count increases. Repository-wide lint remains non-clean, including generated public assets. |

Firefox matrix checks use reduced motion. Chromium and WebKit cover normal curl/slide motion, including captured intermediate frames. Tests use isolated synthetic data and separate browser contexts; they do not establish physical iOS/Android device behavior. Adjustable PDF conversion remains heuristic, and print numbering depends on the source PDF's labels/detected numbers. Native mobile gestures, large-book endurance, and live deployment after push are not claimed as verified here.

## Reproduce

Start the development server with `npm run dev`, then run `npm test`, `npm run test:reader`, `npm run test:pdf`, `npm run test:pagination`, `npm run test:sync`, `npm run test:library`, and `npm run test:fullscreen`. Browser suites write screenshots under ignored `work/reader-qa`. Set `READWIND_TEST_ORIGIN` for another server. `npm run test:cloud` uses the configured test backend and creates synthetic accounts.

For the offline test, run `npm run build`, start `npm start -- --port 5180`, then run `npm run test:offline`. The smoke test uses the secure localhost alias `reader.localhost` so the normal production service worker can run. Stop that production preview before rebuilding on Windows, where it can hold the build directory open.

`npx next build` separately checks the Vercel build path. Physical-device and live-deployment checks remain separate from local build/browser validation.
