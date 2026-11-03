import {it,expect} from 'vitest';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';import path from 'node:path';import {pathToFileURL} from 'node:url';import {spawnSync} from 'node:child_process';
it('generates the offline manifest before the hosting adapter packages static files',()=>{
 const root=mkdtempSync(path.join(tmpdir(),'readwind-adapter-'));mkdirSync(path.join(root,'scripts'));mkdirSync(path.join(root,'public'));
 writeFileSync(path.join(root,'public/sw.js'),'old worker');
 writeFileSync(path.join(root,'scripts/finalize-offline.mjs'),`import fs from 'node:fs';fs.writeFileSync('public/sw.js','generated worker');`);
 const platform=path.join(root,'platform.mjs');writeFileSync(platform,`import fs from 'node:fs';export default {modifyConfig:config=>({...config,platform:true}),onBuildComplete:context=>{if(fs.readFileSync(context.projectDir+'/public/sw.js','utf8')!=='generated worker')throw Error('stale packaged worker');fs.writeFileSync(context.projectDir+'/packaged','ok');}};`);
 const adapter=pathToFileURL(path.resolve('scripts/offline-next-adapter.mjs')).href;
 const fixture=path.join(root,'run.mjs');writeFileSync(fixture,`import adapter from ${JSON.stringify(adapter)};const projectDir=${JSON.stringify(root)};const config=await adapter.modifyConfig({},{});if(!config.platform)throw Error('platform config lost');await adapter.onBuildComplete({projectDir,outputs:{staticFiles:[]}});`);
 const result=spawnSync(process.execPath,[fixture],{env:{...process.env,NEXT_ADAPTER_PATH:platform},encoding:'utf8',windowsHide:true});expect(result.status,result.stderr).toBe(0);expect(readFileSync(path.join(root,'packaged'),'utf8')).toBe('ok');
});
