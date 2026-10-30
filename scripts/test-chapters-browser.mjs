import {chromium,webkit} from '@playwright/test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {contentsPdf,chapterTitles} from '../tests/fixtures/contents-pdf.mjs';
const origin=process.env.READWIND_TEST_ORIGIN||'http://127.0.0.1:5173',out='work/chapter-qa';fs.mkdirSync(out,{recursive:true});
for(const [engine,type] of [['chromium',chromium],['webkit',webkit]]){
 if(process.env.QA_ENGINE&&process.env.QA_ENGINE!==engine)continue;
 const browser=await type.launch();try{
 for(const [device,width,theme] of [['desktop',1440,'light'],['phone',390,'dark'],['small-phone',320,'light']]){
  if(process.env.QA_DEVICE&&process.env.QA_DEVICE!==device)continue;
  console.log('START chapters',engine,device);
  const page=await browser.newPage({viewport:{width,height:1000},reducedMotion:'reduce'}),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(theme=>localStorage.setItem('readwind-theme',theme),theme);await page.route('**/api/config',r=>r.fulfill({json:{authUrl:null}}));await page.goto(origin+'/import');
  await page.locator('input[type=file]').first().setInputFiles({name:'journeys.pdf',mimeType:'application/pdf',buffer:contentsPdf()});await page.locator('.chapter-edit').first().waitFor({timeout:120000});
  assert.equal(await page.locator('.chapter-edit').count(),14);
  for(let i=0;i<chapterTitles.length;i++)assert.equal(await page.getByRole('textbox',{name:`Chapter ${i+3} title`,exact:true}).inputValue(),chapterTitles[i]);
  const overlaps=await page.locator('.chapter-edit').evaluateAll(rows=>rows.flatMap((row,i)=>{
    const parts=[row.querySelector('.chapter-edit-main'),row.querySelector('.chapter-edit-actions'),row.querySelector('details')].map(el=>el.getBoundingClientRect());
    const field=row.querySelector('.chapter-title');return parts.some((r,n)=>n&&r.top<parts[n-1].bottom-1)||field.scrollHeight>field.clientHeight+1?[i]:[];
  }));assert.deepEqual(overlaps,[]);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false);
  await page.locator('.chapter-review').screenshot({path:`${out}/${engine}-${device}-review.png`});
  await page.getByRole('button',{name:/^Original layout/}).click();await page.getByRole('button',{name:'Create book',exact:true}).click();await page.waitForURL(/\/book\//);
  await page.getByRole('button',{name:'Contents and go to page',exact:true}).click();await page.getByRole('searchbox',{name:'Search chapters'}).fill('Chapter 11:');await page.getByRole('navigation',{name:'Chapters'}).getByRole('button').click();await page.getByRole('img',{name:'Original PDF page 13',exact:true}).waitFor();
  await page.getByRole('button',{name:'Contents and go to page',exact:true}).click();await page.getByRole('textbox',{name:'Printed page',exact:true}).fill('PDF 2');await page.getByRole('button',{name:'Go',exact:true}).click();
  await page.getByRole('button',{name:'Go to PDF page 3',exact:true}).first().click();await page.getByRole('img',{name:'Original PDF page 3',exact:true}).waitFor();
  await page.getByRole('button',{name:'Adjustable text',exact:true}).click();await page.locator('.pagination-status').waitFor({state:'hidden',timeout:60000});
  if(await page.locator('.reader-cover').count())await page.getByRole('button',{name:'Open book',exact:true}).click();
  const openContents=async()=>{try{await page.getByRole('button',{name:/^Contents(?: and go to page)?$/}).first().click({timeout:5000});}catch(e){console.log('CHAPTER NAV FAILURE',await page.locator('body').innerText(),errors);await page.screenshot({path:`${out}/${engine}-${device}-failure.png`});throw e;}};
  for(const mode of ['Curl','Slide','Scroll']){
    await page.getByRole('button',{name:'Type and comfort settings',exact:true}).first().click();await page.getByRole('button',{name:mode,exact:true}).click();await page.getByRole('button',{name:'Done',exact:true}).click();await page.locator('.pagination-status').waitFor({state:'hidden',timeout:60000});
    await openContents();await page.getByRole('searchbox',{name:'Search chapters'}).fill('Chapter 11:');await page.getByRole('navigation',{name:'Chapters'}).getByRole('button').click();
    await page.waitForFunction(()=>document.querySelector('.reader-title')?.textContent.includes('Chapter 11:'),null,{timeout:5000}).catch(async e=>{console.log('JUMP FAILURE',mode,await page.locator('body').innerText());await page.screenshot({path:`${out}/${engine}-${device}-jump-failure.png`});throw e;});
    if(mode==='Scroll')await page.waitForFunction(()=>{const root=document.querySelector('.continuous-reader'),heading=[...document.querySelectorAll('.continuous-chapter')].find(h=>h.textContent.includes('Chapter 11:'));return root&&heading&&Math.abs(heading.getBoundingClientRect().top-root.getBoundingClientRect().top-36)<3;});
    await openContents();await page.getByRole('searchbox',{name:'Search chapters'}).fill('Contents');await page.getByRole('navigation',{name:'Chapters'}).getByRole('button').click();
    const link=page.getByRole('button',{name:chapterTitles[0],exact:true}).first();await link.focus();await page.keyboard.press('Enter');await page.waitForFunction(()=>document.querySelector('.reader-title')?.textContent.includes('Chapter 1:'));
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false);
  }
  assert.deepEqual(errors,[]);console.log('PASS chapters',engine,device,'wrapped names, editor layout, original links, search and navigation in Curl/Slide/Scroll');await page.close();
 }
 }finally{await browser.close();}
}
