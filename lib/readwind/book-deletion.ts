import type {Book} from './types';
type SqlTag=(strings:TemplateStringsArray,...values:unknown[])=>Promise<unknown>;
export const deletionLedger='_bookDeletions';

/** Caller serializes library mutations for this owner before this statement. */
export async function markBookDeleted(db:SqlTag,owner:string,id:string,files:string[]){
 return db`WITH candidates AS (
   SELECT COALESCE(jsonb_agg(DISTINCT value),'[]'::jsonb) AS files FROM jsonb_array_elements_text(
     ${JSON.stringify(files)}::jsonb ||
     COALESCE((SELECT data->'_bookDeletions'->${id}::text->'files' FROM folio_settings WHERE owner_id=${owner}::text),'[]'::jsonb) ||
     COALESCE((SELECT jsonb_build_array(data->>'sourcePdfBlobId',data->'cover'->>'blobId',data->>'pdfCoverBlobId',data->>'customCoverBlobId') || jsonb_path_query_array(data,'$.sections[*].blocks[*] ? (@.type == "figure").blobId') FROM folio_books WHERE owner_id=${owner}::text AND id=${id}::text),'[]'::jsonb)
   ) value WHERE value IS NOT NULL
 ), marker AS (
   INSERT INTO folio_settings(owner_id,data) SELECT ${owner}::text,jsonb_build_object('_bookDeletions',jsonb_build_object(${id}::text,jsonb_build_object('files',files))) FROM candidates
   ON CONFLICT(owner_id) DO UPDATE SET data=jsonb_set(folio_settings.data,'{_bookDeletions}',COALESCE(folio_settings.data->'_bookDeletions','{}'::jsonb) || (EXCLUDED.data->'_bookDeletions')),updated_at=now()
   RETURNING data->'_bookDeletions'->${id}::text AS deletion
 ), removed AS (
   DELETE FROM folio_books WHERE owner_id=${owner}::text AND id=${id}::text AND EXISTS(SELECT 1 FROM marker) RETURNING id
 ) SELECT deletion FROM marker`;
}
export async function finishBookCleanup(db:SqlTag,owner:string,id:string){
 return db`UPDATE folio_settings SET data=jsonb_set(data,ARRAY['_bookDeletions',${id}::text,'files'],'[]'::jsonb),updated_at=now() WHERE owner_id=${owner}::text AND data->'_bookDeletions' ? ${id}::text`;
}
export async function saveLiveBook(db:SqlTag,owner:string,book:Book,restore=false){
 return db`WITH saved AS (
   INSERT INTO folio_books(owner_id,id,data) SELECT ${owner}::text,${book.id}::text,${JSON.stringify(book)}::jsonb
   WHERE NOT EXISTS(SELECT 1 FROM folio_settings WHERE owner_id=${owner}::text AND data->'_bookDeletions' ? ${book.id}::text)
      OR (${restore}::boolean AND NOT EXISTS(SELECT 1 FROM folio_settings WHERE owner_id=${owner}::text AND jsonb_array_length(COALESCE(data->'_bookDeletions'->${book.id}::text->'files','[]'::jsonb))>0))
   ON CONFLICT(owner_id,id) DO UPDATE SET data=EXCLUDED.data,updated_at=now() RETURNING id
 ), cleared AS (
   UPDATE folio_settings SET data=jsonb_set(data,'{_bookDeletions}',COALESCE(data->'_bookDeletions','{}'::jsonb)-${book.id}::text),updated_at=now()
   WHERE owner_id=${owner}::text AND ${restore}::boolean AND EXISTS(SELECT 1 FROM saved) RETURNING owner_id
 ) SELECT id FROM saved`;
}
