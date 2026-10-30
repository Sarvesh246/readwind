import fs from 'node:fs';
import path from 'node:path';
export const body='Reading should feel quiet and unhurried. A book leaves room for thought.';
export function createPdfFixture(output){
fs.mkdirSync(output,{recursive:true});
// A real four-page PDF: blank front matter, title, and two selectable text pages.
const streams=['', 'BT /F1 26 Tf 60 700 Td (A Quiet Reading Room) Tj ET', ...[1,2].map(n=>`BT /F1 22 Tf 60 700 Td (Chapter ${n}) Tj /F1 14 Tf 0 -50 Td (${body}) Tj 0 -24 Td (${body}) Tj ET`)];
const objects=['<< /Type /Catalog /Pages 2 0 R >>','<< /Type /Pages /Kids [4 0 R 6 0 R 8 0 R 10 0 R] /Count 4 >>','<< /Type /Font /Subtype /Type1 /BaseFont /Times-Roman >>'];
for(let i=0;i<4;i++){objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${5+i*2} 0 R >>`);objects.push(`<< /Length ${streams[i].length} >>\nstream\n${streams[i]}\nendstream`);}
let pdf='%PDF-1.4\n',offsets=[0];objects.forEach((o,i)=>{offsets.push(Buffer.byteLength(pdf));pdf+=`${i+1} 0 obj\n${o}\nendobj\n`;});const xref=Buffer.byteLength(pdf);pdf+=`xref\n0 ${objects.length+1}\n0000000000 65535 f \n`+offsets.slice(1).map(o=>`${String(o).padStart(10,'0')} 00000 n \n`).join('')+`trailer\n<< /Size ${objects.length+1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
const fixture=path.join(output,'blank-and-text.pdf');fs.writeFileSync(fixture,pdf);return fixture;
}
