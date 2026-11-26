import {chromium,expect} from '@playwright/test';
import assert from 'node:assert/strict';
import path from 'node:path';
const origin=process.env.READWIND_TEST_ORIGIN||'http://127.0.0.1:5173';const out=path.resolve(process.env.READWIND_QA_OUTPUT||'work/reader-qa');
const browser=await chromium.launch();try{
for(const [name,viewport]of [['wide',{width:2532,height:1200}],['desktop',{width:1440,height:1000}],['tablet',{width:900,height:1100}],['phone',{width:390,height:844}],['small-phone',{width:320,height:740}]]){
 const page=await browser.newPage({viewport,hasTouch:viewport.width<640,isMobile:viewport.width<640});await page.addInitScript(()=>localStorage.setItem('readwind-theme','light'));await page.route('**/api/config',r=>r.fulfill({json:{authUrl:null}}));await page.goto(origin);await page.getByRole('heading',{name:'Your shelf'}).waitFor();await page.getByRole('button',{name:'Add the classics',exact:true}).click();await page.getByRole('button',{name:'Read Walden',exact:true}).first().waitFor();await page.waitForTimeout(900);
 for(const theme of ['light','dark']){
  if(theme==='dark')await page.getByRole('button',{name:'Switch between light and dark appearance'}).click();
  assert.equal(await page.locator('html').getAttribute('data-theme'),theme);
  const issues=await page.evaluate(()=>{
   const issues=[];if(document.documentElement.scrollWidth>innerWidth+1)issues.push('horizontal overflow');
   for(const cell of document.querySelectorAll('.shelf-cell')){
    const cover=cell.querySelector('.shelf-cover'),read=cell.querySelector('.shelf-item'),menu=cell.querySelector('.card-menu-trigger');
    const c=cell.getBoundingClientRect(),b=cover.getBoundingClientRect(),r=read.getBoundingClientRect(),m=menu.getBoundingClientRect();
    if(Math.abs(b.width-c.width)>2)issues.push('book cover squeezed by sibling action');
    if(m.left<b.left||m.right>b.right||m.bottom>b.bottom||m.top<b.top)issues.push('menu trigger extends beyond the cover');
    if(m.bottom>r.bottom)issues.push('menu trigger overlaps reading progress');
   }
   for(const el of document.querySelectorAll('.shelf-cover')){const title=el.querySelector('.cover-title-fit'),author=el.querySelector('span');if(title&&author&&title.getBoundingClientRect().bottom>author.getBoundingClientRect().top+1)issues.push('cover title overlaps author');}
   return issues;
  });
  assert.deepEqual(issues,[],name+' '+theme);
  const trigger=page.getByRole('button',{name:/^Actions for/}).first();
  const menu=page.getByRole('menu');
  await trigger.click();
  const bounds=await menu.boundingBox();
  assert.ok(bounds&&bounds.x>=0&&bounds.y>=0&&bounds.x+bounds.width<=viewport.width&&bounds.y+bounds.height<=viewport.height,name+' '+theme+' menu fits the viewport');
  await page.keyboard.press('Escape');
  await menu.waitFor({state:'hidden'});
  await expect(trigger).toBeFocused();
  await page.screenshot({path:path.join(out,`library-${name}-${theme}.png`),fullPage:true});
 }
 await page.getByRole('button',{name:'Notebook',exact:true}).click();await page.getByRole('heading',{name:'Keep what stays with you.'}).waitFor();await page.screenshot({path:path.join(out,`empty-notebook-${name}.png`),fullPage:true});console.log('PASS: library and notebook',name);await page.close();
}
}finally{await browser.close();}
