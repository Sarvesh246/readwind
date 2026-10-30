import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
const base='dist/client',files=[];
function walk(dir){for(const item of fs.readdirSync(dir,{withFileTypes:true})){const file=path.join(dir,item.name),relative=path.relative(base,file).replaceAll('\\','/');if(item.isDirectory())walk(file);else if(!relative.startsWith('cmaps/')&&!relative.startsWith('ocr/lang/')&&/\.(?:js|mjs|css|woff2?|png|svg|wasm|gz|pfb|ttf|otf)$/.test(relative)&&relative!=='sw.js')files.push('/'+relative);}}
walk(base);files.sort();const digest=crypto.createHash('sha256').update(JSON.stringify(files));for(const file of files)digest.update(fs.readFileSync(path.join(base,file.slice(1))));const version=digest.digest('hex').slice(0,12);
let worker=fs.readFileSync('public/sw.js','utf8').replace(/const CACHE='[^']+';/,`const CACHE='readwind-${version}';`);
worker=worker.replace("['/','/manifest.webmanifest','/favicon.svg']",JSON.stringify(['/', '/manifest.webmanifest',...files]));fs.writeFileSync(path.join(base,'sw.js'),worker);
console.log(`Offline app shell prepared: ${files.length} local assets.`);
