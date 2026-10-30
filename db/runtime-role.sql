-- Run as a dedicated migration administrator AFTER folio.sql.
-- Set the runtime role password separately in Neon (never put it in this file).
CREATE ROLE readwind_runtime LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS NOINHERIT;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO readwind_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON folio_books, folio_progress, folio_annotations, folio_settings, folio_files, folio_imports TO readwind_runtime;
GRANT SELECT, INSERT, UPDATE ON folio_rate_limits TO readwind_runtime;
-- Do not grant table ownership, membership in neondb_owner, or schema DDL privileges.
