# Four-book import audit — October 30, 2026

The four user-supplied PDFs were processed locally through the browser importer: 1,075 physical pages in total. Source files, extracted text, cropped images and screenshots remain in ignored local work files; they are not repository fixtures. The documents were treated as content, not instructions.

| Source | PDF pages | Chapter result |
| --- | ---: | --- |
| Ultralearning | 241 | All 14 main chapters, plus front and back matter |
| Man’s Search for Meaning | 187 | All 6 numbered contents destinations, plus Contents and beginning |
| I Will Teach You to Be Rich, second edition | 394 | All 9 main chapters, introduction and other matter |
| The Psychology of Money | 253 | All 20 main chapters, introduction and other matter |

## Findings and changes

- Continued and headerless contents pages were missed. Corroborating bookmark titles now identify them, preserve descriptions separately, and supplement partially resolved contents. Complete linked chapter names and source destinations are retained.
- A 40-image cap silently omitted later illustrations. The cap is removed. The finance book retains its later illustrations as well as earlier ones.
- Aligned numeric tables could flatten into prose. Supported financial tables now retain their visual cells and exact extracted cell text. Failed crops retain their text.
- Native emphasis was discarded. Real PDF font metadata now carries bold and italic ranges through whitespace cleanup, line joining, pagination and rendering. Short bold subheadings stay separate.
- Physical page boundaries could introduce false paragraphs. Corroborated sentence continuations now reflow while page marks preserve character offsets. Manual chapter splitting also handles these offsets and preserves styles and footnote references.
- Image-only chapter-opening designs produced visibly wrong OCR titles. Sparse image pages now retain the original artwork, searchable OCR metadata, enlargement and an original-page link. Ordinary scanned body pages still use OCR paragraphs.
- Figures were small and had no direct inspection control. Proportional sizing, enlargement and source-page navigation are available in paginated and continuous reading. Full-page designs avoid a duplicate generated opening heading in paginated reading.

## Verification

All source pages went through import. Native text was compared against an independent PDF extraction, including numeric tokens in the two finance books. That comparison found no page exceeding the investigation threshold of the greater of eight missing tokens and four percent of source tokens, and no page missing more than three numeric tokens. This is a screening check, not proof of exact typography, ordering or OCR transcription. Rendered samples included contents, chapter openings, prose, emphasis, financial content and scanned pages.

All four imported books were paginated at phone and desktop sizes and checked for loss or duplication of every non-figure block's characters. Source page marks remained valid. Automated generated fixtures cover financial cells, more than 40 illustrations, image-only pages, emphasis offsets, chapter continuations and manual page-boundary splits.

Validation commands: `npm test`, `npm run typecheck`, `npm run test:fidelity`, `npm run test:chapters`, `npm run test:reading-layout`, `npm run test:pagination`, `npm run test:import`, phone `npm run test:pdf`, `npm run test:pace`, `npm run build` and `npx next build`. Browser checks use Chromium and WebKit. Targeted lint passes for the new import helpers and regression fixtures. Reader-wide lint still reports existing effect-state errors and a pre-existing `prefer-const` error outside this change.

## Limits and existing books

OCR confidence is not a transcription guarantee. Faint scans, unusual fonts, equations, complex vector diagrams and unsupported layouts can still need source review. Original mode retains the actual PDF and is recommended for risky layouts; enlargement and original-page controls make comparison possible during reading. Unknown printed numbers remain explicitly marked as PDF positions rather than invented printed labels.

Existing books are not silently re-extracted because that could invalidate annotations and progress. Reimport the source to obtain extraction changes. The existing flattened-contents presentation repair continues to work without changing stored content. This audit does not certify every PDF, physical device or live deployment as bug-free.

# Five-book re-audit — October 31, 2026

The four books above plus *Never Split the Difference* (375 pages) were re-imported and read back block by block, then paged at eleven viewport shapes (phone portrait and landscape, small phone, tablet, laptop, 1920 and 2560×1080 desktop, square) in and out of full screen.

- Pages with two or more list markers or "Word:" lines became line-preserving blocks, so wrapped prose kept hard line breaks. List items now flow as text and keep marker and nesting; prose around them stays prose; a script layout needs speaker labels on at least a fifth of the page.
- Sentences cut by a page break or an OCR paragraph guess were left as two paragraphs (lowercase starts fell from 526 to 82 in the scan, 232 to 73 in Never Split). Continuations are now rejoined wherever the second block starts lowercase after an unfinished line, or after a line-end hyphen. Page marks keep their character offset.
- A split word such as "frustra-tion" kept its hyphen when the book never used the whole word; common word endings now confirm the join.
- OCR punctuation in place of a space ("in.store") and straight apostrophes are repaired; hostnames are left alone.
- Paragraph gaps are measured against each page's own line pitch, which restores paragraph breaks in tightly set type (the Psychology of Money introduction).
- A bold lead-in that runs on into lowercase text is no longer split off as a subheading, and a chapter label that repeats the section title is dropped.
- Chapter openings on short or narrow screens could leave no room for text and showed a clipped drop cap; the title now shrinks to leave room, and the opening picture gets only the space under the title.
- Landscape phones wider than 900px (for example 932×430) showed a small two-page spread in the middle of the screen; they now use the full width like narrower landscape phones.
- Closing an import while pages were still being recognised could throw an unhandled error from the OCR engine; closing now waits for running pages.

Not changed: printed page numbers are absent from these ebook-derived PDFs, so labels stay "PDF n". OCR misreads in the scanned book (for example "FrankI") remain. An illustration that the source PDF itself paints past the page edge is shown as cropped as the PDF shows it.
