import fs from 'node:fs';
import { neon } from '@neondatabase/serverless';
if (!process.env.MIGRATION_DATABASE_URL) throw new Error("Set MIGRATION_DATABASE_URL to a separate schema-owner credential.");
const sql=neon(process.env.MIGRATION_DATABASE_URL);
const source = fs.readFileSync('db/folio.sql','utf8');
const statements = source.match(/(?:[^;$]|\$(?!\$)|\$\$[\s\S]*?\$\$)+/g).filter(s=>s.trim());
await sql.transaction(statements.map(statement=>sql.query(statement)));
console.log('Readwind schema applied.');
