import {chromium,webkit} from '@playwright/test';
import assert from 'node:assert/strict';
import {edgeCasePdf,scanEdgePdf} from '../tests/fixtures/edge-case-pdf.mjs';
const origin=process.env.READWIND_TEST_ORIGIN||'http://127.0.0.1:5173';
for(const [engine,type]of [['chromium',chromium],['webkit',webkit]]){
 const browser=await type.launch();try{
  const page=await browser.newPage({viewport:{width:390,height:844}}),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.route('**/api/config',r=>r.fulfill({json:{authUrl:null}}));await page.goto(origin+'/import');
  let workers=0;page.context().on('request',r=>{if(r.url().includes('/ocr/worker.min.js'))workers++;});
  const native=await page.evaluate(async bytes=>{const {importPDF}=await import('/lib/readwind/pdf.ts');const r=await importPDF(new File([Uint8Array.from(atob(bytes),c=>c.charCodeAt(0))],'native.pdf',{type:'application/pdf'}),{ocr:false,removeHeaders:true,joinHyphens:true},()=>{});return r.book.importReport;},edgeCasePdf().toString('base64'));
  assert.equal(workers,0,'usable native text, including sparse title/list/table pages, must not load OCR');assert.equal(native.pages.some(p=>p.autoOcr||p.ocrConfidence!==undefined),false);
  const images=await page.evaluate(()=>{
   const make=blank=>{const canvas=document.createElement('canvas');canvas.width=1224;canvas.height=1584;const ctx=canvas.getContext('2d');ctx.fillStyle='white';ctx.fillRect(0,0,1224,1584);if(!blank){ctx.fillStyle='black';ctx.font='32px Georgia';['Automatic recognition recovers the real scanned book.','A user should not need to remember the OCR checkbox.','The original content must remain complete and readable.','A small selectable footer is not a complete text layer.'].forEach((s,i)=>ctx.fillText(s,100,220+i*70));}const rgba=ctx.getImageData(0,0,1224,1584).data,gray=Uint8Array.from({length:1224*1584},(_,i)=>rgba[i*4]);let binary='';for(let i=0;i<gray.length;i+=32768)binary+=String.fromCharCode(...gray.subarray(i,i+32768));return {width:1224,height:1584,data:btoa(binary)};};return {blank:make(true),text:make(false)};
  });
  const encode=(image,footer=false)=>scanEdgePdf({...image,data:Buffer.from(image.data,'base64')},{footer}).toString('base64');
  const blank=await page.evaluate(async bytes=>{const {importPDF}=await import('/lib/readwind/pdf.ts');const r=await importPDF(new File([Uint8Array.from(atob(bytes),c=>c.charCodeAt(0))],'blank.pdf',{type:'application/pdf'}),{ocr:false,removeHeaders:true,joinHyphens:true},()=>{});return r.book.importReport;},encode(images.blank));assert.equal(workers,0,'blank scanned pages do not start recognition');assert.equal(blank.pages[0].autoOcr,undefined);
  for(const footer of [false,true]){
   const result=await page.evaluate(async bytes=>{const {importPDF}=await import('/lib/readwind/pdf.ts');const messages=[],r=await importPDF(new File([Uint8Array.from(atob(bytes),c=>c.charCodeAt(0))],'scan.pdf',{type:'application/pdf'}),{ocr:false,removeHeaders:true,joinHyphens:true},m=>messages.push(m));return {book:r.book,messages};},encode(images.text,footer));
   assert.equal(result.book.importReport.pages[0].autoOcr,true);assert.ok(result.book.importReport.pages[0].ocrConfidence>80);assert.ok(result.book.sections.flatMap(s=>s.blocks).some(b=>b.text?.includes('Automatic recognition recovers')));assert.ok(result.messages.some(m=>m.includes('automatically')));assert.ok(result.book.importReport.warnings.some(m=>m.includes('enabled automatically')));
  }
  assert.ok(workers>0);
  // Exercise the actual unchecked import flow and its saved quality metadata.
  await page.getByRole('checkbox',{name:'Recognize scanned pages with OCR',exact:true}).uncheck();await page.locator('input[type=file]').first().setInputFiles({name:'forgot-ocr.pdf',mimeType:'application/pdf',buffer:Buffer.from(encode(images.text,true),'base64')});await page.locator('.chapter-edit').first().waitFor({timeout:180000});await page.getByText(/OCR was enabled automatically for 1 page/).waitFor();assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false);
  assert.deepEqual(errors,[]);console.log(`PASS ${engine}: unchecked OCR keeps native/blank pages fast, automatically recovers full scans and footer-only scans, and explains the fallback in review`);
 }finally{await browser.close();}
}
