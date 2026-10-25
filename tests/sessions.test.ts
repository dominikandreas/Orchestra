import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

const dir=await mkdtemp(join(tmpdir(),'relay-sessions-test-'));
process.env.RELAY_DATA_DIR=join(dir,'data');

const store=await import('../src/server/store.js');
const git=await import('../src/server/git.js');
const {createApp}=await import('../src/server/app.js');

let app:any,owner:any,operator:any,otherProject:any,project:any,repo:any,conn:any;
let ownerToken:string,operatorToken:string,viewerToken:string,otherToken:string;

before(async()=>{
 app=await createApp();
 const ownerInv=store.issueInvite(undefined,'owner');
 const ownerRedeem=store.redeemInvite(ownerInv.token,'Owner');
 owner=ownerRedeem.user;
 ownerToken=ownerRedeem.token;

 project=store.put('projects',{name:'Alpha'});
 otherProject=store.put('projects',{name:'Beta'});

 const opInv=store.issueInvite(undefined,'operator',[project.id]);
 const opRedeem=store.redeemInvite(opInv.token,'Operator');
 operator=opRedeem.user;
 operatorToken=opRedeem.token;

 const viewInv=store.issueInvite(undefined,'viewer',[project.id]);
 viewerToken=store.redeemInvite(viewInv.token,'Viewer').token;

 const otherInv=store.issueInvite(undefined,'operator',[otherProject.id]);
 otherToken=store.redeemInvite(otherInv.token,'OtherOperator').token;

 conn=store.put('connections',{
  name:'Shared Provider',
  ownerId:owner.id,
  provider:'anthropic',
  shared:true,
  projects:[project.id,otherProject.id],
  status:'connected',
  secret:store.encrypt({type:'api_key',key:'sk-test-1234567890'})
 });

 const source=join(dir,'repo-source');
 await git.command('git',['init','-b','main',source]);
 await git.git(source,'config','user.name','Tests');
 await git.git(source,'config','user.email','tests@example.com');
 await writeFile(join(source,'app.ts'),'export const x = 1;\n');
 await git.git(source,'add','.');
 await git.git(source,'commit','-m','initial');
 repo=await git.importRepository(source,'Alpha Repo',project.id);
 store.put('repos',{
  id:repo.id,
  connectionId:conn.id,
  model:'claude-3-5-haiku-latest',
  thinkingLevel:'low',
  autonomy:'auto'
 });
 repo=store.get('repos',repo.id)!;
});

after(async()=>{
 await app.close();
 store.db.close();
});

const request=(method:string,url:string,token?:string,payload?:any)=>
 app.inject({method,url,headers:token?{authorization:`Bearer ${token}`}:{},payload});

test('agent CRUD, permissions, audit logs, and /api/state visibility including admin threads',async()=>{
 // Non-admin cannot create workspace-wide agent
 const deniedGlobal=await request('POST','/api/agents',operatorToken,{
  name:'Global Agent',
  description:'Global',
  instructions:'Follow workspace standards.'
 });
 assert.equal(deniedGlobal.statusCode,400);

 // Admin creates workspace-wide agent
 const globalRes=await request('POST','/api/agents',ownerToken,{
  name:'Security Auditor',
  description:'Audits code for vulnerabilities',
  instructions:'Always check OWASP top 10.',
  kind:'review',
  thinkingLevel:'high',
  autonomy:'prepare'
 });
 assert.equal(globalRes.statusCode,200,globalRes.body);
 const globalAgent=globalRes.json();
 assert.equal(globalAgent.name,'Security Auditor');
 assert.equal(globalAgent.projectId,undefined);
 assert.equal(globalAgent.kind,'review');
 assert.equal(globalAgent.thinkingLevel,'high');

 // Operator creates project-scoped agent
 const projRes=await request('POST','/api/agents',operatorToken,{
  name:'Alpha Implementer',
  description:'Alpha specialist',
  instructions:'Prefer small pure functions.',
  projectId:project.id,
  connectionId:conn.id,
  model:'claude-sonnet-4-20250514',
  thinkingLevel:'medium',
  autonomy:'prepare',
  kind:'implement'
 });
 assert.equal(projRes.statusCode,200,projRes.body);
 const projAgent=projRes.json();
 assert.equal(projAgent.projectId,project.id);

 // Viewer cannot create project agent
 assert.equal((await request('POST','/api/agents',viewerToken,{
  name:'No',
  instructions:'No',
  projectId:project.id
 })).statusCode,400);

 // Create an admin thread for owner and verify /api/state threads + agents visibility
 const thread=store.put('adminThreads',{authorId:owner.id,title:'Ops thread',permissionMode:'manual'});
 store.put('adminRuns',{threadId:thread.id,status:'running'});

 const ownerState=(await request('GET','/api/state',ownerToken)).json();
 assert.equal(ownerState.agents.length,2);
 assert.equal(ownerState.threads.length,1);
 assert.equal(ownerState.threads[0].id,thread.id);
 assert.equal(ownerState.threads[0].running,true);

 const otherState=(await request('GET','/api/state',otherToken)).json();
 assert.deepEqual(otherState.agents.map((a:any)=>a.id),[globalAgent.id]);
 assert.deepEqual(otherState.threads,[]);

 // Patch project agent as operator
 const patchRes=await request('PATCH',`/api/agents/${projAgent.id}`,operatorToken,{
  name:'Alpha Senior Engineer',
  thinkingLevel:'xhigh'
 });
 assert.equal(patchRes.statusCode,200,patchRes.body);
 assert.equal(patchRes.json().name,'Alpha Senior Engineer');
 assert.equal(patchRes.json().projectId,project.id);
 assert.equal(patchRes.json().thinkingLevel,'xhigh');

 // Operator cannot convert project agent to workspace-wide
 assert.equal((await request('PATCH',`/api/agents/${projAgent.id}`,operatorToken,{projectId:null})).statusCode,400);

 // Delete global agent requires admin
 assert.equal((await request('DELETE',`/api/agents/${globalAgent.id}`,operatorToken)).statusCode,400);
 const delRes=await request('DELETE',`/api/agents/${globalAgent.id}`,ownerToken);
 assert.equal(delRes.statusCode,200);
 assert.equal(store.get('agents',globalAgent.id),undefined);

 const audits=store.all('audit');
 assert.ok(audits.some(a=>a.action==='agent.create'&&a.target===projAgent.id));
 assert.ok(audits.some(a=>a.action==='agent.update'&&a.target===projAgent.id));
 assert.ok(audits.some(a=>a.action==='agent.delete'&&a.target===globalAgent.id));
});

