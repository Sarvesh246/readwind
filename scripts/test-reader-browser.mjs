import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {chromium, webkit, firefox} from '@playwright/test';
const origin=process.env.READWIND_TEST_ORIGIN || 'http://127.0.0.1:5173';
const out=path.resolve(process.env.READWIND_QA_OUTPUT || 'work/reader-qa');
fs.mkdirSync(out,{recursive:true});
const legacy='[No readable text was detected on this page. See the original PDF.]';
const classic=JSON.parse(fs.readFileSync('lib/readwind/classics.json','utf8'))[0];
const book={...classic,id:'reader-qa',title:'A Quiet Reading Room',sourcePdfBlobId:'qa-original',readingMode:'reflow',sections:[{id:'empty',title:'Front matter',heading:false,blocks:[{type:'p',text:legacy}]},{id:'chapter',title:'Where I Lived',heading:true,blocks:[{type:'p',text:legacy},...classic.sections[0].blocks.slice(0,18)]}],pageMarks:Array.from({length:7},(_,i)=>({label:String(i+1),index:i,at:i===0?{section:0,block:0,offset:0}:{section:1,block:1+(i-1)*3,offset:0}})),printPageCount:7};
async function seed(page,settings={}){
 await page.route('**/api/config',r=>r.fulfill({json:{authUrl:null}}));
 await page.goto(origin); await page.getByRole('heading',{name:'Your shelf'}).waitFor();await page.getByRole('button',{name:'Add the classics',exact:true}).click();await page.getByRole('button',{name:'Read Walden',exact:true}).first().waitFor();
 await page.evaluate(async({book,settings})=>{
  const db=await new Promise((res,rej)=>{const r=indexedDB.open('folio-preview');r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error);});
  const value={paper:'Paper',font:'Literata',size:18,spacing:'Normal',turn:'Curl',wideLayout:'spread',warmLight:false,restNudge:false,focusParagraph:false,colorNames:{yellow:'Ideas',green:'Agree',blue:'Quotes',pink:'Question'},...settings};
  await new Promise((res,rej)=>{const tx=db.transaction(['books','preferences'],'readwrite');tx.objectStore('books').put(book);tx.objectStore('preferences').put({id:'reader',value});tx.oncomplete=res;tx.onerror=()=>rej(tx.error);});db.close();
 },{book,settings});
 await page.goto(origin+'/book/'+book.id); await settled(page);
}
async function settled(page){await page.locator('.reader').waitFor();await page.waitForTimeout(300);await page.locator('.pagination-status').waitFor({state:'hidden',timeout:90000});}
async function open(page){if(await page.locator('.reader-cover').count()){await page.getByRole('button',{name:'Open book',exact:true}).click();await page.locator('.reader-cover').waitFor({state:'hidden'});} }
async function geometry(page,label){
 const errors=await page.evaluate(()=>{
  const errs=[];
  if(document.documentElement.scrollWidth>innerWidth+1)errs.push('document horizontal overflow');
  for(const el of document.querySelectorAll('.page-text'))if(!el.closest('[aria-hidden="true"]')&&el.scrollHeight>el.clientHeight+3)errs.push(`page overflow ${el.scrollHeight}/${el.clientHeight}`);
  for(const el of document.querySelectorAll('.reader-bottom-tools button,.reader-header nav button')){
   const r=el.getBoundingClientRect();if(r.width&&r.height&&(r.right>innerWidth+1||r.left<0||r.bottom>innerHeight+1))errs.push('tool outside viewport: '+el.textContent);
  }
  return errs;
 });assert.deepEqual(errors,[],label);assert.equal(await page.getByText(legacy,{exact:false}).count(),0,label+' has no legacy filler');
 await page.screenshot({path:path.join(out,label+'.png')});
}
const results=[];
for(const [engine,browserType] of [['chromium',chromium],['webkit',webkit],['firefox',firefox]]){
 if(process.env.QA_ENGINE && process.env.QA_ENGINE!==engine)continue;
 const browser=await browserType.launch();
 try{
 for(const [device,viewport] of [['desktop',{width:1440,height:1000}],['phone',{width:390,height:844}],['small-phone',{width:320,height:740}],['landscape',{width:844,height:390}]]){
  if(process.env.QA_DEVICE && process.env.QA_DEVICE!==device)continue;
  console.log('START',engine,device);
  const page=await browser.newPage({viewport,hasTouch:device!=='desktop',...(engine==='firefox'?{reducedMotion:'reduce'}:{})});const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await seed(page);await open(page);
  for(const paper of ['Paper','Sepia','Dusk','Night']){
   await page.getByRole('button',{name:'Type and comfort settings',exact:true}).click();
   await page.getByRole('button',{name:paper,exact:true}).click();
   await page.screenshot({path:path.join(out,`${engine}-${device}-comfort-${paper}.png`)});
   await page.getByRole('button',{name:'Done',exact:true}).click();await settled(page);
   await geometry(page,`${engine}-${device}-${paper}`);
  }
  await page.getByRole('button',{name:'Bookmark this passage'}).click();await page.getByRole('button',{name:'Remove bookmark'}).waitFor();
  await page.getByRole('button',{name:'Type and comfort settings',exact:true}).click();
  for(let i=0;i<10;i++)await page.getByRole('button',{name:'Larger text'}).click();
  await page.getByRole('button',{name:'Airy',exact:true}).click();await page.getByRole('button',{name:'Done',exact:true}).click();await settled(page);
  await geometry(page,`${engine}-${device}-large-airy`);
  await page.getByRole('button',{name:'Next page',exact:true}).click();await page.waitForTimeout(180);await page.screenshot({path:path.join(out,`${engine}-${device}-curl-mid.png`)});await page.waitForTimeout(700);
  await geometry(page,`${engine}-${device}-turned`);
  if(device==='desktop'){
   await page.getByRole('button',{name:'Full screen',exact:true}).click();await settled(page);
   await geometry(page,`${engine}-${device}-fullscreen`);
   await page.getByRole('button',{name:'Remove bookmark'}).count();
   assert.ok(await page.getByRole('button',{name:'Highlight / note',exact:true}).isVisible());
   await page.getByRole('button',{name:'Exit full screen'}).click();await settled(page);
   // Native DOM selection exercises the real range-to-anchor path.
   await page.locator('.under-page .page-text [data-offset]').first().evaluate(el=>{const r=document.createRange();r.selectNodeContents(el);const sel=getSelection();sel.removeAllRanges();sel.addRange(r);});
   await page.locator('.book-root').dispatchEvent('mouseup');
   await page.getByRole('button',{name:'Note',exact:true}).click();await page.getByRole('textbox',{name:'Note for this passage'}).fill('A saved reading thought.');
   await page.getByRole('button',{name:'Save note',exact:true}).click();
   await page.locator('[data-highlight]').first().click();
   await page.getByRole('textbox',{name:'Note for this passage'}).waitFor();
   assert.equal(await page.getByRole('textbox',{name:'Note for this passage'}).inputValue(),'A saved reading thought.');
   await page.screenshot({path:path.join(out,`${engine}-desktop-note.png`)});
   await page.getByRole('button',{name:'Dismiss selection'}).click();
   await page.getByRole('button',{name:'Notebook',exact:true}).click();
   await page.getByText('A saved reading thought.',{exact:true}).waitFor();
   await page.screenshot({path:path.join(out,`${engine}-desktop-notebook.png`)});
   await page.locator('.notebook-chapter article').filter({hasText:'A saved reading thought.'}).getByRole('button',{name:'Open on page',exact:true}).click();await settled(page);
   for(const turn of ['Slide','Scroll']){
    await page.getByRole('button',{name:'Type and comfort settings',exact:true}).click();
    await page.getByRole('button',{name:turn,exact:true}).click();
    await page.getByRole('button',{name:'Done',exact:true}).click();await settled(page);
    if(turn==='Slide'){await page.getByRole('button',{name:'Next page',exact:true}).click();await page.waitForTimeout(180);await page.screenshot({path:path.join(out,`${engine}-desktop-slide-mid.png`)});await page.waitForTimeout(700);}
    else{
     await page.getByRole('button',{name:'Contents and go to page',exact:true}).click();
     await page.getByRole('textbox',{name:'Print page',exact:true}).fill('4');await page.getByRole('button',{name:'Go',exact:true}).click();await page.waitForTimeout(400);
     const top=await page.locator('.continuous-reader').evaluate(el=>el.querySelector('[data-paragraph="1:7"]').getBoundingClientRect().top-el.getBoundingClientRect().top);
     await page.screenshot({path:path.join(out,`${engine}-desktop-scroll.png`)});
     assert.ok(top>=0&&top<70,'scroll navigation restores the requested passage near the top');
     assert.match(await page.locator('.footer-labels').innerText(),/p\. 4 of 7/);
     await page.screenshot({path:path.join(out,`${engine}-desktop-scroll.png`)});
    }
   }

  }
  assert.deepEqual(errors,[],`${engine} ${device} runtime errors`);results.push(`${engine} ${device} PASS`);console.log(results.at(-1));await page.close();
 }
 }finally{await browser.close();}
}
fs.writeFileSync(path.join(out,'results.json'),JSON.stringify(results,null,2));
console.log('PASS: 3 engines × 4 viewports × 4 papers, large text/spacing, turns, bookmarks, fullscreen, highlights and notes.');
