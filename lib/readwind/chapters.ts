import type { Book, PageMark } from './types';
import {dominantSize} from './pdf-layout';

export type SourceLine = { text: string; header: boolean; y: number; size: number; x?:number; endX?:number; ocr?:boolean };
const key = (s: string) => s.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
const pageToken = /^(?:[1-9]\d*|[ivxlcdm]+)$/i;

export function interpolatePrintedLabels(labels: string[]): string[] {
  return labels.map((label, i) => {
    if (!label.startsWith('PDF ')) return label;
    let left=i-1, right=i+1;
    while (left>=0 && labels[left].startsWith('PDF ')) left--;
    while (right<labels.length && labels[right].startsWith('PDF ')) right++;
    if (left<0 || right>=labels.length || !/^\d+$/.test(labels[left]) || !/^\d+$/.test(labels[right])) return label;
    return Number(labels[right])-Number(labels[left]) === right-left ? String(Number(labels[left])+i-left) : label;
  });
}

/** Unknown printed numbers are explicitly distinct from physical PDF positions. */
export function printedLabels(pages: SourceLine[][], embedded?: string[] | null, heights?: number[]): string[] {
  const inline=pages.map((lines,i)=>{
    const height=heights?.[i] || 800;
    const body=dominantSize(lines.filter(l=>!l.header && l.text.length>25));
    const tokens=lines.filter(l=>(l.y<height*.14 || l.y>height*.87) && l.size<=body*(l.ocr?1.5:1.2) && !/^(chapter|part|book|section)\b/i.test(cleanChapterTitle(l.text))).flatMap(l=>{
      const text=l.text.replace(/\s+/g,' ').trim();
      const token=text.match(/^([1-9]\d{0,3})\s+\p{L}/u)?.[1] || text.match(/\p{L}.*\s+([1-9]\d{0,3})$/u)?.[1];
      return token?[token]:[];
    });return [...new Set(tokens)];
  });
  const observed = pages.map((lines, i) => {
    const body = lines.filter(l => !l.header && l.text.length > 20);
    const bodySize = body.length ? Math.min(...body.map(l => l.size)) : 12;
    const tokens = [...new Set(lines.filter(l => l.header && (l.y > (heights?.[i] || 800) / 2 || (l.size <= bodySize * 1.1 && body.length > 0))).map(l => l.text.trim()).filter(t => pageToken.test(t)))];
    if(tokens.length===1)return tokens[0];
    const verified=inline[i].filter(token=>inline.some((other,j)=>j!==i && Math.abs(j-i)<=4 && other.some(t=>i-Number(token)===j-Number(t))));
    return verified.length===1?verified[0]:undefined;
  });
  const corrected=observed.map((label,i)=>{
    if(!label || !pages[i].some(l=>l.ocr))return label;
    const offsets=new Map<number,number>();
    observed.forEach((other,j)=>{if(j!==i && Math.abs(j-i)<=4 && /^\d+$/.test(other||'')){const offset=j-Number(other);offsets.set(offset,(offsets.get(offset)||0)+1);}});
    if(/^\d+$/.test(label) && (offsets.get(i-Number(label))||0)>=2)return label;
    const oneDigitApart=(value:string)=>/^\d+$/.test(label) && label.length===value.length && [...label].filter((c,j)=>c!==value[j]).length===1;
    const suspect=[...offsets].some(([offset,count])=>count>=2 && oneDigitApart(String(i-offset)));
    let left=i-1,right=i+1;
    while(left>=0 && i-left<=3 && !/^\d+$/.test(observed[left]||''))left--;
    while(right<observed.length && right-i<=3 && !/^\d+$/.test(observed[right]||''))right++;
    if(left<0 || right>=observed.length || i-left>3 || right-i>3)return label;
    const a=Number(observed[left]),b=Number(observed[right]);
    if(b-a!==right-left)return suspect?undefined:label;
    const expected=String(a+i-left);
    if(/^\d+$/.test(label) && label.length===expected.length && [...label].filter((c,j)=>c!==expected[j]).length===1)return expected;
    if(/^[Il]+$/.test(label) && label.replace(/[Il]/g,'1')===expected)return expected;
    return label;
  });
  return interpolatePrintedLabels(pages.map((_, i) => {
    if (corrected[i]) return corrected[i]!;
    if (embedded?.[i]) return embedded[i];
    return `PDF ${i + 1}`;
  }));
}

export function findPrintedPage(marks: PageMark[], input: string): PageMark | undefined {
  const matches = marks.filter(m => m.label.trim().toLowerCase() === input.trim().toLowerCase());
  return matches.length === 1 ? matches[0] : undefined;
}

