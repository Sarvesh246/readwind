import fs from 'node:fs';
import { createDatabase, closeDatabase } from './backend-database.mjs';
import {splitSqlStatements} from './sql-statements.mjs';
if (!process.env.MIGRATION_DATABASE_URL) throw new Error("Set MIGRATION_DATABASE_URL to a separate schema-owner credential.");
const budget=Number(process.env.READWIND_PROJECT_STORAGE_BUDGET_BYTES);
if(process.env.READWIND_BACKEND==='supabase' && (!Number.isSafeInteger(budget)||budget<=0))
 throw new Error('Set READWIND_PROJECT_STORAGE_BUDGET_BYTES to verified provider capacity before migrating.');
const sql=createDatabase(process.env.MIGRATION_DATABASE_URL);
try {
 const source=(process.env.READWIND_BACKEND==='supabase'?['db/folio.sql','db/catalog.sql','db/supabase.sql']:['db/folio.sql']).map(file=>fs.readFileSync(file,'utf8')).join('\n');
 const queries=splitSqlStatements(source).map(statement=>sql.query(statement));
 if(process.env.READWIND_BACKEND==='supabase')queries.push(sql.query('UPDATE folio_storage_capacity SET limit_bytes=$1 WHERE id',[Math.floor(budget*.8)]));
 await sql.transaction(queries);
}finally{await closeDatabase(sql);}
console.log('Readwind schema applied.');
