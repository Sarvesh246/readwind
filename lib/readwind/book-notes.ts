import type {Book,Section,PageMark} from './types';
import type {PdfLine} from './pdf-layout';
type Note=NonNullable<Book['footnotes']>[number];
/** Keep ambiguous text in place; join a continued note only with adjacent-page geometry. */
export function pageNotes(pages:PdfLine[][],heights:number[],bodySize:number):Note[]{
 const notes:Note[]=[];let previous:Note|undefined,previousPage=-1;
 pages.forEach((lines,pageIndex)=>{
  let active:Note|undefined;
  for(const line of lines){
   if(line.header || line.size>=bodySize*.88 || (line.y<heights[pageIndex]*.7 && line.y>heights[pageIndex]*.25)){active=undefined;continue;}
   const match=line.text.match(/^([0-9]{1,3}|[*†‡])\s*[.)]?\s+(.+)/);
   if(match){active={id:crypto.randomUUID(),marker:match[1],text:match[2],pageIndex};notes.push(active);previous=active;previousPage=pageIndex;}
   else if(active){active.text+=' '+line.text;previousPage=pageIndex;}
   else if(previous && previousPage===pageIndex-1 && line.y<heights[pageIndex]*.25 && !/[.!?]$/.test(previous.text) && /^\p{Ll}/u.test(line.text)){active=previous;active.text+=' '+line.text;previousPage=pageIndex;}
  }
 });return notes;
}
export function appendEndnotes(sections:Section[],marks:PageMark[],notes:Note[]){
 for(const [si,section]of sections.entries()){
  if(!/^(?:endnotes|notes|notas|anmerkungen|примечания)$/iu.test(section.title.trim()))continue;
  for(const [bi,block]of section.blocks.entries()){
   if(block.type==='figure')continue;
   const match=block.text.match(/^\s*(\d{1,3})[.)]\s+([\s\S]+)/);if(!match)continue;
   const pageIndex=[...marks].reverse().find(m=>m.at.section===si && m.at.block<=bi)?.index;
   if(pageIndex!==undefined)notes.push({id:crypto.randomUUID(),marker:match[1],text:match[2],pageIndex});
  }
 }
 // Bracketed and Unicode raised references are explicit; bare numbers remain prose.
 const supers='⁰¹²³⁴⁵⁶⁷⁸⁹';
 for(const section of sections)for(const block of section.blocks){
  if(block.type==='figure')continue;
  for(const match of block.text.matchAll(/\[(\d{1,3})\]|[⁰¹²³⁴⁵⁶⁷⁸⁹]+/g)){
   const marker=match[1]||[...match[0]].map(c=>supers.indexOf(c)).join(''),candidates=notes.filter(n=>n.marker===marker);
   if(candidates.length!==1)continue;
   const at=match.index!+match[0].length;block.footnoteRefs ||= [];if(!block.footnoteRefs.some(r=>r.at===at))block.footnoteRefs.push({at,noteId:candidates[0].id});
  }
 }
}
