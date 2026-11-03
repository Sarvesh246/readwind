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
GRANT USAGE ON SCHEMA public TO readwind_runtime,readwind_catalog_publisher,service_role;
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
CREATE POLICY tenant ON folio_recovery_snapshots TO readwind_runtime USING(owner_id=(SELECT current_setting('readwind.owner',true))) WITH CHECK(owner_id=(SELECT current_setting('readwind.owner',true)));
DROP POLICY IF EXISTS tenant ON folio_account_revisions;
CREATE POLICY tenant ON folio_account_revisions TO readwind_runtime USING(owner_id=(SELECT current_setting('readwind.owner',true))) WITH CHECK(owner_id=(SELECT current_setting('readwind.owner',true)));
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

CREATE INDEX IF NOT EXISTS folio_sessions_auth_user ON folio_sessions(auth_user_id);
-- Service-only deletion, authorized by a marker written after password confirmation.
GRANT SELECT,DELETE ON folio_books,folio_progress,folio_annotations,folio_settings,folio_files,folio_imports,folio_recovery_snapshots,folio_account_revisions,folio_sessions TO service_role;
CREATE OR REPLACE FUNCTION readwind_delete_account_data(auth_user uuid,finished boolean DEFAULT false) RETURNS boolean
LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $$
DECLARE target text;
BEGIN
 SELECT owner_id INTO target FROM folio_settings WHERE data->>'_deletingAuthUser'=auth_user::text LIMIT 1;
 IF target IS NULL OR EXISTS(SELECT 1 FROM folio_files WHERE owner_id=target) THEN RETURN false; END IF;
 IF NOT finished THEN
  DELETE FROM folio_books WHERE owner_id=target;
  DELETE FROM folio_annotations WHERE owner_id=target;
  DELETE FROM folio_progress WHERE owner_id=target;
  DELETE FROM folio_imports WHERE owner_id=target;
  DELETE FROM folio_recovery_snapshots WHERE owner_id=target;
  UPDATE folio_settings SET data=jsonb_build_object('_deletingAuthUser',auth_user::text) WHERE owner_id=target;
 ELSE
  DELETE FROM folio_sessions WHERE auth_user_id=auth_user;
  DELETE FROM folio_settings WHERE owner_id=target;
  DELETE FROM folio_account_revisions WHERE owner_id=target;
 END IF;
 RETURN true;
END;$$;
REVOKE ALL ON FUNCTION readwind_delete_account_data(uuid,boolean) FROM PUBLIC,anon,authenticated,readwind_runtime;
GRANT EXECUTE ON FUNCTION readwind_delete_account_data(uuid,boolean) TO service_role;

-- Shared allocation counter includes private reservations and catalog manifests/assets.
-- Zero means the operator has not configured a project budget; uploads fail closed.
CREATE TABLE IF NOT EXISTS folio_storage_capacity(id boolean PRIMARY KEY DEFAULT true CHECK(id),used_bytes bigint NOT NULL DEFAULT 0 CHECK(used_bytes>=0),limit_bytes bigint NOT NULL DEFAULT 0 CHECK(limit_bytes>=0));
INSERT INTO folio_storage_capacity(id,used_bytes) SELECT true,COALESCE((SELECT sum(bytes) FROM folio_files),0)+COALESCE((SELECT sum(bytes) FROM folio_catalog_versions),0) ON CONFLICT DO NOTHING;
ALTER TABLE folio_storage_capacity ENABLE ROW LEVEL SECURITY;
ALTER TABLE folio_storage_capacity FORCE ROW LEVEL SECURITY;
REVOKE ALL ON folio_storage_capacity FROM PUBLIC,anon,authenticated;
GRANT SELECT,UPDATE ON folio_storage_capacity TO readwind_runtime,readwind_catalog_publisher,service_role;
DROP POLICY IF EXISTS capacity ON folio_storage_capacity;
CREATE POLICY capacity ON folio_storage_capacity TO readwind_runtime,readwind_catalog_publisher,service_role USING(true) WITH CHECK(true);
CREATE OR REPLACE FUNCTION folio_reserve_capacity() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $$
DECLARE delta bigint;
BEGIN
 IF TG_OP='DELETE' THEN delta=-OLD.bytes; ELSIF TG_OP='UPDATE' THEN delta=NEW.bytes-OLD.bytes; ELSE delta=NEW.bytes; END IF;
 UPDATE folio_storage_capacity SET used_bytes=GREATEST(0,used_bytes+delta) WHERE id AND (delta<=0 OR (limit_bytes>0 AND used_bytes+delta<=limit_bytes));
 IF NOT FOUND THEN RAISE EXCEPTION 'Project storage capacity is unavailable. Contact the operator or retry later.' USING ERRCODE='23514'; END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END;$$;
REVOKE ALL ON FUNCTION folio_reserve_capacity() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION folio_reserve_capacity() TO readwind_runtime,readwind_catalog_publisher,service_role;
DROP TRIGGER IF EXISTS folio_private_capacity ON folio_files;
CREATE TRIGGER folio_private_capacity AFTER INSERT OR UPDATE OR DELETE ON folio_files FOR EACH ROW EXECUTE FUNCTION folio_reserve_capacity();
DROP TRIGGER IF EXISTS folio_catalog_capacity ON folio_catalog_versions;
CREATE TRIGGER folio_catalog_capacity AFTER INSERT OR UPDATE OR DELETE ON folio_catalog_versions FOR EACH ROW EXECUTE FUNCTION folio_reserve_capacity();

GRANT SELECT,DELETE ON folio_rate_limits TO service_role;
CREATE OR REPLACE FUNCTION readwind_prune_ephemeral() RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $$
DECLARE sessions_count int; limits_count int;
BEGIN
 DELETE FROM folio_sessions WHERE token_hash IN (SELECT token_hash FROM folio_sessions WHERE expires_at<now()-interval '1 day' ORDER BY expires_at LIMIT 500);
 GET DIAGNOSTICS sessions_count=ROW_COUNT;
 DELETE FROM folio_rate_limits WHERE key IN (SELECT key FROM folio_rate_limits WHERE window_start<now()-interval '2 days' ORDER BY window_start LIMIT 500);
 GET DIAGNOSTICS limits_count=ROW_COUNT;
 RETURN jsonb_build_object('sessions',sessions_count,'rateLimits',limits_count);
END;$$;
REVOKE ALL ON FUNCTION readwind_prune_ephemeral() FROM PUBLIC,anon,authenticated,readwind_runtime;
GRANT EXECUTE ON FUNCTION readwind_prune_ephemeral() TO service_role;

CREATE OR REPLACE FUNCTION readwind_upload_allowed(file_owner text,file_id text,file_bytes bigint) RETURNS boolean LANGUAGE sql STABLE SECURITY INVOKER SET search_path=public,pg_temp AS $$
 SELECT EXISTS(SELECT 1 FROM folio_files WHERE owner_id=file_owner AND id=file_id AND bytes>=file_bytes)
 AND NOT EXISTS(SELECT 1 FROM folio_settings WHERE owner_id=file_owner AND data ? '_deletingAuthUser');
$$;
REVOKE ALL ON FUNCTION readwind_upload_allowed(text,text,bigint) FROM PUBLIC,anon,authenticated,readwind_runtime;
GRANT EXECUTE ON FUNCTION readwind_upload_allowed(text,text,bigint) TO service_role;
