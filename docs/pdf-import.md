# PDF import reliability

New imports use a detected contents page to define chapters. Entries are matched to printed page labels, exact opening headings, and internal PDF links. Conflicting or unresolved entries produce a review warning instead of an estimated chapter start. Nested PDF bookmarks are the fallback when there is no detected contents page; typography is the final fallback.

Printed page labels come from visible margin numbers or embedded PDF labels. Missing Arabic numbers are interpolated only between agreeing neighboring labels. Unknown numbers remain explicit labels such as `PDF 6`; they are not silently treated as printed page 6. Both reader modes resolve entered page labels uniquely, including Roman numerals, and reject missing or ambiguous labels.

The import review can add a chapter at a printed page, rename or merge chapters, and split at a paragraph. Splitting preserves the source blocks, figures, footnote references, and page anchors. Selecting a chapter's page opens its original preview. The preview supports correcting a single page label or explicitly numbering that page and all following pages. Numbering an entire remaining run is appropriate only when the source has no gaps or numbering resets.

OCR is enabled by default for sparse, missing, or visibly broken text layers. It uses bounded high-resolution rendering, automatic deskew, recognized line geometry, and a higher-resolution contrast-adjusted retry for uncertain output. A retry must improve the quality score without losing substantial recognized text. Readable native page numbers survive replacement of a sparse text layer. Confidence scores and extraction issues are available per page in the review. Language and cleanup options can be changed and the PDF reprocessed; this replaces review edits.

Cleanup retains footnote text even when a reference cannot be linked, retains table text if a crop fails or reaches the image limit, protects large chapter headings from running-header removal, and avoids joining hyphenated text across column changes. Original PDF bytes remain attached. Imports with risky layouts or scanned content default to the recommended original mode, and users can choose adjustable text after reviewing it.

OCR confidence is an engine score, not a guarantee of transcription accuracy. Very faint, rotated, handwritten, multilingual, mathematical, or complex multi-column pages can still need review. Contents detection currently recognizes English contents headings and common title/page rows; unsupported or ambiguous layouts can be corrected manually. Existing saved books are not automatically re-extracted, so their annotations and positions remain intact. Reimport a source PDF to use the new extraction behavior.

## Validation

- `npm test`: chapter mapping, conflicting contents links, unknown numbers, numbering resets, Roman front matter, manual splits, OCR scoring and geometry, plus existing suites.
- `npm run typecheck`, `npm run build`, and `npx next build`.
- `npm run test:import`: Chromium and WebKit at phone size, using a real PDF with contents, front matter, offset printed numbering, and a scan with a sparse native footer. Checks OCR content recovery, confidence persistence, manual chapter creation, label correction, exact navigation, and review overflow.
- `QA_DEVICE=phone npm run test:pdf`: existing blank/title/text PDF import, notes, bookmarks, reload, themes, and reflow checks in Chromium and WebKit. On PowerShell, set `$env:QA_DEVICE='phone'` before running the command.

Browser artifacts are written to ignored `work/import-qa` and `work/reader-qa`. These tests do not establish accuracy for every book, physical-device behavior, or the live deployment.
