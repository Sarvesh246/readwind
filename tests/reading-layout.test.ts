import {describe,it,expect} from 'vitest';
import {contentsRanges} from '../lib/readwind/reading-layout';
import type {Book} from '../lib/readwind/types';
const legacy={id:'old',title:'Book',sections:[
  {id:'toc',title:'Contents',heading:true,blocks:[{type:'p',text:'Cover Title Page Foreword Chapter I: Field Notes Chapter II: A Longer Journey Appendix Notes'}]},
  ...['Cover','Title Page','Foreword','Chapter I: Field Notes','Chapter II: A Longer Journey','Appendix','Notes'].map((title,i)=>({id:`s${i}`,title,heading:true,blocks:[{type:'p',text:'A real paragraph.'}]})),
],pageMarks:Array.from({length:8},(_,i)=>({label:String(i+1),index:i,at:{section:i,block:0,offset:0}}))} as Book;
describe('existing-book reading presentation',()=>{
 it('recovers separate linked contents rows without rewriting text or anchors',()=>{
  const before=JSON.stringify(legacy),text=legacy.sections[0].blocks[0].text!;
  const ranges=contentsRanges(legacy,0,0)!;
  expect(ranges.map(r=>text.slice(r.start,r.end).trim())).toEqual(['Cover','Title Page','Foreword','Chapter I: Field Notes','Chapter II: A Longer Journey','Appendix','Notes']);
  expect(ranges.map(r=>r.pageIndex)).toEqual([1,2,3,4,5,6,7]);
  expect(ranges.map(r=>text.slice(r.start,r.end)).join('')).toBe(text);
  expect(JSON.stringify(legacy)).toBe(before);
 });
 it('preserves every character when a contents entry crosses old paragraph boundaries',()=>{
  const book=structuredClone(legacy);book.sections[0].blocks=[{type:'p',text:'Chapter I: Field'},{type:'p',text:' Notes Chapter II: A Longer Journey'}];
  for(let bi=0;bi<2;bi++){
   const text=book.sections[0].blocks[bi].text!;
   expect(contentsRanges(book,0,bi)!.map(r=>text.slice(r.start,r.end)).join('')).toBe(text);
  }
  expect(contentsRanges(book,0,1)?.map(r=>r.pageIndex)).toEqual([4,5]);
 });
 it('does not reinterpret ordinary book prose as contents',()=>{
  expect(contentsRanges(legacy,4,0)).toBeUndefined();
  const book=structuredClone(legacy);book.sections[0].blocks.push({type:'p',text:'This is the first real paragraph of the book. It discusses a journey and continues in ordinary prose.'});
  expect(contentsRanges(book,0,1)).toBeUndefined();
 });
 it('uses current imports directly and leaves group headings alone',()=>{
  const book=structuredClone(legacy);book.sections[0].blocks=[{type:'p',text:'A chapter',contentsEntry:true,targetPageIndex:5},{type:'h',text:'PART ONE',contentsEntry:true}];
  expect(contentsRanges(book,0,0)).toEqual([{start:0,end:9,pageIndex:5}]);
  expect(contentsRanges(book,0,1)).toBeUndefined();
 });
});
