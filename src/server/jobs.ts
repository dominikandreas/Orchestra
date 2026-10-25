import { fork,type ChildProcess } from 'node:child_process';
import { requireExternalAdmin } from './external.js';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdtemp,mkdir,rm,stat,cp,copyFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join,dirname,basename } from 'node:path';
import { SessionManager } from '@earendil-works/pi-coding-agent';
import { all,get,put,event,audit,canOperate,canProject,copyEvents,redact,dataDir,type Row } from './store.js';
import { createWorktree,git,locked,createChange,refreshChange,mergeChange,revision,syncRepository,diffChange,emitBranchUpdated } from './git.js';
import { syncDeployments } from './deployments.js';
import { usable } from './providers.js';
import { startSandbox,stopSandbox,dockerExec } from './docker.js';
const active=new Map<string,ChildProcess|null>();
const levels=['approve','prepare','auto'];
export function visibleAgent(user:Row,agentId:string,projectId:string){const a=get('agents',agentId);if(!a||(a.projectId&&(a.projectId!==projectId||!canProject(user,a.projectId))))throw Error('Agent is not available for this project');return a;}
export function enqueue(input:any,user:Row){
  if(input.kind==='deployment_connection')requireExternalAdmin(user);
  const r=get('repos',input.repoId);
  if(!r||!canOperate(user,r.projectId))throw Error('Repository access denied');
  const c=input.changeId?get('changes',input.changeId):undefined;
  if(input.changeId&&(!c||c.repoId!==r.id||c.status!=='open'))throw Error('Invalid change request');
  // Precedence: explicit input, then agent definition, then repository defaults.
  const agent=input.agentId?visibleAgent(user,input.agentId,r.projectId):undefined;
  const kind=input.kind||agent?.kind||'implement';
  const mode=levels[Math.min(levels.indexOf(input.autonomy||agent?.autonomy||r.autonomy||'prepare'),levels.indexOf(r.autonomy||'prepare'))]||'approve';
  const connectionId=input.connectionId||agent?.connectionId||r.connectionId;
  const connection=usable(connectionId,user.id,r.projectId);
  const status=mode==='approve'&&!['review','test'].includes(kind)?'awaiting_approval':kind!=='test'&&!connection?'blocked':'queued';
  
  let promptText=input.prompt||'';
  if(input.attachments?.length){
    for(const att of input.attachments){
      promptText+=`\n\n--- Attachment: ${att.name} ---\n${att.data}`;
    }
  }

  const job=put('jobs',{
    repoId:r.id,
    projectId:r.projectId,
    changeId:c?.id,
    agentId:agent?.id,
    authorId:user.id,
    kind,
    title:input.title||input.prompt?.slice(0,90)||'Task',
    prompt:promptText,
    images:input.images,
    attachments:input.attachments,
    targetBranch:input.targetBranch,
    sourceBranch:input.sourceBranch,
    connectionId,
    provider:connection?.provider,
    model:input.model||agent?.model||r.model,
    thinkingLevel:input.thinkingLevel||agent?.thinkingLevel||r.thinkingLevel||'off',
    status,
    autonomy:mode,
    workflowId:input.workflowId,
    attempt:input.attempt||1,
    error:status==='blocked'?'Connect a model provider and select it in repository settings.':undefined
  });
  event(job.id,'status',status);
  event(job.id,'user',{text:input.prompt,images:input.images,attachments:input.attachments,mode:'prompt'});
  return job;
}
export function signalJob(id:string,type:string,text?:string,images?:any[],attachments?:any[]){
  const j=get('jobs',id)!;
  if(type==='cancel'){
    put('jobs',{id,status:'cancelled'});
    active.get(id)?.send({type});
    void stopSandbox(`relay-job-${id}`);
    void stopSandbox(`relay-test-${id}`);
  }else if(active.get(id)){
    let fullText=text||'';
    if(attachments?.length){
      for(const att of attachments){
        fullText+=`\n\n--- Attachment: ${att.name} ---\n${att.data}`;
      }
    }
    active.get(id)!.send({type,text:fullText,images});
    event(id,'user',{text,images,attachments,mode:type});
  }else throw Error('Job is not running');
}
export function updateJobSettings(id:string,thinkingLevel?:string){
  if(active.get(id)&&thinkingLevel){
    active.get(id)!.send({type:'update_settings',thinkingLevel});
  }
}
export async function runTests(job:Row,repo:Row){
 if(!repo.testCommand){if(job.changeId)put('checks',{changeId:job.changeId,sourceSha:job.sourceSha,targetSha:job.targetSha,status:'not_run',jobId:job.id});event(job.id,'notice','No test command configured');return 'not_run';}
 const name=`relay-test-${job.id}`;let log='',path=job.path;
 try{
  // Test the candidate merge, not just a source revision paired with an untested target.
  if(job.changeId){path=await locked(repo.id,()=>createWorktree(repo,`test-${job.id}-${Date.now()}`,job.targetSha));await git(path,'merge','--no-ff','--no-edit',job.sourceSha);}
  await startSandbox(name,path,repo.image);
  const result=await dockerExec(name,repo.testCommand,b=>{log=(log+b.toString()).slice(-200000);event(job.id,'test_output',b.toString());},undefined,1800);
  if(get('jobs',job.id)?.status==='cancelled')return 'cancelled';
  const status=result.exitCode===0?'passed':'failed';put('checks',{changeId:job.changeId,repoId:repo.id,jobId:job.id,sourceSha:job.sourceSha,targetSha:job.targetSha,status,exitCode:result.exitCode,log});return status;
 }catch(e){put('checks',{changeId:job.changeId,repoId:repo.id,jobId:job.id,sourceSha:job.sourceSha,targetSha:job.targetSha,status:'failed',log:log+'\n'+String(e)});throw e;
 }finally{await stopSandbox(name);if(path!==job.path)await git(repo.path,'worktree','remove','--force',path).catch(()=>{});}
}

