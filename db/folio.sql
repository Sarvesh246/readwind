CREATE TABLE IF NOT EXISTS folio_books (
  owner_id text NOT NULL, id text NOT NULL, data jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(owner_id,id)
);
CREATE TABLE IF NOT EXISTS folio_progress (
  owner_id text NOT NULL, book_id text NOT NULL, at jsonb NOT NULL,
  revision integer NOT NULL DEFAULT 1, device_id text NOT NULL, words_read integer NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(owner_id,book_id),
  FOREIGN KEY(owner_id,book_id) REFERENCES folio_books(owner_id,id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS folio_annotations (
  owner_id text NOT NULL, id text NOT NULL, book_id text NOT NULL, data jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(owner_id,id),
  FOREIGN KEY(owner_id,book_id) REFERENCES folio_books(owner_id,id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS folio_annotations_book ON folio_annotations(owner_id,book_id);
CREATE TABLE IF NOT EXISTS folio_settings (owner_id text PRIMARY KEY, data jsonb NOT NULL, updated_at timestamptz NOT NULL DEFAULT now());
