import type {PdfLine} from './pdf-layout';
export type PdfRect={x:number;y:number;w:number;h:number};
export type PdfTableRegion=PdfRect&{lines:PdfLine[];text:string};
const isRule=(r:PdfRect)=>r.w>0&&r.h>0&&Math.min(r.w,r.h)<=5&&Math.max(r.w,r.h)>=12;
const median=(values:number[])=>{const sorted=[...values].sort((a,b)=>a-b);return sorted[Math.floor(sorted.length/2)]||12;};
const overlapArea=(a:PdfRect,b:PdfRect)=>Math.max(0,Math.min(a.x+a.w,b.x+b.w)-Math.max(a.x,b.x))*Math.max(0,Math.min(a.y+a.h,b.y+b.h)-Math.max(a.y,b.y));
const regionText=(lines:PdfLine[])=>{
 const rows:{y:number;cells:PdfLine[]}[]=[];
 for(const line of [...lines].sort((a,b)=>a.y-b.y||a.x-b.x)){
  const row=rows.find(r=>Math.abs(r.y-line.y)<3);if(row)row.cells.push(line);else rows.push({y:line.y,cells:[line]});
 }
 return rows.map(r=>r.cells.sort((a,b)=>a.x-b.x).map(l=>l.text).join('\t')).join('\n');
};
const mergeAreas=(areas:PdfRect[],pad=8)=>{
 const out=areas.map(a=>({...a}));let changed=true;
 while(changed){
  changed=false;
  for(let i=0;i<out.length&&!changed;i++)for(let j=i+1;j<out.length;j++){
   const a=out[i],b=out[j],
    gapX=Math.max(a.x,b.x)-Math.min(a.x+a.w,b.x+b.w),gapY=Math.max(a.y,b.y)-Math.min(a.y+a.h,b.y+b.h);
   if(gapX<=pad&&gapY<=pad){
    const x=Math.min(a.x,b.x),y=Math.min(a.y,b.y);
    out[i]={x,y,w:Math.max(a.x+a.w,b.x+b.w)-x,h:Math.max(a.y+a.h,b.y+b.h)-y};
    out.splice(j,1);changed=true;break;
   }
  }
 }
 return out;
};

/** Drawn grids: thin rules that meet at cell corners describe a real table. */
export function findGridAreas(boxes:PdfRect[],pageWidth:number,pageHeight:number):PdfRect[]{
 const rules=boxes.filter(isRule);if(rules.length<4||rules.length>1500)return[];
 const parent=rules.map((_,i)=>i);
 const find=(i:number):number=>{while(parent[i]!==i){parent[i]=parent[parent[i]];i=parent[i];}return i;};
 const union=(a:number,b:number)=>{a=find(a);b=find(b);if(a!==b)parent[b]=a;};
 const pad=4;
 for(let i=0;i<rules.length;i++)for(let j=i+1;j<rules.length;j++){
  const a=rules[i],b=rules[j];
  if(a.x-pad<b.x+b.w&&b.x-pad<a.x+a.w&&a.y-pad<b.y+b.h&&b.y-pad<a.y+a.h)union(i,j);
 }
 const groups=new Map<number,number[]>();
 rules.forEach((_,i)=>groups.set(find(i),[...(groups.get(find(i))||[]),i]));
 const areas:PdfRect[]=[];
 for(const indexes of groups.values()){
  const cells=indexes.map(i=>rules[i]);
  const x=Math.min(...cells.map(r=>r.x)),y=Math.min(...cells.map(r=>r.y)),
   w=Math.max(...cells.map(r=>r.x+r.w))-x,h=Math.max(...cells.map(r=>r.y+r.h))-y;
  if(w<60||h<40||w>=pageWidth*.95||h>=pageHeight*.95)continue;
  const rows=new Set(cells.filter(r=>r.w>=r.h).map(r=>Math.round(r.y+r.h/2))),
   columns=new Set(cells.filter(r=>r.h>r.w).map(r=>Math.round(r.x+r.w/2)));
  if(rows.size>=3&&columns.size>=2)areas.push({x,y,w,h});
 }
 return areas;
}

/** Rows of short, numeric cells forming columns: a wrapped-cell table has no
 * single baseline per row, so its text band is used and the drawn border is
 * snapped around it. Kinds of text that only look tabular (a prose sidebar
 * with one price) fail the lane and numeric checks. */
