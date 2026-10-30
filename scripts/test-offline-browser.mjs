import {chromium} from '@playwright/test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {createPdfFixture} from '../tests/fixtures/pdf.mjs';
const origin=process.env.READWIND_OFFLINE_ORIGIN||'http://reader.localhost:5180';
const output=path.resolve(process.env.READWIND_QA_OUTPUT||'work/reader-qa');
const fixture=createPdfFixture(output);
const browser=await chromium.launch({args:['--host-resolver-rules=MAP reader.localhost 127.0.0.1']});
try{
 const context=await browser.newContext({viewport:{width:390,height:844}});const page=await context.newPage();
 await page.goto(origin+'/import');await page.locator('input[type="file"]').setInputFiles(fixture);await page.locator('.chapter-edit').first().waitFor({timeout:60000});await page.getByRole('button',{name:'Create book',exact:true}).click();await page.waitForURL(/\/book\//);await page.locator('.pdf-sheet canvas').first().waitFor();
 await page.getByRole('button',{name:'Next page',exact:true}).click();await page.getByRole('img',{name:'Original PDF page 2',exact:true}).waitFor();
 await page.evaluate(()=>navigator.serviceWorker.ready);await page.waitForFunction(()=>!!navigator.serviceWorker.controller);
 const cached=await page.evaluate(async()=>{const keys=await caches.keys();return keys.filter(k=>k.startsWith('readwind-'));});assert.ok(cached.length);
 await context.setOffline(true);await page.reload();await page.getByRole('img',{name:'Original PDF page 2',exact:true}).waitFor();await page.getByRole('button',{name:'Bookmark page',exact:true}).click();await page.getByRole('button',{name:'Remove bookmark',exact:true}).waitFor();
 await page.reload();await page.getByRole('img',{name:'Original PDF page 2',exact:true}).waitFor();await page.getByRole('button',{name:'Remove bookmark',exact:true}).waitFor();await page.locator('.pdf-page-status').first().waitFor({state:'hidden'});await page.screenshot({path:path.join(output,'production-phone-offline.png')});
 await context.setOffline(false);await page.reload();await page.getByRole('img',{name:'Original PDF page 2',exact:true}).waitFor();console.log('PASS: production app shell and PDF reopen offline; offline bookmark survives another offline reload; reading position remains after reconnect.');
}finally{await browser.close();}
