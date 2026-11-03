import {createDatabase,closeDatabase} from './backend-database.mjs';
if(!process.env.MIGRATION_DATABASE_URL)throw new Error('Set MIGRATION_DATABASE_URL to the intended Readwind project.');
const db=createDatabase(process.env.MIGRATION_DATABASE_URL);
try{
 const privateFiles=await db.query('SELECT count(*) AS objects,coalesce(sum(bytes),0) AS bytes FROM folio_files');
 const catalog=await db.query('SELECT count(*) AS objects,coalesce(sum(bytes),0) AS bytes FROM folio_catalog_assets');
 const recovery=await db.query('SELECT count(*) AS snapshots,coalesce(sum(pg_column_size(data)),0) AS bytes FROM folio_recovery_snapshots');
 const database=await db.query('SELECT pg_database_size(current_database()) AS bytes');
 console.log(JSON.stringify({storageProvider:process.env.READWIND_STORAGE || (process.env.READWIND_BACKEND==='supabase'?'supabase':'s3'),privateFiles:privateFiles[0],catalog:catalog[0],recovery:recovery[0],database:database[0],transfer:'Consult the active storage and database provider dashboards; row bytes do not measure transfer.'},null,2));
}finally{await closeDatabase(db);}