export async function runJob(job:Row){active.set(job.id,null);try{const repo=get('repos',job.repoId)!,user=get('users',job.authorId);if(!user||!canOperate(user,repo.projectId)||user.disabled)throw Error('The job owner no longer has access');if(job.deploymentId){requireExternalAdmin(user);if(get('externalDeployments',job.deploymentId)?.jobId!==job.id)throw Error('Onboarding job is no longer current');}let change=job.changeId?get('changes',job.changeId):undefined;if(change){change=await refreshChange(change);if(change.status!=='open')throw Error('Change request is closed');}
 if(!job.path){const targetBranch=(job.targetBranch&&job.targetBranch!=='auto')?job.targetBranch:undefined;const base=change?.sourceSha||(targetBranch?await revision(repo,targetBranch).catch(()=>revision(repo,repo.base)):await revision(repo,repo.base));const path=await locked(repo.id,()=>createWorktree(repo,job.id,base));job=put('jobs',{...job,path,sourceSha:base,baseSha:base,targetSha:change?.targetSha});}
 put('jobs',{id:job.id,status:'running',started:new Date().toISOString(),error:null});event(job.id,'status','running');
 if(job.kind==='test'){const status=await runTests(job,repo);if(status==='cancelled')return;if(job.changeId)await maybeAutoMerge(job.changeId);put('jobs',{id:job.id,status:status==='failed'?'failed':'completed',result:`Tests ${status.replace('_',' ')}`});return;}
 const connection=usable(job.connectionId,job.authorId,repo.projectId);if(!connection){put('jobs',{id:job.id,status:'blocked',error:'Provider connection is missing or access was revoked.'});return;}job=put('jobs',{id:job.id,provider:connection.provider});
 if(job.kind==='conflict'&&change){try{await git(job.path,'merge','--no-commit','--no-ff',change.targetSha);}catch{}job=put('jobs',{id:job.id,prompt:`Resolve the merge of target branch ${change.target} into this source branch. Resolve all conflicts, retain intended behavior, and test. Do not run git commands; Orchestra will commit the result.\n${job.prompt}`});}
 if(change){const pinned={...change,sourceSha:job.sourceSha,targetSha:job.targetSha};const diff=await diffChange(pinned);job=put('jobs',{id:job.id,context:`Change request: ${change.title}\nSource ${job.sourceSha}; target ${job.targetSha}\nDiff (first 120,000 characters):\n${diff.slice(0,120000)}`});}
 let failure='',result='';const child=fork(new URL('./worker.ts',import.meta.url),[job.id],{cwd:job.path||process.cwd(),execArgv:['--import',import.meta.resolve('tsx')],stdio:['ignore','ignore','pipe','ipc'],env:{...process.env,PATH:process.env.PATH,HOME:process.env.HOME||'',RELAY_DATA_DIR:process.env.RELAY_DATA_DIR||dataDir,LANG:'C.UTF-8'}});active.set(job.id,child);child.stderr?.on('data',b=>event(job.id,'notice',b.toString().slice(0,4000)));child.on('message',(m:any)=>{if(m.type==='session')put('jobs',{id:job.id,sessionFile:m.data});else if(m.type==='failure')failure=m.data;else if(m.type==='review'&&change){put('reviews',{changeId:change.id,jobId:job.id,sourceSha:job.sourceSha,targetSha:job.targetSha,body:m.data.body,verdict:m.data.verdict,ai:true,authorId:job.authorId});}else if(m.type==='result'){result=m.data;if(result)event(job.id,'result',result);}else event(job.id,m.type,m.data);});
 await new Promise<void>((resolve,reject)=>{child.on('error',reject);child.on('exit',code=>code&&get('jobs',job.id)?.status!=='cancelled'?reject(Error(failure||`Worker exited ${code}`)):resolve());});
 if(get('jobs',job.id)?.status==='cancelled')return;if(failure)throw Error(failure);
 const currentUser=get('users',job.authorId);if(!currentUser||currentUser.disabled||!canOperate(currentUser,repo.projectId))throw Error('Job owner access was revoked');
 if(job.deploymentId){requireExternalAdmin(currentUser);const d=get('externalDeployments',job.deploymentId);const c=d&&get('externalConnections',d.connectionId);if(d?.jobId!==job.id||c?.jobId!==job.id)throw Error('The agent did not submit a connection draft for this onboarding job');}
 else if(job.kind!=='review'){await locked(repo.id,async()=>{await git(job.path,'add','-A');if(await git(job.path,'status','--porcelain'))await git(job.path,'commit','-m',`Orchestra: ${job.title.replace(/[\r\n]/g,' ').slice(0,120)}`);const sha=await git(job.path,'rev-parse','HEAD');if(sha!==job.sourceSha){const sourceBranch=(job.sourceBranch&&job.sourceBranch!=='auto')?job.sourceBranch:`relay/${job.id}`;const targetBranch=(job.targetBranch&&job.targetBranch!=='auto')?job.targetBranch:(change?.target||repo.base);await git(job.path,'branch','-f',sourceBranch,sha).catch(()=>{});emitBranchUpdated(repo.id,sourceBranch);const existing=change?.source===sourceBranch;const cr=existing?await refreshChange(change!):await createChange(repo,sourceBranch,targetBranch,job.title,job.authorId);change=put('changes',{...cr,originWorkflowId:job.workflowId});emitAutomation(existing?'change_updated':'change_created',change);job=put('jobs',{id:job.id,changeId:cr.id,sourceSha:sha,targetSha:cr.targetSha});}});
 const testStatus=await runTests(job,repo);if(change&&job.reviewAfter)queueRequestedReview(job,change,user);if(job.autonomy==='auto'&&change&&testStatus==='passed'){await maybeAutoMerge(change.id);}
 }else if(change&&!all('reviews').some(r=>r.jobId===job.id))put('reviews',{changeId:change.id,jobId:job.id,sourceSha:job.sourceSha,targetSha:job.targetSha,body:result,verdict:'commented',authorId:job.authorId,ai:true});
 if(get('jobs',job.id)?.status==='cancelled')return;if(change)await maybeAutoMerge(change.id);put('jobs',{id:job.id,status:'completed',result,finished:new Date().toISOString(),resumePrompt:null});if(result)event(job.id,'result',result);event(job.id,'status','completed');
 }catch(e){if(get('jobs',job.id)?.status==='cancelled')return;put('jobs',{id:job.id,status:'failed',error:redact(String(e)),finished:new Date().toISOString()});event(job.id,'error',String(e));}finally{active.delete(job.id);}}

