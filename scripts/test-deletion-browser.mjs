import {chromium,webkit,expect} from '@playwright/test';
import assert from 'node:assert/strict';
const origin=process.env.READWIND_TEST_ORIGIN||'http://127.0.0.1:5173';
const make=(id,title,time)=>({id,title,author:'Reader',addedAt:time,lastOpenedAt:time,cover:{kind:'typeset',color:'#294636',fg:'#ffffff'},printPageCount:1,sections:[{id:'s',title:'Opening',heading:true,blocks:[{type:'p',text:'A complete book stays readable until its owner confirms deletion. '.repeat(4)}]}],pageMarks:[{label:'1',index:0,at:{section:0,block:0,offset:0}}]});
for(const [name,type]of [['chromium',chromium],['webkit',webkit]]){
 const browser=await type.launch();try{
  const page=await browser.newPage({viewport:{width:390,height:844},reducedMotion:'no-preference'}),errors=[];page.on('pageerror',e=>errors.push(e.message));
  let books=[make('delete-a','First book',2),make('delete-b','Second book',1)],settings=null,holdPull=false,releasePull,pullArrived,releaseDelete;
  const deletes=[],deleteGate=new Promise(r=>releaseDelete=r);
  await page.route('**/api/config',r=>r.fulfill({json:{authUrl:null}}));
  await page.route('**/api/library*',async r=>{
   if(r.request().method()==='DELETE'){const id=new URL(r.request().url()).searchParams.get('id');deletes.push(id);books=books.filter(b=>b.id!==id);await deleteGate;await r.fulfill({json:{ok:true}}).catch(()=>{});return;}
   const data={books:structuredClone(books),annotations:[],progress:[],settings};
   if(holdPull){holdPull=false;pullArrived();await new Promise(r=>releasePull=r);}
   await r.fulfill({json:data}).catch(()=>{});
  });
  await page.route('**/api/sync',async r=>{const c=r.request().postDataJSON();if(c.entity==='settings')settings=c.value;await r.fulfill({json:{ok:true,revision:1}});});
  const mount=async()=>{await page.evaluate(async()=>{const h=await import('/tests/fixtures/deletion-harness.tsx');h.mount('deletion-test');});await expect.poll(()=>page.evaluate(async()=>{const h=await import('/tests/fixtures/deletion-harness.tsx');return !!h.current()?.ready;})).toBe(true);};
  await page.goto(origin);await page.getByRole('heading',{name:'Your shelf'}).waitFor();await mount();const shelf=page.locator('#deletion-harness');
  await shelf.getByRole('button',{name:'Delete First book',exact:true}).click();const dialog=page.getByRole('dialog',{name:'Delete book?',exact:true});await dialog.waitFor();assert.equal(await page.evaluate(()=>document.activeElement?.textContent),'Cancel');await dialog.getByRole('button',{name:'Cancel',exact:true}).click();assert.equal(deletes.length,0);
  const arrived=new Promise(r=>pullArrived=r);holdPull=true;await page.evaluate(async()=>{const h=await import('/tests/fixtures/deletion-harness.tsx');void h.current().sync();});await arrived;
  await shelf.getByRole('button',{name:'Delete First book',exact:true}).click();await dialog.getByRole('checkbox',{name:/ask again/i}).check();
  await page.evaluate(()=>{window.exitFrames=[];const el=document.querySelector('#deletion-harness [data-book-id="delete-a"]');const watch=()=>{if(!el?.isConnected)return;window.exitFrames.push(Number(getComputedStyle(el).opacity));requestAnimationFrame(watch);};watch();});
  await dialog.getByRole('button',{name:'Delete book',exact:true}).click();
  await expect.poll(()=>page.evaluate(async()=>{const h=await import('/tests/fixtures/deletion-harness.tsx');return !h.current().books.some(b=>b.id==='delete-a');}),{timeout:1500}).toBe(true);assert.equal(deletes.length,0,'shelf updates before the held sync request finishes');
  await shelf.locator('[data-book-id="delete-a"]').waitFor({state:'detached'});assert.ok(await page.evaluate(()=>window.exitFrames.some(x=>x>0&&x<1)),'exit animation plays');
  releasePull();await expect.poll(()=>deletes.includes('delete-a')).toBe(true);
  // Reload while the remote deletion is still in flight. Its durable marker must hide the book.
  await page.reload();await page.getByRole('heading',{name:'Your shelf'}).waitFor();await page.evaluate(async()=>{const h=await import('/tests/fixtures/deletion-harness.tsx');h.mount('deletion-test');});await shelf.locator('[data-book-id="delete-b"]').waitFor();assert.equal(await shelf.locator('[data-book-id="delete-a"]').count(),0);
  await shelf.getByRole('button',{name:'Delete Second book',exact:true}).click();await shelf.locator('[data-book-id="delete-b"]').waitFor({state:'detached'});assert.equal(await page.getByRole('dialog',{name:'Delete book?',exact:true}).count(),0,'saved preference skips confirmation after reload');
  releaseDelete();await expect.poll(()=>page.evaluate(async()=>{const h=await import('/tests/fixtures/deletion-harness.tsx');return h.current().db.pending.count();}),{timeout:15000}).toBe(0);assert.ok(deletes.includes('delete-b'));
  await shelf.getByRole('button',{name:'Turn on deletion confirmations',exact:true}).click();await expect.poll(()=>page.evaluate(async()=>{const h=await import('/tests/fixtures/deletion-harness.tsx');return h.current().settings.confirmBookDeletion===true;})).toBe(true);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false);assert.deepEqual(errors,[]);console.log(`PASS ${name}: cancel, instant removal during slow sync, exit animation, stale pull protection, reload persistence, saved checkbox and re-enable`);
 }finally{await browser.close();}
}
