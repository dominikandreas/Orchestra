import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,access} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import http from 'node:http';
const root=await mkdtemp(join(tmpdir(),'orchestra-admin-test-'));process.env.RELAY_DATA_DIR=join(root,'data');
const s=await import('../src/server/store.js');const control=await import('../src/server/admin-control.js');const agent=await import('../src/server/admin-agent.js');const {createApp}=await import('../src/server/app.js');
let app:any,owner:any,ownerToken:string,viewerToken:string,connection:any,repo:any;const requests:any[]=[];
const marker=join(root,'approved.txt');
const server=http.createServer(async(req,res)=>{let body='';for await(const b of req)body+=b;const parsed=JSON.parse(body);requests.push(parsed);const hasTool=parsed.messages.some((m:any)=>m.role==='tool');const text=parsed.messages.filter((m:any)=>m.role==='user').map((m:any)=>JSON.stringify(m.content)).join('\n');
 res.writeHead(200,{'Content-Type':'text/event-stream'});const chunk=(delta:any,finish:any=null)=>res.write(`data: ${JSON.stringify({id:'admin-fixture',object:'chat.completion.chunk',created:Math.floor(Date.now()/1000),model:'fixture',choices:[{index:0,delta,finish_reason:finish}]})}\n\n`);
 if(!hasTool){let name='workspace_state',args:any={};if(text.includes('host fixture')){name='request_admin_action';args={reason:'Write a test marker after approval',action:JSON.stringify({kind:'host',command:`printf approved > '${marker}'`,cwd:root,timeout:10})};}else if(text.includes('orchestrate fixture')){name='start_job';args={repoId:repo.id,title:'Contextual improvement',prompt:'Implement fixture change',kind:'implement',reviewAfter:true,autonomy:'auto'};}else if(text.includes('self fixture')){name='start_job';args={self:true,title:'Improve Orchestra fixture',prompt:'Adapt the app',kind:'adapt',reviewAfter:true};}else if(text.includes('plugin fixture'))name='extension_ping';chunk({role:'assistant',tool_calls:[{index:0,id:'call_admin',type:'function',function:{name,arguments:JSON.stringify(args)}}]});chunk({},'tool_calls');}else{chunk({role:'assistant',content:'Fixture request handled. Check tracked work and approvals.'});chunk({},'stop');}res.end('data: [DONE]\n\n');
});
const request=(method:string,url:string,token=ownerToken,payload?:any)=>app.inject({method,url,headers:{authorization:`Bearer ${token}`},payload});
async function chat(text:string,context:any={}){const thread=agent.createAdminThread(owner.id);const run=agent.startAdminTurn(thread.id,owner.id,{message:text,connectionId:connection.id,model:'fixture',context});for(let n=0;n<500;n++){if(s.get('adminRuns',run.id)?.status!=='running')break;await new Promise(r=>setTimeout(r,20));}assert.equal(s.get('adminRuns',run.id)?.status,'completed',s.get('adminRuns',run.id)?.error);return agent.adminThread(thread.id,owner.id);}
before(async()=>{app=await createApp();const r=s.redeemInvite(s.issueInvite(undefined,'owner').token,'Admin');owner=r.user;ownerToken=r.token;viewerToken=s.redeemInvite(s.issueInvite(undefined,'viewer').token,'Viewer').token;await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));const port=(server.address() as any).port;const project=s.put('projects',{name:'Fixture'});repo=s.put('repos',{name:'Repo',projectId:project.id,autonomy:'prepare',status:'ready'});connection=s.put('connections',{name:'Fixture',provider:'orchestra-admin-fixture',ownerId:owner.id,status:'connected',secret:s.encrypt({type:'api_key',key:'admin-fixture-key'}),config:{name:'Fixture',api:'openai-completions',baseUrl:`http://127.0.0.1:${port}/v1`,models:[{id:'fixture',name:'Fixture',reasoning:false,input:['text'],contextWindow:32000,maxTokens:2048,cost:{input:0,output:0,cacheRead:0,cacheWrite:0}}]}});});
after(async()=>{await agent.shutdownAdmin();await control.waitForAdminActions();await app.close();await new Promise<void>(r=>server.close(()=>r()));s.db.close();});
test('admin endpoints reject non-admins and keep conversations private',async()=>{assert.equal((await request('GET','/api/admin',viewerToken)).statusCode,400);assert.equal((await request('POST','/api/admin/actions',viewerToken,{reason:'No',action:{kind:'host',command:'true',cwd:root}})).statusCode,400);const t=agent.createAdminThread(owner.id);const other=s.redeemInvite(s.issueInvite(undefined,'admin').token,'Other');assert.equal((await request('GET',`/api/admin/threads/${t.id}`,other.token)).statusCode,400);});
test('real Pi admin turn receives current context and starts a tracked review pipeline without bypassing policy',async()=>{const t=await chat('orchestrate fixture',{repoId:repo.id,page:'changes',changeId:'context-fixture'});const j=s.all('jobs').find(j=>j.adminThreadId===t.id)!;assert.ok(j);assert.equal(j.reviewAfter,true);assert.equal(j.autonomy,'prepare');assert.equal(j.status,'queued');assert.equal(j.connectionId,connection.id);const wire=requests.at(-1);assert.ok(JSON.stringify(wire.messages).includes('context-fixture'));assert.ok(wire.tools.some((t:any)=>t.function.name==='start_job'));assert.ok(!wire.tools.some((t:any)=>['bash','write','edit'].includes(t.function.name)));assert.ok(t.messages.some((m:any)=>m.role==='assistant'));});
test('host tool only proposes; human approval executes exactly once',async()=>{const t=await chat('host fixture');const a=s.all('adminActions').find(a=>a.threadId===t.id)!;assert.equal(a.status,'awaiting_approval');await assert.rejects(()=>access(marker));assert.equal((await request('POST',`/api/admin/actions/${a.id}/decision`,viewerToken,{decision:'approve'})).statusCode,400);await assert.rejects(()=>access(marker));assert.equal((await request('POST',`/api/admin/actions/${a.id}/decision`,ownerToken,{decision:'approve'})).statusCode,200);await control.waitForAdminActions();assert.equal(s.get('adminActions',a.id)?.status,'completed',s.get('adminActions',a.id)?.error);assert.equal(await readFile(marker,'utf8'),'approved');assert.equal((await request('POST',`/api/admin/actions/${a.id}/decision`,ownerToken,{decision:'approve'})).statusCode,400);});
test('rejected, stale, and revoked approvals cannot execute',async()=>{const a=control.proposeAction(owner.id,'Reject fixture',{kind:'host',command:'exit 7',cwd:root});await control.decideAction(a.id,'reject',owner.id);await assert.rejects(()=>control.decideAction(a.id,'approve',owner.id));const p=control.draftPlugin(owner.id,{name:'Stale',content:'export default function() {}'});const b=control.proposeAction(owner.id,'Enable',{kind:'extension_enable',pluginId:p.id,digest:p.digest});s.put('adminPlugins',{id:p.id,digest:'changed'});await control.decideAction(b.id,'approve',owner.id);await control.waitForAdminActions();assert.equal(s.get('adminActions',b.id)?.status,'failed');const other=s.put('users',{role:'admin',name:'Revoked'});const c=control.proposeAction(other.id,'Revoked',{kind:'host',command:'exit 8',cwd:root});s.put('users',{id:other.id,disabled:true});await assert.rejects(()=>control.decideAction(c.id,'approve',owner.id),/administrator/);});
test('Pi extension stays a draft until approved and loads into the actual admin session',async()=>{const content=`export default function(pi) { pi.registerTool({name:'extension_ping',label:'Ping',description:'Fixture ping',parameters:{type:'object',properties:{}},execute:async()=>({content:[{type:'text',text:'approved-extension-pong'}],details:{}})}); }`;const p=control.draftPlugin(owner.id,{name:'Ping',content});assert.equal(control.pluginPaths().length,0);const a=control.proposeAction(owner.id,'Enable exact extension',{kind:'extension_enable',pluginId:p.id,digest:p.digest});await control.decideAction(a.id,'approve',owner.id);await control.waitForAdminActions();assert.equal(s.get('adminActions',a.id)?.status,'completed',s.get('adminActions',a.id)?.error);await chat('plugin fixture');assert.ok(JSON.stringify(requests.at(-1).messages).includes('approved-extension-pong'));const off=control.proposeAction(owner.id,'Disable',{kind:'extension_disable',pluginId:p.id,digest:p.digest});await control.decideAction(off.id,'approve',owner.id);await control.waitForAdminActions();assert.equal(control.pluginPaths().length,0);});
test('Pi package install is approval gated and uses its package manager',async(t)=>{const {DefaultPackageManager}=await import('@earendil-works/pi-coding-agent');let called='';t.mock.method(DefaultPackageManager.prototype,'installAndPersist',async(source:string)=>{called=source});const a=control.proposeAction(owner.id,'Install test package',{kind:'plugin_install',source:'npm:fixture-package@1.0.0'});assert.equal(called,'');await control.decideAction(a.id,'approve',owner.id);await control.waitForAdminActions();assert.equal(called,'npm:fixture-package@1.0.0');assert.equal(s.get('adminActions',a.id)?.status,'completed',s.get('adminActions',a.id)?.error);});
test('self-adaptation starts ordinary visible software work',async()=>{const t=await chat('self fixture');const j=s.all('jobs').find(j=>j.adminThreadId===t.id)!;assert.ok(s.get('repos',j.repoId)?.self);assert.equal(j.kind,'adapt');assert.ok(agent.adminSnapshot(owner.id).selfJobs.some(x=>x.id===j.id));});
test('restart interrupts admin work and does not replay approved host operations',()=>{const a=s.put('adminActions',{status:'running'});const r=s.put('adminRuns',{status:'running'});agent.recoverAdminRuns();assert.equal(s.get('adminActions',a.id)?.status,'interrupted');assert.equal(s.get('adminRuns',r.id)?.status,'interrupted');});
test('admin approval executes merge action with admin authorization',async()=>{const git=await import('../src/server/git.js');const rootSource=join(root,'admin-repo-source');await git.command('git',['init','-b','main',rootSource]);await git.git(rootSource,'config','user.name','Tests');await git.git(rootSource,'config','user.email','tests@example.com');await (await import('node:fs/promises')).writeFile(join(rootSource,'hello.txt'),'hi\n');await git.git(rootSource,'add','.');await git.git(rootSource,'commit','-m','init');const r=await git.importRepository(rootSource,'Admin Merge Repo',repo.projectId);const wt=await git.createWorktree(r,'admin-merge',r.base);await (await import('node:fs/promises')).writeFile(join(wt,'merge-target.txt'),'merge\n');await git.git(wt,'add','.');await git.git(wt,'commit','-m','feature commit');const c=await git.createChange(r,'relay/admin-merge','main','Admin merge feature',owner.id);const a=control.proposeAction(owner.id,'Admin requested merge',{kind:'merge',changeId:c.id,sourceSha:c.sourceSha,targetSha:c.targetSha});assert.equal(a.status,'awaiting_approval');await control.decideAction(a.id,'approve',owner.id);await control.waitForAdminActions();assert.equal(s.get('adminActions',a.id)?.status,'completed',s.get('adminActions',a.id)?.error);assert.equal(s.get('changes',c.id)?.status,'merged');});
test('admin agent message accepts and persists thinking effort and forwards it to start_job',async()=>{const thread=agent.createAdminThread(owner.id);const invalid=await request('POST',`/api/admin/threads/${thread.id}/messages`,ownerToken,{message:'Test thinking',connectionId:connection.id,model:'fixture',thinkingLevel:'invalid_level'});assert.equal(invalid.statusCode,400);const run=agent.startAdminTurn(thread.id,owner.id,{message:'orchestrate fixture with thinking',connectionId:connection.id,model:'fixture',thinkingLevel:'high'});assert.equal(s.get('adminRuns',run.id)?.thinkingLevel,'high');assert.equal(s.get('adminThreads',thread.id)?.thinkingLevel,'high');const tools=agent.adminTools(run,{connectionId:connection.id,model:'fixture',thinkingLevel:'high'});const startJob=tools.find(t=>t.name==='start_job')!;assert.ok(startJob);const res=await startJob.execute('call_start_job',{repoId:repo.id,title:'Thinking job',prompt:'Solve with high effort',kind:'implement'});const parsedRes=JSON.parse(res.content[0].text);const createdJob=s.get('jobs',parsedRes.id)!;assert.equal(createdJob.thinkingLevel,'high');const customRes=await startJob.execute('call_start_job_2',{repoId:repo.id,title:'Custom thinking job',prompt:'Solve with minimal effort',kind:'implement',thinkingLevel:'minimal'});const parsedCustom=JSON.parse(customRes.content[0].text);const customJob=s.get('jobs',parsedCustom.id)!;assert.equal(customJob.thinkingLevel,'minimal');});

