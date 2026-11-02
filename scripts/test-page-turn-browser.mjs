import assert from 'node:assert/strict';
import fs from 'node:fs';
import {chromium, webkit, firefox} from '@playwright/test';
const origin=process.env.READWIND_TEST_ORIGIN||'http://127.0.0.1:5173';
const out='work/turn-qa';fs.mkdirSync(out,{recursive:true});
const classic=JSON.parse(fs.readFileSync('lib/readwind/classics.json','utf8'))[0];
const results=[];
for(const [engine,type] of [['chromium',chromium],['webkit',webkit],['firefox',firefox]]){
 if(process.env.QA_ENGINE && process.env.QA_ENGINE!==engine)continue;
 const browser=await type.launch({headless:!process.env.QA_HEADED});
 try{for(const phone of [false,true])for(const mode of ['Curl','Slide']){
 if(process.env.QA_MODE && process.env.QA_MODE!==mode)continue;
 if(process.env.QA_DEVICE && process.env.QA_DEVICE!==(phone?'phone':'desktop'))continue;
 const label=`${engine}-${phone?'phone':'desktop'}-${mode}`;
 console.log('START',label);
 const page=await browser.newPage({viewport:phone?{width:390,height:844}:{width:1440,height:1000},hasTouch:phone});
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/api/config',r=>r.fulfill({json:{authUrl:null}}));
 await page.goto(origin);await page.getByRole('heading',{name:'Your shelf'}).waitFor();
 await page.getByRole('button',{name:'Add the classics',exact:true}).click();
 await page.getByRole('button',{name:'Read Walden',exact:true}).first().waitFor();
 await page.evaluate(async({classic,mode})=>{
 const db=await new Promise((res,rej)=>{const r=indexedDB.open('folio-preview');r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error);});
 await new Promise((res,rej)=>{const tx=db.transaction(['books','preferences'],'readwrite');tx.objectStore('books').put({...classic,id:'turn-qa',readingMode:'reflow'});tx.objectStore('preferences').put({id:'reader',value:{paper:'Paper',font:'Literata',size:18,spacing:'Normal',turn:mode,wideLayout:'spread',warmLight:false,restNudge:false,focusParagraph:false,colorNames:{yellow:'Ideas',green:'Agree',blue:'Quotes',pink:'Question'}}});tx.oncomplete=res;tx.onerror=()=>rej(tx.error);});db.close();
 },{classic,mode});
 await page.goto(origin+'/book/turn-qa');await page.locator('.reader').waitFor();await page.waitForTimeout(300);await page.locator('.pagination-status').waitFor({state:'hidden',timeout:90000});
 if(await page.locator('.reader-cover').count()){await page.getByRole('button',{name:'Open book',exact:true}).click();await page.locator('.reader-cover').waitFor({state:'hidden'});await page.waitForTimeout(100);}
 const initial=await page.locator('.footer-labels').innerText();
 const timings=[];
 await page.waitForTimeout(500);
 for(let i=0;i<6;i++){
 await page.evaluate(()=>{window.turnFrames=[];window.turnRunning=true;let prev=performance.now();function sample(now){window.turnFrames.push(now-prev);prev=now;if(window.turnRunning)requestAnimationFrame(sample);}requestAnimationFrame(sample);});
 await page.getByRole('button',{name:i%2?'Previous page':'Next page',exact:true}).first().click();
 await page.locator('.turning-leaf').waitFor();
 if(i<2){await page.waitForTimeout(80);await page.screenshot({path:`${out}/${label}-${i?'backward':'forward'}-mid.png`});}
 await page.locator('.turning-leaf').waitFor({state:'detached'});
 timings.push(await page.evaluate(()=>{window.turnRunning=false;return Math.max(...window.turnFrames.slice(2));}));
 }
 assert.equal(await page.locator('.footer-labels').innerText(),initial,'forward/backward restore passage');
 if(engine==='chromium' && process.env.QA_FRAME_BUDGET)assert.ok(timings.slice(2).every(ms=>ms<Number(process.env.QA_FRAME_BUDGET)),`repeated turns stay within the frame budget: ${timings}`);
 const initialText=await page.locator('.under-page .page-text').allTextContents();
 // Repeated clicks are accepted while a turn is already moving.
 await page.evaluate(()=>{const next=document.querySelector('button[aria-label="Next page"]');next.click();setTimeout(()=>next.click(),80);});
 await page.waitForTimeout(500);
 await page.locator('.turning-leaf').waitFor({state:'detached',timeout:10000});
 assert.equal(await page.locator('.turning-leaf').count(),0,'repeated presses settle');
 assert.notDeepEqual(await page.locator('.under-page .page-text').allTextContents(),initialText);

 // A real pointer drag on the page margin follows the pointer without React work per move.
 const bounds=await page.locator('.book-box').boundingBox();
 const x=bounds.x+bounds.width-12,y=bounds.y+bounds.height/2;
 if(phone && engine==='chromium'){
  const cdp=await page.context().newCDPSession(page);
  const before=await page.locator('.under-page .page-text').allTextContents();
  await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y}]});
  for(let i=1;i<=12;i++)await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:x-bounds.width*.6*i/12,y}]});
  await page.locator('.turning-leaf').waitFor();
  await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
  await page.waitForTimeout(50);
  await page.locator('.turning-leaf').waitFor({state:'detached'});
  assert.notDeepEqual(await page.locator('.under-page .page-text').allTextContents(),before,'touch swipe advances');
  await cdp.detach();
 }

 await page.mouse.move(x,y);await page.mouse.down();await page.mouse.move(x-60,y,{steps:5});
 await page.locator('.turning-leaf').waitFor();
 const pose1=await page.locator('.turning-leaf').evaluate(el=>el.style.transform);
 await page.mouse.move(x-bounds.width*.4,y,{steps:12});
 const pose2=await page.locator('.turning-leaf').evaluate(el=>el.style.transform);
 assert.notEqual(pose1,pose2,'drag tracks the pointer');
 await page.screenshot({path:`${out}/${label}-drag.png`});
 await page.mouse.up();await page.locator('.turning-leaf').waitFor({state:'detached'});
 // Cancellation rolls back even past the normal commit threshold.
 const beforeCancel=await page.locator('.under-page .page-text').allTextContents();
 await page.mouse.move(x,y);await page.mouse.down();await page.mouse.move(x-bounds.width*.4,y,{steps:8});await page.locator('.turning-leaf').waitFor();
 await page.locator('.book-box').dispatchEvent('pointercancel');await page.mouse.up();await page.locator('.turning-leaf').waitFor({state:'detached'});
 assert.deepEqual(await page.locator('.under-page .page-text').allTextContents(),beforeCancel,'canceled gesture retains passage');
 await page.emulateMedia({reducedMotion:'reduce'});
 await page.getByRole('button',{name:'Next page',exact:true}).first().click();await page.waitForTimeout(250);assert.equal(await page.locator('.turning-leaf').count(),0);
 assert.deepEqual(errors,[]);
 results.push({label,maxFrameGaps:timings});console.log('PASS',label,JSON.stringify(timings));
 await page.close();
 }}finally{await browser.close();}
}
fs.writeFileSync(`${out}/results.json`,JSON.stringify(results,null,2));
