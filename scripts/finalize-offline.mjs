import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
const next=process.argv.includes('--next');
const base=next?'public':'dist/client',files=[];
const piperWorker=`piper/worker-${JSON.parse(fs.readFileSync('lib/readwind/piper-worker-version.json','utf8')).version}.mjs`;
function walk(dir){for(const item of fs.readdirSync(dir,{withFileTypes:true})){const file=path.join(dir,item.name),relative=path.relative(base,file).replaceAll('\\','/');if(item.isDirectory())walk(file);else if(!relative.startsWith('ocr/lang/')&&(!relative.startsWith('piper/')||relative===piperWorker)&&/\.(?:js|mjs|css|woff2?|png|svg|wasm|gz|bcmap|pfb|ttf|otf)$/.test(relative)&&relative!=='sw.js')files.push('/'+relative);}}
walk(base);
if(next){const root='.next/static';function chunks(dir){for(const item of fs.readdirSync(dir,{withFileTypes:true})){const file=path.join(dir,item.name);if(item.isDirectory())chunks(file);else if(/\.(?:js|css|woff2?)$/.test(file))files.push('/_next/static/'+path.relative(root,file).replaceAll('\\','/'));}}chunks(root);}
files.sort();const digest=crypto.createHash('sha256').update(JSON.stringify(files));for(const file of files)digest.update(fs.readFileSync(next&&file.startsWith('/_next/static/')?'.next/static/'+file.slice('/_next/static/'.length):path.join(base,file.slice(1))));const version=digest.digest('hex').slice(0,12);
let worker=fs.readFileSync('scripts/offline-worker.js','utf8').replace(/const CACHE='[^']+';/,`const CACHE='readwind-${version}';`);
const piperVersion=JSON.parse(fs.readFileSync('lib/readwind/piper-runtime-version.json','utf8')).version;
worker=worker.replace(/const PIPER_CACHE='[^']+';/,`const PIPER_CACHE='piper-runtime-${piperVersion}';`);
worker=worker.replace("['/','/manifest.webmanifest','/favicon.svg']",JSON.stringify(['/', '/manifest.webmanifest',...files]));fs.writeFileSync(path.join(base,'sw.js'),worker);
console.log(`Offline app shell prepared: ${files.length} local assets.`);
