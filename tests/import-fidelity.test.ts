import {describe,it,expect} from 'vitest';
import {normalizeStyledText,pdfFontStyle} from '../lib/readwind/rich-text';
import {findPdfTables} from '../lib/readwind/pdf-tables';
import {analyzePdfPage,type PdfLine} from '../lib/readwind/pdf-layout';
import {contentsChapters,addChapterAtPage} from '../lib/readwind/chapters';
import {joinPageParagraphs} from '../lib/readwind/text-cleanup';
import type {Book,Section,PageMark} from '../lib/readwind/types';
const line=(text:string,x:number,y:number):PdfLine=>({text,x,y,endX:x+60,size:12,page:0,header:false});
describe('PDF fidelity across book designs',()=>{
 it('reflows a sentence across PDF pages and can split a manual chapter at its exact page anchor',()=>{
  const text='A paragraph continues naturally across the physical page boundary with the same thought about';
  const sections:Section[]=[{id:'s',title:'Opening',heading:true,blocks:[{type:'p',text},{type:'p',text:'reading well.',styles:[{start:0,end:7,italic:true}],footnoteRefs:[{at:7,noteId:'n'}]},{type:'p',text:'A new paragraph.'}]}];
  const marks:PageMark[]=[{label:'1',index:0,at:{section:0,block:0,offset:0}},{label:'2',index:1,at:{section:0,block:1,offset:0}},{label:'3',index:2,at:{section:0,block:2,offset:0}}];
  joinPageParagraphs(sections,marks,new Set([1]),true,new Set());
  expect(sections[0].blocks[0].text).toBe(text+' reading well.');expect(marks[1].at).toEqual({section:0,block:0,offset:text.length+1});
  const split=addChapterAtPage({sections,pageMarks:marks} as Book,'2','Next');
  expect(split.sections[1].blocks[0]).toMatchObject({text:'reading well.',styles:[{start:0,end:7,italic:true}],footnoteRefs:[{at:7,noteId:'n'}]});expect(split.pageMarks[1].at).toEqual({section:1,block:0,offset:0});expect(split.pageMarks[2].at).toEqual({section:1,block:1,offset:0});
 });
 it('retains real font emphasis without interpreting opaque PDF font IDs as styles',()=>{
  expect(pdfFontStyle({name:'DejaVuSans-Bold'}).bold).toBe(true);
  expect(pdfFontStyle({name:'ACaslonPro-Italic'}).italic).toBe(true);
  expect(pdfFontStyle({name:'g_d0_f17'})).toEqual({bold:false,italic:false});
  expect(normalizeStyledText('  A   careful thought  ',[{start:6,end:13,italic:true}])).toEqual({text:'A careful thought',runs:[{start:2,end:9,italic:true}]});
 });
 it('assembles mixed-weight fragments with valid character offsets',()=>{
  const r=analyzePdfPage([{str:'A ',width:12,height:12,transform:[12,0,0,12,20,700]},{str:'bold',bold:true,width:25,height:12,transform:[12,0,0,12,32,700]}],{width:600,height:800,transform:[1,0,0,-1,0,800]},0);
  expect(r.lines[0].text).toBe('A bold');expect(r.lines[0].styles).toEqual([{start:2,end:6,bold:true,italic:undefined}]);
 });
 it('preserves aligned financial cells as a faithful table region',()=>{
  const r=findPdfTables([line('Year',20,100),line('Value',200,100),...Array.from({length:4},(_,i)=>[line(String(2020+i),20,120+i*20),line(`$${100+i*25}.50`,200,120+i*20)]).flat()]);
  expect(r).toHaveLength(1);expect(r[0].text).toContain('2022\t$150.50');expect(r[0].lines).toHaveLength(10);
 });
 it('keeps numbered prose and two-column paragraphs out of table conversion',()=>{
  const prose=Array.from({length:4},(_,i)=>[line(`${i+1}.`,20,100+i*20),line('A useful instruction.',70,100+i*20)]).flat();
  expect(findPdfTables(prose)).toEqual([]);
  expect(findPdfTables(Array.from({length:4},(_,i)=>[line(`Left ${i}`,20,100+i*20),line(`Right ${i}`,300,100+i*20)]).flat())).toEqual([]);
 });
 it('recognizes headerless and continuing contents from corroborating bookmarks',()=>{
  const titles=['First journey','Second journey','Third journey','Fourth journey','Fifth journey','Sixth journey'];
  const pages=[titles.slice(0,3).map((t,i)=>line(t,30,100+i*30)),titles.slice(3).map((t,i)=>line(t,30,100+i*30)),...titles.map(t=>[line(t,30,150)])];
  const outlines=new Map(titles.map((title,i)=>[i+2,title]));
  const links=new Map([[0,titles.slice(0,3).map((title,i)=>({title,index:i+2,top:90+i*30,bottom:105+i*30}))],[1,titles.slice(3).map((title,i)=>({title,index:i+5,top:90+i*30,bottom:105+i*30}))]]);
  const r=contentsChapters(pages,pages.map((_,i)=>`PDF ${i+1}`),links,undefined,outlines);
  expect([...r.contentsPages]).toEqual([0,1]);expect([...r.chapters.values()]).toEqual(titles);
 });
 it('separates linked chapter titles from their subtitles and descriptive prose',()=>{
  const pages=[[line('Contents',20,100),line('CHAPTER 1',20,140),line('A useful chapter',20,170),line('A helpful subtitle',20,200),line('A paragraph describing the chapter.',20,230)],[],[]];
  const r=contentsChapters(pages,['PDF 1','PDF 2','PDF 3'],new Map([[0,[{top:130,bottom:145,index:2},{top:160,bottom:175,index:2},{top:190,bottom:205,index:2}]]]),undefined,new Map([[2,'A useful chapter']]));
  expect(r.chapters.get(2)).toBe('A useful chapter');expect(r.entriesByPage.get(0)?.some(e=>e.title==='A helpful subtitle'&&e.description)).toBe(true);
 });
 it('reflows descriptive contents lines without flattening the clickable chapter rows',()=>{
  const pages=[[line('Contents',20,100),line('First chapter',20,140),{...line('An italic subtitle',20,170),styles:[{start:0,end:18,italic:true}]},line('A description that continues',20,200),line('onto its next printed line.',20,216),line('Second chapter',20,250)],[],[]];
  const r=contentsChapters(pages,['PDF 1','PDF 2','PDF 3'],new Map([[0,[{top:130,bottom:145,index:1},{top:240,bottom:255,index:2}]]]),undefined,new Map([[1,'First chapter'],[2,'Second chapter']]));
  expect(r.entriesByPage.get(0)?.find(e=>e.title.startsWith('A description'))?.title).toBe('A description that continues onto its next printed line.');
  expect(r.entriesByPage.get(0)?.find(e=>e.title==='An italic subtitle')?.styles?.[0].italic).toBe(true);expect(r.chapters.size).toBe(2);
 });
});