export function findRuledTables(lines:PdfLine[],boxes:PdfRect[],pageWidth:number,pageHeight:number,gridAreas=findGridAreas(boxes,pageWidth,pageHeight)):PdfTableRegion[]{
 if(!gridAreas.length)return[];
 const body=lines.filter(l=>!l.header).sort((a,b)=>a.y-b.y||a.x-b.x);
 if(body.length<6)return[];
 const size=median(body.map(l=>l.size));
 const runs:PdfLine[][]=[];let run:PdfLine[]=[];
 const flush=()=>{if(run.length)runs.push(run);run=[];};
 for(const line of body){
  const previous=run.at(-1),short=line.text.length<=48&&line.endX-line.x<=pageWidth*.55;
  if(previous&&line.y-previous.y>=0&&line.y-previous.y<=size*3.8&&short)run.push(line);
  else{flush();if(short)run.push(line);}
 }flush();
 const rules=boxes.filter(isRule),hs=rules.filter(r=>r.w>=r.h),vs=rules.filter(r=>r.h>r.w);
 const tables:PdfTableRegion[]=[];
 for(const band of runs){
  if(band.length<6)continue;
  const lanes:number[]=[];
  for(const x of [...new Set(band.map(l=>l.x))]){if(!lanes.some(l=>Math.abs(l-x)<=6))lanes.push(x);}
  const solid=lanes.filter(x=>band.filter(l=>Math.abs(l.x-x)<=6).length>=2);
  const numeric=band.filter(l=>/[0-9]/.test(l.text));
  if(solid.length<2||numeric.length<3||numeric.length/band.length<.2)continue;
  const left=Math.min(...band.map(l=>l.x)),right=Math.max(...band.map(l=>l.endX)),
   top=Math.min(...band.map(l=>l.y-l.size*1.2)),bottom=Math.max(...band.map(l=>l.y+l.size*.5));
  const run0={x:left-4,y:top-4,w:right-left+8,h:bottom-top+8};
  if(run0.w<pageWidth*.25||run0.h>pageHeight*.6)continue;
  if(!gridAreas.some(g=>overlapArea(run0,g)>run0.w*run0.h*.3))continue;
  // Snap outward to the visible borders without swallowing prose or display type.
  const inBand=(y0:number,y1:number)=>lines.filter(l=>!l.header&&l.y>=y0&&l.y<=y1);
  const w=run0.w,h=run0.h;let x=run0.x,y=run0.y,bottomEdge=y+h,rightEdge=x+w;
  for(let step=0;step<4;step++){
   const rule=hs.filter(r=>Math.max(0,Math.min(r.x+r.w,rightEdge)-Math.max(r.x,x))>w*.5&&r.y<y-1&&y-(r.y+r.h)<=120).sort((a,b)=>(b.y+b.h)-(a.y+a.h))[0];
   if(!rule)break;
   if(inBand(rule.y+rule.h,y).some(l=>l.size>size*1.45||l.text.length>48))break;
   y=rule.y;
  }
  for(let step=0;step<3;step++){
   const rule=hs.filter(r=>Math.max(0,Math.min(r.x+r.w,rightEdge)-Math.max(r.x,x))>w*.5&&r.y>bottomEdge+1&&r.y-bottomEdge<=60).sort((a,b)=>a.y-b.y)[0];
   if(!rule)break;
   if(inBand(bottomEdge,rule.y).some(l=>l.size>size*1.45||l.text.length>48))break;
   bottomEdge=rule.y+rule.h;
  }
  for(let step=0;step<3;step++){
   const rule=vs.filter(r=>Math.max(0,Math.min(r.y+r.h,bottomEdge)-Math.max(r.y,y))>h*.4&&r.x<x-1&&x-(r.x+r.w)<=60).sort((a,b)=>(b.x+b.w)-(a.x+a.w))[0];
   if(!rule)break;x=rule.x;
  }
  for(let step=0;step<3;step++){
   const rule=vs.filter(r=>Math.max(0,Math.min(r.y+r.h,bottomEdge)-Math.max(r.y,y))>h*.4&&r.x>rightEdge+1&&r.x-rightEdge<=60).sort((a,b)=>a.x-b.x)[0];
   if(!rule)break;rightEdge=rule.x+rule.w;
  }
  const inside=lines.filter(l=>!l.header&&l.x>=x-2&&l.endX<=rightEdge+2&&l.y>=y-2&&l.y<=bottomEdge+2);
  tables.push({x,y,w:rightEdge-x,h:bottomEdge-y,lines:inside,text:regionText(inside)});
 }
 // Two halves of one table (or a header band and its body) are one crop.
 tables.sort((a,b)=>a.y-b.y);
 const merged:PdfTableRegion[]=[];
 for(const table of tables){
  const match=merged.find(r=>overlapArea(r,table)>Math.min(r.w*r.h,table.w*table.h)*.2||(Math.abs(table.y-(r.y+r.h))<=8&&Math.max(0,Math.min(r.x+r.w,table.x+table.w)-Math.max(r.x,table.x))>Math.min(r.w,table.w)*.5));
  if(!match){merged.push(table);continue;}
  const x=Math.min(match.x,table.x),y=Math.min(match.y,table.y),right=Math.max(match.x+match.w,table.x+table.w),bottom=Math.max(match.y+match.h,table.y+table.h);
  const lines=[...new Set([...match.lines,...table.lines])];
  Object.assign(match,{x,y,w:right-x,h:bottom-y,lines,text:regionText(lines)});
 }
 return merged;
}

