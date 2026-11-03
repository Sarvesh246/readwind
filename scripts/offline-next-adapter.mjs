import {spawnSync} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL,fileURLToPath} from 'node:url';
// Preserve the hosting platform adapter while preparing public bytes before it
// packages outputs. This uses the Next 16 adapter lifecycle, not output paths.
const platformPath=process.env.NEXT_ADAPTER_PATH;
const self=fileURLToPath(import.meta.url);
const platform=platformPath && path.resolve(platformPath)!==self
 ? (await import(pathToFileURL(path.resolve(platformPath)).href)).default : null;
const adapter={
 name:'Readwind offline assets',
 async modifyConfig(config,context){return platform?.modifyConfig ? platform.modifyConfig(config,context) : config;},
 async onBuildComplete(context){
  const result=spawnSync(process.execPath,[path.join(context.projectDir,'scripts/finalize-offline.mjs'),'--next'],{cwd:context.projectDir,stdio:'inherit',windowsHide:true});
  if(result.status!==0)throw new Error('Offline app shell generation failed.');
  const worker=fs.readFileSync(path.join(context.projectDir,'public/sw.js'));
  const output=context.outputs.staticFiles.find(file=>file.pathname==='/sw.js');
  // Public assets are discovered separately by Vercel; other adapters may
  // include them explicitly in the output list.
  if(output)fs.writeFileSync(output.filePath,worker);
  if(platform?.onBuildComplete)await platform.onBuildComplete(context);
 },
};

export default adapter;
