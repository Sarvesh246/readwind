import {deflateSync} from 'node:zlib';
const text=(s,x,y,font='F1',size=12)=>`BT /${font} ${size} Tf ${x} ${y} Td (${s.replace(/[\\()]/g,'\\$&')}) Tj ET\n`;
function build(streams,{image,width=612,height=792,outlines=false}={}){
 const objects=[],add=o=>{objects.push(Buffer.isBuffer(o)?o:Buffer.from(o));return objects.length;};
 const catalog=add(''),pages=add('');const f1=add('<< /Type /Font /Subtype /Type1 /BaseFont /Times-Roman >>'),f2=add('<< /Type /Font /Subtype /Type1 /BaseFont /Times-Bold >>'),f3=add('<< /Type /Font /Subtype /Type1 /BaseFont /Courier >>');
 const cmap='begincmap\n/CMapType 2 def\n1 begincodespacerange\n<00> <FF>\nendcodespacerange\n3 beginbfchar\n<41> <05D0>\n<42> <05D1>\n<43> <05D2>\nendbfchar\nendcmap';
 const cm=add(`<< /Length ${cmap.length} >>\nstream\n${cmap}\nendstream`),f4=add(`<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /ToUnicode ${cm} 0 R >>`);
 let imageId;if(image){const data=deflateSync(image.data);imageId=add(Buffer.concat([Buffer.from(`<< /Type /XObject /Subtype /Image /Width ${image.width} /Height ${image.height} /ColorSpace /DeviceGray /BitsPerComponent 8 /Filter /FlateDecode /Length ${data.length} >>\nstream\n`),data,Buffer.from('\nendstream')]));}
 const ids=[];for(const stream of streams){const content=add(`<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}endstream`);ids.push(add(`<< /Type /Page /Parent ${pages} 0 R /MediaBox [0 0 ${width} ${height}] /Resources << /Font << /F1 ${f1} 0 R /F2 ${f2} 0 R /F3 ${f3} 0 R /F4 ${f4} 0 R >> ${imageId?`/XObject << /Scan ${imageId} 0 R >>`:''} >> /Contents ${content} 0 R >>`));}
 let outlineId;if(outlines){outlineId=add('');const root=add(''),child=add('');objects[outlineId-1]=Buffer.from(`<< /Type /Outlines /First ${root} 0 R /Last ${root} 0 R /Count 2 >>`);objects[root-1]=Buffer.from(`<< /Title (A collection) /Parent ${outlineId} 0 R /Dest [${ids[1]} 0 R /Fit] /First ${child} 0 R /Last ${child} 0 R /Count 1 >>`);objects[child-1]=Buffer.from(`<< /Title (Code example) /Parent ${root} 0 R /Dest [${ids[2]} 0 R /Fit] >>`);}
 objects[catalog-1]=Buffer.from(`<< /Type /Catalog /Pages ${pages} 0 R ${outlineId?`/Outlines ${outlineId} 0 R`:''} >>`);objects[pages-1]=Buffer.from(`<< /Type /Pages /Kids [${ids.map(i=>`${i} 0 R`).join(' ')}] /Count ${ids.length} >>`);
 const chunks=[Buffer.from('%PDF-1.4\n')],offsets=[0];let size=chunks[0].length;objects.forEach((o,i)=>{offsets.push(size);const c=Buffer.concat([Buffer.from(`${i+1} 0 obj\n`),o,Buffer.from('\nendobj\n')]);chunks.push(c);size+=c.length;});chunks.push(Buffer.from(`xref\n0 ${objects.length+1}\n0000000000 65535 f \n${offsets.slice(1).map(n=>`${String(n).padStart(10,'0')} 00000 n \n`).join('')}trailer\n<< /Size ${objects.length+1} /Root ${catalog} 0 R >>\nstartxref\n${size}\n%%EOF`));return Buffer.concat(chunks);
}
export function edgeCasePdf(){
 const names=['Poetry','Code example','Drama','Lists','People','Equations','Columns','Raised text','References','Endnotes','Mixed scripts'];
 const streams=[text('Sommaire',40,730,'F2',24)+names.map((n,i)=>text(`${n} .... A-${i+1}`,40,680-i*28)).join('')];
 const title=s=>text(s,40,730,'F2',24);
 streams.push(title(names[0])+['The evening opens on a quiet road','a star','a path','home','and then a quiet night'].map((s,i)=>text(s,i===2?58:40,650-i*20-(i>2?30:0))).join(''));
 streams.push(title(names[1])+text('function read() {',40,650,'F3')+text('return 42;',64,630,'F3')+text('}',40,610,'F3'));
 streams.push(title(names[2])+text('Hamlet: Who goes there?',40,650)+text('[A door opens.]',58,630)+text('Horatio: A friend.',40,610));
 streams.push(title(names[3])+text('1.',40,650)+text('Read the first point.',90,650)+text('a) A nested point.',90,630)+text('2. Read the next point.',40,610));
 streams.push(title(names[4])+[['Name','Role'],['Anna','Editor'],['Ben','Writer'],['Cara','Artist']].map((r,i)=>r.map((s,j)=>text(s,40+j*260,650-i*24)).join('')).join(''));
 streams.push(title(names[5])+text('E = mc^2',40,650));
 streams.push(title(names[6])+Array.from({length:4},(_,r)=>[0,1,2].map(c=>text('A longer column of prose must stay in its own reading lane.',30+c*195,650-r*18,'F1',6)).join('')).join(''));
 streams.push(title(names[7])+text('m',40,650)+text('2',50,655,'F1',7)+text('1 A note that remains visible in its original position.',40,70,'F1',8));
 streams.push(title(names[8])+text('A source [7], and a year 7. Every word remains ordinary prose.',40,650));
 streams.push(title(names[9])+text('7. The original reference for the explicit bracketed note.',40,650));
 streams.push(title(names[10])+text('ABC',40,650,'F4'));
 return build(streams.map((s,i)=>s+(i?text(`A-${i}`,280,25):'')),{outlines:true});
}
export function scanEdgePdf(image,{spread=false,hidden=false}={}){
 let stream=`q ${spread?1224:612} 0 0 792 0 0 cm /Scan Do Q\n`;
 if(hidden){stream+='1 g\n';for(let i=0;i<8;i++)stream+=text('Unrelated hidden vocabulary about gardens rivers birds mountains and weather.',40,730-i*20);}
 return build([stream],{image,width:spread?1224:612});
}