export function cleanChapterTitle(text:string) {
  return text.normalize('NFC').replace(/\s+/g,' ').replace(/^[\s"'|~_]+|[\s|~_]+$/g,'').trim();
}

/** Group display lines; a single enlarged word/drop cap is not a chapter heading. */
export function pageHeading(lines:SourceLine[], bodySize:number, height=800) {
  const sorted=[...lines].sort((a,b)=>a.y-b.y || (a.x||0)-(b.x||0));
  const first=sorted.findIndex(l=>!l.header && (l.y>height*.12 || l.size>bodySize*1.45) && l.y<height*.5 && l.size>bodySize*(l.ocr?1.8:1.24) && /^(?:[\p{Lu}\p{N}]|["'“])/u.test(l.text.trim()) && l.text.trim().length>2 && l.text.trim().split(/\s+/).length<=20 && !/[,;\-]$/.test(l.text.trim()));
  if(first<0)return undefined;
  const group=[sorted[first]];
  for(const line of sorted.slice(first+1)){
    const prev=group[group.length-1];
    if(line.header || line.y-prev.y>Math.max(prev.size,line.size)*2.1 || line.size<bodySize*1.16 || line.size<group[0].size*.45 || line.text.length>160)break;
    group.push(line);
  }
  return {title:cleanChapterTitle(group.map(l=>l.text).join(' ')),lines:group};
}

export type ContentsLink = { top:number; bottom:number; index:number; left?:number; right?:number; title?:string };
export type ContentsEntry = {title:string; label?:string; y:number; target?:number; group?:boolean};
function contentsHeading(text:string){return /^(?:tableof)?contents$/i.test(text.replace(/[^\p{L}]/gu,''));}
function titleKey(text:string){return key(text).replace(/^(?:(?:chapter|part|book)\s+(?:[ivxlcdm]+|\d+|one|two|three)\s*)/,'').replace(/^(preface|foreword|introduction)\s+by\s+.+$/,'$1');}
function titleSimilarity(a:string,b:string){
  const aa=titleKey(a),bb=titleKey(b);if(aa===bb)return 1;
  if(/^(bibliography|index|appendix|acknowledgments|acknowledgements|glossary)$/.test(aa) && bb.split(' ').includes(aa) || /^(bibliography|index|appendix|acknowledgments|acknowledgements|glossary)$/.test(bb) && aa.split(' ').includes(bb))return .95;
  const x=aa.split(' '),y=bb.split(' ');if(Math.min(x.length,y.length)<3)return 0;
  const shared=x.filter(t=>y.includes(t)).length;
  const tokens=2*shared/(x.length+y.length);
  const ac=aa.replace(/ /g,''),bc=bb.replace(/ /g,'');
  if(tokens>=.88 || ac.slice(0,7)!==bc.slice(0,7) || Math.min(ac.length,bc.length)/Math.max(ac.length,bc.length)<.75)return tokens;
  let row=Array.from({length:bc.length+1},(_,i)=>i);
  for(let i=1;i<=ac.length;i++){const next=[i];for(let j=1;j<=bc.length;j++)next[j]=Math.min(next[j-1]+1,row[j]+1,row[j-1]+(ac[i-1]===bc[j-1]?0:1));row=next;}
  return Math.max(tokens,1-row[bc.length]/Math.max(ac.length,bc.length));
}
export function contentsChapters(pages: SourceLine[][], labels: string[], links = new Map<number, ContentsLink[]>(), heights?:number[]) {
  const chapters = new Map<number, string>(), unresolved:string[]=[], contentsPages=new Set<number>();
  const entriesByPage=new Map<number,ContentsEntry[]>();
  const bodySize=dominantSize(pages.flat().filter(l=>!l.header));
  const headings=pages.map((ls,i)=>pageHeading(ls,bodySize,heights?.[i]));
  let continuing=false;
  for(let pi=0;pi<Math.min(pages.length,80);pi++){
    const lines=pages[pi], explicit=lines.some(l=>contentsHeading(l.text));
    const rows:SourceLine[]=[];
    for(const line of [...lines].sort((a,b)=>a.y-b.y || (a.x||0)-(b.x||0))){
      const row=rows.find(r=>Math.abs(r.y-line.y)<3);
      if(row){row.text+='  '+line.text;row.endX=Math.max(row.endX||0,line.endX||0);}else rows.push({...line});
    }
    const pageLinks=links.get(pi)||[];
    if(!explicit && !continuing && pageLinks.length<4)continue;
    const entries:ContentsEntry[]=[];
    const linked=new Map<number,ContentsEntry>();
    const unlinked:SourceLine[]=[];
    for(const row of rows){
      if(contentsHeading(row.text))continue;
      const matches=[...new Set(pageLinks.filter(l=>row.y>=l.top-3 && row.y<=l.bottom+3 && (l.left===undefined || row.x===undefined || (row.endX||row.x)>=l.left && row.x<=(l.right??Infinity))).map(l=>l.index))];
      if(matches.length===1){
        const index=matches[0],old=linked.get(index);
        if(old)old.title+=' '+row.text;
        else{const entry={title:row.text,y:row.y,target:index};linked.set(index,entry);entries.push(entry);}
      }else unlinked.push(row);
    }
    let pending='';
    for(const row of unlinked){
      const text=cleanChapterTitle(row.text);
      if(/^(?:part|book|postscript)\b/i.test(text)){if(pending)entries.push({title:pending,y:row.y-1});pending='';entries.push({title:text,y:row.y,group:true});continue;}
      const match=text.match(/^(.{2,300}?)\s*(?:\.{2,}|…+|\s+)([1-9IlO][\dIlOoSs]*|[ivxlcdm]+|[riIlOo0-9]{2,4})\s*$/i);
      if(match && /\p{L}/u.test(match[1]) && !/^(chapter|part|book|postscript)$/i.test(match[1].trim())){
        let label=match[2];if(/[\dOor]/.test(label))label=label.replace(/[Iilr]/g,'1').replace(/[Oo]/g,'0').replace(/[Ss]/g,'5');
        entries.push({title:cleanChapterTitle((pending?pending+' ':'')+match[1].replace(/[.\s…]+$/,'')),label,y:row.y});pending='';
      }else if(!row.header && !/^\d+$/.test(text) && !/^(?:part|book|postscript)\b/i.test(text) && text.length<180)pending=cleanChapterTitle(pending+' '+text);
    }
    if(pending && entries.length)entries.push({title:pending,y:unlinked.at(-1)?.y || 0});
    if(explicit && !entries.length) for(let ri=0;ri<unlinked.length;ri++){
      const row=unlinked[ri];if(row.header)continue;
      let title=row.text,matched=false;
      for(let count=1;count<=3 && ri+count<=unlinked.length;count++){
        const candidate=unlinked.slice(ri,ri+count).map(l=>l.text).join(' ');
        if(headings.some((h,i)=>i>pi && h && titleSimilarity(h.title,candidate)>=.9)){title=candidate;ri+=count-1;matched=true;break;}
      }
      entries.push({title:cleanChapterTitle(title),y:row.y});
      if(matched)pending='';
    }
    if(!explicit && entries.length<2){continuing=false;continue;}
    contentsPages.add(pi);continuing=entries.length>=2;
    entries.sort((a,b)=>a.y-b.y);
    for(const entry of entries){
      if(entry.group)continue;
      if(entry.target!==undefined){
        const numbered=entry.title.match(/^(.{2,300}?)\s*(?:\.{2,}|…+|\s+)([1-9]\d*|[ivxlcdm]+)\s*$/i);
        if(numbered && !/^(chapter|part|book|postscript)$/i.test(numbered[1].trim())){entry.title=numbered[1].replace(/[.\s…]+$/,'');entry.label=numbered[2];}
      }
      entry.title=cleanChapterTitle(entry.title);
      // Trusted bookmark titles repair line wrapping and damaged text maps at linked entries.
      const bookmark=pageLinks.find(l=>l.index===entry.target && l.title)?.title;
      if(bookmark && titleSimilarity(bookmark,entry.title)>.65)entry.title=cleanChapterTitle(bookmark);
      const matches=entry.label?labels.flatMap((label,i)=>label.toLowerCase()===entry.label!.toLowerCase() && i>pi?[i]:[]):[];
      const titleMatches=pages.flatMap((ls,i)=>{
        if(i<=pi || contentsPages.has(i))return [];
        const exact=ls.some(l=>l.y<(heights?.[i]||800)*.5 && (l.y>(heights?.[i]||800)*.12 || l.size>bodySize*1.8) && !l.header && key(l.text)===key(entry.title));
        return exact || (headings[i] && titleSimilarity(headings[i]!.title,entry.title)>=.88)?[i]:[];
      });
      const target=entry.target ?? (matches.length===1?matches[0]:titleMatches.length===1?titleMatches[0]:undefined);
      if(target===undefined || target===pi || target<0 || target>=pages.length || (matches.length===1 && matches[0]!==target) || (titleMatches.length===1 && titleMatches[0]!==target)){
        entry.target=undefined;unresolved.push(entry.title);continue;
      }
      entry.target=target;
      if(!chapters.has(target))chapters.set(target,entry.title);
      if(entry.label && labels[target].startsWith('PDF '))labels[target]=entry.label;
    }
    entriesByPage.set(pi,entries);
  }
  return {chapters,unresolved,contentsPages,entriesByPage};
}

/** Split at an existing page anchor so no source text, figures or page marks are lost. */
export function addChapterAtPage(book: Book, label: string, title: string): Book {
  const mark = findPrintedPage(book.pageMarks, label);
  if (!mark) throw new Error('That printed page is missing or ambiguous. Correct its page label in the preview first.');
  if (!title.trim()) throw new Error('Enter a chapter title.');
  const b = structuredClone(book), { section: si, block: bi } = mark.at;
  if (mark.at.offset !== 0) throw new Error('This page starts inside a paragraph and cannot be split safely.');
  if (bi === 0) { b.sections[si].title = title.trim(); b.sections[si].heading = true; return b; }
  b.sections.splice(si + 1, 0, { id:crypto.randomUUID(), title:title.trim(), heading:true, blocks:b.sections[si].blocks.splice(bi) });
  b.pageMarks = b.pageMarks.map(m => ({ ...m, at:m.at.section === si && m.at.block >= bi ? { ...m.at, section:si+1, block:m.at.block-bi } : m.at.section > si ? { ...m.at, section:m.at.section+1 } : m.at }));
  return b;
}
