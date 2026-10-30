# Reading progress and time estimates

The dashboard's progress percentage and remaining minutes refer to the entire book. Remaining minutes include all readable words after the saved position, across later chapters. The reader and book-opening screen retain chapter time. New-book reading times also use the account's learned pace. A completed book has zero remaining book minutes; books with no readable text have no total reading-time estimate.

The initial estimate uses 230 words per minute. Both original and adjustable-text readers learn from forward movement through extracted text while the reader is visible and focused. Covers, loading, open dialogs, and annotation editing suspend measurement. Hiding the page, changing focus, switching books or accounts, and leaving the reader reset its timing baseline. Saved-position timestamps are never treated as time spent reading.

Samples must contain 20–1,600 words over 8–180 seconds and imply 50–700 words per minute. Backward navigation, rapid flipping, large jumps, and long gaps outside these bounds do not train the model. Small scroll movements can accumulate into a sample. An initial two-minute prior limits swings while the model learns; each device retains up to two hours of weighted observations so later reading can change its pace.

The profile lives in account-scoped reader preferences and follows the existing offline sync and backup paths. Each device contributes independently versioned observations. Atomic server merges retain the newest observations for every device, so stale/offline settings saves and appearance changes cannot erase another device's pace. Guests learn on the current device. Other accounts have separate profiles.

Reading times remain estimates: page turns cannot distinguish actual reading from distraction, and OCR gaps or different book difficulty can affect word counts and pace. The dashboard labels its estimate accordingly.

Validation includes multi-chapter remaining-time tests, sample filtering, scroll accumulation, interruption resets, bounded adaptation, settings validation, and PostgreSQL merge tests covering stale saves and separate accounts. `npm run test:pace` checks dashboard totals, chapter time, timed page-turn learning and persistence in Chromium and WebKit.
