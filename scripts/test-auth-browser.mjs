import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';
const origin=process.env.READWIND_TEST_ORIGIN || 'http://127.0.0.1:5173';
const browser=await chromium.launch();
try {
 for(const scenario of ['verified','signin-failure','session-failure','verification-failure','unverified']) {
  const page=await browser.newPage();let signedIn=false,verificationRequests=0;
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  const user={id:'auth-regression-user',name:'Test Reader',email:'reader@example.com',emailVerified:scenario==='verified',createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()};
  await page.route('**/api/**',async route=>{
   const path=new URL(route.request().url()).pathname;
   if(path==='/api/config')return route.fulfill({json:{authUrl:'/api/auth'}});
   if(path==='/api/auth/get-session') {
    if(signedIn&&scenario==='session-failure')return route.fulfill({status:503,json:{error:'Session service unavailable.',message:'Session service unavailable.'}});
    return route.fulfill({json:signedIn?{user,session:{id:'session',userId:user.id,expiresAt:new Date(Date.now()+600000).toISOString()}}:null});
   }
   if(path==='/api/auth/sign-in/email') {
    if(scenario==='signin-failure')return route.fulfill({status:503,json:{error:'Service unavailable. Please retry.',message:'Service unavailable. Please retry.'}});
    signedIn=true;return route.fulfill({json:{user,token:'mock-session-token'}});
   }
   if(path==='/api/auth/email-otp/send-verification-otp') {
    verificationRequests++;
    if(scenario==='verification-failure')return route.fulfill({status:503,json:{message:'Verification delivery unavailable.'}});
    return route.fulfill({json:{success:true}});
   }
   if(path==='/api/library')return route.fulfill({json:{books:[],annotations:[],progress:[],settings:null,nextOffset:null}});
   return route.fulfill({status:400,json:{message:'Unexpected test request.'}});
  });
  await page.goto(origin);await page.getByRole('button',{name:'Sign in to your account',exact:true}).click();
  await page.getByRole('textbox',{name:'Email',exact:true}).fill('reader@example.com');
  await page.getByLabel('Password',{exact:true}).fill('a test password');
  await page.locator('.auth-form').getByRole('button',{name:'Sign in',exact:true}).click();
  if(scenario==='verified') {
   await page.getByRole('button',{name:'Your account',exact:true}).waitFor();
   assert.equal(verificationRequests,0);
  } else if(scenario==='unverified') {
   await page.getByLabel('Verification code',{exact:true}).waitFor();assert.equal(verificationRequests,1);
  } else {
   const expected=scenario==='signin-failure'?'Service unavailable. Please retry.':scenario==='session-failure'?'Session service unavailable.':'Verification delivery unavailable.';
   await page.getByRole('alert').filter({hasText:expected}).waitFor();
   assert.equal(await page.getByLabel('Verification code',{exact:true}).count(),0,'failure must not claim a verification email was sent');
   assert.equal(verificationRequests,scenario==='verification-failure'?1:0);
  }
  assert.deepEqual(errors,[]);console.log('PASS: auth UI',scenario);await page.close();
 }
} finally {await browser.close();}
