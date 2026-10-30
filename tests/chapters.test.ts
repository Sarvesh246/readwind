import { describe, expect, it } from 'vitest';
import { addChapterAtPage, contentsChapters, findPrintedPage, printedLabels, interpolatePrintedLabels, pageHeading } from '../lib/readwind/chapters';
import { ocrLines, ocrScore } from '../lib/readwind/ocr';
import type { Book } from '../lib/readwind/types';
import type { Page } from 'tesseract.js';

const line = (text:string, y=100, header=false) => ({text,y,header,size:12});
describe('printed page and chapter reliability', () => {
  it('does not invent printed numbers for front matter or beyond supported anchors', () => {
    expect(printedLabels([[],[line('1',760,true)],[],[line('3',760,true)],[]])).toEqual(['PDF 1','1','2','3','PDF 5']);
  });
  it('prefers visible numbers to embedded PDF labels', () => {
    expect(printedLabels([[line('ix',760,true)],[line('1',760,true)]],['1','2'])).toEqual(['ix','1']);
  });
  it('maps contents entries to printed pages instead of PDF positions', () => {
    const pages = [[],[line('Table of Contents'),line('First journey .... 1',140),line('Second journey .... 3',160)],[],[line('First journey')],[],[line('Second journey')]];
    const result=contentsChapters(pages,['PDF 1','ii','iii','1','2','3']);
    expect([...result.chapters]).toEqual([[3,'First journey'],[5,'Second journey']]);
    expect(result.unresolved).toEqual([]);
  });
  it('reassembles right-aligned contents numbers and resolves missing labels by exact heading', () => {
    const labels=['PDF 1','PDF 2','PDF 3'];
    const result=contentsChapters([[line('Contents'),line('Alpha',140),line('1',140),line('Beta',160),line('2',160)],[line('Alpha')],[line('Beta')]],labels);
    expect([...result.chapters.keys()]).toEqual([1,2]);expect(labels).toEqual(['PDF 1','1','2']);
  });
  it('flags conflicts and unresolved entries instead of guessing offsets', () => {
    const result=contentsChapters([[line('Contents'),line('Alpha ... 1',140),line('Missing ... 2',160)],[line('Other')],[line('Alpha')]],['PDF 1','1','PDF 3']);
    expect(result.chapters.size).toBe(0);expect(result.unresolved).toEqual(['Alpha','Missing']);
  });
  it('rejects ambiguous page labels in navigation', () => {
    expect(findPrintedPage([{label:'1',index:0,at:{section:0,block:0,offset:0}},{label:'1',index:1,at:{section:0,block:1,offset:0}}],'1')).toBeUndefined();
  });
  it('does not interpolate across numbering resets or Roman front matter', () => {
    expect(interpolatePrintedLabels(['ix','PDF 2','1','PDF 4','3','1','PDF 7','3'])).toEqual(['ix','PDF 2','1','2','3','1','2','3']);
    expect(interpolatePrintedLabels(['1','PDF 2','1'])).toEqual(['1','PDF 2','1']);
  });
  it('uses contents links when labels and headings are missing', () => {
    const result=contentsChapters([[line('Contents'),line('Alpha ... 1',140),line('Beta ... 3',160)],[],[],[]],['PDF 1','PDF 2','PDF 3','PDF 4'],new Map([[0,[{top:130,bottom:145,index:1},{top:150,bottom:165,index:3}]]]));
    expect([...result.chapters]).toEqual([[1,'Alpha'],[3,'Beta']]);
  });
  it('flags a contents link that conflicts with a visible printed number', () => {
    const result=contentsChapters([[line('Contents'),line('Alpha ... 1',140),line('Beta ... 3',160)],[],[],[]],['PDF 1','1','PDF 3','3'],new Map([[0,[{top:130,bottom:145,index:2}]]]));
    expect(result.chapters.has(2)).toBe(false);expect(result.unresolved).toContain('Alpha');
  });
  it('does not treat a large Roman chapter heading as a printed page number', () => {
    expect(printedLabels([[{...line('I',50,true),size:26},line('This is a complete paragraph of body text.')]])).toEqual(['PDF 1']);
  });
  it('recognizes a linked, numberless contents page with wrapped titles',()=>{
    const pages=[[],[line('Contents'),line('A journey through',140),line('a changing world',160),line('Afterword',190)],[],[]];
    const links=new Map([[1,[{top:130,bottom:145,index:2},{top:150,bottom:165,index:2},{top:180,bottom:195,index:3}]]]);
    const result=contentsChapters(pages,['PDF 1','PDF 2','PDF 3','PDF 4'],links);
    expect([...result.chapters]).toEqual([[2,'A journey through a changing world'],[3,'Afterword']]);
    expect(result.entriesByPage.get(1)).toHaveLength(2);
  });
  it('recognizes contents even when its entries cannot be resolved',()=>{
    const result=contentsChapters([[line('"Contents'),line('An unknown chapter',140)],[]],['PDF 1','PDF 2']);
    expect(result.contentsPages.has(0)).toBe(true);
    expect(result.unresolved).toEqual(['An unknown chapter']);
  });
  it('retains linked entries that point to earlier front matter',()=>{
    const result=contentsChapters([[],[],[line('Contents'),line('Title page',140)]],['PDF 1','PDF 2','PDF 3'],new Map([[2,[{top:130,bottom:145,index:0}]]]));
    expect(result.entriesByPage.get(2)?.[0].target).toBe(0);
  });
  it('joins all display lines of a chapter title and rejects body fragments',()=>{
    const title=[{...line('A journey through',180),size:24},{...line('a changing world',210),size:24},line('A normal paragraph follows with a full sentence.',270)];
    expect(pageHeading(title,12)?.title).toBe('A journey through a changing world');
    expect(pageHeading([{...line('all, there was longing for home',100),size:20}],12)).toBeUndefined();
    expect(pageHeading([{...line('With their hands on the door jambs our-',100),size:20}],12)).toBeUndefined();
  });
  it('reads inline page numbers only with corroborating neighboring headers',()=>{
    expect(printedLabels([[line('A running title 33',75)],[line('34 A running title',75)], [line('Body text ends with 2026',90)]])).toEqual(['33','34','PDF 3']);
  });
  it('does not mistake chapter numbers in top-of-page titles for printed labels',()=>{
    const pages=[0,1].map(i=>[{...line(`Chapter ${i+1}`,92),size:22},line('A full paragraph of ordinary body text follows.',145)]);
    expect(printedLabels(pages,null,[792,792])).toEqual(['PDF 1','PDF 2']);
  });
  it('preserves contents group headings without promoting them to chapters',()=>{
    const result=contentsChapters([[line('Contents'),line('PART ONE',140),line('A beginning 7',170),line('PART TWO',200),line('A conclusion 15',230)],[],[]],['PDF 1','7','15']);
    expect([...result.chapters.values()]).toEqual(['A beginning','A conclusion']);
    expect(result.entriesByPage.get(0)?.filter(e=>e.group).map(e=>e.title)).toEqual(['PART ONE','PART TWO']);
  });
  it('corrects isolated OCR digit errors without rewriting native printed numbers',()=>{
    const numbers=['131','132','133','184','135','186','137','139'];
    const pages=numbers.map(n=>[{...line(n,760,true),ocr:true}]);
    expect(printedLabels(pages)).toEqual(['131','132','133','134','135','136','137','139']);
    expect(printedLabels(numbers.map(n=>[line(n,760,true)]))[3]).toBe('184');
  });
  it('handles italic OCR page digits in contents when the target is corroborated',()=>{
    const result=contentsChapters([[line('Contents'),line('A useful chapter ror',140),line('A later chapter 105',170)],[],[]],['PDF 1','101','105']);
    expect([...result.chapters]).toEqual([[1,'A useful chapter'],[2,'A later chapter']]);
  });
  it('keeps differently sized lines of a scanned heading together',()=>{
    expect(pageHeading([{...line('A journey through',180),size:25,ocr:true},{...line('a changing world',205),size:17,ocr:true}],8)?.title).toBe('A journey through a changing world');
    expect(pageHeading([{...line('A normal body line with capitals',110),size:10,ocr:true}],8)).toBeUndefined();
  });
  it('splits a chapter at the printed page and preserves all text and anchors', () => {
    const book={sections:[{id:'a',title:'Beginning',heading:false,blocks:[{type:'p',text:'First'},{type:'p',text:'Second'},{type:'p',text:'Third'}]}],pageMarks:[{label:'ix',index:0,at:{section:0,block:0,offset:0}},{label:'1',index:1,at:{section:0,block:1,offset:0}},{label:'2',index:2,at:{section:0,block:2,offset:0}}]} as Book;
    const result=addChapterAtPage(book,'1','Chapter one');
    expect(result.sections.flatMap(s=>s.blocks.map(b=>b.text))).toEqual(['First','Second','Third']);
    expect(result.pageMarks[1].at).toEqual({section:1,block:0,offset:0});
    expect(result.pageMarks[2].at).toEqual({section:1,block:1,offset:0});
    expect(book.sections).toHaveLength(1);
    expect(()=>addChapterAtPage(book,'3','Missing')).toThrow('missing');
  });
});
describe('OCR quality and layout', () => {
  it('rejects empty output and discounts high-confidence garbage', () => {
    expect(ocrScore({text:'',confidence:95})).toBe(0);
    expect(ocrScore({text:'||| @@ ~~~~ a',confidence:95})).toBeLessThan(30);
    expect(ocrScore({text:'A readable sentence.',confidence:90})).toBe(90);
  });
  it('preserves recognized positions for paragraphs and printed footer labels', () => {
    const data={blocks:[{paragraphs:[{lines:[{text:'Body text',bbox:{x0:120,x1:600,y0:300,y1:336}},{text:'12',bbox:{x0:800,x1:840,y0:2280,y1:2316}}]}]}]} as Page;
    const lines=ocrLines(data,600,800,1800,2400,4);
    expect(lines[0]).toMatchObject({x:40,y:112,size:12,page:4,header:false});
    expect(lines[1]).toMatchObject({text:'12',header:true,y:772});
  });
});
