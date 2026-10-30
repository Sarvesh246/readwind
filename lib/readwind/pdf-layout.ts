export type PdfTextItem = {str:string;transform:number[];width:number;height:number;dir?:string;fontName?:string;hasEOL?:boolean};
export type PdfLine = {text:string;x:number;y:number;size:number;page:number;header:boolean;endX:number};
export type PdfIssue = 'columns'|'rotated-text'|'rtl'|'vertical-text'|'scanned'|'text-mapping'|'sparse'|'illustrated'|'low-ocr'|'extraction-error';
export const pdfIssueLabels:Record<PdfIssue,string> = {
 'columns':'Multiple columns or aligned text', 'rotated-text':'Rotated text', 'rtl':'Right-to-left writing', 'vertical-text':'Vertical writing', 'scanned':'Scanned content', 'text-mapping':'Unreliable text layer', 'sparse':'Little selectable text', 'illustrated':'Illustrations or tables', 'low-ocr':'Recognition needs review', 'extraction-error':'Some content could not be extracted',
};
export type PdfPageReport = {index:number;width:number;height:number;characters:number;ocrConfidence?:number;issues:PdfIssue[]};
export type PdfImportReport = {version:1;recommendedMode:'original'|'reflow';pages:PdfPageReport[];warnings:string[]};
export function normalizePdfText(text:string){return text.normalize('NFC').replace(/\u00ad|\u200b/g,'').replace(/[ﬀﬁﬂﬃﬄﬅﬆ]/g,c=>({'ﬀ':'ff','ﬁ':'fi','ﬂ':'fl','ﬃ':'ffi','ﬄ':'ffl','ﬅ':'st','ﬆ':'st'})[c]!);}
function matrix(a:number[],b:number[]){return [a[0]*b[0]+a[2]*b[1],a[1]*b[0]+a[3]*b[1],a[0]*b[2]+a[2]*b[3],a[1]*b[2]+a[3]*b[3],a[0]*b[4]+a[2]*b[5]+a[4],a[1]*b[4]+a[3]*b[5]+a[5]];}
export function dominantSize(items:{size:number;text:string}[]){const weights=new Map<number,number>();for(const i of items){const key=Math.round(i.size*2)/2;if(key>0&&Number.isFinite(key))weights.set(key,(weights.get(key)||0)+i.text.trim().length);}return [...weights].sort((a,b)=>b[1]-a[1])[0]?.[0]||12;}
/** Use viewport coordinates and geometry, never PDF stream order or font names. */
export function analyzePdfPage(items:PdfTextItem[],viewport:{width:number;height:number;transform:number[]},page:number):{lines:PdfLine[];report:PdfPageReport;bodySize:number}{
 const issues=new Set<PdfIssue>();
 const glyphs=items.filter(i=>i.str.trim()).map(i=>{const m=matrix(viewport.transform,i.transform),size=Math.hypot(m[2],m[3])||Math.abs(i.height)||12,scale=Math.hypot(viewport.transform[0],viewport.transform[1])||1,angle=Math.atan2(m[1],m[0]);if(i.dir==='rtl')issues.add('rtl');if(i.dir==='ttb')issues.add('vertical-text');if(Math.abs(Math.sin(angle))>.15)issues.add('rotated-text');return {text:normalizePdfText(i.str),x:m[4],y:m[5],size,width:Math.abs(i.width*scale)};});
 const characters=glyphs.reduce((n,g)=>n+g.text.length,0);const bad=glyphs.reduce((n,g)=>n+(g.text.match(/[\uFFFD\uE000-\uF8FF]/g)?.length||0),0);
 if(bad>0&&bad/Math.max(1,characters)>.005)issues.add('text-mapping');
 if(!characters)issues.add('scanned');else if(characters<100)issues.add('sparse');
 const bodySize=dominantSize(glyphs);
 const rows:{y:number;size:number;items:typeof glyphs}[]=[];
 for(const glyph of glyphs.sort((a,b)=>a.y-b.y||a.x-b.x)){
  const tolerance=Math.max(1,Math.min(3,Math.min(glyph.size,bodySize)*.22));
  const row=rows.slice(-5).find(r=>Math.abs(r.y-glyph.y)<=tolerance);
  if(row){row.items.push(glyph);row.size=Math.max(row.size,glyph.size);}else rows.push({y:glyph.y,size:glyph.size,items:[glyph]});
 }
 const lines:PdfLine[]=[],gaps:{x:number;y:number}[]=[];
 for(const row of rows){let line:PdfLine|undefined;for(const g of row.items.sort((a,b)=>a.x-b.x)){
  const gap=line?g.x-line.endX:0;
  if(!line||gap>Math.max(bodySize*2.8,viewport.width*.035)){
   if(line&&!line.header)gaps.push({x:(line.endX+g.x)/2,y:row.y});
   line={text:g.text,x:g.x,y:row.y,size:g.size,page,header:row.y<viewport.height*.08||row.y>viewport.height*.92,endX:g.x+g.width};lines.push(line);
  }else{const space=gap>Math.min(line.size,g.size)*.16&&!/\s$/.test(line.text)&&!/^\s/.test(g.text);line.text+=(space?' ':'')+g.text;line.endX=Math.max(line.endX,g.x+g.width);}
 }}
 const gutters=new Map<number,{count:number;minY:number}>();for(const g of gaps.filter(g=>g.x>viewport.width*.2&&g.x<viewport.width*.8)){const bin=Math.round(g.x/(viewport.width*.04));const old=gutters.get(bin);gutters.set(bin,{count:(old?.count||0)+1,minY:Math.min(old?.minY??Infinity,g.y)});}
 const candidate=[...gutters].sort((a,b)=>b[1].count-a[1].count)[0];
 if(candidate&&candidate[1].count>=Math.max(3,rows.length*.15)){
  issues.add('columns');const gutter=candidate[0]*viewport.width*.04,top=candidate[1].minY;
  // Titles remain above the columns. Each column then reads top to bottom.
  lines.sort((a,b)=>{const lane=(l:PdfLine)=>l.header&&l.y<viewport.height*.08||l.y<top-bodySize*.5?0:l.header&&l.y>viewport.height*.92?3:l.x<gutter?1:2;return lane(a)-lane(b)||a.y-b.y||a.x-b.x;});
 }else lines.sort((a,b)=>a.y-b.y||a.x-b.x);
 return {lines,bodySize,report:{index:page,width:viewport.width,height:viewport.height,characters,issues:[...issues]}};
}
export function importReport(pages:PdfPageReport[]):PdfImportReport{
 pages=pages.map(p=>({...p,issues:[...new Set(p.issues)]}));
 const all=new Set(pages.flatMap(p=>p.issues));const warnings:string[]=[];
 if(all.has('columns'))warnings.push('Multiple columns or aligned cells detected. Original layout keeps their reading order and spacing.');
 if(all.has('scanned'))warnings.push('Image-based pages detected. Original layout preserves the scan; OCR is optional and language-dependent.');
 if(all.has('rtl')||all.has('vertical-text'))warnings.push('Right-to-left or vertical writing detected. Original layout preserves text direction.');
 if(all.has('rotated-text'))warnings.push('Rotated text detected. Original layout preserves its orientation.');
 if(all.has('text-mapping')||all.has('extraction-error'))warnings.push('Some PDF text could not be mapped reliably. Original layout avoids showing corrupted extracted text.');
 if(all.has('illustrated'))warnings.push('Illustrations or tables detected. Original layout preserves their exact placement.');
 if(all.has('low-ocr'))warnings.push('Some OCR text has low confidence. Check it against the original page.');
 const risky=['columns','scanned','rtl','vertical-text','rotated-text','text-mapping','extraction-error','illustrated','low-ocr'];
 return {version:1,recommendedMode:pages.some(p=>p.issues.some(i=>risky.includes(i)))?'original':'reflow',pages,warnings};
}