test('adminSnapshot orders past threads by date descending and supports deleting threads/actions',async()=>{
 const t1=s.put('adminThreads',{authorId:owner.id,title:'Older thread',created:'2026-01-01T00:00:00.000Z',updated:'2026-01-01T00:00:00.000Z'});
 const t2=s.put('adminThreads',{authorId:owner.id,title:'Newer thread',created:'2026-01-02T00:00:00.000Z',updated:'2026-01-02T00:00:00.000Z'});
 const snap=agent.adminSnapshot(owner.id);
 const idx1=snap.threads.findIndex((t:any)=>t.id===t1.id);
 const idx2=snap.threads.findIndex((t:any)=>t.id===t2.id);
 assert.ok(idx2<idx1,'Newer thread should appear before older thread');

 const delRes=await request('DELETE',`/api/admin/threads/${t1.id}`,ownerToken);
 assert.equal(delRes.statusCode,200);
 assert.equal(s.get('adminThreads',t1.id),undefined);

 const action=s.put('adminActions',{authorId:owner.id,status:'failed',reason:'Test'});
 const delAct=await request('DELETE',`/api/admin/actions/${action.id}`,ownerToken);
 assert.equal(delAct.statusCode,200);
 assert.equal(s.get('adminActions',action.id),undefined);
});

