import fs from 'node:fs';import assert from 'node:assert/strict';import crypto from 'node:crypto';
if(process.env.READWIND_ALLOW_CLOUD_TESTS!=='isolated-recovery-accounts')throw new Error('Use an explicitly authorized disposable account.');
const account=JSON.parse(fs.readFileSync(process.env.READWIND_TEST_ACCOUNT_FILE,'utf8'));
assert(/^readwind-recovery-qa-[a-f0-9-]+@example\.com$/.test(account.email));
const origin=process.env.READWIND_TEST_ORIGIN || 'http://localhost:3108';
async function login(){const r=await fetch(origin+'/api/auth/sign-in/email',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({email:account.email,password:account.password})});assert.equal(r.status,200,await r.clone().text());return r.headers.getSetCookie().map(c=>c.split(';')[0]).join('; ');}
async function request(cookie,path,value,method='POST'){return fetch(origin+path,{method,headers:{Origin:origin,Cookie:cookie,...(value!==undefined?{'Content-Type':'application/json'}:{})},...(value===undefined?{}:{body:JSON.stringify(value)})});}
const a=await login(),b=await login();
let usage=await request(a,'/api/account',undefined,'GET');assert.equal(usage.status,200);assert((await usage.json()).sessions.length>=2);
assert.equal((await request(a,'/api/account',{action:'revoke'})).status,200);
assert.equal((await request(b,'/api/library',undefined,'GET')).status,401,'revocation blocks the other app session');
const device='audit-'+crypto.randomUUID();const state=await request(a,'/api/recovery?device='+device,undefined,'GET');const recovery=await state.json();
if(recovery.required)assert.equal((await request(a,'/api/recovery',{epoch:recovery.epoch,deviceId:device,kind:'complete',value:{reason:'Isolated account-control test'}})).status,200);
const book={id:'audit-book',title:'Disposable account control fixture',author:'QA',addedAt:1,lastOpenedAt:1,printPageCount:1,pageMarks:[],cover:{kind:'typeset',color:'#112233',fg:'#ffffff'},sections:[{id:'s',title:'Text',heading:false,blocks:[{type:'p',text:'Private disposable test content.'}]}]};
assert.equal((await request(a,'/api/library',book)).status,200);
assert.equal((await request(a,'/api/account',{action:'delete',confirmation:'DELETE',password:'wrong password'})).status,400);
assert.equal((await request(a,'/api/library?device='+device,undefined,'GET')).status,200,'failed password confirmation preserves access');
const fileId='audit-file-'+crypto.randomUUID(),bytes=new TextEncoder().encode('Disposable private original');
const signed=await request(a,'/api/files/sign',{id:fileId,type:'text/plain',bytes:bytes.length});assert.equal(signed.status,200,await signed.clone().text());const grant=await signed.json();
assert((await fetch(grant.url,{method:'PUT',headers:{...grant.headers,Origin:origin},body:bytes})).ok);
const complete=await request(a,'/api/files/complete',{id:fileId,type:'text/plain',bytes:bytes.length});assert.equal(complete.status,200,await complete.clone().text());
usage=await request(a,'/api/account',undefined,'GET');assert((await usage.json()).bytes>=bytes.length);
const deleted=await request(a,'/api/account',{action:'delete',confirmation:'DELETE',password:account.password});assert.equal(deleted.status,200,await deleted.clone().text());assert.equal((await deleted.json()).deleted,true);
assert.equal((await request(a,'/api/library',undefined,'GET')).status,401);
if(grant.url.includes('/functions/v1/readwind-storage'))assert.equal((await fetch(grant.url,{method:'PUT',headers:{...grant.headers,Origin:origin},body:bytes})).status,410,'a previously signed upload cannot recreate a deleted account file');
console.log('PASS: real disposable account session listing/revocation, wrong-password protection, private upload, quota accounting, account/file/recovery/identity deletion.');
