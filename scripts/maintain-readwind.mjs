import {createDatabase,closeDatabase} from './backend-database.mjs';
if(!process.env.MIGRATION_DATABASE_URL)throw new Error('Set MIGRATION_DATABASE_URL to the intended Readwind project.');
const db=createDatabase(process.env.MIGRATION_DATABASE_URL);
try{
 const sessions=await db.query("DELETE FROM folio_sessions WHERE token_hash IN (SELECT token_hash FROM folio_sessions WHERE expires_at<now()-interval '1 day' ORDER BY expires_at LIMIT 500) RETURNING 1");
 const limits=await db.query("DELETE FROM folio_rate_limits WHERE key IN (SELECT key FROM folio_rate_limits WHERE window_start<now()-interval '2 days' ORDER BY window_start LIMIT 500) RETURNING 1");
 console.log(JSON.stringify({expiredSessionsPruned:sessions.length,oldRateLimitsPruned:limits.length}));
}finally{await closeDatabase(db);}