test('revoked author action can still be rejected by an active administrator',async()=>{
 const other=s.put('users',{role:'admin',name:'Revoked2'});
 const c=control.proposeAction(other.id,'Revoked proposal',{kind:'host',command:'exit 8',cwd:root});
 s.put('users',{id:other.id,disabled:true});
 // Rejecting should succeed even though proposer was disabled
 const res=await control.decideAction(c.id,'reject',owner.id);
 assert.equal(res.status,'rejected');
});

test('follow-up prompts preserve exact chronological order of user prompt and assistant response',async()=>{
 const thread=agent.createAdminThread(owner.id);
 // First turn
 const run1=agent.startAdminTurn(thread.id,owner.id,{message:'Initial prompt 1',connectionId:connection.id,model:'fixture'});
 for(let n=0;n<500;n++){if(s.get('adminRuns',run1.id)?.status!=='running')break;await new Promise(r=>setTimeout(r,20));}
 assert.equal(s.get('adminRuns',run1.id)?.status,'completed');

 // Follow-up turn
 const run2=agent.startAdminTurn(thread.id,owner.id,{message:'Follow-up prompt 2',connectionId:connection.id,model:'fixture'});
 for(let n=0;n<500;n++){if(s.get('adminRuns',run2.id)?.status!=='running')break;await new Promise(r=>setTimeout(r,20));}
 assert.equal(s.get('adminRuns',run2.id)?.status,'completed');

 const t=agent.adminThread(thread.id,owner.id);
 assert.equal(t.messages.length,4);
 assert.equal(t.messages[0].role,'user');
 assert.equal(t.messages[0].text,'Initial prompt 1');
 assert.equal(t.messages[1].role,'assistant');
 assert.equal(t.messages[2].role,'user');
 assert.equal(t.messages[2].text,'Follow-up prompt 2');
 assert.equal(t.messages[3].role,'assistant');
});

