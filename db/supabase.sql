-- Apply after folio.sql and catalog.sql using a Supabase schema administrator.
-- Set role passwords separately. Runtime credentials must never own the schema.
DO $$ BEGIN
 IF NOT EXISTS(SELECT FROM pg_roles WHERE rolname='readwind_runtime') THEN
  CREATE ROLE readwind_runtime NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS NOINHERIT;
 END IF;
 IF NOT EXISTS(SELECT FROM pg_roles WHERE rolname='readwind_catalog_publisher') THEN
  CREATE ROLE readwind_catalog_publisher NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS NOINHERIT;
 END IF;
END $$;
REVOKE CREATE ON SCHEMA public FROM PUBLIC,anon,authenticated;
GRANT USAGE ON SCHEMA public TO readwind_runtime,readwind_catalog_publisher;
REVOKE ALL ON folio_books,folio_progress,folio_annotations,folio_settings,folio_files,folio_imports,folio_rate_limits,folio_catalog_versions,folio_catalog_assets FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON folio_books,folio_progress,folio_annotations,folio_settings,folio_files,folio_imports TO readwind_runtime;
GRANT SELECT,INSERT,UPDATE ON folio_rate_limits TO readwind_runtime;
GRANT SELECT ON folio_catalog_versions,folio_catalog_assets TO readwind_runtime;
GRANT SELECT,INSERT,UPDATE,DELETE ON folio_catalog_versions,folio_catalog_assets TO readwind_catalog_publisher;
ALTER FUNCTION folio_check_quota() SET search_path=public,pg_temp;
REVOKE ALL ON FUNCTION folio_check_quota() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION folio_check_quota() TO readwind_runtime,service_role;
ALTER TABLE folio_rate_limits ENABLE ROW LEVEL SECURITY;
ALTER TABLE folio_rate_limits FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS runtime_rate_limits ON folio_rate_limits;
CREATE POLICY runtime_rate_limits ON folio_rate_limits TO readwind_runtime USING(true) WITH CHECK(true);
ALTER TABLE folio_catalog_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE folio_catalog_versions FORCE ROW LEVEL SECURITY;
ALTER TABLE folio_catalog_assets ENABLE ROW LEVEL SECURITY;
ALTER TABLE folio_catalog_assets FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS runtime_catalog_read ON folio_catalog_versions;
CREATE POLICY runtime_catalog_read ON folio_catalog_versions FOR SELECT TO readwind_runtime USING(true);
DROP POLICY IF EXISTS runtime_catalog_assets_read ON folio_catalog_assets;
CREATE POLICY runtime_catalog_assets_read ON folio_catalog_assets FOR SELECT TO readwind_runtime USING(true);
DROP POLICY IF EXISTS publisher_catalog ON folio_catalog_versions;
CREATE POLICY publisher_catalog ON folio_catalog_versions TO readwind_catalog_publisher USING(true) WITH CHECK(true);
DROP POLICY IF EXISTS publisher_catalog_assets ON folio_catalog_assets;
CREATE POLICY publisher_catalog_assets ON folio_catalog_assets TO readwind_catalog_publisher USING(true) WITH CHECK(true);

