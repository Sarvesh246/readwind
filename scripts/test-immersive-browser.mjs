import { chromium, webkit } from '@playwright/test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const origin = process.env.READWIND_TEST_ORIGIN || 'http://127.0.0.1:5173';
const out = 'work/immersive-qa'; fs.mkdirSync(out, { recursive: true });
const classic = JSON.parse(fs.readFileSync('lib/readwind/classics.json', 'utf8'))[0];
const devices = [
  ['iphone-15-pro', 393, 852, 59, 34], ['iphone-se', 375, 667, 20, 0],
  ['small-phone', 320, 568, 20, 0], ['compact-phone', 360, 780, 44, 34],
  ['tall-phone', 412, 915, 24, 24], ['large-iphone', 430, 932, 59, 34],
];
const results = [];
const settled = page => page.locator('.pagination-status').waitFor({ state: 'hidden', timeout: 90000 });
async function metrics(page) {
  return page.evaluate(() => {
    const r = document.querySelector('.book-box').getBoundingClientRect();
    const texts = [...document.querySelectorAll('.under-page .page-text')];
    return { box: { x:r.x, y:r.y, width:r.width, height:r.height },
      textArea: texts.reduce((n,e) => n + e.clientWidth * e.clientHeight, 0),
      fontSizes: texts.map(e => getComputedStyle(e).fontSize), columns: texts.length,
      clipping: texts.filter(e => e.scrollHeight > e.clientHeight + 2).length,
      overflow: document.documentElement.scrollWidth > innerWidth + 1 };
  });
}
async function tap(page, rel) {
  const b = await page.locator('.book-box').boundingBox();
  await page.touchscreen.tap(b.x + b.width * rel, b.y + b.height / 2);
}
async function turn(page, dir) {
  await page.locator('.book-root').focus();
  await page.keyboard.press(dir>0?'ArrowRight':'ArrowLeft');
  await page.locator('.turning-leaf').waitFor({ state: 'detached' });
}
for (const [engine,type] of [['chromium',chromium],['webkit',webkit]]) {
  if (process.env.QA_ENGINE && process.env.QA_ENGINE !== engine) continue;
  const browser = await type.launch();
  try { for (const [name,w,h,top,bottom] of devices) {
    if (process.env.QA_DEVICE && process.env.QA_DEVICE !== name) continue;
    for (const landscape of [false,true]) {
      const label = `${engine}-${name}-${landscape?'landscape':'portrait'}`;
      console.log('START',label);
      const viewport = landscape ? {width:h,height:w} : {width:w,height:h};
      const page = await browser.newPage({viewport,hasTouch:true,isMobile:true,deviceScaleFactor:3});
      const errors=[]; page.on('pageerror',e=>errors.push(e.message));
      await page.route('**/api/config',r=>r.fulfill({json:{authUrl:null}}));
      // Exercise the iPhone's CSS fullscreen fallback.
      await page.addInitScript(()=>{Element.prototype.requestFullscreen=undefined;});
      await page.goto(origin);
      await page.getByRole('button',{name:'Add the classics',exact:true}).click();
      await page.getByRole('button',{name:'Read Walden',exact:true}).first().waitFor();
      await page.evaluate(async classic=>{
        const db=await new Promise((resolve,reject)=>{const r=indexedDB.open('folio-preview');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
        await new Promise((resolve,reject)=>{const tx=db.transaction(['books','preferences'],'readwrite');
          tx.objectStore('books').put({...classic,id:'immersive-qa',readingMode:'reflow'});
          tx.objectStore('preferences').put({id:'reader',value:{paper:'Paper',font:'Literata',size:18,spacing:'Normal',turn:'Curl',wideLayout:'spread',warmLight:false,restNudge:false,focusParagraph:false,colorNames:{yellow:'Ideas',green:'Agree',blue:'Quotes',pink:'Question'}}});
          tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);});db.close();
      },classic);
      await page.goto(origin+'/book/immersive-qa');await page.locator('.reader').waitFor();await settled(page);
      if(await page.locator('.reader-cover').count()){
        await page.getByRole('button',{name:'Open book',exact:true}).click();
        await page.locator('.reader-cover').waitFor({state:'hidden'});
      }
      // Emulators don't expose physical notches: model safe insets separately.
      const insets=landscape?[0,bottom?top:0,bottom?21:0,bottom?top:0]:[top,0,bottom,0];
      await page.addStyleTag({content:`.reader{${['top','right','bottom','left'].map((s,i)=>`--reader-safe-${s}:${insets[i]}px`).join(';')}}`});
      await page.getByRole('button',{name:'Full screen',exact:true}).click();
      await page.locator('.immersive-reader').waitFor();await settled(page);
      await page.locator('.controls-hidden').waitFor();await page.waitForTimeout(200);
      // The first spread intentionally opens the chapter on a right-hand page.
      // Check a full spread of body text as well as its chapter opening.
      await page.screenshot({path:`${out}/${label}-opening.png`});
      await turn(page,1);
      const before=await metrics(page);
      assert.equal(before.overflow,false,label+' fits viewport');assert.equal(before.clipping,0,label+' text fits');
      assert.ok(before.fontSizes.every(s=>s==='18px'),label+' keeps font size');
      assert.equal(before.columns,landscape?2:1,label+' columns');
      assert.ok(before.box.x>=insets[3]&&before.box.y>=insets[0],label+' notch');
      assert.ok(before.box.y+before.box.height<=viewport.height-insets[2]+1,label+' home indicator');
      await page.screenshot({path:`${out}/${label}.png`});
      if(await page.locator('.controls-hidden').count())await tap(page,.5);
      await page.getByRole('button',{name:'Type and comfort settings',exact:true}).waitFor();
      assert.deepEqual((await metrics(page)).box,before.box,label+' controls do not repaginate');
      const toolsOutside=await page.locator('.reader-bottom-tools button').evaluateAll(buttons=>buttons.some(e=>{const r=e.getBoundingClientRect();return r.left<0||r.right>innerWidth+1||r.bottom>innerHeight+1;}));
      assert.equal(toolsOutside,false,label+' toolbar fits');
      await page.getByRole('button',{name:'Type and comfort settings',exact:true}).click();
      await page.getByRole('button',{name:'Done',exact:true}).click();
      await tap(page,.5);await page.locator('.controls-hidden').waitFor();
      const initial=await page.locator('.under-page .page-text').allTextContents();
      await turn(page,1);assert.notDeepEqual(await page.locator('.under-page .page-text').allTextContents(),initial,label+' advances');
      await turn(page,-1);assert.deepEqual(await page.locator('.under-page .page-text').allTextContents(),initial,label+' returns');
      assert.equal(await page.locator('.controls-hidden').count(),1,label+' turns keep chrome hidden');
      await page.evaluate(()=>{window.qaFrames=[];window.qaSampling=true;let last=performance.now();const frame=now=>{window.qaFrames.push(now-last);last=now;if(window.qaSampling)requestAnimationFrame(frame);};requestAnimationFrame(frame);});
      await turn(page,1);await turn(page,-1);
      const frames=await page.evaluate(()=>{window.qaSampling=false;return window.qaFrames.slice(2);});
      const sorted=frames.toSorted((a,b)=>a-b),p95FrameMs=sorted[Math.floor(sorted.length*.95)];
      if(engine==='chromium')assert.ok(p95FrameMs<34,label+' repeated flips meet the frame budget');
      assert.equal((await metrics(page)).clipping,0);
      if(name==='iphone-15-pro'&&!landscape){
        // Cancel a real drag without losing the passage, then rotate during a turn.
        const b=await page.locator('.book-box').boundingBox(),x=b.x+b.width-6,y=b.y+b.height/2;
        await page.mouse.move(x,y);await page.mouse.down();await page.mouse.move(x-b.width*.4,y,{steps:8});
        await page.locator('.turning-leaf').waitFor();
        const animated=await page.locator('.turning-leaf').evaluate(e=>getComputedStyle(e).transformStyle);
        assert.equal(animated,'preserve-3d',label+' keeps the 3D leaf');
        await page.screenshot({path:`${out}/${label}-flip.png`});
        await page.locator('.book-box').dispatchEvent('pointercancel');await page.mouse.up();
        await page.locator('.turning-leaf').waitFor({state:'detached'});
        assert.deepEqual(await page.locator('.under-page .page-text').allTextContents(),initial,label+' canceled drag preserves passage');
        await turn(page,1);await page.setViewportSize({width:h,height:250});
        await page.waitForTimeout(300);await settled(page);await page.locator('.turning-leaf').waitFor({state:'detached'});
        await page.screenshot({path:`${out}/${label}-short-landscape.png`});
        const short=await metrics(page);assert.equal(short.clipping,0,label+' short browser viewport');
        assert.ok(short.box.y+short.box.height<=250,label+' short browser page fits');
        await page.setViewportSize(viewport);await page.waitForTimeout(300);await settled(page);
        await page.emulateMedia({reducedMotion:'reduce'});
        await turn(page,1);assert.equal(await page.locator('.turning-leaf').count(),0,label+' reduced motion settles');
        await page.emulateMedia({reducedMotion:'no-preference'});
        await tap(page,.5);
        if(await page.locator('.controls-hidden').count())await tap(page,.5);
        await page.getByRole('button',{name:'Type and comfort settings',exact:true}).click();
        await page.getByRole('button',{name:'Night',exact:true}).click();
        await page.getByRole('button',{name:'Larger text',exact:true}).click({clickCount:2});
        await page.getByRole('button',{name:'Airy',exact:true}).click();
        await page.getByRole('button',{name:'Done',exact:true}).click();
        await settled(page);await tap(page,.5);await page.waitForTimeout(200);
        assert.equal((await metrics(page)).clipping,0,label+' large type and night theme');
        await page.screenshot({path:`${out}/${label}-night.png`});
      }
      await page.keyboard.press('Tab');await page.getByRole('button',{name:'Exit full screen',exact:true}).waitFor();
      await page.getByRole('button',{name:'Exit full screen',exact:true}).click();
      await page.locator('.reader.is-full').waitFor({state:'hidden'});
      assert.deepEqual(errors,[],label+' runtime errors');
      results.push({label,viewport,simulatedSafeInsets:insets,...before,p95FrameMs,maxFrameMs:Math.max(...frames)});
      console.log('PASS',label,'p95',p95FrameMs.toFixed(1),'ms');await page.close();
    }
  }} finally {await browser.close();}
}
const suffix=[process.env.QA_ENGINE,process.env.QA_DEVICE].filter(Boolean).join('-');
fs.writeFileSync(`${out}/results${suffix?'-'+suffix:''}.json`,JSON.stringify(results,null,2));
