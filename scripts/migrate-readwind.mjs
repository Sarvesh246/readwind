import fs from 'node:fs';
import { neon } from '@neondatabase/serverless';
const sql=neon(process.env.DATABASE_URL);
for(const statement of fs.readFileSync('db/folio.sql','utf8').split(';').filter(x=>x.trim())) await sql.query(statement);
console.log('Readwind schema applied.');
