import {chromium,webkit,expect} from '@playwright/test';
import assert from 'node:assert/strict';
const origin=process.env.READWIND_TEST_ORIGIN||'http://127.0.0.1:5173';
const job=(patch={})=>({id:'import-a',title:'Man\'s Search for Meaning',percent:37,message:'Recognizing page 69 of 187…',status:'running',deviceId:'desktop-device',age:2,...patch});
for(const [name,type]of [['chromium',chromium],['webkit',webkit]]){
 const browser=await type.launch();try{
  const page=await browser.newPage({viewport:{width:390,height:844}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
  let jobs=[job()];const writes=[],removed=[];
  await page.route('**/api/config',r=>r.fulfill({json:{authUrl:null}}));
  await page.route('**/api/library*',r=>r.fulfill({json:{books:[],annotations:[],progress:[],settings:null}}));
  await page.route('**/api/sync',r=>r.fulfill({json:{ok:true,revision:1}}));
  await page.route('**/api/imports*',async r=>{
   const request=r.request();
   if(request.method()==='PUT'){const body=request.postDataJSON();writes.push(body);jobs=[{...body,age:0},...jobs.filter(j=>j.id!==body.id)];return r.fulfill({json:{ok:true}});}
   if(request.method()==='DELETE'){const id=new URL(request.url()).searchParams.get('id');removed.push(id);jobs=jobs.filter(j=>j.id!==id);return r.fulfill({json:{ok:true}});}
   return r.fulfill({json:{imports:jobs}});
  });
  await page.goto(origin);await page.getByRole('heading',{name:'Your shelf'}).waitFor();
  await page.evaluate(async()=>{const h=await import('/tests/fixtures/deletion-harness.tsx');h.mount('import-status-test');});
  const shelf=page.locator('#deletion-harness');
  // The phone opens the account and sees the desktop's import, with no shelf-empty prompt in the way.
  const bar=shelf.getByRole('progressbar',{name:"Importing Man's Search for Meaning"});
  await bar.waitFor();assert.equal(await bar.getAttribute('aria-valuenow'),'37');
  await shelf.getByText('Recognizing page 69 of 187…').waitFor();
  assert.equal(await shelf.getByText('A shelf of your own.').count(),0);
  // Later polls move the bar.
  jobs=[job({percent:82,message:'Recognizing page 153 of 187…'})];
  await expect.poll(()=>bar.getAttribute('aria-valuenow'),{timeout:30000}).toBe('82');
  // Closing the desktop tab stops reports; the server's age eventually marks it interrupted and it can be dismissed.
  jobs=[job({percent:82,age:300})];
  await shelf.getByText(/Stopped\. Imports only continue while Readwind is open on your other device/).waitFor({timeout:30000});
  assert.equal(await shelf.locator('[data-import-state="interrupted"]').count(),1);
  await shelf.getByRole('button',{name:'Dismiss'}).click();await expect.poll(()=>removed).toEqual(['import-a']);
  assert.equal(await shelf.locator('.import-cell').count(),0);
  // A finished import waits for review without offering to dismiss it.
  jobs=[job({id:'import-c',status:'ready',percent:100,message:'Ready to review'})];
  await shelf.getByText(/Finished\. Open Readwind on the device that started it/).waitFor({timeout:30000});
  assert.equal(await shelf.getByRole('button',{name:'Dismiss'}).count(),0);
  jobs=[];await expect.poll(()=>shelf.locator('.import-cell').count(),{timeout:30000}).toBe(0);
  // The importing side publishes progress and clears it when it stops.
  await page.evaluate(async()=>{const h=await import('/tests/fixtures/deletion-harness.tsx');await h.current().reportImport({id:'import-b',title:'Local book',percent:12,message:'Reading page 3 of 20',status:'running'});});
  await expect.poll(()=>writes.length).toBe(1);
  assert.deepEqual({id:writes[0].id,percent:writes[0].percent,status:writes[0].status},{id:'import-b',percent:12,status:'running'});
  assert.ok(writes[0].deviceId,'the report names its device');
  await shelf.getByRole('progressbar',{name:'Importing Local book'}).waitFor();
  await page.evaluate(async()=>{const h=await import('/tests/fixtures/deletion-harness.tsx');await h.current().clearImport('import-b');});
  await expect.poll(()=>removed.includes('import-b')).toBe(true);
  assert.equal(await shelf.locator('.import-cell').count(),0);
  assert.deepEqual(errors,[]);console.log(`PASS ${name}: other devices see import progress, interruption, completion and dismissal; the importer publishes and clears its status`);
 }finally{await browser.close();}
}
