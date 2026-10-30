import type {Book} from './types';

export type ContentsRange={start:number;end:number;pageIndex?:number};
const cache=new WeakMap<Book,Map<number,(ContentsRange[]|undefined)[]>>();
const normalized=(text:string)=>text.normalize('NFKD').toLowerCase().replace(/[^\p{L}\p{N}]/gu,'');
const isContents=(title:string)=>/^(?:tableof)?contents$/.test(normalized(title));
export function isContentsSection(book:Book,section:number){return isContents(book.sections[section]?.title || '');}

/** Presentation only. Original strings, block indexes and annotation offsets never change. */
export function contentsRanges(book:Book,section:number,block:number):ContentsRange[]|undefined {
  const source=book.sections[section]?.blocks[block];
  if(!source || source.type==='figure' || source.type==='h')return;
  if(source.contentsEntry)return [{start:0,end:source.text.length,pageIndex:source.targetPageIndex}];
  if(!isContents(book.sections[section].title))return;
  let sections=cache.get(book);if(!sections){sections=new Map();cache.set(book,sections);}
  if(!sections.has(section)){
    const blocks=book.sections[section].blocks, starts:number[]=[];
    let raw='';for(const b of blocks){starts.push(raw.length);raw+=(b.text||'')+'\n';}
    let key='';const offsets:number[]=[];
    for(let i=0;i<raw.length;i++){const chars=normalized(raw[i]);key+=chars;for(let j=0;j<chars.length;j++)offsets.push(i);}
    const candidates:{at:number;length:number;until?:number;pageIndex?:number}[]=[];
    const add=(title:string,pageIndex?:number)=>{
      const needle=normalized(title);if(needle.length<4)return;
      for(let from=0;from<key.length;){const at=key.indexOf(needle,from);if(at<0)break;from=at+needle.length;
        const start=offsets[at],end=offsets[at+needle.length-1]+1;
        if(start>0 && /[\p{L}\p{N}]/u.test(raw[start-1]) || end<raw.length && /[\p{L}\p{N}]/u.test(raw[end]))continue;
        candidates.push({at:start,until:end,length:needle.length,pageIndex});
      }
    };
    book.sections.forEach((s,i)=>{if(i!==section)add(s.title,book.pageMarks.find(m=>m.at.section===i)?.index);});
    for(const title of ['Cover','Title Page','Dedication','Foreword','Acknowledgments','Acknowledgements','Appendix','Notes','Index','About the Author','Copyright','About the Publisher'])add(title);
    for(const match of raw.matchAll(/\bChapter\s+(?:[IVXLCDM]+|\d+)\s*[:.\u2014\u2013-]/gi))candidates.push({at:match.index!,length:0});
    candidates.sort((a,b)=>a.at-b.at || b.length-a.length || Number(b.pageIndex!==undefined)-Number(a.pageIndex!==undefined));
    const entries=candidates.filter((c,i)=>(!i || c.at!==candidates[i-1].at) && !candidates.some(other=>other.at<c.at && (other.until||0)>c.at));
    // One matched word is not enough evidence to split a legacy paragraph into a list.
    const boundaries=entries.length>=2?entries:[{at:0,length:0}];
    if(boundaries[0]?.at>0)boundaries.unshift({at:0,length:0});
    sections.set(section,blocks.map((b,bi)=>{
      if(b.type==='figure')return undefined;
      const start=starts[bi],end=start+b.text.length;
      const coverage=entries.reduce((n,e)=>n+Math.max(0,Math.min(end,e.until||e.at)-Math.max(start,e.at)),0);
      const prefixes=[...b.text.matchAll(/\bChapter\s+(?:[IVXLCDM]+|\d+)\s*[:.\u2014\u2013-]/gi)].length;
      // Old detection sometimes left the following body pages in the Contents section.
      if(entries.length>=2 && coverage< b.text.length*.35 && prefixes<2)return undefined;
      return boundaries.flatMap((entry,i)=>{
        const a=Math.max(start,entry.at),z=Math.min(end,boundaries[i+1]?.at ?? raw.length);
        return z>a?[{start:a-start,end:z-start,pageIndex:entry.pageIndex}]:[];
      });
    }));
  }
  return sections.get(section)?.[block];
}
