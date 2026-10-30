import {chromium,webkit} from '@playwright/test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const origin=process.env.READWIND_TEST_ORIGIN||'http://127.0.0.1:5173',out='work/reading-layout-qa';fs.mkdirSync(out,{recursive:true});
const titles=['Foreword','Chapter I: Field Notes','Chapter II: A Longer Journey','Appendix'];
const book={id:'existing-layout',title:'An Existing Book',author:'Reader',addedAt:1,lastOpenedAt:1,cover:{kind:'typeset',color:'#333333',fg:'#ffffff'},printPageCount:5,
 sections:[{id:'toc',title:'Contents',heading:true,blocks:[{type:'p',text:'Foreword Chapter I: Field Notes Chapter II: A Longer Journey Appendix'}]},...titles.map((title,i)=>({id:`s${i}`,title,heading:true,blocks:[{type:'h',text:'A quiet beginning'},{type:'p',text:'Reading gives each idea room to grow. A paragraph carries its thought from the opening sentence to its natural conclusion. '.repeat(3)},{type:'quote',text:'A quotation should have its own space on the page.'},{type:'p',text:'An intentional line break.\nA second line stays separate.'},{type:'p',text:'unusuallylongword'.repeat(80)},{type:'h',text:'The next thought'},{type:'p',text:'The final paragraph follows its heading and belongs to the same chapter.'}]}))],
 pageMarks:Array.from({length:5},(_,i)=>({label:String(i+1),index:i,at:{section:i,block:0,offset:0}}))};
for(const [engine,type]of [['chromium',chromium],['webkit',webkit]]){
 const browser=await type.launch();try{
 for(const [device,width,height]of [['desktop',1440,1000],['phone',390,844],['small-phone',320,740],['landscape',844,390]]){
  console.log('START reading layout',engine,device);
  const page=await browser.newPage({viewport:{width,height},reducedMotion:'reduce'}),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.route('**/api/config',r=>r.fulfill({json:{authUrl:null}}));await page.goto(origin);await page.getByRole('heading',{name:'Your shelf'}).waitFor();
  await page.evaluate(async book=>{
   const db=await new Promise(resolve=>{const r=indexedDB.open('folio-preview');r.onsuccess=()=>resolve(r.result);});
   await new Promise(resolve=>{const tx=db.transaction(['books','progress'],'readwrite');tx.objectStore('books').put(book);tx.objectStore('progress').put({bookId:book.id,at:{section:0,block:0,offset:0},wordsRead:0,revision:0,deviceId:'layout-device',updatedAt:1});tx.oncomplete=resolve;});db.close();
  },book);
  await page.goto(origin+'/book/'+book.id);await page.locator('.reader').waitFor();await page.locator('.pagination-status').waitFor({state:'hidden',timeout:60000});
  await page.getByRole('button',{name:/^Contents(?: and go to page)?$/}).first().click();await page.getByRole('searchbox',{name:'Search chapters'}).fill('Contents');await page.getByRole('navigation',{name:'Chapters'}).getByRole('button').click();
  assert.ok(await page.locator('.book-page:not(.decorative-page) .reading-contents-row').count()>0);
  assert.equal(await page.locator('.reading-contents-row .drop-cap').count(),0);
  await page.screenshot({path:`${out}/${engine}-${device}-legacy-contents.png`});
  await page.getByRole('button',{name:'Chapter I: Field Notes',exact:true}).first().focus();await page.keyboard.press('Enter');await page.waitForFunction(()=>document.querySelector('.reader-title').textContent.includes('Chapter I: Field Notes'));
  const pagination=await page.evaluate(async book=>{
   const {paginate,geometry}=await import('/lib/readwind/pagination.ts'),{defaults}=await import('/lib/readwind/types.ts');
   const settings={...defaults,size:28,spacing:'Airy'},g=geometry(innerWidth,innerHeight,settings,innerWidth<900,false);
   const pages=await paginate(book,g,settings),failures=[];
   book.sections.forEach((s,si)=>s.blocks.forEach((block,bi)=>{const actual=pages.flatMap(p=>p.fragments.filter(f=>f.section===si&&f.block===bi).map(f=>f.text)).join('');if(actual!==block.text)failures.push(`${si}:${bi}`);}));
   for(const page of pages)if(page.fragments.length>1&&page.fragments.at(-1).type==='h')failures.push('stranded heading');
   return failures;
  },book);assert.deepEqual(pagination,[]);
  await page.getByRole('button',{name:'Type and comfort settings',exact:true}).first().click();await page.getByRole('button',{name:'Scroll',exact:true}).click();await page.getByRole('button',{name:'Done',exact:true}).click();await page.locator('.continuous-reader').waitFor();
  assert.equal(await page.locator('.continuous-reader .reading-contents-row').count(),4);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false);
  const original=await page.evaluate(async()=>{const db=await new Promise(resolve=>{const r=indexedDB.open('folio-preview');r.onsuccess=()=>resolve(r.result);});const b=await new Promise(resolve=>{const r=db.transaction('books').objectStore('books').get('existing-layout');r.onsuccess=()=>resolve(r.result);});db.close();return b;});
  assert.deepEqual(original.sections,book.sections);assert.deepEqual(original.pageMarks,book.pageMarks);assert.deepEqual(errors,[]);
  console.log('PASS reading layout',engine,device,'existing contents, links, source retention, quotes, breaks, long words and headings');await page.close();
 }
 }finally{await browser.close();}
}
