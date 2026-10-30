import {chromium,webkit} from '@playwright/test';
import assert from 'node:assert/strict';
import path from 'node:path';
const origin=process.env.READWIND_TEST_ORIGIN||'http://127.0.0.1:5173';const output=path.resolve(process.env.READWIND_QA_OUTPUT||'work/reader-qa');
for(const [engine,type]of [['chromium',chromium],['webkit',webkit]]){
 const browser=await type.launch();try{
 for(const [name,viewport]of [['phone',{width:390,height:844}],['small-phone',{width:320,height:740}],['landscape',{width:844,height:390}]]){
  const page=await browser.newPage({viewport,hasTouch:true});await page.route('**/api/config',r=>r.fulfill({json:{authUrl:null}}));await page.goto(origin);await page.getByRole('button',{name:'Read Walden',exact:true}).first().click();await page.locator('.reader').waitFor();await page.locator('.pagination-status').waitFor({state:'hidden',timeout:60000});
  if(await page.locator('.reader-cover').count()){await page.getByRole('button',{name:'Open book',exact:true}).click();await page.locator('.reader-cover').waitFor({state:'hidden'});}
  await page.getByRole('button',{name:'Full screen',exact:true}).click();await page.locator('.reader.is-full').waitFor();await page.waitForTimeout(400);await page.locator('.pagination-status').waitFor({state:'hidden'});
  for(const name of ['Highlight / note','Contents','Search','Type and comfort settings','Notebook','Exit full screen'])assert.ok(await page.getByRole('button',{name,exact:true}).isVisible(),name+' remains accessible');
  await page.getByRole('button',{name:'Next page',exact:true}).click();await page.waitForTimeout(850);
  const issue=await page.evaluate(()=>{const r=document.querySelector('.book-box').getBoundingClientRect();return r.left<8||r.right>innerWidth-8||document.documentElement.scrollWidth>innerWidth+1;});assert.equal(issue,false,'fullscreen retains room for page turns');
  await page.screenshot({path:path.join(output,`${engine}-${name}-fullscreen.png`)});await page.getByRole('button',{name:'Exit full screen',exact:true}).click();await page.locator('.reader.is-full').waitFor({state:'hidden'});console.log('PASS: fullscreen tools and turns',engine,name);await page.close();
 }
 }finally{await browser.close();}
}
