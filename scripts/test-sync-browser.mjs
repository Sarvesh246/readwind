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
await page.route('**/api/library',r=>r.fulfill({json:server}));
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
 throw new Error('Timed out waiting for library '+state);
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
assert.deepEqual(errors,[]);
console.log('PASS: edit during upload drains immediately; no false synced status; conflict resolution preserves the latest local reading anchor.');
}finally{await browser.close();}
