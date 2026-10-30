import { chromium, webkit } from '@playwright/test';
import assert from 'node:assert/strict';
import { deflateSync } from 'node:zlib';
import fs from 'node:fs';
import path from 'node:path';

const origin=process.env.READWIND_TEST_ORIGIN||'http://127.0.0.1:5173';
const output=path.resolve('work/import-qa');fs.mkdirSync(output,{recursive:true});
const text=(s,y=680,size=14)=>`BT /F1 ${size} Tf 60 ${y} Td (${s}) Tj ET\n`;
function fixture(scan) {
  const streams=[text('Reliable Book',680,24),text('Contents',680,24)+text('First journey ........ 1',620)+text('Second journey ........ 3',590),text('Opening scene',680,24)+text('The first chapter keeps every original sentence.',620),text('An intermediate page still belongs to the first chapter.',620)+text('2',25,12),text('Second journey',680,24)+text('The second chapter begins on printed page three.',620)+text('3',25,12)];
  if(scan) streams.push('q 612 0 0 792 0 0 cm /Scan Do Q\n'+text('4',25,12)); // Sparse text over a scanned page.
  const count=streams.length, imageId=4+count*2, linkId=imageId+(scan?1:0);
  const objects=[Buffer.from('<< /Type /Catalog /Pages 2 0 R >>'),Buffer.from(`<< /Type /Pages /Kids [${streams.map((_,i)=>`${4+i*2} 0 R`).join(' ')}] /Count ${count} >>`),Buffer.from('<< /Type /Font /Subtype /Type1 /BaseFont /Times-Roman >>')];
  streams.forEach((s,i)=>{objects.push(Buffer.from(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> ${scan&&i===count-1?`/XObject << /Scan ${imageId} 0 R >>`:''} >> /Contents ${5+i*2} 0 R ${i===1?`/Annots [${linkId} 0 R]`:""} >>`));objects.push(Buffer.from(`<< /Length ${Buffer.byteLength(s)} >>\nstream\n${s}endstream`));});
  if(scan){const compressed=deflateSync(Buffer.from(scan));objects.push(Buffer.concat([Buffer.from(`<< /Type /XObject /Subtype /Image /Width 1224 /Height 1584 /ColorSpace /DeviceGray /BitsPerComponent 8 /Filter /FlateDecode /Length ${compressed.length} >>\nstream\n`),compressed,Buffer.from('\nendstream')]));}
  objects.push(Buffer.from('<< /Type /Annot /Subtype /Link /Rect [55 610 540 635] /Dest [8 0 R /Fit] >>'));
  const chunks=[Buffer.from('%PDF-1.4\n')],offsets=[0];let size=chunks[0].length;
  objects.forEach((o,i)=>{offsets.push(size);const chunk=Buffer.concat([Buffer.from(`${i+1} 0 obj\n`),o,Buffer.from('\nendobj\n')]);chunks.push(chunk);size+=chunk.length;});
  chunks.push(Buffer.from(`xref\n0 ${objects.length+1}\n0000000000 65535 f \n${offsets.slice(1).map(o=>`${String(o).padStart(10,'0')} 00000 n \n`).join('')}trailer\n<< /Size ${objects.length+1} /Root 1 0 R >>\nstartxref\n${size}\n%%EOF`));return Buffer.concat(chunks);
}
for(const [name,type] of [['chromium',chromium],['webkit',webkit]]){
  if(process.env.QA_ENGINE&&process.env.QA_ENGINE!==name)continue;
  console.log(`START import ${name}`);
  const browser=await type.launch();try{
    const page=await browser.newPage({viewport:{width:390,height:844}}), errors=[];
    page.on('pageerror',e=>errors.push(e.message));await page.route('**/api/config',r=>r.fulfill({json:{authUrl:null}}));await page.goto(origin+'/import');
    const scan=await page.evaluate(()=>{const c=document.createElement('canvas');c.width=1224;c.height=1584;const ctx=c.getContext('2d');ctx.fillStyle='white';ctx.fillRect(0,0,c.width,c.height);ctx.fillStyle='black';ctx.font='32px Georgia';['A scanned page with a small selectable footer.','Recognition must recover the actual book content.','Every sentence should stay readable and complete.'].forEach((s,i)=>ctx.fillText(s,100,220+i*60));const data=ctx.getImageData(0,0,c.width,c.height).data;const gray=Uint8Array.from({length:c.width*c.height},(_,i)=>data[i*4]);let binary="";for(let i=0;i<gray.length;i+=32768)binary+=String.fromCharCode(...gray.subarray(i,i+32768));return btoa(binary);});
    await page.locator('input[type=file]').first().setInputFiles({name:'reliable-book.pdf',mimeType:'application/pdf',buffer:fixture(Buffer.from(scan,"base64"))});
    await page.locator('.chapter-edit').first().waitFor({timeout:180000});
    assert.equal(await page.locator('.chapter-edit').count(),3);
    await page.getByRole('textbox',{name:'New chapter title',exact:true}).fill('A manual chapter');await page.getByRole('textbox',{name:'Chapter starts on printed page',exact:true}).fill('2');await page.getByRole('button',{name:'Add chapter',exact:true}).click();
    assert.equal(await page.locator('.chapter-edit').count(),4);
    await page.getByRole('button',{name:'Page 2',exact:true}).click();await page.getByRole('img',{name:'Original PDF page 4',exact:true}).waitFor();
    // Correct a front-matter label without renumbering the body.
    await page.getByRole('button',{name:'Previous preview page'}).click();await page.getByRole('button',{name:'Previous preview page'}).click();
    await page.getByRole('textbox',{name:'Printed page label',exact:true}).fill('ii');await page.getByRole('button',{name:'Set page label',exact:true}).click();
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false);
    await page.screenshot({path:path.join(output,`${name}-review.png`),fullPage:true});
    await page.getByRole('button',{name:'Create book',exact:true}).click();await page.waitForURL(/\/book\//);
    const book=await page.evaluate(async()=>{const db=await new Promise(res=>{const r=indexedDB.open('folio-preview');r.onsuccess=()=>res(r.result);});const books=await new Promise(res=>{const r=db.transaction('books').objectStore('books').getAll();r.onsuccess=()=>res(r.result);});db.close();return books.find(b=>b.sourcePdfBlobId);});
    assert.deepEqual(book.pageMarks.map(m=>m.label),['PDF 1','ii','1','2','3','4']);
    assert.deepEqual(book.sections.map(s=>s.title),['Beginning','First journey','A manual chapter','Second journey']);
    assert.ok(book.sections.flatMap(s=>s.blocks).some(b=>b.text?.includes('Recognition must recover the actual book content')));
    assert.ok(book.importReport.pages[5].ocrConfidence>80);
    assert.equal(book.pageMarks[4].at.section,3);
    await page.getByRole('button',{name:'Contents and go to page'}).click();await page.getByRole('textbox',{name:'Printed page',exact:true}).fill('3');await page.getByRole('button',{name:'Go',exact:true}).click();await page.getByRole('img',{name:'Original PDF page 5',exact:true}).waitFor();
    await page.screenshot({path:path.join(output,`${name}-printed-page.png`)});assert.deepEqual(errors,[]);
    console.log(`PASS ${name}: contents, printed numbering, manual chapter, page correction, sparse-layer OCR (${Math.round(book.importReport.pages[5].ocrConfidence)}%), saved original navigation`);
  } finally {await browser.close();}
}
