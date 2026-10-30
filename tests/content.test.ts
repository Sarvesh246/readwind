import {describe,it,expect} from 'vitest';
import {hasReadableContent} from '../lib/readwind/content';
import {wordProgress,labelAt} from '../lib/readwind/anchors';
import type {Book} from '../lib/readwind/types';
const placeholder='[No readable text was detected on this page. See the original PDF.]';
const book:Book={id:'legacy',title:'Book',author:'Author',addedAt:1,lastOpenedAt:1,cover:{kind:'typeset',color:'#222222',fg:'#ffffff'},printPageCount:3,sections:[{id:'chapter',title:'Chapter',heading:true,blocks:[{type:'p',text:placeholder},{type:'p',text:''},{type:'p',text:'Actual book text remains here.'}]}],pageMarks:[0,1,2].map(i=>({label:String(i+1),index:i,at:{section:0,block:i,offset:0}}))};
describe('empty and legacy PDF pages',()=>{
 it('suppresses generated filler and empty blocks while preserving real text and figures',()=>{
  expect(book.sections[0].blocks.map(hasReadableContent)).toEqual([false,false,true]);
  expect(hasReadableContent({type:'figure',blobId:'illustration'})).toBe(true);
  expect(hasReadableContent({type:'quote',text:'No readable text is a phrase in this book.'})).toBe(true);
 });
 it('excludes old import messages from reading time without renumbering saved anchors',()=>{
  expect(wordProgress(book,{section:0,block:2,offset:0})).toMatchObject({before:0,total:5,pct:0});
  expect(labelAt(book,{section:0,block:2,offset:12})).toBe('3');
  expect(book.sections[0].blocks).toHaveLength(3);
 });
});
