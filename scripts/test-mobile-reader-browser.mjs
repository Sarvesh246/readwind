import assert from 'node:assert/strict';
import fs from 'node:fs';
import {chromium, webkit} from '@playwright/test';
const origin=process.env.READWIND_TEST_ORIGIN || 'http://127.0.0.1:5173';
const out='work/mobile-reader-qa';fs.mkdirSync(out,{recursive:true});
const classic=JSON.parse(fs.readFileSync('lib/readwind/classics.json','utf8'))[0];
const settled=async page=>{await page.waitForTimeout(350);await page.locator('.pagination-status').waitFor({state:'hidden',timeout:90000});await page.locator('.turning-leaf').waitFor({state:'detached'});};
for(const [engine,type] of [['chromium',chromium],['webkit',webkit]]) {
 if(process.env.QA_ENGINE && process.env.QA_ENGINE!==engine)continue;
 const browser=await type.launch();
 try {
 for(const mode of ['Curl','Slide']) {
 if(process.env.QA_MODE && process.env.QA_MODE!==mode)continue;
 const page=await browser.newPage({viewport:{width:393,height:760},hasTouch:true,isMobile:true});
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/api/config',r=>r.fulfill({json:{authUrl:null}}));
 await page.addInitScript(()=>{Element.prototype.requestFullscreen=undefined;});
 await page.goto(origin);await page.getByRole('button',{name:'Add the classics',exact:true}).click();
 await page.getByRole('button',{name:'Read Walden',exact:true}).first().waitFor();
 await page.evaluate(async({classic,mode})=>{
 const db=await new Promise((res,rej)=>{const r=indexedDB.open('folio-preview');r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error);});
 await new Promise((res,rej)=>{const tx=db.transaction(['books','preferences'],'readwrite');
 tx.objectStore('books').put({...classic,id:'mobile-ui-qa',readingMode:'reflow',sourcePdfBlobId:'qa-pdf'});
 tx.objectStore('preferences').put({id:'reader',value:{paper:'Dusk',font:'Literata',size:18,spacing:'Normal',turn:mode,wideLayout:'spread',warmLight:false,restNudge:false,focusParagraph:false,colorNames:{yellow:'Ideas',green:'Agree',blue:'Quotes',pink:'Question'}}});tx.oncomplete=res;tx.onerror=()=>rej(tx.error);});db.close();
 },{classic,mode});
 await page.goto(origin+'/book/mobile-ui-qa');await page.locator('.reader').waitFor();await settled(page);
 if(await page.locator('.reader-cover').count()){await page.getByRole('button',{name:'Open book',exact:true}).click();await page.locator('.reader-cover').waitFor({state:'hidden'});await settled(page);}
 for(const viewport of [{width:393,height:760},{width:852,height:393},{width:320,height:568},{width:740,height:320}]) {
 if(process.env.QA_WIDTH && Number(process.env.QA_WIDTH)!==viewport.width)continue;
 await page.setViewportSize(viewport);await settled(page);
 for(const full of [false,true]) {
 if(full){await page.getByRole('button',{name:'Full screen',exact:true}).click();await settled(page);}
 const wake=async()=>{if(await page.locator('.controls-hidden').count()){const b=await page.locator('.book-box').boundingBox();await page.touchscreen.tap(b.x+b.width/2,b.y+b.height/3);}};
 await wake();
 const label=`${engine}-${mode}-${viewport.width}x${viewport.height}-${full?'full':'normal'}`;
 const issues=await page.evaluate(()=>{
 const errs=[],rect=s=>document.querySelector(s).getBoundingClientRect(),f=rect('.book-footer'),t=rect('.reader-bottom-tools'),b=rect('.book-box');
 const overlap=(a,b)=>a.left<b.right&&a.right>b.left&&a.top<b.bottom&&a.bottom>b.top;
 if(overlap(f,t))errs.push('footer overlaps toolbar');
 if(!document.querySelector('.is-full')&&(overlap(b,f)||overlap(b,t)))errs.push('controls overlap paper');
 if(parseFloat(getComputedStyle(document.querySelector('.footer-labels')).fontSize)<13)errs.push('small progress text');
 for(const el of document.querySelectorAll('.reader-controls button')){const r=el.getBoundingClientRect();if(r.width<44||r.height<32||r.left<0||r.right>innerWidth+1||r.bottom>innerHeight+1)errs.push('bad control bounds '+el.getAttribute('aria-label')+JSON.stringify(r));}
 for(const el of document.querySelectorAll('.under-page .page-text'))if(el.scrollHeight>el.clientHeight+2)errs.push('clipped passage');
 if(document.documentElement.scrollWidth>innerWidth+1)errs.push('horizontal overflow');
 return errs;
 });assert.deepEqual(issues,[],label);
 await page.screenshot({path:`${out}/${label}.png`});
 const passage=()=>page.locator('.under-page .page-text').allTextContents();
 const before=await passage(),b=await page.locator('.book-box').boundingBox();
 for(const rel of [.08,.5,.92]){await page.touchscreen.tap(b.x+b.width*rel,b.y+b.height*.35);await page.waitForTimeout(100);assert.deepEqual(await passage(),before,label+' taps preserve passage');}
 await wake();
 // Selection remains on this passage and opens the highlight toolbar.
 await page.locator('.under-page .page-text [data-offset]').first().evaluate(el=>{const r=document.createRange();r.selectNodeContents(el);const s=getSelection();s.removeAllRanges();s.addRange(r);});
 await page.locator('.book-root').dispatchEvent('mouseup');
 await page.getByRole('button',{name:'Dismiss selection',exact:true}).waitFor();
 assert.deepEqual(await passage(),before,label+' selection preserves passage');
 await page.getByRole('button',{name:'Dismiss selection',exact:true}).click();
 await wake();await page.getByRole('button',{name:'Next page',exact:true}).click();await settled(page);
 assert.notDeepEqual(await passage(),before,label+' explicit next turns');
 if(engine==='chromium') {
 const cdp=await page.context().newCDPSession(page);
 const swipe=async(dx,dy,hold=0,cancel=false)=>{const b=await page.locator('.book-box').boundingBox(),x=b.x+b.width*.7,y=b.y+b.height*.45;await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y}]});if(hold)await page.waitForTimeout(hold);for(let i=1;i<=8;i++)await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:x+dx*i/8,y:y+dy*i/8}]});await cdp.send('Input.dispatchTouchEvent',{type:cancel?'touchCancel':'touchEnd',touchPoints:[]});await settled(page);};
 const initial=await passage();await swipe(-80,0);assert.notDeepEqual(await passage(),initial,label+' short intentional swipe turns');
 const next=await passage();await swipe(-12,2);assert.deepEqual(await passage(),next,label+' jitter does not turn');
 await swipe(-70,0,500);assert.deepEqual(await passage(),next,label+' long press does not turn');
 await swipe(-80,0,0,true);assert.deepEqual(await passage(),next,label+' cancellation does not turn');
 const r=await page.locator('.book-box').boundingBox(),x=r.x+r.width*.6,y=r.y+r.height*.4;
 await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y}]});
 await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:x-60,y}]});
 await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:x+60,y}]});
 await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await settled(page);
 assert.deepEqual(await passage(),next,label+' reversing a swipe cancels the turn');
 await cdp.detach();
 }
 if(full){await wake();await page.getByRole('button',{name:'Exit full screen',exact:true}).click();await settled(page);}
 console.log('PASS',label);
 }
 }
 assert.deepEqual(errors,[],engine+' runtime');await page.close();
 }
 } finally {await browser.close();}
}