CREATE TABLE IF NOT EXISTS folio_identities(
 auth_user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
 owner_id text NOT NULL UNIQUE
);
CREATE TABLE IF NOT EXISTS folio_sessions(
 token_hash text PRIMARY KEY CHECK(token_hash ~ '^[a-f0-9]{64}$'),
 auth_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
 tokens text NOT NULL,expires_at timestamptz NOT NULL,updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS folio_sessions_expiry ON folio_sessions(expires_at);
ALTER TABLE folio_identities ENABLE ROW LEVEL SECURITY;
ALTER TABLE folio_identities FORCE ROW LEVEL SECURITY;
ALTER TABLE folio_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE folio_sessions FORCE ROW LEVEL SECURITY;
REVOKE ALL ON folio_identities,folio_sessions FROM PUBLIC,anon,authenticated;
GRANT SELECT ON folio_identities TO readwind_runtime;
GRANT SELECT,INSERT,UPDATE,DELETE ON folio_sessions TO readwind_runtime;
DROP POLICY IF EXISTS backend_identities ON folio_identities;
CREATE POLICY backend_identities ON folio_identities FOR SELECT TO readwind_runtime USING(true);
DROP POLICY IF EXISTS backend_sessions ON folio_sessions;
CREATE POLICY backend_sessions ON folio_sessions TO readwind_runtime USING(true) WITH CHECK(true);

-- Supabase owns the auth schema. Only its private service role inspects live sessions.
GRANT SELECT(id,user_id,not_after) ON auth.sessions TO service_role;
GRANT SELECT(id,banned_until,deleted_at,email_confirmed_at) ON auth.users TO service_role;
CREATE OR REPLACE FUNCTION readwind_session_live(session_id uuid,auth_user_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY INVOKER SET search_path=pg_catalog AS $$
 SELECT EXISTS(SELECT 1 FROM auth.sessions s JOIN auth.users u ON u.id=s.user_id
 WHERE s.id=session_id AND s.user_id=auth_user_id AND (s.not_after IS NULL OR s.not_after>now())
 AND u.deleted_at IS NULL AND u.email_confirmed_at IS NOT NULL AND (u.banned_until IS NULL OR u.banned_until<=now()));
$$;
REVOKE ALL ON FUNCTION readwind_session_live(uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION readwind_session_live(uuid,uuid) TO service_role;

CREATE TABLE IF NOT EXISTS folio_recovery_snapshots(
 owner_id text NOT NULL,device_id text NOT NULL,epoch text NOT NULL,entity text NOT NULL,entity_id text NOT NULL,
 data jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(owner_id,device_id,epoch,entity,entity_id)
);
CREATE TABLE IF NOT EXISTS folio_account_revisions(owner_id text PRIMARY KEY,revision bigint NOT NULL DEFAULT 1);
ALTER TABLE folio_account_revisions ADD COLUMN IF NOT EXISTS books_revision bigint NOT NULL DEFAULT 0;
ALTER TABLE folio_recovery_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE folio_recovery_snapshots FORCE ROW LEVEL SECURITY;
ALTER TABLE folio_account_revisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE folio_account_revisions FORCE ROW LEVEL SECURITY;
REVOKE ALL ON folio_recovery_snapshots,folio_account_revisions FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT ON folio_recovery_snapshots TO readwind_runtime;
GRANT SELECT,INSERT,UPDATE ON folio_account_revisions TO readwind_runtime;
DROP POLICY IF EXISTS tenant ON folio_recovery_snapshots;
CREATE POLICY tenant ON folio_recovery_snapshots TO readwind_runtime USING(owner_id=current_setting('readwind.owner',true)) WITH CHECK(owner_id=current_setting('readwind.owner',true));
DROP POLICY IF EXISTS tenant ON folio_account_revisions;
CREATE POLICY tenant ON folio_account_revisions TO readwind_runtime USING(owner_id=current_setting('readwind.owner',true)) WITH CHECK(owner_id=current_setting('readwind.owner',true));
CREATE OR REPLACE FUNCTION folio_bump_revision() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $$
DECLARE owner text;
BEGIN
 IF TG_OP='DELETE' THEN owner=OLD.owner_id; ELSE owner=NEW.owner_id; END IF;
 INSERT INTO folio_account_revisions(owner_id,revision,books_revision) VALUES(owner,1,CASE WHEN TG_TABLE_NAME='folio_books' THEN 1 ELSE 0 END) ON CONFLICT(owner_id) DO UPDATE SET revision=folio_account_revisions.revision+1,books_revision=folio_account_revisions.books_revision+CASE WHEN TG_TABLE_NAME='folio_books' THEN 1 ELSE 0 END;
 IF TG_OP='DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END;$$;
REVOKE ALL ON FUNCTION folio_bump_revision() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION folio_bump_revision() TO readwind_runtime,service_role;
DROP TRIGGER IF EXISTS folio_books_revision ON folio_books;
CREATE TRIGGER folio_books_revision AFTER INSERT OR UPDATE OR DELETE ON folio_books FOR EACH ROW EXECUTE FUNCTION folio_bump_revision();
DROP TRIGGER IF EXISTS folio_progress_revision ON folio_progress;
CREATE TRIGGER folio_progress_revision AFTER INSERT OR UPDATE OR DELETE ON folio_progress FOR EACH ROW EXECUTE FUNCTION folio_bump_revision();
DROP TRIGGER IF EXISTS folio_annotations_revision ON folio_annotations;
CREATE TRIGGER folio_annotations_revision AFTER INSERT OR UPDATE OR DELETE ON folio_annotations FOR EACH ROW EXECUTE FUNCTION folio_bump_revision();
DROP TRIGGER IF EXISTS folio_settings_revision ON folio_settings;
CREATE TRIGGER folio_settings_revision AFTER INSERT OR UPDATE OR DELETE ON folio_settings FOR EACH ROW EXECUTE FUNCTION folio_bump_revision();
INSERT INTO folio_account_revisions(owner_id) SELECT DISTINCT owner_id FROM folio_books ON CONFLICT DO NOTHING;
