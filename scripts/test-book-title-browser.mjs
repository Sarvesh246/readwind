import {chromium,webkit} from '@playwright/test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const origin=process.env.READWIND_TEST_ORIGIN||'http://127.0.0.1:5173';
const titles=['Ultralearning','The Psychology of Money','Man’s Search for Meaning','I Will Teach You to Be Rich: Second Edition — No Guilt. No Excuses. No BS. Just a Six-Week Program That Works','A Very Long Book Title With Many Ordinary Words That Must All Remain Visible and Readable Without Being Truncated or Escaping the Card','ExtraordinarilyLongUnbrokenBookTitle'.repeat(4)];
fs.mkdirSync('work/title-qa',{recursive:true});
for(const [engine,type]of [['chromium',chromium],['webkit',webkit]]){
 const browser=await type.launch();try{
  const page=await browser.newPage({viewport:{width:390,height:844}}),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.route('**/api/config',r=>r.fulfill({json:{authUrl:null}}));await page.goto(origin);await page.getByRole('heading',{name:'Your shelf'}).waitFor();
  for(const [index,title]of titles.entries()){
   await page.evaluate(async title=>{
    const db=await new Promise(resolve=>{const r=indexedDB.open('folio-preview');r.onsuccess=()=>resolve(r.result);});
    const book={id:'title-fit',title,author:'A Reader',addedAt:Date.now(),lastOpenedAt:Date.now()+60000,cover:{kind:'typeset',color:'#294636',fg:'#fff'},printPageCount:1,pageMarks:[{index:0,label:'1',at:{section:0,block:0,offset:0}}],sections:[{id:'s',title:'Opening',heading:true,blocks:[{type:'p',text:'Every book title should remain readable and complete inside its card at every screen width.'}]}]};
    await new Promise(resolve=>{const tx=db.transaction('books','readwrite');tx.objectStore('books').put(book);tx.oncomplete=resolve;});db.close();
   },title);await page.reload();await page.locator('.continue-copy h1').filter({hasText:title}).waitFor();await page.evaluate(()=>document.fonts.ready);
   // Resize the same mounted heading in both directions to exercise the observer.
   for(const width of [390,320,430,768,1440,390]){
    await page.setViewportSize({width,height:844});await page.waitForFunction(()=>{const t=document.querySelector('.continue-copy h1');return t?.style.fontSize && t.scrollWidth<=t.clientWidth+1;});
    await page.waitForTimeout(70);
    const result=await page.evaluate(()=>{
     const t=document.querySelector('.continue-copy h1'),copy=t.parentElement,card=t.closest('.continue-card'),r=t.getBoundingClientRect(),c=card.getBoundingClientRect(),css=getComputedStyle(t);
     const range=document.createRange();range.selectNodeContents(t);
     return {text:t.textContent,size:parseFloat(css.fontSize),wrap:css.overflowWrap,overflow:t.scrollWidth>t.clientWidth+1||document.documentElement.scrollWidth>innerWidth+1,inside:[...range.getClientRects()].every(x=>x.left>=c.left&&x.right<=c.right),overlap:r.bottom>copy.querySelector('.chapter-label').getBoundingClientRect().top+1};
    });assert.equal(result.text,title);assert.equal(result.overflow,false,`${engine} ${width} ${title}`);assert.equal(result.inside,true);assert.equal(result.overlap,false);assert.ok(result.size>=17.9);
    if(index<5)assert.equal(result.wrap,'normal','ordinary words stay whole');
    if(width===390&&index<4)await page.screenshot({path:`work/title-qa/${engine}-${index}-phone.png`});
   }
  }
  assert.deepEqual(errors,[]);console.log(`PASS ${engine}: complete titles, whole-word wrapping, readable sizing, extreme words and live resizing at 320–1440px`);
 }finally{await browser.close();}
}
