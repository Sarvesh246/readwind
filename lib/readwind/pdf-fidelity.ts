import type {Block} from './types';
import type {PdfLine,PdfIssue,PdfTextItem} from './pdf-layout';

export const listMarker=/^\s*(?:[•●○▪■‣⁃◦☐☑✓✔–—-]|\(?\d{1,3}[.)]|\(?[a-zA-Z][.)]|\(?[ivxlcdmIVXLCDM]{2,8}[.)])(?:\s+|$)/;
const speaker=/^[\p{Lu}][\p{L}\p{M} .’'-]{1,35}:\s*\S/u;

/** Conservative routing: preserve the source when geometry carries meaning. */
export function fidelityIssues(lines:PdfLine[],items:PdfTextItem[],width:number,height:number,excluded:{x:number;y:number;w:number;h:number}[]=[]):PdfIssue[]{
 const inside=(r:{x:number;y:number;w:number;h:number},l:{x:number;endX:number;y:number;size:number})=>l.x>=r.x-2&&l.endX<=r.x+r.w+2&&l.y>=r.y-l.size&&l.y<=r.y+r.h+l.size*.5;
 const kept=(l:PdfLine)=>!excluded.some(r=>inside(r,l));
 const issues:PdfIssue[]=[],body=lines.filter(l=>!l.header&&kept(l)),text=body.map(l=>l.text).join('\n');
 const mono=body.filter(l=>l.monospace).length;if(mono>=2 && mono<body.length*.5)issues.push('complex-layout');
 if(mono<body.length*.5 && /[∑∫√∂∇∞≠≤≥∏⊗]|\b\w\s*[=^]\s*[-+\w(]/u.test(text))issues.push('technical-text');
 // Only short tokens can be exponents or note references. Long runs are prose
 // and a large initial letter (drop cap) is the first glyph of its own line.
 const glyphs=items.filter(i=>i.str.trim()&&!excluded.some(r=>i.transform[4]>=r.x-2&&i.transform[4]<=r.x+r.w+2&&height-i.transform[5]>=r.y-2&&height-i.transform[5]<=r.y+r.h+2)),
  sizes=glyphs.map(i=>Math.hypot(i.transform[2],i.transform[3])),short=(i:PdfTextItem)=>{const t=i.str.trim();return t.length>0&&t.length<=3&&!/\s/.test(t);};
 const bins=new Map<number,number[]>();glyphs.forEach((i,n)=>{const k=Math.floor((i.transform[4]+i.width)/24);bins.set(k,[...(bins.get(k)||[]),n]);});
 // Raised/lowered small glyphs directly after body text include exponents and note references.
 if(glyphs.some((i,n)=>short(i)&&sizes[n]>0 && [-1,0,1].flatMap(d=>bins.get(Math.floor(i.transform[4]/24)+d)||[]).some(m=>{const j=glyphs[m],end=j.transform[4]+j.width;return n!==m && sizes[m]>sizes[n]*1.4 && sizes[m]<sizes[n]*3 && Math.abs(i.transform[5]-j.transform[5])>sizes[m]*.2 && Math.abs(i.transform[5]-j.transform[5])<sizes[m]*.8 && Math.abs(i.transform[4]-end)<sizes[m]*.45;})))issues.push('technical-text');
 if(body.filter(l=>l.x<0 || l.endX>width+2 || l.y<0 || l.y>height+2).length>=2)issues.push('cropped-text');
 const words=text.match(/[\p{L}\p{N}]+/gu)||[];
 if(words.filter(w=>w.length>35).length>=3 || /([\p{L}\p{N}])\1{7}/u.test(text))issues.push('suspect-text');
 // Three persistent lanes of prose remain unsafe to flatten automatically.
 const rows=new Map<number,PdfLine[]>();for(const l of body){const k=Math.round(l.y/4);rows.set(k,[...(rows.get(k)||[]),l]);}
 if([...rows.values()].filter(r=>r.length>=3 && r.some(l=>l.text.length>50 || l.text.split(/\s+/).length>8)).length>=3)issues.push('complex-layout');
 // Short tokens in table cells must not look like prose columns. Text that sits
 // in a margin or sidebar is extracted as a quote block instead of preserving
 // the whole page, so only genuine multi-lane prose stays layout-sensitive.
 return [...new Set(issues)];
}

/** Retain meaningful line breaks instead of inventing paragraphs for verse/code/drama/lists. */
export function structuredBlocks(lines:PdfLine[],forced?:'verse'|'code'|'dialogue'):Block[]|undefined{
 if(lines.filter(l=>listMarker.test(l.text)).length>=2){
  const rows:PdfLine[]=[];
  for(const line of [...lines].sort((a,b)=>a.y-b.y||a.x-b.x)){
   const prev=rows.at(-1);
   if(prev && Math.abs(prev.y-line.y)<3 && listMarker.test(prev.text)){
    const start=prev.text.length+1;prev.text+=' '+line.text;prev.endX=line.endX;
    prev.styles=[...(prev.styles||[]),...(line.styles||[]).map(r=>({...r,start:r.start+start,end:r.end+start}))];
   }else rows.push({...line});
  }lines=rows;
 }
 const body=lines.filter(l=>!l.header);if(body.length<2)return;
 const markers=body.filter(l=>listMarker.test(l.text)).length;
 const mono=body.filter(l=>l.monospace).length;
 const drama=body.filter(l=>speaker.test(l.text)).length;
 const short=body.filter(l=>l.text.length<48).length;
 const singleLane=new Set(body.map(l=>Math.round(l.y/3))).size>=body.length*.95;
 const maxWidth=Math.max(...body.map(l=>l.endX-l.x)),ragged=body.filter(l=>l.endX-l.x<maxWidth*.82).length;
 const stanzas=body.some((l,i)=>i>0 && l.y-body[i-1].y>l.size*2.2);
 const verse=singleLane && body.length>=5 && short/body.length>.85 && ragged>=3 && (stanzas || ragged/body.length>.6) && body.filter(l=>/[.!?;:]\s*$/.test(l.text)).length/body.length<.35 && markers===0;
 const layout=forced||(mono>=2 && mono/body.length>.5?'code':drama>=2?'dialogue':markers>=2?'list':verse?'verse':undefined);
 if(!layout)return;
 const left=Math.min(...body.map(l=>l.x)),blocks:Block[]=[];
 let text='',styles:NonNullable<Extract<Block,{type:'p'|'h'|'quote'}>['styles']>=[];
 const flush=()=>{if(text)blocks.push({type:'p',text,layout,styles:styles.length?styles:undefined});text='';styles=[];};
 let previous:PdfLine|undefined;
 for(const line of lines){
  if(line.header){flush();blocks.push({type:'p',text:line.text,styles:line.styles});previous=undefined;continue;}
  if(layout==='list' && listMarker.test(line.text) || previous && line.y-previous.y>line.size*2.4)flush();
  const indent=' '.repeat(Math.min(24,Math.max(0,Math.round((line.x-left)/Math.max(1,line.size*.5)))));
  const prefix=(text?'\n':'')+indent,start=text.length+prefix.length;text+=prefix+line.text;
  styles.push(...(line.styles||[]).map(r=>({...r,start:r.start+start,end:r.end+start})));previous=line;
 }flush();return blocks;
}

const tokens=(text:string)=>text.normalize('NFKC').toLocaleLowerCase().replace(/[-\u00ad]\s*\n\s*/g,'').match(/[\p{L}\p{N}]+/gu)||[];
export function missingTokens(expected:string,actual:string){
 const counts=new Map<string,number>();for(const t of tokens(actual))counts.set(t,(counts.get(t)||0)+1);
 let missing=0;const source=tokens(expected);for(const t of source){const n=counts.get(t)||0;if(n)counts.set(t,n-1);else missing++;}return {missing,total:source.length};
}
function numericLoss(expected:string,actual:string){
 const numbers=(s:string)=>s.normalize('NFKC').match(/[+−-]?\p{Nd}+(?:[.,:/]\p{Nd}+)*(?:[%‰])?/gu)||[],counts=new Map<string,number>();
 for(const n of numbers(actual))counts.set(n,(counts.get(n)||0)+1);
 for(const n of numbers(expected)){const count=counts.get(n)||0;if(!count)return true;counts.set(n,count-1);}return false;
}
export function extractionLoss(expected:string,actual:string){const r=missingTokens(expected,actual);return r.missing>Math.max(8,r.total*.04) || numericLoss(expected,actual);}
export function ocrAddsContent(native:string,recognized:string){
 const existing=tokens(native).length;if(!existing)return tokens(recognized).length>0;
 const added=missingTokens(recognized,native);return added.missing>=Math.max(3,existing*.25) && added.missing/Math.max(1,added.total)>.15;
}
export function textLayerDisagrees(native:string,recognized:string,confidence:number){
 if(confidence<85 || tokens(recognized).length<25 || tokens(native).length<25)return false;
 const a=missingTokens(native,recognized),b=missingTokens(recognized,native);
 return a.missing/a.total>.4 && b.missing/b.total>.4;
}
export function textLayerCheck(native:string,recognized:string,confidence:number):'matched'|'disagreed'|'inconclusive'{
 if(textLayerDisagrees(native,recognized,confidence))return 'disagreed';
 if(confidence<85 || tokens(recognized).length<25 || tokens(native).length<25)return 'inconclusive';
 if(numericLoss(native,recognized)||numericLoss(recognized,native))return 'disagreed';
 const a=missingTokens(native,recognized),b=missingTokens(recognized,native);
 const pairs=(text:string)=>{const words=tokens(text);return words.slice(1).map((word,i)=>words[i]+'\u0000'+word);},left=pairs(native),right=pairs(recognized),counts=new Map<string,number>();
 for(const pair of right)counts.set(pair,(counts.get(pair)||0)+1);let shared=0;
 for(const pair of left){const count=counts.get(pair)||0;if(count){shared++;counts.set(pair,count-1);}}
 const order=shared/Math.max(1,Math.min(left.length,right.length));
 if(a.missing/a.total<.15 && b.missing/b.total<.15 && order<.5)return 'disagreed';
 return a.missing/a.total<.12 && b.missing/b.total<.12 && order>=.7?'matched':'inconclusive';
}
export function needsSourcePage(issues:PdfIssue[]){return issues.some(i=>['technical-text','complex-layout','rtl','vertical-text','rotated-text','low-ocr','ocr-mismatch','cropped-text','scan-spread','suspect-text','text-mapping','extraction-error','duplicate-text'].includes(i));}
