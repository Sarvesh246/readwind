export function bookWordEvidence(pages:{text:string}[][]){
  return new Set(pages.flatMap(lines=>lines.flatMap(l=>(l.text.match(/\p{L}+(?:-\p{L}+)*/gu)||[]).map(word=>word.toLocaleLowerCase()))));
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
  const remove=joinHyphens && (tail[2]==='\u00ad' || words.has(joined) && !words.has(compound));
  return {text:(remove?paragraph.slice(0,-1):paragraph)+line,fixed:remove};
}
import type {Section,PageMark} from './types';

/** Rejoin only corroborated sentence continuations across physical page boundaries. */
export function joinPageParagraphs(sections:Section[],marks:PageMark[],candidates:Set<number>,joinHyphens:boolean,words:Set<string>){
 for(const mark of marks){
  if(!candidates.has(mark.index))continue;
  const {section:si,block:bi}=mark.at,blocks=sections[si].blocks,left=blocks[bi-1],right=blocks[bi];
  if(!left || left.type!=='p' || right?.type!=='p' || left.layout || right.layout || left.contentsEntry || right.contentsEntry || left.text.length<80 || !/^[\p{Ll}\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(right.text) || !/[\p{L},\-]\s*$/u.test(left.text))continue;
  const joined=joinPrintedLine(left.text,right.text,joinHyphens,words),offset=joined.text.length-right.text.length;
  left.styles=(left.styles||[]).map(r=>({...r,end:Math.min(r.end,offset)})).filter(r=>r.end>r.start).concat((right.styles||[]).map(r=>({...r,start:r.start+offset,end:r.end+offset})));
  left.footnoteRefs=[...(left.footnoteRefs||[]),...(right.footnoteRefs||[]).map(r=>({...r,at:r.at+offset}))];
  left.text=joined.text;blocks.splice(bi,1);
  for(const m of marks)if(m.at.section===si){
   if(m.at.block===bi)m.at={...m.at,block:bi-1,offset:m.at.offset+offset};
   else if(m.at.block>bi)m.at={...m.at,block:m.at.block-1};
  }
 }
}
