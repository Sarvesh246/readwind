# Temporary export access request

Subject: Temporary export access for quota-blocked Readwind project

My Neon Free project `delicate-sunset-26738792` (named Folio; application Readwind) is quota-blocked. Please provide a temporary supported export window, or a secure complete export, so I can migrate my existing account and books without enabling paid billing.

Source details:

- Branch: `br-lively-term-b5lb2wv5` (`main`).
- Endpoint: `ep-delicate-lab-b5yptf8x`.
- Database reads and Neon Auth return HTTP 402; auth code is `GENERIC_QUOTA_EXCEEDED`.
- S3 object listing returns HTTP 503 / `SlowDown`, with “Requests for this account are currently blocked.”
- The management API reports 5,874,308,908 transferred bytes for November 1–December 1, 2026, and a 44,630,016-byte database.
- A pre-migration database snapshot exists: `snap-bold-lake-b5bls2rm` (`readwind-before-supabase-migration`).

I need all application tables (`public.folio_*`), the original account identity and authentication records needed for account migration (`neon_auth`), and all book/catalog objects with keys and metadata. The library includes reading positions, annotations, preferences, deletion markers, imported books, and the published catalog. Please provide sensitive authentication exports only through a secure private channel.

Please preserve the source and snapshot. A database snapshot alone does not recover the separate book files. Please confirm a supported way to export both database and object storage without upgrading or incurring charges. I do not authorize billing changes.
