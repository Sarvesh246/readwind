import type {PdfLine} from './pdf-layout';
export function findPdfTables(lines:PdfLine[]){
 const rows:{y:number;cells:PdfLine[]}[]=[];
 for(const line of [...lines].filter(l=>!l.header).sort((a,b)=>a.y-b.y||a.x-b.x)){
  const row=rows.find(r=>Math.abs(r.y-line.y)<3);if(row)row.cells.push(line);else rows.push({y:line.y,cells:[line]});
 }
 const tables:{x:number;y:number;w:number;h:number;lines:PdfLine[];text:string}[]=[];let run:typeof rows=[];
 const numeric=(s:string)=>/^[\s$€£¥₹()+−\-\d.,%:]+$/.test(s)&&/\d/.test(s)&&!/^\d+[.)]$/.test(s.trim());
 const flush=()=>{
  const cells=run.flatMap(r=>r.cells),numbers=cells.filter(l=>numeric(l.text));
  if(run.length>=3 && numbers.length>=4 && numbers.length/cells.length>=.35){
   const x=Math.min(...cells.map(l=>l.x)),right=Math.max(...cells.map(l=>l.endX)),top=Math.min(...cells.map(l=>l.y-l.size*1.2)),bottom=Math.max(...cells.map(l=>l.y+l.size*.4));
   tables.push({x:Math.max(0,x-4),y:Math.max(0,top-4),w:right-x+8,h:bottom-top+8,lines:cells,text:run.map(r=>r.cells.sort((a,b)=>a.x-b.x).map(l=>l.text).join('\t')).join('\n')});
  }run=[];
 };
 for(const row of rows){
  if(row.cells.length>=2 && row.cells.every(c=>c.text.split(/\s+/).length<=12) && (!run.length || row.y-run.at(-1)!.y<Math.max(...row.cells.map(c=>c.size))*2.8))run.push(row);
  else{flush();if(row.cells.length>=2 && row.cells.every(c=>c.text.split(/\s+/).length<=12))run.push(row);}
 }flush();return tables;
}
