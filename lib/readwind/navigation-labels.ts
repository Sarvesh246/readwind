export function isContentsTitle(text:string){
 const key=text.normalize('NFKD').toLocaleLowerCase().replace(/[\p{M}\s\p{P}]/gu,'');
 return ['Contents','Table of contents','Sommaire','Table des matières','Inhalt','Inhaltsverzeichnis','Índice','Sumário','Sommario','Contenido','Contenidos','Содержание','Оглавление','目次','目录','目錄','목차','المحتويات','الفهرس','תוכן עניינים','विषयसूची'].some(t=>t.normalize('NFKD').toLocaleLowerCase().replace(/[\p{M}\s\p{P}]/gu,'')===key);
}
export function normalizePageLabel(text:string){
 return text.trim().toLocaleLowerCase().replace(/[‐‑‒–—−]/g,'-').replace(/[٠-٩۰-۹०-९]/g,c=>{const n=c.codePointAt(0)!;return String(n>0x965?n-0x966:n>0x6ef?n-0x6f0:n-0x660);});
}
export const printedPageToken=/^(?:\d{1,5}|[ivxlcdm]+|[\p{L}]{1,8}[-.:]\d{1,5})$/iu;