test('POST /api/jobs and workflows with agentId apply precedence: explicit > agent > repo defaults',async()=>{
 const agent=(await request('POST','/api/agents',ownerToken,{
  name:'Coverage Bot',
  description:'Writes unit tests',
  instructions:'Target 90% branch coverage.',
  projectId:project.id,
  connectionId:conn.id,
  model:'claude-sonnet-4-20250514',
  thinkingLevel:'high',
  autonomy:'prepare',
  kind:'coverage'
 })).json();

 // Job inheriting from agent over repo defaults
 const job1Res=await request('POST','/api/jobs',operatorToken,{
  repoId:repo.id,
  agentId:agent.id,
  prompt:'Add tests for app.ts'
 });
 assert.equal(job1Res.statusCode,200,job1Res.body);
 const job1=job1Res.json();
 assert.equal(job1.agentId,agent.id);
 assert.equal(job1.kind,'coverage');
 assert.equal(job1.model,'claude-sonnet-4-20250514');
 assert.equal(job1.thinkingLevel,'high');
 assert.equal(job1.autonomy,'prepare');

 // Explicit job fields override agent defaults, while autonomy remains capped by repo autonomy
 store.put('repos',{id:repo.id,autonomy:'approve'});
 const job2Res=await request('POST','/api/jobs',operatorToken,{
  repoId:repo.id,
  agentId:agent.id,
  prompt:'Quick fix',
  kind:'implement',
  model:'claude-3-5-haiku-latest',
  thinkingLevel:'minimal',
  autonomy:'auto'
 });
 assert.equal(job2Res.statusCode,200,job2Res.body);
 const job2=job2Res.json();
 assert.equal(job2.kind,'implement');
 assert.equal(job2.model,'claude-3-5-haiku-latest');
 assert.equal(job2.thinkingLevel,'minimal');
 assert.equal(job2.autonomy,'approve');
 store.put('repos',{id:repo.id,autonomy:'auto'});

 // Agent from another project is rejected
 const betaAgent=(await request('POST','/api/agents',ownerToken,{
  name:'Beta Agent',
  instructions:'Beta only',
  projectId:otherProject.id
 })).json();
 const badJob=await request('POST','/api/jobs',ownerToken,{
  repoId:repo.id,
  agentId:betaAgent.id,
  prompt:'Should fail'
 });
 assert.equal(badJob.statusCode,400);

 // Workflow with agentId
 const wfRes=await request('POST','/api/workflows',operatorToken,{
  repoId:repo.id,
  agentId:agent.id,
  name:'Nightly Coverage',
  prompt:'Run coverage pass',
  trigger:'schedule',
  intervalMinutes:60
 });
 assert.equal(wfRes.statusCode,200,wfRes.body);
 assert.equal(wfRes.json().agentId,agent.id);
 assert.equal(wfRes.json().kind,'coverage');

 const wfPatch=await request('PATCH',`/api/workflows/${wfRes.json().id}`,operatorToken,{agentId:null});
 assert.equal(wfPatch.statusCode,200);
 assert.equal(wfPatch.json().agentId,undefined);
});

