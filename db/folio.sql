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

CREATE TABLE IF NOT EXISTS folio_rate_limits (
  key text PRIMARY KEY, window_start timestamptz NOT NULL, hits integer NOT NULL
);
CREATE TABLE IF NOT EXISTS folio_files (
  owner_id text NOT NULL, id text NOT NULL, bytes bigint NOT NULL CHECK(bytes BETWEEN 0 AND 20971520),
  PRIMARY KEY(owner_id,id)
);
CREATE TABLE IF NOT EXISTS folio_imports (
  owner_id text NOT NULL, id text NOT NULL, title text NOT NULL,
  percent smallint NOT NULL CHECK(percent BETWEEN 0 AND 100), message text NOT NULL,
  status text NOT NULL CHECK(status IN ('running','ready','failed')), device_id text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(owner_id,id)
);-- Serialize quota checks per tenant, including concurrent upserts.
CREATE OR REPLACE FUNCTION folio_check_quota() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE total_count bigint; total_bytes bigint;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(NEW.owner_id,0));
  IF TG_TABLE_NAME = 'folio_books' THEN
    SELECT count(*),coalesce(sum(octet_length(data::text)),0) INTO total_count,total_bytes FROM folio_books WHERE owner_id=NEW.owner_id AND id<>NEW.id;
    IF total_count>=100 OR total_bytes+octet_length(NEW.data::text)>25165824 THEN RAISE EXCEPTION 'Library quota exceeded' USING ERRCODE='23514'; END IF;
  ELSIF TG_TABLE_NAME = 'folio_annotations' THEN
    SELECT count(*),coalesce(sum(octet_length(data::text)),0) INTO total_count,total_bytes FROM folio_annotations WHERE owner_id=NEW.owner_id AND id<>NEW.id;
    IF total_count>=10000 OR total_bytes+octet_length(NEW.data::text)>8388608 THEN RAISE EXCEPTION 'Notes quota exceeded' USING ERRCODE='23514'; END IF;
  ELSIF TG_TABLE_NAME = 'folio_files' THEN
    SELECT count(*),coalesce(sum(bytes),0) INTO total_count,total_bytes FROM folio_files WHERE owner_id=NEW.owner_id AND id<>NEW.id;
    IF total_count>=2000 OR total_bytes+NEW.bytes>524288000 THEN RAISE EXCEPTION 'Storage quota exceeded' USING ERRCODE='23514'; END IF;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS folio_books_quota ON folio_books;
CREATE TRIGGER folio_books_quota BEFORE INSERT OR UPDATE ON folio_books FOR EACH ROW EXECUTE FUNCTION folio_check_quota();
DROP TRIGGER IF EXISTS folio_annotations_quota ON folio_annotations;
CREATE TRIGGER folio_annotations_quota BEFORE INSERT OR UPDATE ON folio_annotations FOR EACH ROW EXECUTE FUNCTION folio_check_quota();
DROP TRIGGER IF EXISTS folio_files_quota ON folio_files;
CREATE TRIGGER folio_files_quota BEFORE INSERT OR UPDATE ON folio_files FOR EACH ROW EXECUTE FUNCTION folio_check_quota();
ALTER TABLE folio_books ENABLE ROW LEVEL SECURITY;
ALTER TABLE folio_books FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant ON folio_books;
CREATE POLICY tenant ON folio_books USING(owner_id=current_setting('readwind.owner',true)) WITH CHECK(owner_id=current_setting('readwind.owner',true));
ALTER TABLE folio_progress ENABLE ROW LEVEL SECURITY;
ALTER TABLE folio_progress FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant ON folio_progress;
CREATE POLICY tenant ON folio_progress USING(owner_id=current_setting('readwind.owner',true)) WITH CHECK(owner_id=current_setting('readwind.owner',true));
ALTER TABLE folio_annotations ENABLE ROW LEVEL SECURITY;
ALTER TABLE folio_annotations FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant ON folio_annotations;
CREATE POLICY tenant ON folio_annotations USING(owner_id=current_setting('readwind.owner',true)) WITH CHECK(owner_id=current_setting('readwind.owner',true));
ALTER TABLE folio_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE folio_settings FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant ON folio_settings;
CREATE POLICY tenant ON folio_settings USING(owner_id=current_setting('readwind.owner',true)) WITH CHECK(owner_id=current_setting('readwind.owner',true));
ALTER TABLE folio_files ENABLE ROW LEVEL SECURITY;
ALTER TABLE folio_files FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant ON folio_files;
CREATE POLICY tenant ON folio_files USING(owner_id=current_setting('readwind.owner',true)) WITH CHECK(owner_id=current_setting('readwind.owner',true));
ALTER TABLE folio_imports ENABLE ROW LEVEL SECURITY;
ALTER TABLE folio_imports FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant ON folio_imports;
CREATE POLICY tenant ON folio_imports USING(owner_id=current_setting('readwind.owner',true)) WITH CHECK(owner_id=current_setting('readwind.owner',true));