test('messages can be edited and deleted in assistant session',async()=>{
 const thread=agent.createAdminThread(owner.id);
 const msg=s.put('adminMessages',{threadId:thread.id,role:'user',text:'Original text'});
 
 // Edit message
 const editRes=await request('PATCH',`/api/admin/threads/${thread.id}/messages/${msg.id}`,ownerToken,{text:'Edited text'});
 assert.equal(editRes.statusCode,200);
 assert.equal(s.get('adminMessages',msg.id)?.text,'Edited text');

 // Delete message
 const delRes=await request('DELETE',`/api/admin/threads/${thread.id}/messages/${msg.id}`,ownerToken);
 assert.equal(delRes.statusCode,200);
 assert.equal(s.get('adminMessages',msg.id),undefined);
});

test('sessions can be forked into separate sessions with parentThreadId and copied messages',async()=>{
 const thread=agent.createAdminThread(owner.id);
 s.put('adminMessages',{threadId:thread.id,role:'user',text:'Turn 1 user',created:'2026-01-01T00:00:01.000Z'});
 s.put('adminMessages',{threadId:thread.id,role:'assistant',text:'Turn 1 assistant',created:'2026-01-01T00:00:02.000Z'});
 const msg3=s.put('adminMessages',{threadId:thread.id,role:'user',text:'Turn 2 user',created:'2026-01-01T00:00:03.000Z'});
 s.put('adminMessages',{threadId:thread.id,role:'assistant',text:'Turn 2 assistant',created:'2026-01-01T00:00:04.000Z'});

 // Full fork
 const forkRes=await request('POST',`/api/admin/threads/${thread.id}/fork`,ownerToken,{title:'Forked Conversation'});
 assert.equal(forkRes.statusCode,200);
 const forkedData=JSON.parse(forkRes.body);
 assert.equal(forkedData.parentThreadId,thread.id);
 assert.equal(forkedData.title,'Forked Conversation');
 assert.equal(forkedData.messages.length,4);

 // Partial fork up to Turn 2 user message
 const partialRes=await request('POST',`/api/admin/threads/${thread.id}/fork`,ownerToken,{title:'Partial Fork',messageId:msg3.id});
 assert.equal(partialRes.statusCode,200);
 const partialData=JSON.parse(partialRes.body);
 assert.equal(partialData.parentThreadId,thread.id);
 assert.equal(partialData.title,'Partial Fork');
 assert.equal(partialData.messages.length,3);
 assert.equal(partialData.messages[2].text,'Turn 2 user');
});

