import {chromium} from '@playwright/test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const origin=process.env.READWIND_TEST_ORIGIN||'http://127.0.0.1:5173';
const browser=await chromium.launch();
try{
 const page=await browser.newPage();await page.route('**/api/config',r=>r.fulfill({json:{authUrl:null}}));await page.goto(origin);await page.getByRole('heading',{name:'Your shelf'}).waitFor();
 const source=JSON.parse(fs.readFileSync('lib/readwind/classics.json','utf8'))[0];
 const result=await page.evaluate(async source=>{
  const {paginate,geometry,pageIndex}=await import('/lib/readwind/pagination.ts');
  const {defaults}=await import('/lib/readwind/types.ts');const {compare,labelAt}=await import('/lib/readwind/anchors.ts');
  const book={...source,id:'pagination-regression',sections:[{...source.sections[0],blocks:[{type:'p',text:'[No readable text was detected on this page. See the original PDF.]'},...source.sections[0].blocks.slice(0,6)]}],pageMarks:[0,1,2,3,4,5,6].map(i=>({label:String(i+1),index:i,at:{section:0,block:i,offset:0}})),printPageCount:7};
  const failures=[],counts=[];
  for(const [w,h]of [[320,740],[844,390],[1440,1000]])for(const size of [14,28])for(const spacing of ['Snug','Airy']){
   const settings={...defaults,size,spacing,warmLight:false};const g=geometry(w,h,settings,w<900,w>640);const pages=await paginate(book,g,settings);
   const key=`${w}x${h} ${size} ${spacing}`;counts.push({key,pages:pages.length});
   for(let block=1;block<book.sections[0].blocks.length;block++){
    const expected=book.sections[0].blocks[block].text;
    const actual=pages.flatMap(p=>p.fragments.filter(f=>f.block===block).map(f=>f.text)).join('');
    if(actual!==expected)failures.push(key+' content lost/duplicated at block '+block);
   }
   const at={section:0,block:3,offset:7},idx=pageIndex(pages,at,g.spread),spread=pages.slice(idx,idx+(g.spread?2:1));
   if(!spread.some(p=>!p.blank&&compare(p.start,at)<=0&&compare(p.end,at)>0))failures.push(key+' cannot restore anchor');
   if(labelAt(book,at)!=='4'||book.printPageCount!==7)failures.push(key+' print numbers changed');
   if(pages.flatMap(p=>p.fragments).some(f=>f.block===0))failures.push(key+' legacy filler remains');
  }
  return {failures,counts};
 },source);
 assert.deepEqual(result.failures,[]);console.log('PASS: 12 actual DOM pagination layouts retain every character and the same print-page anchors across fonts sizes 14/28, Snug/Airy spacing, desktop/phone/landscape.');
 fs.mkdirSync('work/reader-qa',{recursive:true});fs.writeFileSync('work/reader-qa/pagination-results.json',JSON.stringify(result,null,2));
}finally{await browser.close();}
