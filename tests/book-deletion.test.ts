import {describe,it,expect} from 'vitest';
import {PGlite} from '@electric-sql/pglite';
import {markBookDeleted,finishBookCleanup,saveLiveBook} from '../lib/readwind/book-deletion';
import {persistSettings} from '../lib/readwind/settings-sync';
import {defaults,type Book} from '../lib/readwind/types';
describe('durable book deletion',()=>{
 it('removes metadata and notes first, retains retryable files, rejects stale saves and permits deliberate restoration',async()=>{
  const pg=new PGlite();try{
   await pg.exec(`CREATE TABLE folio_books(owner_id text,id text,data jsonb,updated_at timestamptz DEFAULT now(),PRIMARY KEY(owner_id,id));CREATE TABLE folio_settings(owner_id text PRIMARY KEY,data jsonb,updated_at timestamptz DEFAULT now());CREATE TABLE folio_progress(owner_id text,book_id text,FOREIGN KEY(owner_id,book_id) REFERENCES folio_books(owner_id,id) ON DELETE CASCADE);CREATE TABLE folio_annotations(owner_id text,book_id text,FOREIGN KEY(owner_id,book_id) REFERENCES folio_books(owner_id,id) ON DELETE CASCADE)`);
   const tag=async(strings:TemplateStringsArray,...values:unknown[])=>(await pg.query(strings.reduce((sql,s,i)=>sql+(i?`$${i}`:'')+s,''),values)).rows;
   const book={id:'book-a',title:'A book',author:'Author',cover:{kind:'typeset',color:'#333333',fg:'#ffffff',blobId:'cover-a'},sourcePdfBlobId:'pdf-a',sections:[{id:'s',title:'Beginning',heading:true,blocks:[{type:'figure',blobId:'image-a'},{type:'p',text:'Original text.'}]}],pageMarks:[],printPageCount:1,addedAt:1,lastOpenedAt:1} as Book;
   await persistSettings(tag,'alice',{...defaults,readingPace:{device:{samples:2,words:300,seconds:90}}});await saveLiveBook(tag,'alice',book);await saveLiveBook(tag,'bob',book);
   await pg.query('INSERT INTO folio_annotations VALUES ($1,$2)',['alice',book.id]);await pg.query('INSERT INTO folio_progress VALUES ($1,$2)',['alice',book.id]);
   const deleted=await markBookDeleted(tag,'alice',book.id,['queued-upload']) as {deletion:{files:string[]}}[];
   expect(new Set(deleted[0].deletion.files)).toEqual(new Set(['cover-a','pdf-a','image-a','queued-upload']));
   expect((await pg.query('SELECT * FROM folio_books WHERE owner_id=$1',['alice'])).rows).toHaveLength(0);expect((await pg.query('SELECT * FROM folio_annotations')).rows).toHaveLength(0);expect((await pg.query('SELECT * FROM folio_progress')).rows).toHaveLength(0);expect((await pg.query('SELECT * FROM folio_books WHERE owner_id=$1',['bob'])).rows).toHaveLength(1);
   expect(await saveLiveBook(tag,'alice',book)).toHaveLength(0);expect(await saveLiveBook(tag,'alice',book,true)).toHaveLength(0);
   const retry=await markBookDeleted(tag,'alice',book.id,[]) as {deletion:{files:string[]}}[];expect(new Set(retry[0].deletion.files)).toEqual(new Set(deleted[0].deletion.files));
   await persistSettings(tag,'alice',{...defaults,paper:'Night',confirmBookDeletion:false});
   expect((await pg.query<{data:Record<string,unknown>}>('SELECT data FROM folio_settings WHERE owner_id=$1',['alice'])).rows[0].data._bookDeletions).toBeTruthy();
   await finishBookCleanup(tag,'alice',book.id);expect(await saveLiveBook(tag,'alice',book)).toHaveLength(0);expect(await saveLiveBook(tag,'alice',book,true)).toHaveLength(1);
   const profile=(await pg.query<{data:Record<string,unknown>}>('SELECT data FROM folio_settings WHERE owner_id=$1',['alice'])).rows[0].data;expect(profile.confirmBookDeletion).toBe(false);expect(profile.readingPace).toEqual({device:{samples:2,words:300,seconds:90}});
   await markBookDeleted(tag,'alice','book-b',[]);await markBookDeleted(tag,'alice',book.id,[]);
   const ledger=(await pg.query<{data:{_bookDeletions:Record<string,unknown>}}>('SELECT data FROM folio_settings WHERE owner_id=$1',['alice'])).rows[0].data._bookDeletions;expect(Object.keys(ledger).sort()).toEqual(['book-a','book-b']);
  }finally{await pg.close();}
 },30000);
});
