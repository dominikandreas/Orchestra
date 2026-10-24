import { readFileSync,existsSync,writeFileSync } from 'node:fs';
import { resolve,join } from 'node:path';
import { spawn } from 'node:child_process';
for(const [name,value] of Object.entries(process.env)){if(name.startsWith('ORCHESTRA_')&&value!==undefined)process.env['RELAY_'+name.slice(10)]=value;}
const root=resolve(new URL('..',import.meta.url).pathname),data=process.env.RELAY_DATA_DIR||join(root,'.data');
let selected=root;const selection=join(data,'active-release.json');let saved;
if(existsSync(selection)){saved=JSON.parse(readFileSync(selection,'utf8'));selected=saved.path;}
const start=path=>spawn(process.execPath,['--import','tsx','src/server/index.ts'],{cwd:path,stdio:'inherit',env:{...process.env,RELAY_DATA_DIR:data}});
let child=start(selected),stopping=false;
const shutdown=signal=>{stopping=true;child.kill(signal)};process.on('SIGTERM',()=>shutdown('SIGTERM'));process.on('SIGINT',()=>shutdown('SIGINT'));
const launched=Date.now();child.on('exit',(code)=>{if(!stopping&&code&&saved?.previous&&Date.now()-launched<30000){console.error('Release failed to start; restoring previous version.');writeFileSync(selection,JSON.stringify({path:saved.previous,previous:selected}),{mode:0o600});child=start(saved.previous);child.on('exit',c=>process.exit(c||0));}else process.exit(code||0)});
