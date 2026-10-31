import {describe,it,expect} from 'vitest';
import {bookWordEvidence,joinPrintedLine,repairOcrText,joinPageParagraphs} from '../lib/readwind/text-cleanup';
import {structuredBlocks} from '../lib/readwind/pdf-fidelity';
import type {Section,PageMark} from '../lib/readwind/types';
describe('faithful line joining',()=>{
 it('preserves compound words instead of inventing new spellings',()=>{
  const words=bookWordEvidence([[{text:'The early-morning light returned.'},{text:'Preparation matters.'}]]);
  expect(joinPrintedLine('The early-','morning light',true,words)).toEqual({text:'The early-morning light',fixed:false});
  expect(joinPrintedLine('Prepa-','ration matters',true,words)).toEqual({text:'Preparation matters',fixed:true});
 });
 it('keeps uncertain hyphens and honors the cleanup option',()=>{
  expect(joinPrintedLine('An unfamiliar-','compound',true,new Set()).text).toBe('An unfamiliar-compound');
  expect(joinPrintedLine('Prepa-','ration',false,new Set(['preparation'])).text).toBe('Prepa-ration');
  expect(joinPrintedLine('A complete thought.','Another thought.',true,new Set()).text).toBe('A complete thought. Another thought.');
 });
});
describe('sentences split by page breaks and wrapped lists',()=>{
 it('removes the hyphen from a split word ending even when the book never uses the whole word',()=>{
  expect(joinPrintedLine('Frankl, frustra-','tion in the',true,new Set()).text).toBe('Frankl, frustration in the');
  expect(joinPrintedLine('the well-','known author',true,new Set()).text).toBe('the well-known author');
 });
 it('repairs OCR punctuation in place of a space and straight apostrophes',()=>{
  expect(repairOcrText("there were surprises in.store, people:how it's done")).toBe("there were surprises in. store, people: how it’s done");
  expect(repairOcrText('see bitcoin.reddit.com and index.html')).toBe('see bitcoin.reddit.com and index.html');
 });
 it('rejoins a lowercase continuation anywhere, keeping page marks at their character offset',()=>{
  const p=(text:string)=>({type:'p' as const,text});
  const sections:Section[]=[{id:'s',title:'t',heading:false,blocks:[p('I had come up to Harvard to take a short executive negotiating'),p('course, to see what I could learn.'),p('A new paragraph begins here.')]}];
  const marks:PageMark[]=[{label:'2',index:1,at:{section:0,block:1,offset:0}},{label:'3',index:2,at:{section:0,block:2,offset:0}}];
  joinPageParagraphs(sections,marks,new Set(),true,new Set());
  expect(sections[0].blocks.map(b=>b.type==='figure'?'':b.text)).toEqual(['I had come up to Harvard to take a short executive negotiating course, to see what I could learn.','A new paragraph begins here.']);
  expect(marks[0].at).toEqual({section:0,block:0,offset:'I had come up to Harvard to take a short executive negotiating '.length});expect(marks[1].at.block).toBe(1);
 });
 it('flows wrapped list items and keeps surrounding prose out of the list',()=>{
  const l=(text:string,x:number,y:number)=>({text,x,y,endX:x+text.length*6,size:12,page:0,header:false});
  const blocks=structuredBlocks([l('Here is why this matters to you today',30,100),l('1. Use the late-night voice, which',30,130),l('is calm and slow.',50,144),l('2. Start with sorry.',30,158),l('Then the paragraph continues as prose here.',30,200)])!;
  expect(blocks.map(b=>b.type==='figure'?'':b.text)).toEqual(['Here is why this matters to you today','1. Use the late-night voice, which is calm and slow.','2. Start with sorry.','Then the paragraph continues as prose here.']);
  expect(blocks.map(b=>b.type==='figure'?'':b.layout)).toEqual([undefined,'list','list',undefined]);
 });
 it('does not read two labelled sentences inside prose as a script',()=>{
  const l=(text:string,y:number)=>({text,x:30,y,endX:30+text.length*6,size:12,page:0,header:false});
  const prose=Array.from({length:14},(_,i)=>l(i===3?'Remember: calm voices win more often':i===9?'Result: they listen to what you say':'An ordinary line carries a sentence onward',100+i*14));
  expect(structuredBlocks(prose)).toBeUndefined();
 });
});
describe('hyphenated compounds cut by a block break',()=>{
 it('joins a capitalised second half after a line-end hyphen',()=>{
  const p=(text:string)=>({type:'p' as const,text});
  const sections:Section[]=[{id:'s',title:'t',heading:false,blocks:[p('Crumbaugh, James C., Everything to Gain: A Guide to Self-'),p('Fulfillment Through Logoanalysis. Chicago, 1973.')]}];
  joinPageParagraphs(sections,[],new Set(),true,new Set());
  expect(sections[0].blocks).toHaveLength(1);expect((sections[0].blocks[0] as {text:string}).text).toContain('Self-Fulfillment Through');
 });
});