export async function submitChangeForJob(job:Row,repo:Row,user:Row){
  if(job.status==='running')throw Error('Cannot submit while task is actively running. Wait for the model to finish or steer/stop it.');
  if(!job.path)throw Error('No workspace exists for this task.');
  let change=job.changeId?get('changes',job.changeId):undefined;
  let resultChange:Row;
  let updatedJob:Row=job;
  await locked(repo.id,async()=>{
    await git(job.path,'add','-A');
    if(await git(job.path,'status','--porcelain')){
      await git(job.path,'commit','-m',`Orchestra: ${job.title.replace(/[\r\n]/g,' ').slice(0,120)}`);
    }
    const sha=await git(job.path,'rev-parse','HEAD');
    const sourceBranch=(job.sourceBranch&&job.sourceBranch!=='auto')?job.sourceBranch:`relay/${job.id}`;
    const targetBranch=(job.targetBranch&&job.targetBranch!=='auto')?job.targetBranch:(change?.target||repo.base);
    await git(job.path,'branch','-f',sourceBranch,sha).catch(()=>{});
    emitBranchUpdated(repo.id,sourceBranch);
    const existing=!!change;
    const cr=existing?await refreshChange(change!):await createChange(repo,sourceBranch,targetBranch,job.title,user.id);
    resultChange=put('changes',{...cr,originWorkflowId:job.workflowId});
    emitAutomation(existing?'change_updated':'change_created',resultChange);
    updatedJob=put('jobs',{id:job.id,changeId:cr.id,sourceSha:sha,targetSha:cr.targetSha});
  });
  event(job.id,'notice',`Change request ${resultChange!.id} submitted.`);
  return {change:resultChange!,job:updatedJob};
}
// Continue a session in a new job: same commit, same uncommitted/untracked files, forked Pi transcript and copied events.
export async function forkJob(source:Row,user:Row,title?:string){
  const repo=get('repos',source.repoId);if(!repo||!canOperate(user,repo.projectId))throw Error('Repository access denied');
  const id=randomUUID();let path:string|undefined,sourceSha:string|undefined,baseSha:string|undefined,sessionFile:string|undefined;
  if(source.path&&existsSync(source.path)){
    const head=await git(source.path,'rev-parse','HEAD');
    path=await locked(repo.id,()=>createWorktree(repo,id,head));
    const tmp=await mkdtemp(join(tmpdir(),'orchestra-fork-'));
    try{const patch=join(tmp,'changes.patch');await git(source.path,'diff','HEAD','--binary','--no-ext-diff','--no-color',`--output=${patch}`);if((await stat(patch)).size)await git(path,'apply','--binary','--whitespace=nowarn',patch);}finally{await rm(tmp,{recursive:true,force:true});}
    for(const f of (await git(source.path,'ls-files','--others','--exclude-standard','-z')).split('\0').filter(Boolean)){const target=join(path,f);await mkdir(dirname(target),{recursive:true});await cp(join(source.path,f),target,{recursive:true,verbatimSymlinks:true});}
    sourceSha=head;baseSha=source.baseSha||head;
  }
  if(source.sessionFile&&existsSync(source.sessionFile)&&(await stat(source.sessionFile)).size){
    const dir=join(dataDir,'sessions',id);await mkdir(dir,{recursive:true});
    try{sessionFile=SessionManager.forkFrom(source.sessionFile,path||process.cwd(),dir).getSessionFile();}catch{}
    // Fall back to a verbatim transcript copy when Pi cannot fork (for example a header-only session).
    if(!sessionFile||!existsSync(sessionFile)){sessionFile=join(dir,basename(source.sessionFile));await copyFile(source.sessionFile,sessionFile);}
  }
  const job=put('jobs',{id,repoId:repo.id,projectId:repo.projectId,agentId:source.agentId,authorId:user.id,kind:['review','test'].includes(source.kind)?'implement':source.kind||'implement',title:(title||`${source.title} (fork)`).slice(0,200),prompt:source.prompt,images:source.images,attachments:source.attachments,targetBranch:source.targetBranch,connectionId:source.connectionId,provider:source.provider,model:source.model,thinkingLevel:source.thinkingLevel,autonomy:source.autonomy,status:'idle',attempt:1,forkedFrom:source.id,path,sourceSha,baseSha,sessionFile});
  copyEvents(source.id,id);event(id,'notice',`Forked from "${source.title}"`);
  return job;
}
const numstat=(out:string)=>out.split('\n').filter(Boolean).map(l=>{const [a,d,...p]=l.split('\t');return {path:p.join('\t'),additions:a==='-'?0:Number(a),deletions:d==='-'?0:Number(d),binary:a==='-'};});
export async function jobDiff(job:Row){
  if(!job.path||!existsSync(job.path))return {base:null,head:null,diff:'',files:[],untracked:[]};
  const repo=get('repos',job.repoId)!;const target=(job.targetBranch&&job.targetBranch!=='auto')?job.targetBranch:repo.base;
  const head=await git(job.path,'rev-parse','HEAD');
  const base=job.baseSha||await git(job.path,'merge-base','HEAD',`refs/heads/${target}`).catch(()=>head);
  const [diff,stats,names,others]=await Promise.all([git(job.path,'diff','--no-ext-diff','--no-color','--no-renames',base),git(job.path,'diff','--numstat','--no-renames',base),git(job.path,'diff','--name-status','--no-renames',base),git(job.path,'ls-files','--others','--exclude-standard','-z')]);
  const status=new Map(names.split('\n').filter(Boolean).map(l=>{const [s,...p]=l.split('\t');return [p.join('\t'),s] as [string,string];}));
  return {base,head,diff:diff.length>400000?diff.slice(0,400000)+'\n… diff truncated …':diff,truncated:diff.length>400000,files:numstat(stats).map(f=>({path:f.path,status:status.get(f.path)||'M',additions:f.additions,deletions:f.deletions,binary:f.binary})),untracked:others.split('\0').filter(Boolean)};
}
let polling=false;
export function startQueue(){for(const j of all('jobs').filter(j=>j.status==='running'))put('jobs',{id:j.id,status:'interrupted',error:'Service restarted. Resume to continue from the saved session.'});setInterval(()=>{if(polling)return;polling=true;try{const runningRepos=new Set([...active.keys()].map(id=>get('jobs',id)?.repoId));for(const j of all('jobs').filter(j=>j.status==='queued').sort((a,b)=>a.created.localeCompare(b.created))){if(active.size>=2)break;if(runningRepos.has(j.repoId))continue;runningRepos.add(j.repoId);void runJob(j);}}finally{polling=false}},1000).unref();setInterval(()=>void scanAutomation().catch(e=>put('system',{id:'automation',error:String(e)})),30000).unref();setInterval(()=>void syncDeployments().catch(()=>{}),20000).unref();}
let scanning=false;
export async function scanAutomation(){if(scanning)return;scanning=true;try{for(const repo of all('repos').filter(r=>r.status==='ready')){try{await syncRepository(repo)}catch(e){put('repos',{id:repo.id,error:String(e)})}}for(const c of all('changes').filter(c=>c.status==='open')){try{const updated=await refreshChange(c);if(c.sourceSha!==updated.sourceSha||c.targetSha!==updated.targetSha)emitAutomation('change_updated',updated);if(updated.conflict)emitAutomation('conflict',updated);}catch{}}
 for(const w of all('workflows').filter(w=>w.enabled&&w.trigger==='schedule'&&w.nextRun<=Date.now())){const u=get('users',w.authorId);if(u){try{enqueue({...w,title:w.name,workflowId:w.id},u)}catch(e){put('workflows',{id:w.id,error:String(e)})}}put('workflows',{id:w.id,nextRun:Date.now()+w.intervalMinutes*60000});}
 for(const check of all('checks').filter(c=>c.status==='failed')){const c=get('changes',check.changeId);if(c&&c.status==='open'&&c.sourceSha===check.sourceSha&&c.targetSha===check.targetSha)emitAutomation('test_failed',c,check.id);}
 }finally{scanning=false;}}
