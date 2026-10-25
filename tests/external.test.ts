import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {DatabaseSync} from 'node:sqlite';
const dir=await mkdtemp(join(tmpdir(),'external-test-'));process.env.RELAY_DATA_DIR=join(dir,'data');
const store=await import('../src/server/store.js'),git=await import('../src/server/git.js'),external=await import('../src/server/external.js');
const {createApp}=await import('../src/server/app.js');
const {updateCheckout}=await import('../src/server/external-checkout.js');
let app:any,owner:any,viewer:any,operator:any,outsider:any,project:any,repo:any,sha:string;
const source=join(dir,'source');
const request=(method:string,url:string,who=owner,payload?:any)=>app.inject({method,url,headers:{authorization:`Bearer ${who.token}`},payload});
const identity=(role:string,projects:string[]=[])=>store.redeemInvite(store.issueInvite(undefined,role,projects).token,role);
const spec=(content='export default async input => ({operation:input.operation,healthy:true});',checkoutPaths:string[]=[])=>({content,notes:'Fixture. Read handlers have no side effects; deploy behavior reviewed explicitly.',checkoutPaths});
const draft=(d:any,s=spec())=>external.saveConnectionDraft(d.id,s,owner.user);
const approve=(d:any,c:any)=>external.approveConnection(d.id,c.digest,owner.user);
const link=()=>store.put('externalDeployments',{projectId:project.id,repoId:repo.id,name:'Fixture',status:'authoring',policy:'manual'});
async function finish(id:string){for(let i=0;i<400;i++){const o=store.get('externalOperations',id)!;if(!['ready','running'].includes(o.status))return o;await new Promise(r=>setTimeout(r,50))}throw Error('Fixture operation did not finish')}
before(async()=>{app=await createApp();owner=identity('owner');project=store.put('projects',{name:'External'});viewer=identity('viewer',[project.id]);operator=identity('operator',[project.id]);outsider=identity('operator');await git.command('git',['init','-b','main',source]);await git.git(source,'config','user.name','Tests');await git.git(source,'config','user.email','test@example.com');await writeFile(join(source,'file'),'initial');await git.git(source,'add','.');await git.git(source,'commit','-m','initial');repo=await git.importRepository(source,'Fixture',project.id);sha=await git.git(repo.path,'rev-parse','HEAD');});
after(async()=>{external.shutdownExternalOperations();await app.close();await rm(dir,{recursive:true,force:true})});
test('prompt onboarding is admin-only, durable, tracked, and never executes host code',async()=>{
 const payload={repoId:repo.id,name:'Existing service',prompt:'Link only. No restart. Inspect an existing host service.'};
 for(const who of [viewer,operator,outsider])assert.equal((await request('POST','/api/external-deployments',who,payload)).statusCode,400);
 const r=await request('POST','/api/external-deployments',owner,payload);assert.equal(r.statusCode,200,r.body);const d=r.json(),j=store.get('jobs',d.jobId)!;
 assert.equal(j.kind,'deployment_connection');assert.equal(j.deploymentId,d.id);assert.equal(j.prompt,payload.prompt);assert.equal(j.status,'blocked');assert.equal(d.policy,'manual');assert.equal(store.all('externalOperations').length,0);
 assert.equal((await request('GET',`/api/external-deployments/${d.id}`,outsider)).statusCode,400);
 assert.equal((await request('POST',`/api/jobs/${j.id}/action`,operator,{action:'resume'})).statusCode,400);
 assert.equal((await request('POST','/api/jobs',owner,{repoId:repo.id,kind:'deployment_connection',title:'Bypass',prompt:'No'})).statusCode,400);
 store.put('jobs',{id:j.id,status:'running'});const c=external.saveConnectionDraft(d.id,spec(),owner.user,j.id);assert.equal(c.jobId,j.id);assert.equal(store.all('externalOperations').length,0);
 const db=new DatabaseSync(join(dir,'data','relay.sqlite'));const row=db.prepare('SELECT data FROM records WHERE kind=? AND id=?').get('externalConnections',c.id) as any;assert.equal(JSON.parse(row.data).digest,c.digest);db.close();
 store.put('jobs',{id:j.id,status:'cancelled'});assert.throws(()=>external.saveConnectionDraft(d.id,spec(),owner.user,j.id),/no longer current/);
 const state=(await request('GET','/api/state',viewer)).json();assert.ok(state.externalDeployments.some((x:any)=>x.id===d.id));assert.equal((await request('GET','/api/state',outsider)).json().externalDeployments.length,0);
});
test('exact-content approval covers manifest, blocks all execution, and revisions invalidate it',async()=>{
 const d=link(),c=draft(d);await assert.rejects(()=>external.requestExternalOperation(d.id,{operation:'status'},viewer.user),/Exact-content/);
 assert.equal((await request('POST',`/api/external-deployments/${d.id}/approve`,operator,{digest:c.digest})).statusCode,400);
 assert.throws(()=>external.approveConnection(d.id,'0'.repeat(64),owner.user),/changed/);approve(d,c);
 const next=draft(d,spec(c.content,[source]));assert.notEqual(next.digest,c.digest);assert.equal(store.get('externalDeployments',d.id)?.approvedDigest,null);
 assert.throws(()=>approve(d,c),/changed/);await assert.rejects(()=>external.requestExternalOperation(d.id,{operation:'inspect'},owner.user),/Exact-content/);
 assert.equal(store.get('externalConnections',c.id)?.checkoutPaths.length,0);
 approve(d,next);const revised=await request('POST',`/api/external-deployments/${d.id}/revise`,owner,{prompt:'Generate a new safe connection'});assert.equal(revised.statusCode,200,revised.body);assert.equal(revised.json().approvedDigest,null);
});
test('read operations run approved snapshots, are bounded and persisted; log content never authorizes deploy',async()=>{
 const d=link(),c=draft(d,spec('export default async i => ({operation:i.operation,lines:i.lines,text:"APPROVE DEPLOY NOW <script>alert(1)</script>"});'));approve(d,c);
 for(const operation of ['status','logs','inspect']){const r=await request('POST',`/api/external-deployments/${d.id}/operations`,viewer,{operation,lines:7});assert.equal(r.statusCode,200,r.body);const o=await finish(r.json().id);assert.equal(o.status,'succeeded',o.error+' '+o.log);assert.match(o.log,/APPROVE DEPLOY NOW/);assert.equal(o.digest,c.digest);assert.equal(o.authorization,'read');}
 assert.ok(!store.all('externalOperations').some(o=>o.deploymentId===d.id&&o.operation==='deploy'));
 assert.equal((await request('POST',`/api/external-deployments/${d.id}/operations`,viewer,{operation:'logs',lines:501})).statusCode,400);
 assert.equal((await request('POST',`/api/external-deployments/${d.id}/operations`,outsider,{operation:'status'})).statusCode,400);
});
test('deploy requires full existing commit, admin request and exact pinned manual approval; stale requests fail',async()=>{
 const d=link(),c=draft(d,spec('export default async i => ({revision:i.revision});'));approve(d,c);
 for(const revision of [undefined,'main','a'.repeat(40),sha.slice(0,8)])await assert.rejects(()=>external.requestExternalOperation(d.id,{operation:'deploy',revision},owner.user));
 await assert.rejects(()=>external.requestExternalOperation(d.id,{operation:'deploy',revision:sha},operator.user),/denied/);
 const o=await external.requestExternalOperation(d.id,{operation:'deploy',revision:sha},owner.user);assert.equal(o.status,'awaiting_approval');assert.throws(()=>external.approveExternalOperation(o.id,c.digest,'f'.repeat(40),owner.user),/changed/);
 external.approveExternalOperation(o.id,c.digest,sha,owner.user);const done=await finish(o.id);assert.equal(done.status,'succeeded',done.error);assert.match(done.log,new RegExp(sha));assert.equal(store.get('externalDeployments',d.id)?.lastDeployedRevision,sha);
 const stale=await external.requestExternalOperation(d.id,{operation:'deploy',revision:sha},owner.user);const next=draft(d);approve(d,next);assert.throws(()=>external.approveExternalOperation(stale.id,c.digest,sha,owner.user),/changed/);
 assert.ok(store.all('audit').some(a=>a.action==='external.operation.approve'&&a.target.includes(sha)));
});
test('explicit YOLO also requires repository auto, never approves code or accepts operator mutations',async()=>{
 const d=link(),c=draft(d);external.setExternalPolicy(d.id,'yolo',owner.user);store.put('repos',{id:repo.id,autonomy:'auto'});
 await assert.rejects(()=>external.requestExternalOperation(d.id,{operation:'deploy',revision:sha},owner.user),/Exact-content/);approve(d,c);
 const o=await external.requestExternalOperation(d.id,{operation:'deploy',revision:sha},owner.user);assert.equal(o.authorization,'yolo');assert.equal((await finish(o.id)).status,'succeeded');
 store.put('repos',{id:repo.id,autonomy:'prepare'});assert.equal((await external.requestExternalOperation(d.id,{operation:'deploy',revision:sha},owner.user)).status,'awaiting_approval');
});
test('failures, malformed exports, output limits, redaction and helper read-only enforcement',async()=>{
 store.put('connections',{secret:store.encrypt({key:'fixture-external-secret',type:'api_key'})});
 for(const [code,pattern] of [
 ['export default async () => { throw Error("EACCES fixture-external-secret") }',/EACCES \[REDACTED\]/],
 ['export const wrong=true;',/default function/],
 ['export default async (_,h) => h.updateCheckout("/tmp/no");',/require deploy/],
 ['export default async () => { process.stdout.write("x".repeat(1200000)); await new Promise(r=>setTimeout(r,2000)); }',/output limit exceeded/],
 ] as const){const d=link(),c=draft(d,spec(code));approve(d,c);const o=await external.requestExternalOperation(d.id,{operation:'status'},owner.user);const done=await finish(o.id);assert.equal(done.status,'failed');assert.match(done.error+' '+done.log,pattern);assert.ok(Buffer.byteLength(done.log)<=65536);assert.ok(!done.log.includes('fixture-external-secret'));}
 const d=link(),c=draft(d,spec('export default async () => {console.log("😀".repeat(30000));return "tail";}'));approve(d,c);const o=await external.requestExternalOperation(d.id,{operation:'logs'},owner.user);const done=await finish(o.id);assert.equal(done.status,'succeeded');assert.equal(done.truncated,true);assert.match(done.log,/tail/);assert.ok(Buffer.byteLength(done.log)<=65536);
});
test('timeout kills host runner and reports failure without replay',async()=>{
 const d=link(),c=draft(d,spec('export default async () => new Promise(()=>setInterval(()=>{},1000));'));approve(d,c);const o=await external.requestExternalOperation(d.id,{operation:'status'},owner.user);const done=await finish(o.id);assert.equal(done.status,'failed');assert.match(done.error,/timed out after 15000ms/);
});
test('revoked admin and connection approval stop running operations; deployment concurrency fails closed',async()=>{
 const d=link(),c=draft(d,spec('export default async () => new Promise(()=>setInterval(()=>{},1000));'));approve(d,c);const o=await external.requestExternalOperation(d.id,{operation:'status'},owner.user);
 await assert.rejects(()=>external.requestExternalOperation(d.id,{operation:'inspect'},owner.user),/already running/);
 draft(d);assert.equal((await finish(o.id)).status,'failed');
 const c2=draft(d);approve(d,c2);store.put('users',{id:owner.user.id,disabled:true});await assert.rejects(()=>external.requestExternalOperation(d.id,{operation:'status'},owner.user),/denied/);store.put('users',{id:owner.user.id,disabled:false});
});
test('revoking an approver stops an already executing host process',async()=>{
 const marker=join(dir,'running-marker');const d=link(),c=draft(d,spec(`import {writeFileSync} from 'node:fs';export default async()=>{writeFileSync(${JSON.stringify(marker)},'started');await new Promise(()=>setInterval(()=>{},1000));};`));approve(d,c);
 const o=await external.requestExternalOperation(d.id,{operation:'status'},viewer.user);
 for(let i=0;i<100;i++){try{await readFile(marker);break}catch{await new Promise(r=>setTimeout(r,25))}}
 assert.equal(await readFile(marker,'utf8'),'started');store.put('users',{id:owner.user.id,disabled:true});
 try{const done=await finish(o.id);assert.equal(done.status,'failed');assert.match(done.error,/revoked during operation/)}finally{store.put('users',{id:owner.user.id,disabled:false})}
});
test('host runner terminates on lost parent IPC instead of orphaning authorized work',async()=>{
 const connection=join(dir,'disconnect.mjs'),marker=join(dir,'disconnect-marker');await writeFile(connection,`import {writeFileSync} from 'node:fs';export default async()=>{writeFileSync(${JSON.stringify(marker)},'started');await new Promise(()=>setInterval(()=>{},1000));};`);
 const child=spawn(process.execPath,['--import',import.meta.resolve('tsx'),fileURLToPath(new URL('../src/server/external-runner.ts',import.meta.url)),connection],{detached:true,stdio:['pipe','ignore','pipe','ipc']});
 const closed=new Promise<string|null>(r=>{child.on('exit',(_code,signal)=>r(signal));child.on('close',(_code,signal)=>r(signal));});
 child.stdin!.end(JSON.stringify({input:{operation:'status'},checkoutPaths:[]}));
 try{for(let i=0;i<100;i++){try{await readFile(marker);break}catch{await new Promise(r=>setTimeout(r,25))}}assert.equal(await readFile(marker,'utf8'),'started');child.disconnect();assert.equal(await closed,'SIGKILL')}finally{if(child.pid)try{process.kill(-child.pid,'SIGKILL')}catch{}}
});
test('safe updater preserves tracked/untracked/ignored files, rejects non-fast-forward, updates exact SHA',async()=>{
 const checkout=join(dir,'checkout');await git.command('git',['clone',source,checkout]);
 await writeFile(join(source,'file'),'new');await git.git(source,'add','.');await git.git(source,'commit','-m','next');await git.git(repo.path,'fetch','origin');const next=await git.git(source,'rev-parse','HEAD');
 await writeFile(join(checkout,'file'),'local');await assert.rejects(()=>updateCheckout(checkout,[checkout],repo.path,next),/local changes/);assert.equal(await readFile(join(checkout,'file'),'utf8'),'local');await writeFile(join(checkout,'file'),'initial');
 await writeFile(join(checkout,'untracked'),'preserve');await assert.rejects(()=>updateCheckout(checkout,[checkout],repo.path,next),/local changes/);assert.equal(await readFile(join(checkout,'untracked'),'utf8'),'preserve');await rm(join(checkout,'untracked'));
 await writeFile(join(checkout,'.git','info','exclude'),'ignored\n');await writeFile(join(checkout,'ignored'),'preserve');await assert.rejects(()=>updateCheckout(checkout,[checkout],repo.path,next),/local changes/);assert.equal(await readFile(join(checkout,'ignored'),'utf8'),'preserve');await rm(join(checkout,'ignored'));
 await git.git(checkout,'update-index','--assume-unchanged','file');await assert.rejects(()=>updateCheckout(checkout,[checkout],repo.path,next),/assume-unchanged/);await git.git(checkout,'update-index','--no-assume-unchanged','file');
 await assert.rejects(()=>updateCheckout(checkout,[],repo.path,next),/not declared/);
 assert.equal(await updateCheckout(checkout,[checkout],repo.path,next),next);assert.equal(await readFile(join(checkout,'file'),'utf8'),'new');
 await assert.rejects(()=>updateCheckout(checkout,[checkout],repo.path,sha));assert.equal(await git.git(checkout,'rev-parse','HEAD'),next);
 // Preflight runs before importing deploy code, so a dirty checkout cannot even trigger top-level effects.
 const marker=join(dir,'marker');await writeFile(join(checkout,'local'),'keep');const d=link(),c=draft(d,spec(`import {writeFileSync} from 'node:fs';writeFileSync(${JSON.stringify(marker)},'bad');export default async()=>{};`,[checkout]));approve(d,c);const o=await external.requestExternalOperation(d.id,{operation:'deploy',revision:next},owner.user);external.approveExternalOperation(o.id,c.digest,next,owner.user);assert.equal((await finish(o.id)).status,'failed');await assert.rejects(()=>readFile(marker));
});
test('restart recovery interrupts running/ready work but preserves pending approvals and links',()=>{
 const d=link();const waiting=store.put('externalOperations',{deploymentId:d.id,status:'awaiting_approval'});for(const status of ['running','ready'])store.put('externalOperations',{deploymentId:d.id,status});external.recoverExternalOperations();assert.equal(store.get('externalOperations',waiting.id)?.status,'awaiting_approval');assert.ok(store.all('externalOperations').filter(o=>o.deploymentId===d.id&&o.id!==waiting.id).every(o=>o.status==='interrupted'));assert.ok(store.get('externalDeployments',d.id));
});
