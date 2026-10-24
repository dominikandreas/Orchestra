import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const dir=await mkdtemp(join(tmpdir(),'relay-test-'));process.env.RELAY_DATA_DIR=join(dir,'data');
const store=await import('../src/server/store.js');const git=await import('../src/server/git.js');const {createApp}=await import('../src/server/app.js');const {enqueue}=await import('../src/server/jobs.js');
let app:any,owner:any,project:any,repo:any,ownerToken:string,viewerToken:string,otherToken:string;
before(async()=>{app=await createApp();const inv=store.issueInvite(undefined,'owner');const r=store.redeemInvite(inv.token,'Owner');owner=r.user;ownerToken=r.token;project=store.put('projects',{name:'Test'});const v=store.issueInvite(undefined,'viewer',[project.id]);viewerToken=store.redeemInvite(v.token,'Viewer').token;otherToken=store.redeemInvite(store.issueInvite(undefined,'operator',[]).token,'Other').token;const source=join(dir,'source');await git.command('git',['init','-b','main',source]);await git.git(source,'config','user.name','Tests');await git.git(source,'config','user.email','tests@example.com');await writeFile(join(source,'hello.txt'),'original\n');await git.git(source,'add','.');await git.git(source,'commit','-m','initial');await writeFile(join(source,'dirty.txt'),'do not touch');repo=await git.importRepository(source,'Test repo',project.id);});
after(async()=>{await app.close();store.db.close()});
const request=(method:string,url:string,token?:string,payload?:any)=>app.inject({method,url,headers:token?{authorization:`Bearer ${token}`}:{},payload});
test('device invitations are single-use, expiring, and tokens hashed',()=>{const i=store.issueInvite(undefined,'viewer');const r=store.redeemInvite(i.token,'A');assert.throws(()=>store.redeemInvite(i.token,'A'));assert.ok(!JSON.stringify(store.all('devices')).includes(r.token));const expired=store.issueInvite(undefined,'viewer',[],-1);assert.throws(()=>store.redeemInvite(expired.token,'Expired'));});
test('API requires auth and enforces project roles',async()=>{assert.equal((await request('GET','/api/state')).statusCode,401);assert.equal((await request('POST','/api/projects',viewerToken,{name:'No'})).statusCode,400);const r=await request('GET','/api/state',otherToken);assert.equal(r.json().repos.length,0);assert.equal((await request('GET',`/api/repos/${repo.id}/inspect`,otherToken)).statusCode,400);assert.equal((await request('POST','/api/jobs',viewerToken,{repoId:repo.id,title:'No',prompt:'No',kind:'implement'})).statusCode,400);});
test('revoked devices immediately lose access',async()=>{const r=store.redeemInvite(store.issueInvite(owner.id).token,'Device');const device=store.all('devices').find(d=>d.hash===store.hash(r.token))!;store.del('devices',device.id);assert.equal((await request('GET','/api/state',r.token)).statusCode,401);});
test('import preserves original uncommitted files and uses managed bare repository',async()=>{assert.equal(await readFile(join(repo.source,'dirty.txt'),'utf8'),'do not touch');assert.equal(await git.git(repo.path,'rev-parse','--is-bare-repository'),'true');});
test('merge rejects stale revisions and missing current tests/review',async()=>{const path=await git.createWorktree(repo,'feature',repo.base);await writeFile(join(path,'hello.txt'),'new\n');await git.git(path,'add','.');await git.git(path,'commit','-m','feature');const c=await git.createChange(repo,'relay/feature','main','Feature',owner.id);await assert.rejects(()=>git.mergeChange(c.id),/review/);store.put('repos',{id:repo.id,testCommand:'true'});store.put('reviews',{changeId:c.id,sourceSha:c.sourceSha,targetSha:c.targetSha,verdict:'approved'});await assert.rejects(()=>git.mergeChange(c.id),/test/);store.put('checks',{changeId:c.id,sourceSha:c.sourceSha,targetSha:c.targetSha,status:'passed'});await writeFile(join(path,'extra.txt'),'more');await git.git(path,'add','.');await git.git(path,'commit','-m','later');await assert.rejects(()=>git.mergeChange(c.id),/changed/);const fresh=await git.refreshChange(c);store.put('checks',{changeId:c.id,sourceSha:fresh.sourceSha,targetSha:fresh.targetSha,status:'passed'});store.put('reviews',{changeId:c.id,sourceSha:fresh.sourceSha,targetSha:fresh.targetSha,verdict:'approved'});assert.equal((await git.mergeChange(c.id)).status,'merged');assert.equal(await git.git(repo.path,'show','main:hello.txt'),'new');await assert.rejects(()=>git.mergeChange(c.id),/not open/);});
test('approval mode cannot be bypassed with resume and missing credentials block',async()=>{store.put('repos',{id:repo.id,autonomy:'approve'});const j=enqueue({repoId:repo.id,prompt:'Implement',title:'Implement',kind:'implement',autonomy:'auto'},owner);assert.equal(j.status,'awaiting_approval');assert.equal((await request('POST',`/api/jobs/${j.id}/action`,ownerToken,{action:'resume'})).statusCode,400);store.put('repos',{id:repo.id,autonomy:'prepare'});assert.equal(enqueue({repoId:repo.id,prompt:'Review',title:'Review',kind:'review'},owner).status,'blocked');});
test('credentials encrypted and state endpoint redacts secrets',async()=>{const secret='highly-secret-api-key';store.put('connections',{name:'C',ownerId:owner.id,provider:'test',secret:store.encrypt({key:secret,type:'api_key'}),status:'connected'});assert.ok(!JSON.stringify(store.all('connections')).includes(secret));const r=await request('GET','/api/state',ownerToken);assert.ok(!r.body.includes('"secret"'));assert.ok(!r.body.includes(secret));});
test('last owner is protected and non-admin cannot activate extensions',async()=>{assert.equal((await request('PATCH',`/api/users/${owner.id}`,ownerToken,{disabled:true})).statusCode,400);const r=store.put('resources',{projectId:project.id,kind:'extension',name:'ext',content:'export default ()=>{}'});assert.equal((await request('POST',`/api/resources/${r.id}/activate`,viewerToken,{})).statusCode,400);});
test('automation events deduplicate and suppress their originating workflow',async()=>{const {emitAutomation}=await import('../src/server/jobs.js');const w=store.put('workflows',{repoId:repo.id,projectId:project.id,name:'Review',kind:'review',trigger:'change_created',enabled:true,authorId:owner.id,prompt:'Review changes'});const c=store.put('changes',{repoId:repo.id,projectId:project.id,source:'relay/feature',target:'main',sourceSha:'a',targetSha:'b',status:'open'});const count=store.all('jobs').length;emitAutomation('change_created',c);emitAutomation('change_created',c);assert.equal(store.all('jobs').length,count+1);emitAutomation('change_created',{...c,id:'other',originWorkflowId:w.id});assert.equal(store.all('jobs').length,count+1);});
test('provider catalog is Pi-backed and self-update APIs require admin',async()=>{const r=await request('GET','/api/providers',ownerToken);assert.equal(r.statusCode,200);assert.ok(r.json().some((p:any)=>p.id==='anthropic'&&p.models.length));assert.equal((await request('GET','/api/self',viewerToken)).statusCode,400);});
test('known provider secrets are redacted from event streams',()=>{store.put('connections',{secret:store.encrypt({key:'fixture-super-secret',type:'api_key'})});store.event('redaction','error','Failed with key fixture-super-secret');assert.equal(store.events('redaction')[0].data,'Failed with key [REDACTED]');});