export function emitAutomation(trigger:string,c:Row,eventId=''){for(const w of all('workflows').filter(w=>w.enabled&&w.repoId===c.repoId&&w.trigger===trigger)){if(c.originWorkflowId===w.id)continue;const key=`${w.id}:${c.id}:${c.sourceSha}:${c.targetSha}:${eventId}`;if(get('triggers',key))continue;put('triggers',{id:key});const attempts=all('jobs').filter(j=>j.workflowId===w.id&&j.changeId===c.id);if(attempts.length>=3||attempts.some(j=>['queued','running','awaiting_approval'].includes(j.status)))continue;const u=get('users',w.authorId);if(u)try{enqueue({...w,title:w.name,changeId:c.id,workflowId:w.id,attempt:attempts.length+1},u);}catch(e){put('workflows',{id:w.id,error:String(e)});}}}
export function queueRequestedReview(job:Row,change:Row,user:Row){
 const existing=all('jobs').find(j=>j.parentJobId===job.id&&j.kind==='review'&&j.reviewSourceSha===change.sourceSha&&j.reviewTargetSha===change.targetSha);if(existing)return existing;
 const review=enqueue({repoId:job.repoId,changeId:change.id,title:`Review: ${job.title}`,prompt:'Independently review this change for correctness, regressions, and test coverage. Inspect the diff and record an honest verdict. Approve only when ready to merge.',kind:'review',autonomy:job.autonomy,connectionId:job.connectionId,model:job.model,thinkingLevel:job.thinkingLevel},user);
 return put('jobs',{id:review.id,parentJobId:job.id,adminThreadId:job.adminThreadId,adminRunId:job.adminRunId,reviewSourceSha:change.sourceSha,reviewTargetSha:change.targetSha});
}
export async function maybeAutoMerge(changeId:string){const c=get('changes',changeId);if(!c||c.status!=='open')return;const repo=get('repos',c.repoId);if(repo?.autonomy!=='auto'||!repo.testCommand)return;const job=all('jobs').find(j=>j.changeId===c.id&&j.autonomy==='auto'&&j.kind!=='review');if(!job)return;if(job.reviewAfter&&!all('reviews').some(r=>r.changeId===c.id&&r.sourceSha===c.sourceSha&&r.targetSha===c.targetSha&&r.verdict==='approved'&&get('jobs',r.jobId)?.parentJobId===job.id))return;try{await mergeChange(c.id);event(job.id,'notice','Merged automatically after current tests and review gates passed.');}catch{/* Pending gates remain visible on the change request. */}}

export async function shutdownJobs(){for(const [id,child] of active){put('jobs',{id,status:'interrupted',error:'Service stopped. Resume to continue.'});child?.kill('SIGTERM');await stopSandbox(`relay-job-${id}`);await stopSandbox(`relay-test-${id}`);}}
