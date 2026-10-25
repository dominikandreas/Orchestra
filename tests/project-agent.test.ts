import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import http from 'node:http';
import Fastify from 'fastify';

const root=await mkdtemp(join(tmpdir(),'orchestra-project-agent-'));process.env.RELAY_DATA_DIR=join(root,'data');
const s=await import('../src/server/store.js');
const agent=await import('../src/server/project-agent.js');
const project=s.put('projects',{name:'Scoped project'}),otherProject=s.put('projects',{name:'Other project'});
const operator=s.put('users',{role:'operator',projects:[project.id],name:'Operator'});
const colleague=s.put('users',{role:'operator',projects:[project.id],name:'Colleague'});
const viewer=s.put('users',{role:'viewer',projects:[project.id]});
const outsider=s.put('users',{role:'operator',projects:[otherProject.id]});
const repo=s.put('repos',{projectId:project.id,name:'Repo',status:'ready',autonomy:'prepare'});
const otherRepo=s.put('repos',{projectId:otherProject.id,name:'Other repo'});
const change=s.put('changes',{projectId:project.id,repoId:repo.id,status:'open'});
const otherChange=s.put('changes',{projectId:otherProject.id,repoId:otherRepo.id,status:'open'});
const otherJob=s.put('jobs',{projectId:otherProject.id,repoId:otherRepo.id,status:'queued',title:'Private job'});
let connection:any;
const wire:any[]=[];
const server=http.createServer(async(req,res)=>{
 let body='';for await(const b of req)body+=b;const parsed=JSON.parse(body);wire.push(parsed);
 res.writeHead(200,{'Content-Type':'text/event-stream'});
 const chunk=(delta:any,finish:any=null)=>res.write(`data: ${JSON.stringify({id:'project-fixture',object:'chat.completion.chunk',created:Math.floor(Date.now()/1000),model:'fixture',choices:[{index:0,delta,finish_reason:finish}]})}\n\n`);
 const last=parsed.messages.at(-1);
 if(last.role==='user'&&JSON.stringify(last.content).includes('delegate fixture')){
  chunk({role:'assistant',tool_calls:[{index:0,id:'project_call',type:'function',function:{name:'start_job',arguments:JSON.stringify({repoId:repo.id,title:'Delegated fixture',prompt:'Implement fixture',kind:'implement',autonomy:'auto'})}}]});chunk({},'tool_calls');
 }else{chunk({role:'assistant',content:'Coordinator remembers the project. Delegated work remains tracked.'});chunk({},'stop');}
 res.end('data: [DONE]\n\n');
});
const app=Fastify();
app.setErrorHandler((e:any,_req,reply)=>reply.code(e.statusCode||400).send({error:e.message}));
app.addHook('preHandler',async(req:any)=>{req.user=s.get('users',String(req.headers['x-user']||''));});
agent.registerProjectAgentRoutes(app);
const request=(method:string,path:string,user=operator,payload?:any)=>app.inject({method:method as any,url:'/api'+path,headers:{'x-user':user.id},payload});
const body=(message:string)=>({message,connectionId:connection.id,model:'fixture',thinkingLevel:'high'});
async function wait(id:string){for(let n=0;n<500;n++){const r=s.get('projectRuns',id)!;if(r.status!=='running')return r;await new Promise(r=>setTimeout(r,20));}throw Error('Coordinator fixture timed out');}
before(async()=>{
 await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
 connection=s.put('connections',{name:'Project fixture',provider:'project-agent-fixture',ownerId:operator.id,status:'connected',secret:s.encrypt({type:'api_key',key:'project-fixture-secret'}),config:{name:'Project fixture',api:'openai-completions',baseUrl:`http://127.0.0.1:${(server.address() as any).port}/v1`,models:[{id:'fixture',name:'Fixture',reasoning:false,input:['text'],contextWindow:32000,maxTokens:2048,cost:{input:0,output:0,cacheRead:0,cacheWrite:0}}]}});
 await app.ready();
});
after(async()=>{await app.close();await new Promise<void>(resolve=>server.close(()=>resolve()));s.db.close();});

test('project and change conversations are canonical across operators, separate from each other, and scoped',async()=>{
 const first=await request('GET',`/projects/${project.id}/conversation`);
 assert.equal(first.statusCode,200);
 const second=await request('GET',`/projects/${project.id}/conversation`,colleague);
 assert.equal(first.json().thread.id,second.json().thread.id);
 const c1=await request('GET',`/changes/${change.id}/conversation`),c2=await request('GET',`/changes/${change.id}/conversation`,colleague);
 assert.equal(c1.json().thread.id,c2.json().thread.id);
 assert.notEqual(first.json().thread.id,c1.json().thread.id);
 assert.equal(s.all('projectThreads').length,2);
 assert.equal((await request('GET',`/projects/${project.id}/conversation`,viewer)).statusCode,200);
 assert.equal((await request('POST',`/projects/${project.id}/conversation`,viewer,body('not allowed'))).statusCode,400);
 assert.equal((await request('GET',`/projects/${project.id}/conversation`,outsider)).statusCode,400);
 assert.equal((await request('GET',`/changes/${otherChange.id}/conversation`)).statusCode,400);
 assert.throws(()=>agent.projectThread(operator.id,project.id,otherChange.id),/access denied/);
 const anonymous=await app.inject({url:`/api/projects/${project.id}/conversation`});assert.equal(anonymous.statusCode,401);
});

