import {test} from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';

// Real Pi SDK/worker and tool protocol, with a deterministic provider. Docker lifecycle is a
// no-op fixture: this test does not claim to verify real container isolation or host access.
test('onboarding worker proposes a connection without edits, checks, change requests, or auto-merge',{timeout:30000},async()=>{
 const root=await mkdtemp(join(tmpdir(),'external-agent-'));// process.env.RELAY_DATA_DIR
 const oldPath=process.env.PATH;await mkdir(join(root,'bin'));const dockerLog=join(root,'docker.log');
 await writeFile(join(root,'bin','docker'),`#!/bin/sh\nprintf '%s\\n' "$*" >> '${dockerLog}'\nexit 0\n`,{mode:0o700});process.env.PATH=join(root,'bin')+':'+oldPath;
 const s=await import('../src/server/store.js'),g=await import('../src/server/git.js'),jobs=await import('../src/server/jobs.js');let requests=0;
 const server=http.createServer(async(req,res)=>{let body='';for await(const b of req)body+=b;const parsed=JSON.parse(body);requests++;
  assert.ok(parsed.tools.some((t:any)=>t.function.name==='propose_deployment_connection'));assert.ok(!parsed.tools.some((t:any)=>t.function.name==='propose_resource'));assert.match(JSON.stringify(parsed.messages),/external deployment connection contract v1/);
  res.writeHead(200,{'Content-Type':'text/event-stream'});const chunk=(delta:any,finish:any=null)=>res.write(`data: ${JSON.stringify({id:'fixture',object:'chat.completion.chunk',created:1,model:'fixture',choices:[{index:0,delta,finish_reason:finish}]})}\n\n`);
  if(!parsed.messages.some((m:any)=>m.role==='tool')){chunk({role:'assistant',tool_calls:[{index:0,id:'call',type:'function',function:{name:'propose_deployment_connection',arguments:JSON.stringify({content:'export default async i => ({operation:i.operation});',notes:'Fixture only, not live verified.',checkoutPaths:[]})}}]});chunk({},'tool_calls')}else{chunk({role:'assistant',content:'Draft submitted for exact-content approval. No service was inspected or restarted.'});chunk({},'stop')}res.end('data: [DONE]\n\n');
 });
 await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));const port=(server.address() as any).port;
 try{
 const source=join(root,'repo');await g.command('git',['init','-b','main',source]);await g.git(source,'config','user.name','Test');await g.git(source,'config','user.email','test@example.com');await writeFile(join(source,'readme'),'Fixture');await g.git(source,'add','.');await g.git(source,'commit','-m','initial');
 const project=s.put('projects',{name:'Fixture'}),user=s.put('users',{name:'Admin',role:'admin'});let repo=await g.importRepository(source,'Fixture',project.id);
 const c=s.put('connections',{name:'Fixture',provider:'external-fixture',ownerId:user.id,status:'connected',secret:s.encrypt({type:'api_key',key:'fixture-key'}),config:{name:'Fixture',api:'openai-completions',baseUrl:`http://127.0.0.1:${port}/v1`,models:[{id:'fixture',name:'Fixture',reasoning:false,input:['text'],contextWindow:32000,maxTokens:2048,cost:{input:0,output:0,cacheRead:0,cacheWrite:0}}]}});
 repo=s.put('repos',{id:repo.id,connectionId:c.id,model:'fixture',autonomy:'auto',testCommand:'exit 99'});
 const d=s.put('externalDeployments',{repoId:repo.id,projectId:project.id,name:'Connection',policy:'manual'});
 let job=jobs.enqueue({repoId:repo.id,kind:'deployment_connection',title:'Connect',prompt:'Describe an existing service connection, no live changes.',autonomy:'prepare'},user);
 job=s.put('jobs',{id:job.id,deploymentId:d.id});s.put('externalDeployments',{id:d.id,jobId:job.id});await jobs.runJob(job);
 const done=s.get('jobs',job.id)!;if(done.status!=='completed')console.error('FAILED JOB EVENTS:',s.events(job.id));assert.equal(done.status,'completed',done.error);assert.ok(requests>=2);assert.equal(done.changeId,undefined);assert.equal(s.all('checks').filter(c=>c.jobId===job.id).length,0);assert.equal(s.all('changes').filter(c=>c.repoId===repo.id).length,0);assert.equal(s.all('externalOperations').filter(o=>o.deploymentId===d.id).length,0);
 const linked=s.get('externalDeployments',d.id)!;assert.equal(linked.status,'needs_approval');assert.equal(linked.approvedDigest,null);assert.equal(s.get('externalConnections',linked.connectionId)?.jobId,job.id);assert.equal(await g.git(done.path,'status','--porcelain'),'');
 const calls=await readFile(dockerLog,'utf8');assert.match(calls,/target=\/workspace,readonly/);assert.ok(!calls.includes('exec '));
 }finally{process.env.PATH=oldPath;await new Promise<void>(r=>server.close(()=>r()));await rm(root,{recursive:true,force:true})}
});