test('PATCH /api/jobs/:id renames title and toggles archived state',async()=>{
 const job=(await request('POST','/api/jobs',operatorToken,{
  repoId:repo.id,
  title:'Initial title',
  prompt:'Initial prompt'
 })).json();

 const renameRes=await request('PATCH',`/api/jobs/${job.id}`,operatorToken,{
  title:'  Refined session title  ',
  archived:true
 });
 assert.equal(renameRes.statusCode,200,renameRes.body);
 assert.equal(renameRes.json().title,'Refined session title');
 assert.equal(renameRes.json().archived,true);

 // Empty title is rejected
 assert.equal((await request('PATCH',`/api/jobs/${job.id}`,operatorToken,{title:'   '})).statusCode,400);

 const unarchiveRes=await request('PATCH',`/api/jobs/${job.id}`,operatorToken,{archived:false});
 assert.equal(unarchiveRes.statusCode,200);
 assert.equal(unarchiveRes.json().archived,false);
});

test('GET /api/jobs/:id/diff, POST /api/jobs/:id/fork, and resume from idle',async()=>{
 // Job without worktree returns empty diff
 const emptyJob=store.put('jobs',{
  repoId:repo.id,
  projectId:project.id,
  authorId:owner.id,
  title:'No worktree yet',
  prompt:'Pending',
  kind:'implement',
  status:'queued'
 });
 const emptyDiff=(await request('GET',`/api/jobs/${emptyJob.id}/diff`,ownerToken)).json();
 assert.deepEqual(emptyDiff,{base:null,head:null,diff:'',files:[],untracked:[]});

 // Create a job with a real worktree, committed change, uncommitted change, and untracked nested file
 const baseSha=await git.revision(repo,repo.base);
 const jobId='11111111-2222-4333-8444-555555555555';
 const wtPath=await git.locked(repo.id,()=>git.createWorktree(repo,jobId,baseSha));
 await writeFile(join(wtPath,'committed.ts'),'export const committed = true;\n');
 await git.git(wtPath,'add','committed.ts');
 await git.git(wtPath,'commit','-m','Add committed.ts');
 const headSha=await git.git(wtPath,'rev-parse','HEAD');

 // Uncommitted modification to tracked file + untracked file in nested dir
 await writeFile(join(wtPath,'app.ts'),'export const x = 42;\nexport const y = 99;\n');
 await mkdir(join(wtPath,'src/nested'),{recursive:true});
 await writeFile(join(wtPath,'src/nested/untracked.txt'),'untracked content\n');

 const sessionDir=join(store.dataDir,'sessions',jobId);
 await mkdir(sessionDir,{recursive:true});
 const sessionFile=join(sessionDir,'session.jsonl');
 await writeFile(sessionFile,'{"type":"session","id":"test-session"}\n');

 const sourceJob=store.put('jobs',{
  id:jobId,
  repoId:repo.id,
  projectId:project.id,
  authorId:owner.id,
  title:'Original review session',
  prompt:'Inspect and fix',
  kind:'review',
  connectionId:conn.id,
  provider:'anthropic',
  model:'claude-sonnet-4-20250514',
  thinkingLevel:'medium',
  autonomy:'prepare',
  status:'completed',
  path:wtPath,
  sourceSha:headSha,
  baseSha,
  sessionFile,
  changeId:'some-change-id',
  sourceBranch:'relay/original'
 });
 store.event(sourceJob.id,'user',{text:'Inspect and fix',mode:'prompt'});
 store.event(sourceJob.id,'final_text','Found issue in app.ts: variable x should be 42.');

 // Verify GET /api/jobs/:id/diff against baseSha
 const diffRes=await request('GET',`/api/jobs/${sourceJob.id}/diff`,ownerToken);
 assert.equal(diffRes.statusCode,200,diffRes.body);
 const diffBody=diffRes.json();
 assert.equal(diffBody.base,baseSha);
 assert.equal(diffBody.head,headSha);
 assert.ok(diffBody.diff.includes('export const x = 42;'));
 assert.ok(diffBody.diff.includes('export const committed = true;'));
 assert.ok(diffBody.files.some((f:any)=>f.path==='app.ts'&&f.status==='M'&&f.additions===2&&f.deletions===1));
 assert.ok(diffBody.files.some((f:any)=>f.path==='committed.ts'&&f.status==='A'));
 assert.deepEqual(diffBody.untracked,['src/nested/untracked.txt']);

 // Fork the session
 const forkRes=await request('POST',`/api/jobs/${sourceJob.id}/fork`,operatorToken,{});
 assert.equal(forkRes.statusCode,200,forkRes.body);
 const forked=forkRes.json();
 assert.notEqual(forked.id,sourceJob.id);
 assert.equal(forked.forkedFrom,sourceJob.id);
 assert.equal(forked.title,'Original review session (fork)');
 assert.equal(forked.status,'idle');
 assert.equal(forked.kind,'implement'); // review converts to implement on fork
 assert.equal(forked.changeId,undefined);
 assert.equal(forked.sourceBranch,undefined);
 assert.equal(forked.baseSha,baseSha);
 assert.equal(forked.sourceSha,headSha);
 assert.ok(forked.path&&forked.path!==wtPath);
 assert.ok(forked.sessionFile&&forked.sessionFile!==sessionFile);

 // Verify uncommitted + untracked files were replicated into forked worktree
 assert.equal(await readFile(join(forked.path,'app.ts'),'utf8'),'export const x = 42;\nexport const y = 99;\n');
 assert.equal(await readFile(join(forked.path,'committed.ts'),'utf8'),'export const committed = true;\n');
 assert.equal(await readFile(join(forked.path,'src/nested/untracked.txt'),'utf8'),'untracked content\n');

 // Verify events were copied + notice appended
 const forkedDetail=(await request('GET',`/api/jobs/${forked.id}`,operatorToken)).json();
 assert.ok(forkedDetail.events.some((e:any)=>e.type==='final_text'&&e.data.includes('Found issue in app.ts')));
 assert.ok(forkedDetail.events.some((e:any)=>e.type==='notice'&&e.data==='Forked from "Original review session"'));

 // Resume from idle logs a user event and transitions to queued
 const resumeRes=await request('POST',`/api/jobs/${forked.id}/action`,operatorToken,{
  action:'resume',
  text:'Now commit the fix and add unit tests.'
 });
 assert.equal(resumeRes.statusCode,200,resumeRes.body);
 assert.equal(resumeRes.json().status,'queued');
 assert.equal(resumeRes.json().resumePrompt,'Now commit the fix and add unit tests.');
 const afterResumeEvents=store.events(forked.id);
 assert.ok(afterResumeEvents.some((e:any)=>e.type==='user'&&e.data?.mode==='resume'&&e.data?.text==='Now commit the fix and add unit tests.'));
});

