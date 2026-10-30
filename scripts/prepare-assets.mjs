import fs from 'node:fs';
fs.copyFileSync('node_modules/pdfjs-dist/build/pdf.worker.min.mjs','public/pdf.worker.min.mjs');
for(const [src,dest] of [['cmaps','cmaps'],['standard_fonts','standard_fonts'],['wasm','pdf-wasm']])fs.cpSync(`node_modules/pdfjs-dist/${src}`,`public/${dest}`,{recursive:true});
fs.mkdirSync('public/ocr',{recursive:true});fs.copyFileSync('node_modules/tesseract.js/dist/worker.min.js','public/ocr/worker.min.js');
fs.mkdirSync('public/fonts',{recursive:true});
for(const [pkg,file] of [['@fontsource-variable/literata','literata-latin-standard-normal.woff2'],['@fontsource-variable/literata','literata-latin-standard-italic.woff2'],['@fontsource-variable/source-serif-4','source-serif-4-latin-standard-normal.woff2']])fs.copyFileSync(`node_modules/${pkg}/files/${file}`,`public/fonts/${file}`);
fs.mkdirSync('public/ocr/core',{recursive:true});
for(const file of fs.readdirSync('node_modules/tesseract.js-core').filter(f=>f.includes('lstm')&&(f.endsWith('.wasm')||f.endsWith('.wasm.js'))))fs.copyFileSync(`node_modules/tesseract.js-core/${file}`,`public/ocr/core/${file}`);
console.log('PDF and OCR workers prepared.');

fs.mkdirSync('public/ocr/lang',{recursive:true});
for (const lang of ['eng','spa','fra','deu','por','hin','ara','jpn','chi_sim']) {
  fs.copyFileSync(`node_modules/@tesseract.js-data/${lang}/4.0.0_best_int/${lang}.traineddata.gz`,`public/ocr/lang/${lang}.traineddata.gz`);
}
