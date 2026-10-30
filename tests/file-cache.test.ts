import {describe,it,expect} from 'vitest';
import {encodeFile,storedBlob} from '../lib/readwind/db';
describe('portable file cache',()=>{
 it('preserves exact PDF bytes and MIME type without storing a Blob in IndexedDB',async()=>{
  const blob=new Blob(['%PDF-1.4\n',new Uint8Array([0,128,255,10])],{type:'application/pdf'});
  const encoded=await encodeFile({id:'pdf',blob});
  expect('blob' in encoded).toBe(false);
  const decoded=storedBlob(encoded);
  expect(decoded.type).toBe('application/pdf');
  expect(new Uint8Array(await decoded.arrayBuffer())).toEqual(new Uint8Array(await blob.arrayBuffer()));
 });
 it('continues reading legacy Blob records',async()=>{
  const blob=new Blob(['legacy image'],{type:'image/png'});
  expect(storedBlob({id:'legacy',blob})).toBe(blob);
 });
});