test('real persistent SDK session delegates through enqueue and restores context on the next turn',async()=>{
 const path=`/changes/${change.id}/conversation`;
 const response=await request('POST',path,operator,body('delegate fixture remember this requirement'));
 assert.equal(response.statusCode,200,response.body);
 const run=response.json();assert.equal((await wait(run.id)).status,'completed');
 const snapshot=(await request('GET',path)).json();
 assert.equal(snapshot.messages.length,2);assert.ok(snapshot.runs[0].events.some((e:any)=>e.type==='tool_result'));
 const job=s.all('jobs').find(j=>j.projectThreadId===snapshot.thread.id)!;
 assert.ok(job);assert.equal(job.changeId,change.id);assert.equal(job.parentThreadId,snapshot.thread.id);assert.equal(job.parentRunId,run.id);
 assert.equal(job.projectId,project.id);assert.equal(job.status,'queued');assert.equal(job.autonomy,'prepare');assert.equal(job.thinkingLevel,'high');
 const stored=s.get('projectThreads',snapshot.thread.id)!;assert.ok(stored.sessionFile);assert.ok((await readFile(stored.sessionFile,'utf8')).includes('remember this requirement'));
 assert.equal(snapshot.thread.sessionFile,undefined);
 const next=await request('POST',path,operator,body('What did we agree?'));
 assert.equal((await wait(next.json().id)).status,'completed');
 assert.equal(s.get('projectThreads',snapshot.thread.id)?.sessionFile,stored.sessionFile);
 const lastWire=wire.at(-1);assert.ok(JSON.stringify(lastWire.messages).includes('remember this requirement'));
 const tools=lastWire.tools.map((t:any)=>t.function.name);
 assert.ok(tools.includes('project_knowledge'));assert.ok(tools.includes('inspect_job'));
 for(const forbidden of ['terminal','bash','read','write','edit','merge_change','request_admin_action'])assert.ok(!tools.includes(forbidden),forbidden);
 const finished=(await request('GET',path,colleague)).json();assert.equal(finished.messages.length,4);assert.equal(finished.runs.length,2);
});

test('tools cannot inspect, steer or delegate outside the project; permissions and provider scope are rechecked',async()=>{
 const thread=agent.projectThread(operator.id,project.id);
 const run=s.put('projectRuns',{threadId:thread.id,projectId:project.id,authorId:operator.id,status:'running'});
 const tools=agent.projectTools(run,{connectionId:connection.id,model:'fixture'});
 const invoke=(name:string,args:any)=>tools.find(t=>t.name===name)!.execute('fixture',args);
 await assert.rejects(()=>invoke('inspect_job',{jobId:otherJob.id}),/access denied/);
 await assert.rejects(()=>invoke('steer_job',{jobId:otherJob.id,action:'cancel'}),/access denied/);
 await assert.rejects(()=>invoke('inspect_change',{changeId:otherChange.id}),/access denied/);
 await assert.rejects(()=>invoke('start_job',{repoId:otherRepo.id,title:'No',prompt:'No',kind:'implement'}),/access denied/);
 await assert.rejects(()=>invoke('start_job',{repoId:repo.id,changeId:otherChange.id,title:'No',prompt:'No',kind:'implement'}),/access denied/);
 const knowledge=JSON.parse((await invoke('project_knowledge',{})).content[0].text);
 assert.equal(knowledge.projectId,project.id);assert.ok(knowledge.revision);assert.ok(knowledge.files.some((f:any)=>f.path==='knowledge.md'));
 const result=JSON.parse((await invoke('project_state',{})).content[0].text);
 assert.equal(result.repos.length,1);assert.ok(!JSON.stringify(result).includes('Private job'));
 s.put('users',{id:operator.id,projects:[]});await assert.rejects(()=>invoke('project_state',{}),/access denied/);
 s.put('users',{id:operator.id,projects:[project.id]});
 s.put('connections',{id:connection.id,status:'disconnected'});await assert.rejects(()=>invoke('project_state',{}),/revoked/);
 s.put('connections',{id:connection.id,status:'connected'});
 s.put('projectRuns',{id:run.id,status:'completed'});await assert.rejects(()=>invoke('project_state',{}),/no longer running/);
 assert.equal(s.get('jobs',otherJob.id)?.status,'queued');
});

test('POST rejects foreign project-shared connections; only project operators can stop, recovery persists interruption',async()=>{
 const foreign=s.put('connections',{ownerId:outsider.id,status:'connected',shared:true,projects:[otherProject.id]});
 assert.equal((await request('POST',`/projects/${project.id}/conversation`,operator,{...body('No provider access'),connectionId:foreign.id})).statusCode,400);
 const thread=agent.projectThread(operator.id,project.id);
 const run=s.put('projectRuns',{threadId:thread.id,projectId:project.id,authorId:operator.id,status:'running'});
 assert.equal((await request('POST',`/projects/${project.id}/conversation`,operator,body('Concurrent'))).statusCode,400);
 assert.equal((await request('POST',`/projects/${project.id}/conversation/stop`,viewer,{})).statusCode,400);
 assert.equal((await request('POST',`/projects/${project.id}/conversation/stop`,colleague,{})).statusCode,200);
 assert.equal(s.get('projectRuns',run.id)?.status,'cancelled');
 const interrupted=s.put('projectRuns',{threadId:thread.id,status:'running'});agent.recoverProjectRuns();assert.equal(s.get('projectRuns',interrupted.id)?.status,'interrupted');
});
