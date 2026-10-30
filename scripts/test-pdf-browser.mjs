import {createPdfFixture,body} from '../tests/fixtures/pdf.mjs';
import {chromium,webkit} from '@playwright/test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
const origin=process.env.READWIND_TEST_ORIGIN||'http://127.0.0.1:5173';
const output=path.resolve(process.env.READWIND_QA_OUTPUT||'work/reader-qa');fs.mkdirSync(output,{recursive:true});
const fixture=createPdfFixture(output);
for(const [engine,type]of [['chromium',chromium],['webkit',webkit]]){
if(process.env.QA_ENGINE&&process.env.QA_ENGINE!==engine)continue;
const browser=await type.launch();try{
for(const [device,viewport]of [['desktop',{width:1440,height:1000}],['phone',{width:390,height:844}],['small-phone',{width:320,height:740}]]){
 if(process.env.QA_DEVICE&&process.env.QA_DEVICE!==device)continue;
 console.log('START PDF',engine,device);
 const page=await browser.newPage({viewport,hasTouch:device==='phone'});const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.route('**/api/config',r=>r.fulfill({json:{authUrl:null}}));await page.goto(origin+'/import');await page.locator('input[type="file"]').setInputFiles(fixture);await page.locator('.chapter-edit').first().waitFor({timeout:60000});
 await page.getByRole('button',{name:'Create book',exact:true}).click();await page.waitForURL(/\/book\//,{waitUntil:'domcontentloaded'}).catch(async e=>{console.log('IMPORT FAILED',await page.locator('body').innerText(),errors);await page.screenshot({path:path.join(output,`${engine}-${device}-import-error.png`)});throw e;});await page.locator('.pdf-sheet canvas').first().waitFor();await page.locator('.pdf-page-status').first().waitFor({state:'hidden'});
 const metadata=await page.evaluate(async()=>{const db=await new Promise(res=>{const r=indexedDB.open('folio-preview');r.onsuccess=()=>res(r.result);});const books=await new Promise(res=>{const r=db.transaction('books').objectStore('books').getAll();r.onsuccess=()=>res(r.result)});db.close();return books.find(b=>b.sourcePdfBlobId);});assert.equal(metadata.printPageCount,4);assert.ok(metadata.sections.every(s=>s.blocks.every(b=>!b.text?.includes('[No readable text'))));
 await page.getByRole('button',{name:'Contents and go to page'}).click();await page.getByRole('spinbutton').fill('3');await page.getByRole('button',{name:'Go',exact:true}).click();await page.getByRole('img',{name:'Original PDF page 3',exact:true}).waitFor();await page.locator('.pdf-page-status').first().waitFor({state:'hidden'});
 await page.getByRole('button',{name:'Bookmark page',exact:true}).click();await page.getByRole('button',{name:'Remove bookmark',exact:true}).waitFor();
 await page.locator('.readwind-pdf-text span').filter({hasText:body}).first().evaluate(el=>{const range=document.createRange();range.selectNodeContents(el);getSelection().removeAllRanges();getSelection().addRange(range);});await page.locator('.pdf-reading-area').dispatchEvent('mouseup');await page.getByRole('button',{name:'Note',exact:true}).click();await page.getByRole('textbox',{name:'Note for this passage'}).fill('A note on the original PDF.');await page.getByRole('button',{name:'Save note',exact:true}).click();await page.locator('.pdf-highlight').first().waitFor();
 await page.getByRole('button',{name:'Type and comfort settings'}).click();await page.getByRole('button',{name:'Dusk',exact:true}).click();await page.getByRole('button',{name:'Done',exact:true}).click();await page.screenshot({path:path.join(output,`${engine}-${device}-original.png`)});
 const over=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1);assert.equal(over,false);await page.reload();await page.getByRole('img',{name:'Original PDF page 3',exact:true}).waitFor();await page.locator('.pdf-highlight').first().waitFor();
 await page.getByRole('button',{name:'Adjustable text',exact:true}).click();await page.locator('.reader').waitFor();await page.locator('.pagination-status').waitFor({state:'hidden',timeout:60000});if(await page.locator('.reader-cover').count()){await page.getByRole('button',{name:'Open book',exact:true}).click();await page.locator('.reader-cover').waitFor({state:'hidden'});}
 if(device==='desktop'){await page.getByRole('button',{name:'Original PDF',exact:true}).click();await page.locator('.original-pdf-preview canvas').waitFor();await page.locator('.original-pdf-preview .pdf-page-status').waitFor({state:'hidden'});assert.equal(await page.locator('iframe').count(),0,'original PDF is rendered without an active document');await page.getByRole('button',{name:'Close dialog',exact:true}).click();}
 assert.equal(await page.getByText('[No readable text',{exact:false}).count(),0);await page.screenshot({path:path.join(output,`${engine}-${device}-imported-reflow.png`)});assert.deepEqual(errors,[]);console.log(`PASS: ${engine} ${device} PDF import, blank pages, text, notes, bookmarks, retrieval after reload, theme, reflow.`);await page.close();
}
}finally{await browser.close();}}