test('sessions can use and create agent skills via admin tools',async()=>{
 const thread=agent.createAdminThread(owner.id);
 const run=s.put('adminRuns',{threadId:thread.id,authorId:owner.id,status:'running'});
 const tools=agent.adminTools(run,{connectionId:connection.id,model:'fixture'});

 const createSkillTool=tools.find(t=>t.name==='create_skill')!;
 assert.ok(createSkillTool);

 // Create a skill
 const createResult=await createSkillTool.execute('call_create_skill',{
  name:'deploy-verification',
  description:'Verifies container and HTTP endpoints before signoff',
  content:'1. Check docker ps\n2. Verify health endpoint\n3. Confirm SSL status'
 });
 const parsed=JSON.parse(createResult.content[0].text);
 assert.equal(parsed.ok,true);
 assert.equal(parsed.skill.name,'deploy-verification');
 assert.equal(parsed.skill.active,true);

 // List skills
 const listSkillTool=tools.find(t=>t.name==='list_skills')!;
 const listResult=await listSkillTool.execute('call_list_skills',{});
 const listed=JSON.parse(listResult.content[0].text);
 assert.ok(listed.some((s:any)=>s.name==='deploy-verification'));

 // Use skill
 const useSkillTool=tools.find(t=>t.name==='use_skill')!;
 const useResult=await useSkillTool.execute('call_use_skill',{nameOrId:'deploy-verification'});
 const used=JSON.parse(useResult.content[0].text);
 assert.equal(used.name,'deploy-verification');
 assert.ok(used.content.includes('Check docker ps'));
});