/** Ruled comparison charts and table layouts: a drawn grid whose text is
 * short cell-like lines in two or more lanes. Prose in a bordered box has long
 * lines and stays text. Display headings above the grid are trimmed so they
 * remain readable prose. */
export function findLayoutGraphics(lines:PdfLine[],boxes:PdfRect[],pageWidth:number,pageHeight:number,gridAreas=findGridAreas(boxes,pageWidth,pageHeight)):PdfTableRegion[]{
 const body=lines.filter(l=>!l.header);
 if(!gridAreas.length||body.length<6)return[];
 const size=median(body.map(l=>l.size)),out:PdfTableRegion[]=[];
 for(const area of mergeAreas(gridAreas)){
  const x=Math.max(0,area.x),startY=Math.max(0,area.y),
   w=Math.min(pageWidth-x,area.x+area.w-x),bottom=Math.min(pageHeight,area.y+area.h);
  let y=startY;
  if(w<pageWidth*.2||bottom-y<60)continue;
  const inside=()=>body.filter(l=>l.x>=x-2&&l.endX<=x+w+2&&l.y>=y-2&&l.y<=bottom+2);
  let cells=inside();
  if(cells.length<6)continue;
  const display=cells.filter(l=>l.size>size*1.45);
  if(display.length){
   if(!display.every(l=>l.y<startY+(bottom-startY)*.35))continue;
   y=Math.max(startY,...display.map(l=>l.y+l.size*.8));cells=inside();
  }
  if(cells.length<6)continue;
  const lanes:number[]=[];
  for(const left of [...new Set(cells.map(l=>l.x))])if(!lanes.some(l=>Math.abs(l-left)<=8))lanes.push(left);
  const solid=lanes.filter(left=>cells.filter(l=>Math.abs(l.x-left)<=8).length>=2);
  const short=cells.filter(l=>l.text.length<=48&&l.endX-l.x<=pageWidth*.55).length/cells.length;
  if(solid.length<2||short<.7)continue;
  out.push({x,y,w,h:bottom-y,lines:cells,text:regionText(cells)});
 }
 return out;
}

export function findPdfTables(lines:PdfLine[]){
 const rows:{y:number;cells:PdfLine[]}[]=[];
 for(const line of [...lines].filter(l=>!l.header).sort((a,b)=>a.y-b.y||a.x-b.x)){
  const row=rows.find(r=>Math.abs(r.y-line.y)<3);if(row)row.cells.push(line);else rows.push({y:line.y,cells:[line]});
 }
 const tables:{x:number;y:number;w:number;h:number;lines:PdfLine[];text:string}[]=[];let run:typeof rows=[];
 const numeric=(s:string)=>/^[\s$€£¥₹()+−\-\d.,%:]+$/.test(s)&&/\d/.test(s)&&!/^\d+[.)]$/.test(s.trim());
 const flush=()=>{
  const cells=run.flatMap(r=>r.cells),numbers=cells.filter(l=>numeric(l.text));
  const anchors=run[0]?.cells.map(c=>c.x)||[];
  const aligned=run.length>=3 && anchors.length>=2 && run.every(r=>r.cells.length===anchors.length && r.cells.every((c,i)=>Math.abs(c.x-anchors[i])<=c.size)) && run[0].cells.every(c=>!/[\d.!?]/.test(c.text)) && cells.every(c=>c.text.length<=50 && c.text.split(/\s+/).length<=6);
  if(run.length>=3 && (numbers.length>=4 && numbers.length/cells.length>=.35 || aligned)){
   const x=Math.min(...cells.map(l=>l.x)),right=Math.max(...cells.map(l=>l.endX)),top=Math.min(...cells.map(l=>l.y-l.size*1.2)),bottom=Math.max(...cells.map(l=>l.y+l.size*.4));
   tables.push({x:Math.max(0,x-4),y:Math.max(0,top-4),w:right-x+8,h:bottom-top+8,lines:cells,text:run.map(r=>r.cells.sort((a,b)=>a.x-b.x).map(l=>l.text).join('\t')).join('\n')});
  }run=[];
 };
 for(const row of rows){
  if(row.cells.length>=2 && row.cells.every(c=>c.text.split(/\s+/).length<=12) && (!run.length || row.y-run.at(-1)!.y<Math.max(...row.cells.map(c=>c.size))*2.8))run.push(row);
  else{flush();if(row.cells.length>=2 && row.cells.every(c=>c.text.split(/\s+/).length<=12))run.push(row);}
 }flush();return tables;
}
