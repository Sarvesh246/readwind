-- Apply once as a role administrator after catalog.sql.
-- Set the password separately; keep the connection only on the preparation computer.
CREATE ROLE readwind_catalog_publisher LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS NOINHERIT;
GRANT USAGE ON SCHEMA public TO readwind_catalog_publisher;
GRANT SELECT, INSERT, UPDATE, DELETE ON folio_catalog_versions, folio_catalog_assets TO readwind_catalog_publisher;
