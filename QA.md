# Validation

## Readwind update

- TypeScript type checking and production build pass.
- Thirteen automated checks cover stable anchors, fragmented glyphs, reading order, columns, ligatures, mixed font sizes, scans, rotated viewports, right-to-left text, and unmapped characters.
- Browser verification confirmed the original-layout reader displays an imported illustrated PDF with its image, table, footnote, and original typography.
- Website title, wordmark, PWA manifest, favicon, and install icons use Readwind branding.

## Limits

Original-layout pages use PDF.js rather than reconstructing typography from extracted text. Adjustable text remains heuristic. No claim is made that every PDF can be converted perfectly. Imports are limited to 50 MB; damaged PDFs, unavailable fonts, unsupported encryption, and poor scans can fail or require correction. OCR is optional and requires the correct language data.

The account backend, private file storage, account isolation, progress synchronization, stale-write handling, and offline cache were verified during the initial implementation. Physical iOS/Android installation, long offline sessions, and large-book performance still require device testing. Real-mail delivery for account recovery has not been tested.
