export type TextStyleRun={start:number;end:number;bold?:boolean;italic?:boolean};
export function pdfFontStyle(font:{name?:string;bold?:boolean;italic?:boolean;cssFontInfo?:{fontWeight?:string|number;italicAngle?:number}|null}){
 return {bold:font.bold || Number(font.cssFontInfo?.fontWeight)>=600 || /bold|semibold|demi|black|heavy/i.test(font.name||''),italic:font.italic || !!font.cssFontInfo?.italicAngle || /italic|oblique/i.test(font.name||'')};
}
export function normalizeStyledTextWithOffsets(text:string,runs:TextStyleRun[]=[]){
 const first=text.search(/\S/),last=text.search(/\s*$/);if(first<0)return {text:'',runs:[],offsets:Array(text.length+1).fill(0) as number[]};
 let normalized='';const offsets=Array(text.length+1).fill(0);let space=false;
 for(let i=0;i<text.length;i++){
  offsets[i]=normalized.length;if(i<first || i>=last)continue;
  if(/\s/.test(text[i])){if(!space)normalized+=' ';space=true;}else{normalized+=text[i];space=false;}
 }offsets[text.length]=normalized.length;
 const styles=runs.map(r=>({...r,start:offsets[Math.min(text.length,r.start)],end:offsets[Math.min(text.length,r.end)]})).filter(r=>r.end>r.start);
 return {text:normalized,runs:styles,offsets:offsets as number[]};
}
export function appendStyledText(parent:HTMLElement,text:string,start:number,end:number,runs:TextStyleRun[]=[]){
 const points=[...new Set([start,end,...runs.flatMap(r=>[r.start,r.end]).filter(p=>p>start&&p<end)])].sort((a,b)=>a-b);
 for(let i=0;i<points.length-1;i++){
  const a=points[i],b=points[i+1],run=runs.find(r=>r.start<=a&&r.end>=b);
  const node=document.createElement('span');node.textContent=text.slice(a,b);if(run?.bold)node.style.fontWeight='600';if(run?.italic)node.style.fontStyle='italic';parent.appendChild(node);
 }
}

export function normalizeStyledText(text:string,runs:TextStyleRun[]=[]){const result=normalizeStyledTextWithOffsets(text,runs);return {text:result.text,runs:result.runs};}
