-- Apply after folio.sql using a schema-owner connection.
CREATE TABLE IF NOT EXISTS folio_catalog_versions (
  id text PRIMARY KEY, edition_id text NOT NULL, entry jsonb NOT NULL,
  manifest_id text NOT NULL, manifest_sha256 text NOT NULL,
  report jsonb NOT NULL, bytes bigint NOT NULL DEFAULT 0, ready boolean NOT NULL DEFAULT false, cleaning boolean NOT NULL DEFAULT false, published boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS folio_catalog_active_edition ON folio_catalog_versions(edition_id) WHERE published;
CREATE INDEX IF NOT EXISTS folio_catalog_search ON folio_catalog_versions USING gin(to_tsvector('simple',(entry->>'title')||' '||(entry->>'author')||' '||coalesce((entry->'subjects')::text,''))) WHERE published;
CREATE TABLE IF NOT EXISTS folio_catalog_assets (
  id text PRIMARY KEY, version_id text NOT NULL REFERENCES folio_catalog_versions(id),
  sha256 text NOT NULL, bytes bigint NOT NULL CHECK(bytes>0 AND bytes<=20971520), type text NOT NULL
);
CREATE INDEX IF NOT EXISTS folio_catalog_assets_version ON folio_catalog_assets(version_id);
-- Runtime receives read-only catalog access. Publication uses a separate worker credential.
DO $$ BEGIN IF EXISTS(SELECT FROM pg_roles WHERE rolname='readwind_runtime') THEN
 GRANT SELECT ON folio_catalog_versions,folio_catalog_assets TO readwind_runtime;
END IF; END $$;
