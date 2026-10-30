export function bookWordEvidence(pages:{text:string}[][]){
  return new Set(pages.flatMap(lines=>lines.flatMap(l=>(l.text.match(/\p{L}+(?:-\p{L}+)*/gu)||[]).map(word=>word.toLocaleLowerCase()))));
}
/** Only remove an ambiguous line-end hyphen when the book corroborates the joined word. */
export function joinPrintedLine(paragraph:string,line:string,joinHyphens:boolean,words:Set<string>){
  const tail=paragraph.match(/(\p{L}+)([-\u00ad])$/u),head=line.match(/^(\p{L}+)/u);
  if(!tail || !head)return {text:paragraph+(paragraph?' ':'')+line,fixed:false};
  const joined=(tail[1]+head[1]).toLocaleLowerCase(),compound=(tail[1]+'-'+head[1]).toLocaleLowerCase();
  const remove=joinHyphens && (tail[2]==='\u00ad' || words.has(joined) && !words.has(compound));
  return {text:(remove?paragraph.slice(0,-1):paragraph)+line,fixed:remove};
}
