export function bookWordEvidence(pages:{text:string}[][]){
  return new Set(pages.flatMap(lines=>lines.flatMap(l=>(l.text.match(/\p{L}+(?:-\p{L}+)*/gu)||[]).map(word=>word.toLocaleLowerCase()))));
}
const wordEndings=new Set('tion tions sion sions ation ations ing ings ment ments ness ity ous ious able ible ance ence ive ively ful less ical ally ize ization ary ory ure ial ual'.split(' '));
/** Repair OCR slips that put punctuation where a space belongs, and straight apostrophes inside words. */
export function repairOcrText(text:string){
  return text
    .replace(/\S+/g,token=>/\.[a-z]+\.|[/@]|^www\./i.test(token)?token:token.replace(/(?<=[a-z]{2})([.:;])(?=[a-z]{3,}\b)(?!(?:com|org|net|edu|gov|html?|pdf|php|uk|au|ca|io|co)\b)/g,'$1 '))
    .replace(/(?<=\p{L})'(?=\p{L})/gu,'’');
}
/** Only remove an ambiguous line-end hyphen when the book corroborates the joined word. */
export function joinPrintedLine(paragraph:string,line:string,joinHyphens:boolean,words:Set<string>){
  const tail=paragraph.match(/(\p{L}+)([-\u00ad])$/u),head=line.match(/^(\p{L}+)/u);
  if(!tail || !head){
    const cjk=/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}、。，！？「」（）]/u;
    const adjacent=paragraph && cjk.test([...paragraph].at(-1)||'') && cjk.test([...line][0]||'');
    return {text:paragraph+(paragraph&&!adjacent?' ':'')+line,fixed:false};
  }
  const joined=(tail[1]+head[1]).toLocaleLowerCase(),compound=(tail[1]+'-'+head[1]).toLocaleLowerCase();
  // A bare word ending such as "tion" or "ing" can only be the second half of a split word.
  const split=wordEndings.has(head[1].toLocaleLowerCase()) && tail[1].length>=3 && !words.has(compound);
  const remove=joinHyphens && (tail[2]==='\u00ad' || words.has(joined) && !words.has(compound) || split);
  return {text:(remove?paragraph.slice(0,-1):paragraph)+line,fixed:remove};
}
import type {Section,PageMark} from './types';

const lowerStart=/^[\p{Ll}\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u,unfinished=/[\p{L},\-]\s*$/u;
/** A lowercase block after an unfinished plain paragraph is the tail of the same sentence. */
function continues(left:Section['blocks'][number]|undefined,right:Section['blocks'][number]|undefined){
  return !!left && left.type==='p' && right?.type==='p' && !left.layout && !right.layout && !left.contentsEntry && !right.contentsEntry && left.text.length>=24 && ((lowerStart.test(right.text) && unfinished.test(left.text)) || (/\p{L}-\s*$/u.test(left.text) && /^\p{L}/u.test(right.text)));
}
function mergeInto(sections:Section[],marks:PageMark[],si:number,bi:number,joinHyphens:boolean,words:Set<string>){
  const blocks=sections[si].blocks,left=blocks[bi-1],right=blocks[bi];
  if(left.type!=='p' || right.type!=='p')return;
  const joined=joinPrintedLine(left.text,right.text,joinHyphens,words),offset=joined.text.length-right.text.length;
  left.styles=(left.styles||[]).map(r=>({...r,end:Math.min(r.end,offset)})).filter(r=>r.end>r.start).concat((right.styles||[]).map(r=>({...r,start:r.start+offset,end:r.end+offset})));
  left.footnoteRefs=[...(left.footnoteRefs||[]),...(right.footnoteRefs||[]).map(r=>({...r,at:r.at+offset}))];
  left.text=joined.text;blocks.splice(bi,1);
  for(const m of marks)if(m.at.section===si){
   if(m.at.block===bi)m.at={...m.at,block:bi-1,offset:m.at.offset+offset};
   else if(m.at.block>bi)m.at={...m.at,block:m.at.block-1};
  }
}
/** Rejoin sentences that a page break, or an OCR paragraph guess, cut in half. Page marks keep their exact character offset. */
export function joinPageParagraphs(sections:Section[],marks:PageMark[],_candidates:Set<number>,joinHyphens:boolean,words:Set<string>){
 sections.forEach((section,si)=>{
  for(let bi=1;bi<section.blocks.length;bi++)
   if(continues(section.blocks[bi-1],section.blocks[bi])){mergeInto(sections,marks,si,bi,joinHyphens,words);bi--;}
 });
}

const plain=(text:string)=>text.toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu,'');
/** A chapter's own heading, picked up again as a short block from the page, is already shown as the title. */
export function dropRepeatedHeadings(sections:Section[],marks:PageMark[]){
  sections.forEach((section,si)=>{
    if(!section.heading)return;
    const title=plain(section.title);
    while(section.blocks.length>1){
      const block=section.blocks[0],text=block.type==='figure'?'':plain(block.text);
      if(!text || text.length>60 || block.type==='figure' || block.contentsEntry || !title.includes(text))break;
      section.blocks.shift();
      for(const m of marks)if(m.at.section===si && m.at.block>0)m.at={...m.at,block:m.at.block-1};
    }
  });
}
