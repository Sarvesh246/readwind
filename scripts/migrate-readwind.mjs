import fs from 'node:fs';
import { neon } from '@neondatabase/serverless';
import {splitSqlStatements} from './sql-statements.mjs';
if (!process.env.MIGRATION_DATABASE_URL) throw new Error("Set MIGRATION_DATABASE_URL to a separate schema-owner credential.");
const sql=neon(process.env.MIGRATION_DATABASE_URL);
const source = fs.readFileSync('db/folio.sql','utf8');
const statements = splitSqlStatements(source);
await sql.transaction(statements.map(statement=>sql.query(statement)));
console.log('Readwind schema applied.');
