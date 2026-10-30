export function fidelityPdf({imageOnlyLast=false}={}){
 const count=12,imageId=5+count*2;
 const objects=['<< /Type /Catalog /Pages 2 0 R >>',`<< /Type /Pages /Kids [${Array.from({length:count},(_,i)=>`${5+i*2} 0 R`).join(' ')}] /Count ${count} >>`,'<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>','<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-BoldOblique >>'];
 const text=(s,x,y,font='F1',size=12)=>`BT /${font} ${size} Tf ${x} ${y} Td (${s}) Tj ET\n`;
 for(let i=0;i<count;i++){
  let stream=(i===0?text('A reliable book',50,730,'F2',24):'')+text('Every page keeps its original text and figures available for careful reading.',50,680)+text('Meaningful emphasis',50,650,'F2')+text(' remains meaningful.',170,650)+text('The surrounding paragraph remains ordinary text with no missing characters.',50,620);
  if(i===0)for(let r=0;r<5;r++)stream+=text(r?'202'+r:'Year',50,540-r*22)+text(r?`$${r===2?'12,345.67':r*125+'.50'}`:'Amount',230,540-r*22)+text(r?`${r*2}.5%`:'Return',420,540-r*22);
  for(let n=0;n<4;n++)stream+=`q 90 0 0 60 ${50+n*130} 130 cm /Image Do Q\n`;
  if(imageOnlyLast && i===count-1)stream='q 612 0 0 792 0 0 cm /Image Do Q\n';
  objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> /XObject << /Image ${imageId} 0 R >> >> /Contents ${6+i*2} 0 R >>`);
  objects.push(`<< /Length ${stream.length} >>\nstream\n${stream}endstream`);
 }
 const pixels=Array.from({length:64},(_,i)=>(i%8<(i/8|0)?'00':'FF')).join('');
 objects.push(`<< /Type /XObject /Subtype /Image /Width 8 /Height 8 /ColorSpace /DeviceGray /BitsPerComponent 8 /Filter /ASCIIHexDecode /Length ${pixels.length+1} >>\nstream\n${pixels}>\nendstream`);
 let pdf='%PDF-1.4\n';const offsets=[0];objects.forEach((object,i)=>{offsets.push(Buffer.byteLength(pdf));pdf+=`${i+1} 0 obj\n${object}\nendobj\n`;});const xref=Buffer.byteLength(pdf);
 pdf+=`xref\n0 ${objects.length+1}\n0000000000 65535 f \n${offsets.slice(1).map(o=>`${String(o).padStart(10,'0')} 00000 n \n`).join('')}trailer\n<< /Size ${objects.length+1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;return Buffer.from(pdf);
}
