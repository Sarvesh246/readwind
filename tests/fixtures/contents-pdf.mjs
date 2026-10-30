export const chapterTitles=Array.from({length:12},(_,i)=>`Chapter ${i+1}: A journey through a changing world and the ideas that shape its next beginning`);
const text=(value,y,size=14)=>`BT /F1 ${size} Tf 60 ${y} Td (${value}) Tj ET\n`;
/** Numberless linked contents, wrapped titles and enough chapters to expose shrinking rows. */
export function contentsPdf(){
  const pages=[text('A Book of Journeys',700,24),''];
  const annotations=[];
  pages[1]=text('Contents',720,24);
  chapterTitles.forEach((title,i)=>{
    const y=670-i*43, split=title.indexOf('world')+5;
    pages[1]+=text(title.slice(0,split),y,12)+text(title.slice(split).trim(),y-17,12);
    annotations.push({index:i+2,top:y,bottom:y-17});
    pages.push(text(`Chapter ${i+1}`,700,22)+text('A journey through a changing world',660,20)+text('and the ideas that shape its next beginning',632,20)+Array.from({length:8},(_,n)=>text('Reading gives each idea the space to become a clear and lasting thought.',570-n*22,13)).join('')+text(String(i+1),25,12));
  });
  const linkStart=4+pages.length*2;
  const objects=['<< /Type /Catalog /Pages 2 0 R >>',`<< /Type /Pages /Kids [${pages.map((_,i)=>`${4+i*2} 0 R`).join(' ')}] /Count ${pages.length} >>`,'<< /Type /Font /Subtype /Type1 /BaseFont /Times-Roman >>'];
  pages.forEach((stream,i)=>{objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${5+i*2} 0 R ${i===1?`/Annots [${annotations.flatMap((_,n)=>[`${linkStart+n*2} 0 R`,`${linkStart+n*2+1} 0 R`]).join(' ')}]`:''} >>`);objects.push(`<< /Length ${stream.length} >>\nstream\n${stream}endstream`);});
  for(const link of annotations)for(const y of [link.top,link.bottom])objects.push(`<< /Type /Annot /Subtype /Link /Rect [55 ${y-3} 560 ${y+13}] /Dest [${4+link.index*2} 0 R /Fit] >>`);
  let pdf='%PDF-1.4\n';const offsets=[0];objects.forEach((object,i)=>{offsets.push(Buffer.byteLength(pdf));pdf+=`${i+1} 0 obj\n${object}\nendobj\n`;});const xref=Buffer.byteLength(pdf);
  pdf+=`xref\n0 ${objects.length+1}\n0000000000 65535 f \n${offsets.slice(1).map(o=>`${String(o).padStart(10,'0')} 00000 n \n`).join('')}trailer\n<< /Size ${objects.length+1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(pdf);
}