test('GET /api/search finds sessions (title, prompt, events) and changes (title, branches, comments, reviews)',async()=>{
 const c=store.put('changes',{
  repoId:repo.id,
  projectId:project.id,
  title:'Refactor authentication middleware',
  source:'relay/auth-refactor',
  target:'main',
  sourceSha:'aaa',
  targetSha:'bbb',
  status:'open',
  authorId:owner.id
 });
 store.put('comments',{changeId:c.id,authorId:owner.id,text:'Watch out for token skew in JWT validation.'});
 store.put('reviews',{changeId:c.id,authorId:owner.id,sourceSha:'aaa',targetSha:'bbb',body:'LGTM on crystal-clear error handling.',verdict:'approved'});

 // Short query (< 2 chars) returns empty
 const shortRes=(await request('GET','/api/search?q=a',ownerToken)).json();
 assert.deepEqual(shortRes,{sessions:[],changes:[]});

 // Search matching event transcript in session
 const evSearch=(await request('GET','/api/search?q=variable%20x%20should%20be%2042',ownerToken)).json();
 assert.ok(evSearch.sessions.length>=2); // original + fork both have the event
 assert.ok(evSearch.sessions[0].snippet.includes('variable x should be 42'));

 // Search matching change comment
 const cmSearch=(await request('GET','/api/search?q=token%20skew',ownerToken)).json();
 assert.equal(cmSearch.changes.length,1);
 assert.equal(cmSearch.changes[0].id,c.id);
 assert.ok(cmSearch.changes[0].snippet.toLowerCase().includes('token skew'));

 // Search matching change review
 const rvSearch=(await request('GET','/api/search?q=crystal-clear',ownerToken)).json();
 assert.equal(rvSearch.changes.length,1);
 assert.equal(rvSearch.changes[0].id,c.id);

 // Search respects project visibility (otherToken cannot see project Alpha's sessions/changes)
 const isolatedSearch=(await request('GET','/api/search?q=token%20skew',otherToken)).json();
 assert.deepEqual(isolatedSearch,{sessions:[],changes:[]});
});
