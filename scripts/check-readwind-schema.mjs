import { neon } from '@neondatabase/serverless';
import { pathToFileURL } from 'node:url';
export const readinessSql = `
  SELECT name, to_regclass('public.' || name) IS NOT NULL AS ready
  FROM unnest(ARRAY['folio_books','folio_progress','folio_annotations','folio_settings','folio_rate_limits','folio_files']) AS name
  UNION ALL
  SELECT 'quota:' || tablename, EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid=to_regclass('public.' || tablename) AND tgname=tablename || '_quota' AND NOT tgisinternal AND tgenabled='O')
  FROM unnest(ARRAY['folio_books','folio_annotations','folio_files']) AS tablename
  UNION ALL
  SELECT 'rls:' || name, EXISTS(SELECT 1 FROM pg_class WHERE oid=to_regclass('public.' || name) AND relrowsecurity AND relforcerowsecurity)
  FROM unnest(ARRAY['folio_books','folio_progress','folio_annotations','folio_settings','folio_files']) AS name
`;
export function assertSchemaReady(rows) {
  const missing=rows.filter(row=>!row.ready).map(row=>row.name);
  if(missing.length) throw new Error(`Readwind database migration required: ${missing.join(', ')}. Run db:migrate with a schema-owner connection before deploying.`);
}
async function main() {
  if (!process.env.DATABASE_URL) throw new Error('Set DATABASE_URL to check the target runtime database.');
  const rows=await neon(process.env.DATABASE_URL).query(readinessSql);
  assertSchemaReady(rows);
  console.log('Readwind database schema is ready.');
}
if (process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href) {
  main().catch(error=>{console.error(error.code?'Database readiness check failed.':error.message);process.exitCode=1;});
}
