// Imports real PDFs whose printed page numbers sit in different places and
// checks none of them leak into the reading text while genuine numbers stay.
import {chromium,webkit} from '@playwright/test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
const origin=process.env.READWIND_TEST_ORIGIN||'http://127.0.0.1:5173';
const output=path.resolve(process.env.READWIND_QA_OUTPUT||'work/page-number-qa');fs.mkdirSync(output,{recursive:true});
const PAGES=12,FIRST=10,words=['amber','birch','cedar','dune','ember','fern','grove','heath','iris','juniper','kelp','lichen'];
const legit='In 1984 the company had 7 people and 12 desks.';
function makePdf(variant){
 const streams=[];
 for(let i=0;i<PAGES;i++){
  const n=FIRST+i;let s='BT /F1 14 Tf ';
  const at=(x,y,size,text)=>`/F1 ${size} Tf 1 0 0 1 ${x} ${y} Tm (${text}) Tj `;
  if(i===0)s+=at(60,700,22,'Chapter 1');
  if(variant==='chapters')s+=at(60,750,14,`${i+1} ${words[i]} chapter`);
  if(variant==='split-chapters')s+=at(60,750,14,String(i+1))+at(60,730,14,`${words[i][0].toUpperCase()+words[i].slice(1)} chapter`);
  const sentence=`The quiet river runs on past the ${words[i]} bank.`,first=variant==='glued'?`${n} ${sentence}`:sentence;
  s+=at(60,variant==='glued'?720:660,14,first)+at(60,636,14,'A second sentence follows it without any hurry at all.');
  s+=at(60,612,14,i%3===1?legit:'A third sentence carries the thought a little further.');
  if(variant==='footer-87')s+=at(300,100,11,String(n));
  if(variant==='footer-95')s+=at(300,40,11,String(n));
  if(variant==='header')s+=at(300,750,11,String(n));
  if(variant==='running-header')s+=at(60,750,10,`${n} WALDEN`);
  if(variant==='dashes')s+=at(290,100,11,`- ${n} -`);
  streams.push(s+'ET');
 }
 const objects=['<< /Type /Catalog /Pages 2 0 R >>',`<< /Type /Pages /Kids [${streams.map((_,i)=>`${4+i*2} 0 R`).join(' ')}] /Count ${PAGES} >>`,'<< /Type /Font /Subtype /Type1 /BaseFont /Times-Roman >>'];
 streams.forEach((s,i)=>{objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${5+i*2} 0 R >>`);objects.push(`<< /Length ${s.length} >>\nstream\n${s}\nendstream`);});
 let pdf='%PDF-1.4\n';const offsets=[];objects.forEach((o,i)=>{offsets.push(Buffer.byteLength(pdf));pdf+=`${i+1} 0 obj\n${o}\nendobj\n`;});
 const xref=Buffer.byteLength(pdf);pdf+=`xref\n0 ${objects.length+1}\n0000000000 65535 f \n`+offsets.map(o=>String(o).padStart(10,'0')+' 00000 n \n').join('')+`trailer\n<< /Size ${objects.length+1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
 const file=path.join(output,`${variant}.pdf`);fs.writeFileSync(file,pdf);return file;
}
const variants=(process.env.VARIANTS||'footer-87,footer-95,header,running-header,glued,dashes,chapters,split-chapters').split(',');
for(const [engine,type] of [['chromium',chromium],['webkit',webkit]]){
 if(process.env.QA_ENGINE&&process.env.QA_ENGINE!==engine)continue;
 const browser=await type.launch();
 try{for(const variant of variants){
  const page=await browser.newPage({viewport:{width:1100,height:900}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/api/config',r=>r.fulfill({json:{authUrl:null}}));
  await page.goto(origin+'/import');await page.locator('input[type="file"]').setInputFiles(makePdf(variant));await page.locator('.chapter-edit').first().waitFor({timeout:60000});
  await page.getByRole('button',{name:'Create book',exact:true}).click();await page.waitForURL(/\/book\//,{waitUntil:'domcontentloaded'});
  const result=await page.evaluate(async()=>{const db=await new Promise(res=>{const r=indexedDB.open('folio-preview');r.onsuccess=()=>res(r.result);});const books=await new Promise(res=>{const r=db.transaction('books').objectStore('books').getAll();r.onsuccess=()=>res(r.result)});db.close();const b=books.filter(b=>b.sourcePdfBlobId).at(-1);return {text:b.sections.flatMap(s=>s.blocks.map(x=>x.text||'')).join('\n'),titles:b.sections.map(s=>s.title).join('\n')};});
  const {text,titles}=result;
  const legitCount=(text.match(/In 1984 the company had 7 people and 12 desks\./g)||[]).length;
  assert.equal(legitCount,PAGES/3,`${engine} ${variant}: genuine numbers kept`);
  const rest=text.replaceAll(legit,'').replace('Chapter 1','');
  if(variant==='chapters') for(let i=0;i<PAGES;i++) assert.ok((text+'\n'+titles).includes(`${i+1} ${words[i]} chapter`),`${engine}: chapter ${i+1} retained`);
  else if(variant==='split-chapters') for(let i=0;i<PAGES;i++) assert.match(text+'\n'+titles,new RegExp(`(?:^|\\D)${i+1}(?:\\D|$)`),`${engine}: standalone chapter ${i+1} retained`);
  else if(variant!=='glued') assert.equal(/\d/.test(rest),false,`${engine} ${variant}: page numbers leaked into text: ${rest.match(/.{0,20}\d.{0,20}/)?.[0]}`);
  assert.equal(/WALDEN/.test(rest),false,`${engine} ${variant}: running header removed`);
  if(process.env.DEBUG_TEXT)console.log(JSON.stringify(text.slice(0,700)));assert.equal(words.every(w=>text.includes(`The quiet river runs on past the ${w} bank.`)),true,`${engine} ${variant}: prose kept`);
  assert.deepEqual(errors,[]);console.log(`PASS: ${engine} ${variant}`);await page.close();
 }}finally{await browser.close();}
}
