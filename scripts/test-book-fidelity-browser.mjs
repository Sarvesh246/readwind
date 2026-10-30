import {chromium,webkit} from '@playwright/test';
import assert from 'node:assert/strict';
import {fidelityPdf} from '../tests/fixtures/fidelity-pdf.mjs';
const origin=process.env.READWIND_TEST_ORIGIN||'http://127.0.0.1:5173';
for(const [name,type]of [['chromium',chromium],['webkit',webkit]]){
 const browser=await type.launch();try{
  const page=await browser.newPage({viewport:{width:390,height:844},reducedMotion:'reduce'}),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.route('**/api/config',r=>r.fulfill({json:{authUrl:null}}));await page.goto(origin+'/import');
  await page.locator('input[type=file]').first().setInputFiles({name:'faithful.pdf',mimeType:'application/pdf',buffer:fidelityPdf()});await page.locator('.chapter-edit').first().waitFor({timeout:120000});await page.getByRole('button',{name:/^Adjustable text/}).click();await page.getByRole('button',{name:'Create book',exact:true}).click();await page.waitForURL(/\/book\//);await page.locator('.reader').waitFor();await page.locator('.pagination-status').waitFor({state:'hidden',timeout:60000});
  const stored=await page.evaluate(async()=>{const db=await new Promise(resolve=>{const r=indexedDB.open('folio-preview');r.onsuccess=()=>resolve(r.result);});const books=await new Promise(resolve=>{const r=db.transaction('books').objectStore('books').getAll();r.onsuccess=()=>resolve(r.result);});db.close();return books.find(b=>b.sourcePdfBlobId);});
  const figures=stored.sections.flatMap(s=>s.blocks).filter(b=>b.type==='figure');assert.equal(figures.length,49,'48 illustrations and one vector table survive import');
  assert.ok(figures.some(f=>f.text?.includes('$12,345.67')&&f.sourcePageIndex===0));
  const emphasized=stored.sections.flatMap(s=>s.blocks).find(b=>b.styles?.some(r=>r.bold&&r.italic));assert.ok(emphasized);assert.ok(emphasized.styles.every(r=>r.start>=0&&r.end<=emphasized.text.length));
  await page.getByRole('button',{name:/^Contents(?: and go to page)?$/}).first().click();await page.getByRole('navigation',{name:'Chapters'}).getByRole('button').first().click();
  const open=page.getByRole('button',{name:'Enlarge illustration or table'}).first();
  for(let turns=0;!await open.count() && turns<6;turns++)await page.getByRole('button',{name:'Next page',exact:true}).first().click();
  await open.click();await page.getByRole('img',{name:'Enlarged book illustration or table',exact:true}).waitFor();await page.getByRole('button',{name:'View original page',exact:true}).click();await page.getByRole('img',{name:'Original PDF page 1',exact:true}).waitFor();
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false);
  const opening=await page.evaluate(async b64=>{const {importPDF}=await import('/lib/readwind/pdf.ts');const r=await importPDF(new File([Uint8Array.from(atob(b64),c=>c.charCodeAt(0))],'illustrated.pdf',{type:'application/pdf'}),{ocr:false,removeHeaders:true,joinHyphens:true},()=>{});const m=r.book.pageMarks[11],b=r.book.sections[m.at.section].blocks[m.at.block];return {figures:r.figures,block:b};},fidelityPdf({imageOnlyLast:true}).toString('base64'));
  assert.equal(opening.figures,46);assert.equal(opening.block.type,'figure');assert.equal(opening.block.sourcePageIndex,11);assert.equal(opening.block.fullPage,true);assert.ok(Math.abs(opening.block.aspectRatio-612/792)<.01);
  assert.deepEqual(errors,[]);console.log(`PASS ${name}: 49 retained figures/tables, numeric cell fidelity, native emphasis, image-only page, enlargement and original-page verification`);
 }finally{await browser.close();}
}
