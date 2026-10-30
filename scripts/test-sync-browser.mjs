import {chromium} from '@playwright/test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const origin=process.env.READWIND_TEST_ORIGIN||'http://127.0.0.1:5173';
const book=JSON.parse(fs.readFileSync('lib/readwind/classics.json','utf8'))[0];book.id='sync-browser-fixture';
const browser=await chromium.launch();
try{
const page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
const server={books:[book],annotations:[],progress:[],settings:null};
let firstResolve,release,conflictOnce=true;
const first=new Promise(r=>firstResolve=r),barrier=new Promise(r=>release=r);
const sent=[];
await page.route('**/api/config',r=>r.fulfill({json:{authUrl:null}}));
await page.route('**/api/library*',r=>r.fulfill({json:server}));
await page.route('**/api/sync',async r=>{
 const change=r.request().postDataJSON();sent.push(change);
 if(change.entity==='annotation'){
  if(sent.length===1){firstResolve();await barrier;}
  server.annotations=[change.value];await r.fulfill({json:{ok:true}});
 }else if(change.entity==='progress'){
  if(conflictOnce){conflictOnce=false;await r.fulfill({status:409,json:{current:{at:{section:0,block:4,offset:0},revision:4,deviceId:'other-device'}}});}
  else {server.progress=[{...change.value,revision:5,updatedAt:Date.now()}];await r.fulfill({json:{revision:5}});}
 }else await r.fulfill({json:{ok:true}});
});
await page.goto(origin);await page.getByRole('heading',{name:'Your shelf'}).waitFor();
await page.evaluate(async()=>{const h=await import('/tests/fixtures/library-harness.tsx');h.mount('sync-regression');});
async function waitForLibrary(state){
 const deadline=Date.now()+5000;
 while(Date.now()<deadline){
  const ready=await page.evaluate(async state=>{const h=await import('/tests/fixtures/library-harness.tsx');const l=h.current();return state==='ready'?!!l?.ready:state==='conflict'?!!l?.conflict:l?.status==='All changes synced'&&(await l.db.pending.count())===0;},state);
  if(ready)return;await page.waitForTimeout(50);
 }
 const current=await page.evaluate(async()=>{const h=await import('/tests/fixtures/library-harness.tsx');const l=h.current();return {status:l?.status,ready:l?.ready,pending:(await l?.db.pending.toArray()||[]).map(p=>p.id)};});
 throw new Error('Timed out waiting for library '+state+' '+JSON.stringify(current));
}
await waitForLibrary('ready');
const ann={id:'race-note',bookId:book.id,kind:'highlight',range:{start:{section:0,block:1,offset:0},end:{section:0,block:1,offset:10}},quote:'A passage',note:'first edit',color:'yellow',createdAt:Date.now(),updatedAt:Date.now()};
await page.evaluate(async a=>{const h=await import('/tests/fixtures/library-harness.tsx');await h.current().saveAnnotation(a);},ann);
await first;
await page.evaluate(async a=>{const h=await import('/tests/fixtures/library-harness.tsx');await h.current().saveAnnotation({...a,note:'new edit during upload'});},ann);
release();
await waitForLibrary('synced');
assert.equal(sent.filter(s=>s.entity==='annotation').length,2,'new edit drains without waiting for the 12-second poll');
assert.equal(server.annotations[0].note,'new edit during upload');
assert.equal(await page.evaluate(async()=>{const h=await import('/tests/fixtures/library-harness.tsx');return h.current().db.pending.count();}),0);
await page.evaluate(async id=>{const h=await import('/tests/fixtures/library-harness.tsx');await h.current().saveProgress(id,{section:0,block:1,offset:0},10);},book.id);
await waitForLibrary('conflict');
await page.evaluate(async id=>{const h=await import('/tests/fixtures/library-harness.tsx');await h.current().saveProgress(id,{section:0,block:2,offset:25},20);await h.current().resolveConflict(true);},book.id);
await waitForLibrary('synced');
assert.deepEqual(server.progress[0].at,{section:0,block:2,offset:25},'resolving a conflict retains the latest local position');
assert.equal(sent.filter(s=>s.entity==='progress').at(-1).value.revision,4);
const gone={...book,id:'deleted-on-another-device',title:'Deleted elsewhere',sourcePdfBlobId:'gone-blob'};
await page.evaluate(async b=>{const h=await import('/tests/fixtures/library-harness.tsx');const l=h.current();await l.db.transaction('rw',[l.db.books,l.db.progress,l.db.annotations,l.db.blobs],async()=>{await l.db.books.put(b);await l.db.progress.put({bookId:b.id,at:{section:0,block:1,offset:0},wordsRead:12,revision:3,deviceId:'qa-old',updatedAt:Date.now()});await l.db.annotations.put({id:'gone-note',bookId:b.id,kind:'highlight',range:{start:{section:0,block:1,offset:0},end:{section:0,block:1,offset:10}},quote:'Old passage',note:'Old note',color:'yellow',createdAt:Date.now(),updatedAt:Date.now()});await l.db.blobs.put({id:'gone-blob',data:new ArrayBuffer(8),type:'application/pdf'});});await l.sync();},gone);
await waitForLibrary('synced');
assert.equal(await page.evaluate(async()=>{const h=await import('/tests/fixtures/library-harness.tsx');return h.current().db.books.get('deleted-on-another-device');}),undefined,'a book deleted on another device disappears here');
assert.equal(await page.evaluate(async()=>{const h=await import('/tests/fixtures/library-harness.tsx');const l=h.current();return {p:await l.db.progress.get('deleted-on-another-device'),a:await l.db.annotations.get('gone-note'),b:await l.db.blobs.get('gone-blob')};}).then(x=>x.p||x.a||x.b),undefined,'its position, notes, and cached file are removed too');
const uploadBook={...book,id:'upload-new-book',title:'Uploaded straight to storage',sourcePdfBlobId:'upload-blob'};
server.books.push(uploadBook);
let signed=null,putBytes=0,completed=null;
const storage='https://br-lively-term-b5lb2wv5.storage.c-7.us-east-2.aws.neon.tech';
await page.route('**/api/files/sign',async r=>{signed=r.request().postDataJSON();await r.fulfill({json:{url:`${storage}/folio-books/qa/upload-blob?X-Amz-Signature=test`,headers:{'content-type':'application/pdf'},expires:300}});});
await page.route(`${storage}/**`,async r=>{
 if(r.request().method()==='OPTIONS')return r.fulfill({status:204,headers:{'access-control-allow-origin':'*','access-control-allow-methods':'PUT','access-control-allow-headers':'content-type'}});
 putBytes=r.request().postDataBuffer()?.length||0;
 await r.fulfill({status:200,headers:{'access-control-allow-origin':'*'},body:''});
});
await page.route('**/api/files/complete',async r=>{completed=r.request().postDataJSON();await r.fulfill({json:{ok:true}});});
await page.evaluate(async b=>{const h=await import('/tests/fixtures/library-harness.tsx');const l=h.current();const bytes=new Uint8Array(5*1024*1024);bytes.set(new TextEncoder().encode('%PDF-1.4\n'));await l.db.transaction('rw',[l.db.books,l.db.blobs,l.db.pending],async()=>{await l.db.books.put(b);await l.db.blobs.put({id:b.sourcePdfBlobId,data:bytes.buffer,type:'application/pdf'});await l.db.pending.put({id:`book:${b.id}`,entity:'book',bookId:b.id,value:b});});await l.sync();},uploadBook);
await waitForLibrary('synced');
assert.equal(signed.bytes,5*1024*1024,'file grants are requested with the exact size');
assert.equal(putBytes,5*1024*1024,'the browser uploads the file body directly to storage');
assert.equal(completed.id,'upload-blob','the upload is verified after the direct PUT');
assert.deepEqual(errors,[]);
console.log('PASS: edit during upload drains immediately; no false synced status; conflict resolution preserves the latest local reading anchor; remote deletions reconcile locally; files upload directly to storage.');
}finally{await browser.close();}
