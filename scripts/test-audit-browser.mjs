import {chromium} from '@playwright/test';
import {spawn} from 'node:child_process';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createPdfFixture} from '../tests/fixtures/pdf.mjs';
const port=3107,origin=process.env.BASE_URL || `http://reader.localhost:${port}`;
let server;
if(process.argv.includes('--start')){
 server=spawn(process.execPath,['node_modules/next/dist/bin/next','start','--port',String(port),'--hostname','0.0.0.0'],{stdio:'ignore',windowsHide:true});
 let ready=false;for(let i=0;i<60;i++){try{if((await fetch(`http://127.0.0.1:${port}`)).ok){ready=true;break;}}catch{}await new Promise(r=>setTimeout(r,500));}if(!ready)throw new Error('Production server did not start.');
}
const browser=await chromium.launch({args:['--host-resolver-rules=MAP reader.localhost 127.0.0.1']});
try{
 const context=await browser.newContext({viewport:{width:390,height:844}});
 const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
 let offline=false;
 const book=JSON.parse(fs.readFileSync('lib/readwind/classics.json','utf8'))[0];book.id='audit-offline-book';book.title='Offline account fixture';
 const user={id:'audit-isolated-account',name:'QA Reader',email:'qa@example.invalid',emailVerified:true};
 const mock=async(route,data)=>offline?route.abort():route.fulfill({json:data});
 await context.route('**/api/config',r=>mock(r,{authUrl:origin+'/api/auth'}));
 await context.route('**/api/auth/get-session*',r=>mock(r,{user,session:{expiresAt:new Date(Date.now()+86400000).toISOString()}}));
 await context.route('**/api/recovery*',r=>mock(r,{required:false}));
 await context.route('**/api/imports*',r=>mock(r,{imports:[]}));
 await context.route('**/api/library*',r=>mock(r,{books:[book],annotations:[],progress:[],settings:null,nextOffset:null}));
 await context.route('**/api/sync',r=>mock(r,{revision:1}));
 await context.route('**/api/account*',r=>mock(r,{bytes:0,limit:524288000,provider:'supabase',sessions:[]}));
 await context.addInitScript(()=>localStorage.setItem('readwind-offline-enabled','true'));
 await page.goto(origin);await page.getByRole('button',{name:'Read Offline account fixture',exact:true}).first().waitFor();
 await page.evaluate(()=>navigator.serviceWorker.ready);await page.waitForFunction(()=>!!navigator.serviceWorker.controller);
 const cached=await page.evaluate(async()=>{const cache=await caches.open((await caches.keys()).find(k=>k.startsWith('readwind-')));return (await cache.keys()).map(r=>new URL(r.url).pathname);});
 assert(cached.includes('/pdf.worker.min.mjs'),'PDF worker is precached');assert(cached.some(p=>p.startsWith('/_next/static/')),'production chunks are precached');assert(cached.some(p=>p.startsWith('/cmaps/')),'PDF character maps are precached');
 offline=true;await context.setOffline(true);
 const fresh=await context.newPage();await fresh.goto(origin);await fresh.getByRole('button',{name:'Read Offline account fixture',exact:true}).first().waitFor();
 await fresh.getByRole('button',{name:'Read Offline account fixture',exact:true}).first().click();
 await fresh.locator('.reader').waitFor();await fresh.waitForTimeout(500);await fresh.locator('.pagination-status').waitFor({state:'hidden',timeout:90000});
 await fresh.getByRole('button',{name:'Open book',exact:true}).click();

 await fresh.locator('.reader-cover').waitFor({state:'hidden',timeout:5000});
 await fresh.getByRole('button',{name:'Next page',exact:true}).click();
 await fresh.locator('.turning-leaf').waitFor({state:'detached'});
 await fresh.getByRole('button',{name:'Bookmark this passage',exact:true}).click();
 await fresh.getByRole('button',{name:'Remove bookmark',exact:true}).waitFor();
 await fresh.reload();await fresh.locator('.reader').waitFor();await fresh.waitForTimeout(500);await fresh.locator('.pagination-status').waitFor({state:'hidden',timeout:90000});await fresh.getByRole('button',{name:'Open book',exact:true}).click();await fresh.locator('.reader-cover').waitFor({state:'hidden'});await fresh.getByRole('button',{name:'Remove bookmark',exact:true}).waitFor();
 await fresh.getByRole('button',{name:'Back to library',exact:true}).click();
 await fresh.getByRole('button',{name:'Your account',exact:true}).click();
 await fresh.getByRole('button',{name:'Sign out',exact:true}).click();
 await fresh.getByText(/Sign-out paused:/).waitFor();
 const pending=await fresh.evaluate(()=>new Promise((resolve,reject)=>{const request=indexedDB.open('folio-audit-isolated-account');request.onerror=()=>reject(request.error);request.onsuccess=()=>{const db=request.result;const count=db.transaction('pending').objectStore('pending').count();count.onsuccess=()=>{db.close();resolve(count.result);};};}));assert(pending>0,'offline sign-out retains pending work');
 assert.equal(errors.length,0,errors.join('\n'));await context.close();
 // Original PDF search and cold offline rendering use a separate guest context.
 const guest=await browser.newContext({viewport:{width:390,height:844}});const pdfPage=await guest.newPage();
 await guest.route('**/api/config',r=>r.fulfill({json:{authUrl:null}}));
 const fixture=createPdfFixture('work/audit-qa');
 await pdfPage.goto(origin+'/import');await pdfPage.locator('input[type=file]').setInputFiles(fixture);await pdfPage.locator('.chapter-edit').first().waitFor({timeout:60000});await pdfPage.getByRole('button',{name:'Create book',exact:true}).click();await pdfPage.locator('.pdf-sheet canvas').first().waitFor();
 await pdfPage.getByRole('button',{name:'Search book',exact:true}).click();await pdfPage.getByLabel('Search extracted text').fill('chapter');await pdfPage.getByRole('dialog').waitFor();await pdfPage.getByRole('button',{name:'Close dialog',exact:true}).click();
 await pdfPage.evaluate(()=>navigator.serviceWorker.ready);await pdfPage.waitForFunction(()=>!!navigator.serviceWorker.controller);await guest.setOffline(true);await pdfPage.reload();await pdfPage.locator('.pdf-sheet canvas').first().waitFor();
 await guest.close();
 const shelfContext=await browser.newContext();const shelf=await shelfContext.newPage();
 await shelfContext.route('**/api/config',r=>r.fulfill({json:{authUrl:null}}));
 await shelf.goto(origin);await shelf.getByRole('heading',{name:'Your shelf'}).waitFor();
 await shelf.evaluate(async template=>{
  const db=await new Promise((resolve,reject)=>{const r=indexedDB.open('folio-preview');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
  await new Promise((resolve,reject)=>{const tx=db.transaction(['books','annotations','progress'],'readwrite');
   for(let i=0;i<100;i++){const id='profile-'+i,title='Profile '+String(i).padStart(3,'0');const sections=Array.from({length:5},(_,n)=>template.sections.map(s=>({...s,id:s.id+'-'+n}))).flat();tx.objectStore('books').put({...template,id,title,sections});tx.objectStore('progress').put({bookId:id,at:{section:0,block:0,offset:0},wordsRead:0,revision:0,deviceId:'profile',updatedAt:i});for(let n=0;n<100;n++)tx.objectStore('annotations').put({id:id+'-note-'+n,bookId:id,kind:'highlight',range:{start:{section:0,block:0,offset:0},end:{section:0,block:0,offset:0}},color:'yellow',quote:'Searchable passage',note:'Profile note '+n,createdAt:1,updatedAt:1});}
   tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);
  });db.close();
 },book);
 await shelf.reload();await shelf.waitForFunction(()=>document.querySelectorAll('.shelf-cell').length===100);
 const began=Date.now();await shelf.getByRole('searchbox').fill('Profile 099');await shelf.waitForFunction(()=>document.querySelectorAll('.shelf-cell').length===1);const filterMs=Date.now()-began;
 await shelf.getByRole('searchbox').fill('');await shelf.waitForFunction(()=>document.querySelectorAll('.shelf-cell').length===100);await shelf.getByRole('group',{name:'Sort',exact:true}).getByRole('button',{name:'Progress',exact:true}).click();
 console.log('100-book shelf / 10,000 annotations: filter visible in '+filterMs+' ms.');await shelfContext.close();
 console.log('PASS: exact Next build, precached worker/chunks/maps, fresh offline account tab, offline edits, sign-out protection, PDF search and offline rendering.');
}finally{await browser.close();server?.kill();}
