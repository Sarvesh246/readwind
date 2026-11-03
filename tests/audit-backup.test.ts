import {it,expect} from 'vitest';
import {createArchive,readBackup} from '../lib/readwind/backup';
import {checkPayloadSize,boundedFetch} from '../lib/readwind/sync-safety';
import type {Book} from '../lib/readwind/types';
const book:Book={id:'b',title:'Backup',author:'Author',addedAt:1,lastOpenedAt:1,printPageCount:1,pageMarks:[],cover:{kind:'typeset',color:'#112233',fg:'#ffffff'},sections:[{id:'s',title:'Text',heading:false,blocks:[{type:'p',text:'hello'}]}]};
it('restores an encrypted archive larger than the previous attachment limit',async()=>{
 const bytes=new Uint8Array(19*1024*1024);bytes.set(new TextEncoder().encode('%PDF-1.7\n'));
 const books=[0,1,2].map(i=>({...book,id:'b'+i,sourcePdfBlobId:'pdf'+i}));
 const files=books.map(b=>({id:b.sourcePdfBlobId,blob:new Blob([bytes],{type:'application/pdf'})}));
 const archive=await createArchive({format:'folio-backup-1',books,annotations:[],progress:[]},files,'correct password');expect(archive.size).toBeGreaterThan(55*1024*1024);
 const restored=await readBackup(new File([archive],'backup.readwind'),()=> 'correct password');expect(restored.files).toHaveLength(3);expect(restored.files[2].blob.size).toBe(bytes.length);
 await expect(readBackup(new File([archive],'backup.readwind'),()=> 'incorrect password')).rejects.toThrow(/password|damaged/i);
 const corrupted=new Blob([archive.slice(0,archive.size-1),new Uint8Array([255])]);await expect(readBackup(new File([corrupted],'backup.readwind'),()=> 'correct password')).rejects.toThrow();
},30000);
it('checks serialized UTF-8 bytes before queuing a large book',()=>{expect(()=>checkPayloadSize({text:'x'.repeat(3_400_000)})).not.toThrow();expect(()=>checkPayloadSize({text:'本'.repeat(1_200_000)})).toThrow(/too much extracted/);});
it('aborts stalled requests on their deadline',async()=>{const original=globalThis.fetch;globalThis.fetch=async(_input,init)=>new Promise((_resolve,reject)=>init?.signal?.addEventListener('abort',()=>reject(init.signal?.reason)));try{await expect(boundedFetch('https://test.invalid',{},20)).rejects.toThrow();}finally{globalThis.fetch=original;}});

it('streams encrypted frames to a file destination with lazy attachment reads',async()=>{
 const pieces:BlobPart[]=[];let loads=0;
 const blob=new Blob(['%PDF-1.7\n disposable test'],{type:'application/pdf'});
 await createArchive({format:'folio-backup-1',books:[{...book,sourcePdfBlobId:'pdf'}],annotations:[],progress:[]},[{id:'pdf',load:async()=>{loads++;return blob;}}],'correct password',{write:async(part)=>{pieces.push(part);}});
 const restored=await readBackup(new File(pieces,'streamed.readwind'),()=> 'correct password');expect(restored.files[0].blob.size).toBe(blob.size);expect(loads).toBe(2);
});
