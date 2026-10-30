import {chromium,webkit} from '@playwright/test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const origin=process.env.READWIND_TEST_ORIGIN||'http://127.0.0.1:5173';
const output='work/pace-qa';fs.mkdirSync(output,{recursive:true});
for(const [name,type] of [['chromium',chromium],['webkit',webkit]]){
  const browser=await type.launch();try{
    const page=await browser.newPage({viewport:{width:390,height:844},reducedMotion:'reduce'});
    const errors=[];page.on('pageerror',e=>errors.push(e.message));
    await page.route('**/api/config',r=>r.fulfill({json:{authUrl:null}}));
    await page.goto(origin);await page.getByRole('heading',{name:'Your shelf'}).waitFor();
    await page.evaluate(async()=>{
      localStorage.setItem('folio-device','pace-device');
      const db=await new Promise(resolve=>{const r=indexedDB.open('folio-preview');r.onsuccess=()=>resolve(r.result);});
      const words=Array(230).fill('reading').join(' '), now=Date.now();
      const at={section:0,block:1,offset:0};
      const book={id:'pace-book',title:'Pace Test Book',author:'Test',cover:{kind:'typeset',color:'#333333',fg:'#ffffff'},addedAt:now,lastOpenedAt:now,printPageCount:4,sections:[0,1].map(i=>({id:`s${i}`,title:`Chapter ${i+1}`,heading:true,blocks:[{type:'p',text:words},{type:'p',text:words}]})),pageMarks:[0,1,2,3].map(i=>({label:String(i+1),index:i,at:{section:Math.floor(i/2),block:i%2,offset:0}}))};
      await new Promise((resolve,reject)=>{const tx=db.transaction(['books','progress','preferences'],'readwrite');tx.objectStore('books').put(book);tx.objectStore('progress').put({bookId:book.id,at,wordsRead:230,revision:0,deviceId:'pace-device',updatedAt:now});tx.objectStore('preferences').put({id:'reader',value:{paper:'Paper',font:'Literata',size:18,spacing:'Normal',turn:'Slide',wideLayout:'single',warmLight:false,restNudge:false,focusParagraph:false,colorNames:{yellow:'Ideas',green:'Agree',blue:'Quotes',pink:'Question'},readingPace:{'pace-device':{samples:120,words:14400,seconds:7200}}}});tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);});db.close();
    });
    await page.reload();await page.locator('.continue-copy h1').filter({hasText:'Pace Test Book'}).waitFor();
    assert.match(await page.locator('.continue-progress').innerText(),/6 min left in book/);
    assert.match(await page.locator('.shelf-item').filter({hasText:'Pace Test Book'}).innerText(),/25%.*6 min left/s);
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false);
    await page.screenshot({path:`${output}/${name}-dashboard.png`});
    await page.getByRole('button',{name:'Resume',exact:true}).click();
    await page.locator('.pagination-status').waitFor({state:'hidden',timeout:60000});
    if(await page.locator('.reader-cover').count())await page.getByRole('button',{name:'Open book',exact:true}).click();
    await page.getByText(/min left in chapter/).waitFor();
    await page.clock.install();await page.clock.fastForward(60000);
    await page.keyboard.press('ArrowRight');
    await page.waitForFunction(async()=>{
      const db=await new Promise(resolve=>{const r=indexedDB.open('folio-preview');r.onsuccess=()=>resolve(r.result);});
      const entry=await new Promise(resolve=>{const r=db.transaction('preferences').objectStore('preferences').get('reader');r.onsuccess=()=>resolve(r.result);});db.close();return entry.value.readingPace['pace-device'].samples>120;
    });
    await page.reload();await page.locator('.pagination-status').waitFor({state:'hidden',timeout:60000});
    assert.deepEqual(errors,[]);console.log(`PASS ${name}: full-book dashboard estimate, chapter footer, timed page-turn learning, persisted pace`);
  }finally{await browser.close();}
}
