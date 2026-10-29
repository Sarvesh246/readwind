import { spawnSync } from 'node:child_process';
for(const args of [['scripts/prepare-assets.mjs'],['scripts/run-framework.mjs','build'],['scripts/finalize-offline.mjs']]){const r=spawnSync(process.execPath,args,{stdio:'inherit'});if(r.status!==0)process.exit(r.status||1);}
