import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
const origin=process.env.READWIND_TEST_ORIGIN||'http://127.0.0.1:5173';
if (process.env.READWIND_ALLOW_CLOUD_TESTS !== 'staging-only') throw new Error('Cloud tests require an isolated staging branch and READWIND_ALLOW_CLOUD_TESTS=staging-only.');
const suffix=crypto.randomUUID().slice(0,8);
async function session(name){
 const suffix = name === 'laptop' ? 'A' : 'B';
 const email=process.env[`READWIND_TEST_EMAIL_${suffix}`], password=process.env[`READWIND_TEST_PASSWORD_${suffix}`];
 if (!email || !password) throw new Error('Supply two verified staging test accounts through READWIND_TEST_EMAIL_A/B and READWIND_TEST_PASSWORD_A/B.');
 const signin=await fetch(`${origin}/api/auth/sign-in/email`,{method:'POST',headers:{'Content-Type':'application/json',Origin:origin},body:JSON.stringify({email,password})});
 assert.equal(signin.status,200,'verified staging account signs in');
 const cookies=signin.headers.getSetCookie().map(s=>s.split(';')[0]).join('; ');
 return {email,password,cookies};
}
const a=await session('laptop'),b=await session('other-account');
const req=(s,path,body)=>fetch(origin+path,{method:body?'POST':'GET',headers:{Cookie:s.cookies,Origin:origin,...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});
assert.equal((await fetch(origin+'/api/library')).status,401,'anonymous reads must be blocked');
const book=JSON.parse(fs.readFileSync('lib/readwind/classics.json','utf8'))[0];book.id=`qa-${suffix}`;
assert.equal((await req(a,'/api/library',book)).status,200,'owner can save a book');
let response=await req(a,'/api/library');assert.equal(response.status,200,'owner can load library');assert.equal((await response.json()).books.length,1);
response=await req(b,'/api/library');assert.equal((await response.json()).books.length,0,'another account sees no books');
const p={bookId:book.id,at:{section:0,block:1,offset:27},deviceId:'qa-laptop',wordsRead:160,revision:0};
response=await req(a,'/api/sync',{entity:'progress',value:p});assert.equal(response.status,200);assert.equal((await response.json()).revision,1);
const phoneLogin=await fetch(origin+'/api/auth/sign-in/email',{method:'POST',headers:{'Content-Type':'application/json',Origin:origin},body:JSON.stringify({email:a.email,password:a.password})});assert.equal(phoneLogin.status,200,'second device signs in independently');
const phoneCookies=phoneLogin.headers.getSetCookie().map(s=>s.split(';')[0]).join('; ');
const phone={cookies:phoneCookies};response=await req(phone,'/api/library');const saved=(await response.json()).progress[0];assert.deepEqual(saved.at,p.at,'second device resumes at the exact passage');
response=await req(a,'/api/sync',{entity:'progress',value:{...p,at:{section:0,block:2,offset:0},deviceId:'qa-phone',revision:1}});assert.equal(response.status,200);
response=await req(a,'/api/sync',{entity:'progress',value:p});assert.equal(response.status,409,'stale tab cannot overwrite newer position');assert.equal((await response.json()).current.revision,2);
const ann={id:`qa-note-${suffix}`,bookId:book.id,kind:'highlight',range:{start:p.at,end:{...p.at,offset:60}},quote:'A sample passage',color:'yellow',note:'A thought that follows me.',createdAt:Date.now(),updatedAt:Date.now()};
response=await req(a,'/api/sync',{entity:'annotation',value:ann});assert.equal(response.status,200);
response=await req(b,'/api/sync',{entity:'annotation',value:{...ann,id:`qa-foreign-${suffix}`}});assert.equal(response.status,404,'foreign annotations are rejected');
response=await req(phone,'/api/library');assert.deepEqual((await response.json()).annotations.find(x=>x.id===ann.id).note,ann.note,'independent device retrieves notes');
response=await req(a,'/api/sync',{entity:'annotation',value:{...ann,deleted:true,updatedAt:Date.now()+1}});assert.equal(response.status,200);
response=await req(phone,'/api/library');assert.equal((await response.json()).annotations.find(x=>x.id===ann.id).deleted,true,'annotation deletions follow the account');
const prefs={paper:'Dusk',font:'Literata',size:24,spacing:'Airy',turn:'Curl',wideLayout:'single',warmLight:false,restNudge:true,focusParagraph:false,colorNames:{yellow:'Ideas',green:'Agree',blue:'Quotes',pink:'Question'}};
response=await req(a,'/api/sync',{entity:'settings',value:prefs});assert.equal(response.status,200);
response=await req(phone,'/api/library');assert.deepEqual((await response.json()).settings,prefs,'reader preferences follow the account');
const id=crypto.randomUUID();const pdf=new Uint8Array(6*1024*1024);pdf.set(new TextEncoder().encode('%PDF-1.4\nReadwind QA storage test'));
response=await fetch(origin+'/api/files/sign',{method:'POST',headers:{Cookie:a.cookies,Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({id,type:'application/pdf',bytes:pdf.length})});assert.equal(response.status,200,'owner can request a direct upload URL');const grant=await response.json();
response=await fetch(grant.url,{method:grant.method||'PUT',headers:grant.headers,body:pdf});assert.equal(response.status,200,'browser can upload a PDF directly to storage');
response=await fetch(origin+'/api/files/complete',{method:'POST',headers:{Cookie:a.cookies,Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({id,type:'application/pdf',bytes:pdf.length})});assert.equal(response.status,200,'storage verifies the direct upload');
response=await fetch(origin+`/api/files?id=${id}`,{headers:{Cookie:a.cookies,Origin:origin}});assert.equal(response.status,200);assert.equal((await response.arrayBuffer()).byteLength,pdf.length,'owner downloads the exact file');
response=await fetch(origin+`/api/files?id=${id}`,{headers:{Cookie:b.cookies,Origin:origin}});assert.equal(response.status,404,'other accounts cannot download private files');
const signin=await fetch(origin+'/api/auth/sign-in/email',{method:'POST',headers:{'Content-Type':'application/json',Origin:origin},body:JSON.stringify({email:a.email,password:a.password})});assert.equal(signin.status,200,'account signs back in');
// Never persist QA credentials.
await fetch(origin+`/api/library?id=${book.id}`,{method:'DELETE',headers:{Cookie:a.cookies,Origin:origin}});
console.log('PASS: signin, live session, account isolation, book sync, cross-session resume, stale-position conflict, notes, deletion tombstones, settings, private PDF upload/download.');

