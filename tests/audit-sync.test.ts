import {beforeEach,afterEach,it,expect,vi} from 'vitest';
import {PGlite} from '@electric-sql/pglite';
import {readFileSync} from 'node:fs';
import type {Book} from '../lib/readwind/types';
import {wordProgress,start} from '../lib/readwind/anchors';
const state=vi.hoisted(()=>({pg:null as PGlite|null,mutate:false}));
vi.mock('../lib/readwind/server',()=>({owner:async()=> 'alice',unauthorized:()=>new Response(null,{status:401}),rateLimit:async()=>{},sql:()=>async(strings:TemplateStringsArray,...values:unknown[])=>{
 const query=strings.reduce((out,part,i)=>out+(i?'$'+i:'')+part,'');
 if(state.mutate && query.includes('SELECT data FROM folio_annotations')){state.mutate=false;await state.pg!.exec("UPDATE folio_account_revisions SET revision=revision+1 WHERE owner_id='alice'");}
 return (await state.pg!.query(query,values)).rows;
}}));
import {POST} from '../app/api/sync/route';
import {GET} from '../app/api/library/route';
import {saveLiveBook} from '../lib/readwind/book-deletion';
const template:Book={id:'book',title:'Book',author:'Author',addedAt:1,lastOpenedAt:1,printPageCount:1,pageMarks:[],cover:{kind:'typeset',color:'#112233',fg:'#ffffff'},sections:[{id:'s',title:'Text',heading:false,blocks:[{type:'p',text:'hello'}]}]};
beforeEach(async()=>{state.pg=new PGlite();await state.pg.exec(readFileSync('db/folio.sql','utf8'));await state.pg.exec("CREATE TABLE folio_account_revisions(owner_id text PRIMARY KEY,revision bigint,books_revision bigint);INSERT INTO folio_account_revisions VALUES('alice',1,1)");vi.stubEnv('READWIND_BACKEND','supabase');vi.stubEnv('READWIND_RECOVERY_EPOCH','');});
afterEach(async()=>{await state.pg?.close();vi.unstubAllEnvs();});
for(const text of ['私は毎日図書館で本を読みます。今日は楽しいです。','我每天在图书馆读书。今天很开心。','Read 本を reading 日本語 today','An ordinary English sentence.'])it('syncs and reloads Unicode progress: '+text,async()=>{
 const b={...template,sections:[{...template.sections[0],blocks:[{type:'p' as const,text}]}]};
 await state.pg!.query('INSERT INTO folio_books VALUES($1,$2,$3,now())',['alice',b.id,b]);
 const total=wordProgress(b,start).total;
 const post=(words:number,revision=0)=>POST(new Request('https://readwind.test/api/sync',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({entity:'progress',value:{bookId:b.id,at:{...start,offset:text.length},wordsRead:words,revision,deviceId:'qa'}})}));
 expect((await post(total)).status).toBe(200);
 const page=await GET(new Request('https://readwind.test/api/library'));expect(((await page.json()) as {progress:{wordsRead:number}[]}).progress[0].wordsRead).toBe(total);
 expect((await post(total+1,1)).status).toBe(400);
});
it('rejects both mid-page changes and stale subsequent-page tokens',async()=>{
 for(let i=0;i<25;i++)await state.pg!.query('INSERT INTO folio_books VALUES($1,$2,$3,now())',['alice','book'+i,{...template,id:'book'+i}]);
 const first=await GET(new Request('https://readwind.test/api/library'));expect(first.status).toBe(200);expect(first.headers.get('x-readwind-snapshot')).toBe('1');
 await state.pg!.exec("UPDATE folio_account_revisions SET revision=2");
 const stale=await GET(new Request('https://readwind.test/api/library?offset=10',{headers:{'X-Readwind-Snapshot':'1'}}));expect(stale.status).toBe(409);
 state.mutate=true;expect((await GET(new Request('https://readwind.test/api/library'))).status).toBe(409);
 expect((await GET(new Request('https://readwind.test/api/library?verify=1',{headers:{'X-Readwind-Snapshot':'2'}}))).status).toBe(409);
});
it('retains a note deletion tombstone when an older edit arrives',async()=>{
 await state.pg!.query('INSERT INTO folio_books VALUES($1,$2,$3,now())',['alice',template.id,template]);
 const value={id:'note',bookId:'book',kind:'highlight',range:{start,end:start},color:'yellow',quote:'',note:'Original',createdAt:1,updatedAt:1};
 const send=(a:object)=>POST(new Request('https://readwind.test/api/sync',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({entity:'annotation',value:a})}));
 expect((await send(value)).status).toBe(200);
 expect((await send({...value,revision:1,deleted:true})).status).toBe(200);
 const stale=await send({...value,revision:1,note:'Offline edit'});expect(stale.status).toBe(409);expect(((await stale.json()) as {alternate:{deleted:boolean}}).alternate.deleted).toBe(true);
});
it('conditionally saves book revisions without replacing a newer version',async()=>{
 const tag=async(strings:TemplateStringsArray,...values:unknown[])=>(await state.pg!.query(strings.reduce((s,t,i)=>s+(i?'$'+i:'')+t,''),values)).rows;
 await saveLiveBook(tag,'alice',{...template,revision:1},false,false,undefined,0);
 expect(await saveLiveBook(tag,'alice',{...template,title:'First edit',revision:2},false,false,undefined,1)).toHaveLength(1);
 expect(await saveLiveBook(tag,'alice',{...template,title:'Stale edit',revision:2},false,false,undefined,1)).toHaveLength(0);
});