test('provider login supplies a persistent installation UUID and supports retry after failure',async(t)=>{
 const {ModelRuntime}=await import('@earendil-works/pi-coding-agent');
 const ids:string[]=[];
 t.mock.method(ModelRuntime.prototype,'login',async(_provider:any,_method:any,_interaction:any,options:any)=>{
  assert.equal(options.agentName,'Orchestra');
  const deviceId=options.getDeviceId();
  assert.match(deviceId,/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
  ids.push(deviceId);
  if(ids.length===1)throw Error('Test cancellation');
  return {type:'oauth',access:'fixture',refresh:'fixture',expires:0};
 });
 const c=store.put('connections',{name:'OpenAI test',ownerId:owner.id,provider:'openai',status:'disconnected'});
 for(const status of ['error','connected']){
  const start=await request('POST',`/api/connections/${c.id}/login`,ownerToken,{method:'oauth'});
  assert.equal(start.statusCode,200,start.body);
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal((await request('GET',`/api/connections/${c.id}/login`,ownerToken)).json().status,status);
 }
 assert.equal(ids.length,2);
 assert.equal(ids[0],ids[1]);
 assert.equal(store.get('system','installation')?.deviceId,ids[0]);
 assert.equal(store.installationDeviceId(),ids[0]);
});


test('browser bodyless DELETE omits JSON content type and removes a connection',async()=>{
 const {requestOptions}=await import('../src/web/request.js');
 const c=store.put('connections',{ownerId:owner.id,provider:'google',status:'disconnected'});
 const options=requestOptions('DELETE',ownerToken);
 assert.equal((options.headers as any)['Content-Type'],undefined);
 assert.equal(options.body,undefined);
 const result=await app.inject({method:'DELETE',url:`/api/connections/${c.id}`,headers:options.headers});
 assert.equal(result.statusCode,200,result.body);
 assert.equal(store.get('connections',c.id),undefined);
 assert.equal((requestOptions('POST',ownerToken,{answer:'test'}).headers as any)['Content-Type'],'application/json');
});
test('cancelling Google API-key setup discards a new connection but preserves authenticated ones',async()=>{
 const c=store.put('connections',{ownerId:owner.id,provider:'google',status:'disconnected'});
 assert.equal((await request('POST',`/api/connections/${c.id}/login`,ownerToken,{method:'api_key'})).statusCode,200);
 await new Promise(resolve=>setImmediate(resolve));
 const state=(await request('GET',`/api/connections/${c.id}/login`,ownerToken)).json();
 assert.equal(state.status,'pending');
 assert.ok(state.prompt);
 assert.equal((await request('POST',`/api/connections/${c.id}/cancel-login`,otherToken,{discard:true})).statusCode,400);
 assert.ok(store.get('connections',c.id));
 assert.equal((await request('POST',`/api/connections/${c.id}/cancel-login`,ownerToken,{discard:true})).statusCode,200);
 assert.equal(store.get('connections',c.id),undefined);
 const saved=store.put('connections',{ownerId:owner.id,provider:'google',status:'connected',secret:store.encrypt({type:'api_key',key:'test'})});
 assert.equal((await request('POST',`/api/connections/${saved.id}/cancel-login`,ownerToken,{discard:true})).statusCode,200);
 assert.equal(store.get('connections',saved.id)?.secret,saved.secret);
});
