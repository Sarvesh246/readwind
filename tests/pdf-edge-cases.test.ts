import {describe,it,expect} from 'vitest';
import {fidelityIssues,structuredBlocks,extractionLoss,textLayerCheck,needsSourcePage,ocrAddsContent} from '../lib/readwind/pdf-fidelity';
import {analyzePdfPage,type PdfLine,type PdfTextItem} from '../lib/readwind/pdf-layout';
import {findPdfTables} from '../lib/readwind/pdf-tables';
import {isContentsTitle,normalizePageLabel} from '../lib/readwind/navigation-labels';
import {contentsChapters,findPrintedPage} from '../lib/readwind/chapters';
import {pageNotes,appendEndnotes} from '../lib/readwind/book-notes';
import {blockLayout} from '../lib/readwind/block-layout';
import {joinPrintedLine} from '../lib/readwind/text-cleanup';
import {readingWordCount} from '../lib/readwind/word-count';
import type {Section,PageMark} from '../lib/readwind/types';
const line=(text:string,x=30,y=120):PdfLine=>({text,x,y,endX:x+text.length*6,size:12,page:0,header:false});
const glyph=(str:string,x:number,y:number,size=12):PdfTextItem=>({str,transform:[size,0,0,size,x,800-y],width:str.length*6,height:size});
describe('book import edge cases',()=>{
 it('joins CJK print lines without adding English spaces and counts unspaced words',()=>{
  expect(joinPrintedLine('本を','読みます',true,new Set()).text).toBe('本を読みます');
  expect(joinPrintedLine('阅读','这本书',true,new Set()).text).toBe('阅读这本书');
  expect(readingWordCount('这是一本关于学习和阅读的书。')).toBeGreaterThan(3);
  expect(readingWordCount('English words still count normally.')).toBe(5);
 });
 it('preserves poem indentation and stanza gaps without interpreting ordinary prose as verse',()=>{
  const ls=['The road across the evening sky','a star','a path','the way','home','and then a quiet night'].map((s,i)=>line(s,i===2?48:30,120+i*18+(i>2?25:0)));
  const blocks=structuredBlocks(ls)!;expect(blocks[0]).toMatchObject({layout:'verse'});expect(blocks.map(b=>b.text).join('\n')).toContain('   a path');expect(blocks.length).toBe(2);
  expect(structuredBlocks(Array.from({length:12},(_,i)=>line('An ordinary line carries a sentence onward',30,120+i*18)))).toBeUndefined();
 });
 it('allows explicit line-preserving mode for punctuated poetry',()=>{
  const blocks=structuredBlocks([line('One thought.',30,120),line('Another thought.',54,140)],'verse')!;
  expect(blocks[0].text).toBe('One thought.\n    Another thought.');expect(blockLayout(blocks[0])).toMatchObject({whiteSpace:'pre-wrap',textIndent:'0'});
 });
 it('preserves code indentation with a monospace reading font',()=>{
  const ls=[line('function read() {'),line('return 42;',54,140),line('}',30,160)].map(l=>({...l,monospace:true}));
  const block=structuredBlocks(ls)![0];expect(block).toMatchObject({layout:'code',text:'function read() {\n    return 42;\n}'});expect(blockLayout(block).fontFamily).toContain('monospace');expect(fidelityIssues(ls,[],600,800)).not.toContain('technical-text');
 });
 it('preserves named speakers and stage directions',()=>{
  const blocks=structuredBlocks([line('Hamlet: Who goes there?'),line('[A door opens.]',45,140),line('Horatio: A friend.',30,160)])!;
  expect(blocks[0]).toMatchObject({layout:'dialogue'});expect(blocks[0].text).toContain('\n');
 });
 it('reassembles separately positioned list markers and retains nested indentation',()=>{
  const ls=[line('1.',30,120),line('Read the first point.',70,120),line('a) A nested point.',70,140),line('2. Read the next point.',30,160)];
  const blocks=structuredBlocks(ls)!;expect(blocks).toHaveLength(3);expect(blocks[0].text).toBe('1. Read the first point.');expect(blocks[1].text).toMatch(/^ +a\)/);expect(blocks.every(b=>b.type!=='figure'&&b.layout==='list')).toBe(true);
 });
 it('routes equations, superscripts and subscripts to their source appearance',()=>{
  expect(fidelityIssues([line('E = mc^2')],[],600,800)).toContain('technical-text');
  for(const shift of [-5,5])expect(fidelityIssues([line('a2')],[glyph('a',30,120),glyph('2',36,120+shift,7)],600,800)).toContain('technical-text');
 });
 it('preserves three-column prose and mixed code/sidebar layouts',()=>{
  const ls=Array.from({length:3},(_,i)=>[0,1,2].map(c=>line('A longer column of prose that must stay in its own reading lane.',30+c*190,120+i*18))).flat();
  expect(fidelityIssues(ls,[],650,800)).toContain('complex-layout');
  const mixed=Array.from({length:8},(_,i)=>({...line('A line of body text.',30,120+i*18),monospace:i<2}));expect(fidelityIssues(mixed,[],600,800)).toContain('complex-layout');
 });
 it('keeps margin and sidebar prose as text instead of preserving the whole page',()=>{
  const sidebar=[line('A full-width body paragraph crossing the page before the inset begins.'),...Array.from({length:3},(_,i)=>line('A same-font inset sidebar.',300,160+i*18))];
  expect(fidelityIssues(sidebar,[],600,800)).not.toContain('complex-layout');
  const epigraph=[line('A short quotation set in the outer margin.',300,120),line('One more margin line of prose.',300,138)];
  expect(fidelityIssues(epigraph,[],600,800).every(i=>i!=='complex-layout')).toBe(true);
 });
 it('does not mistake a drop cap or a display title for raised technical text',()=>{
  const dropCap=[glyph('P',72,169.12,28.8),glyph('them valid, but most of them poorly veiled excuses for laziness or not having',72,190.01,14.4)];
  expect(fidelityIssues([],[...dropCap],595,842)).not.toContain('technical-text');
  // A genuinely raised footnote marker directly after body text still counts.
  expect(fidelityIssues([],[glyph('a',30,120),glyph('2',36,115,7)],600,800)).toContain('technical-text');
 });
 it('captures aligned text-only tables',()=>{
  const ls=[['Name','Role'],['Anna','Editor'],['Ben','Writer'],['Cara','Artist']].flatMap((r,i)=>r.map((s,c)=>line(s,30+c*220,120+i*20)));
  const tables=findPdfTables(ls);expect(tables).toHaveLength(1);expect(tables[0].text).toContain('Ben\tWriter');
 });
 it('deduplicates overlapping text without deleting repeated words at other positions',()=>{
  const a=glyph('A repeated sentence',30,120),b=glyph('A repeated sentence',30,150);
  const result=analyzePdfPage([a,{...a},b],{width:600,height:800,transform:[1,0,0,-1,0,800]},0);
  expect(result.report.issues).toContain('duplicate-text');expect(result.lines.map(l=>l.text)).toEqual([a.str,b.str]);
 });
 it('checks content counts and does not mark uncertain OCR as a visual match',()=>{
  const a=Array.from({length:70},(_,i)=>`word${String.fromCharCode(65+i%26)}${String.fromCharCode(65+Math.floor(i/26))}`).join(' '),b=Array.from({length:70},(_,i)=>`other${i}`).join(' ');
  expect(extractionLoss(a,a)).toBe(false);expect(extractionLoss(a,a.split(' ').slice(0,30).join(' '))).toBe(true);
  expect(textLayerCheck(a,b,95)).toBe('disagreed');expect(textLayerCheck(a,b,65)).toBe('inconclusive');expect(textLayerCheck(a,a,95)).toBe('matched');expect(textLayerCheck('A title','A title',99)).toBe('inconclusive');
  expect(textLayerCheck(a,a.split(' ').slice(0,50).join(' '),95)).toBe('inconclusive');
  expect(extractionLoss('Balance $1,000 and return 2.5%','Balance and return 2.5%')).toBe(true);
  expect(textLayerCheck(a+' $1,000',a+' $7,000',95)).toBe('disagreed');
  expect(textLayerCheck(a,a.split(' ').reverse().join(' '),95)).toBe('disagreed');
 });
 it('keeps a correct sparse native table and only replaces it when OCR adds actual content',()=>{
  expect(ocrAddsContent('Name Role Anna Editor Ben Writer','Name   Role\nAnna   Editor\nBen   Writer')).toBe(false);
  expect(ocrAddsContent('4','A scanned body has several sentences that the small selectable footer did not contain. 4')).toBe(true);
 });
 it('detects clipping and suspicious text and protects uncertain scripts/scans',()=>{
  expect(fidelityIssues([line('cropped',-15),line('more cropped',-15,140)],[],600,800)).toContain('cropped-text');
  expect(fidelityIssues([line('aaaaaaaaaaaa')],[],600,800)).toContain('suspect-text');
  for(const issue of ['rtl','vertical-text','rotated-text','scan-spread','low-ocr','text-mapping','extraction-error'] as const)expect(needsSourcePage([issue])).toBe(true);
 });
 it('recognizes multilingual contents headings',()=>{
  for(const title of ['Table des matières','Índice','Inhaltsverzeichnis','目次','目录','المحتويات','תוכן עניינים','विषयसूची','Содержание'])expect(isContentsTitle(title),title).toBe(true);
  expect(isContentsTitle('The contents of this chapter')).toBe(false);
 });
 it('finds contents beyond page 80 and resolves appendix page labels',()=>{
  const pages:PdfLine[][]=Array.from({length:101},()=>[]);pages[90]=[line('Sommaire'),line('Appendix guide .... A-12',30,150)];pages[100]=[{...line('Appendix guide',30,180),size:24}];
  const labels=pages.map((_,i)=>`PDF ${i+1}`);labels[100]='A-12';const r=contentsChapters(pages,labels);
  expect(r.contentsPages.has(90)).toBe(true);expect(r.chapters.get(100)).toBe('Appendix guide');expect(normalizePageLabel('A–١٢')).toBe('a-12');
 });
 it('does not turn chapter headings and backward citation links in endnotes into contents',()=>{
  const pages:PdfLine[][]=Array.from({length:25},()=>[]),outlines=new Map([[2,'First journey'],[3,'Second journey'],[4,'Third journey']]);
  pages[0]=[line('Contents'),line('First journey .... 1',30,150),line('Second journey .... 2',30,170),line('Third journey .... 3',30,190)];
  for(const [i,title]of outlines)pages[i]=[{...line(title,30,180),size:24}];
  pages[20]=[line('First journey'),line('Second journey',30,140),line('Third journey',30,160),line('1. A long citation from the body of the book.',30,180)];
  const labels=pages.map((_,i)=>`PDF ${i+1}`);labels[2]='1';labels[3]='2';labels[4]='3';
  const r=contentsChapters(pages,labels,new Map([[20,[{index:2,top:100,bottom:125},{index:3,top:130,bottom:145},{index:4,top:150,bottom:165}]]]),undefined,outlines);
  expect(r.contentsPages.has(20)).toBe(false);expect(r.chapters.size).toBe(3);
 });
 it('resolves corroborated facing-page aliases without resolving ambiguous labels',()=>{
  const marks:PageMark[]=[{index:0,label:'PDF 1',at:{section:0,block:0,offset:0}},{index:1,label:'PDF 2',at:{section:0,block:1,offset:0}}];
  expect(findPrintedPage(marks,'١٣',[{label:'12',index:0},{label:'13',index:0}])?.index).toBe(0);
  expect(findPrintedPage(marks,'12',[{label:'12',index:0},{label:'12',index:1}])).toBeUndefined();
 });
 it('joins a continued footnote across adjacent pages while retaining its source location',()=>{
  const pages=[[{...line('1 A note that continues',30,700),size:8}],[{...line('on the following page.',30,100),size:8}]];
  const notes=pageNotes(pages,[800,800],12);expect(notes).toHaveLength(1);expect(notes[0]).toMatchObject({pageIndex:0,text:'A note that continues on the following page.'});
 });
 it('links explicit endnote references and leaves ambiguous bare numbers alone',()=>{
  const sections:Section[]=[{id:'s',heading:true,title:'Opening',blocks:[{type:'p',text:'A source [7], and a year 7.'}]},{id:'n',heading:true,title:'Endnotes',blocks:[{type:'p',text:'7. The original reference.'}]}];
  const marks:PageMark[]=[{label:'1',index:0,at:{section:0,block:0,offset:0}},{label:'2',index:1,at:{section:1,block:0,offset:0}}],notes:NonNullable<import('../lib/readwind/types').Book['footnotes']>=[];
  appendEndnotes(sections,marks,notes);expect(notes).toHaveLength(1);expect(sections[0].blocks[0]).toMatchObject({footnoteRefs:[{at:12,noteId:notes[0].id}]});
 });
});
