import { spawn,type ChildProcess } from 'node:child_process';
import { mkdir,writeFile } from 'node:fs/promises';
import { join,isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { all,get,put,hash,admin,canProject,audit,redact,dataDir,transaction,type Row } from './store.js';
import { git } from './git.js';
export const draftSchema=z.object({content:z.string().min(1).max(200000),notes:z.string().min(1).max(20000),checkoutPaths:z.array(z.string().max(4096).refine(isAbsolute,'Absolute checkout path required')).max(20)}).strict();
export const operationSchema=z.object({operation:z.enum(['status','logs','inspect','deploy']),revision:z.string().regex(/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/).optional(),lines:z.number().int().min(1).max(500).default(100)}).strict();
export function externalAccess(user:Row,deploymentId:string,write=false):Row {
 const current=get('users',user.id),d=get('externalDeployments',deploymentId);
 if(!current||current.disabled||!d||!canProject(current,d.projectId)||write&&!admin(current))throw Error('External deployment access denied');
 return d;
}
export function requireExternalAdmin(user:Row):void {const u=get('users',user.id);if(!u||u.disabled||!admin(u))throw Error('Administrator access required')}
export function saveConnectionDraft(deploymentId:string,input:unknown,user:Row,jobId?:string):Row {
 const d=externalAccess(user,deploymentId,true),spec=draftSchema.parse(input);
 if(jobId){const j=get('jobs',jobId);if(d.jobId!==jobId||j?.deploymentId!==d.id||j.status!=='running'||j.authorId!==user.id)throw Error('Onboarding job is no longer current')}
 // Immutable, unique revisions. Even identical content in a new revision needs approval again.
 const version=all('externalConnections').filter(c=>c.deploymentId===d.id).length+1;
 const digest=hash(JSON.stringify({contractVersion:1,deploymentId:d.id,repoId:d.repoId,version,...spec}));
 return transaction(()=>{const c=put('externalConnections',{deploymentId:d.id,projectId:d.projectId,repoId:d.repoId,contractVersion:1,version,...spec,digest,authorId:user.id,jobId});
  put('externalDeployments',{id:d.id,connectionId:c.id,status:'needs_approval',approvedDigest:null,approvedBy:null,approvedAt:null});
  audit(user.id,'external.connection.draft',`${d.id}:${digest}`);return c;
 });
}
export function approveConnection(deploymentId:string,digest:string,user:Row):Row {
 const d=externalAccess(user,deploymentId,true),c=get('externalConnections',d.connectionId);
 if(!c||c.digest!==digest)throw Error('Connection changed; review and approve the current exact digest');
 audit(user.id,'external.connection.approve',`${d.id}:${digest}`);
 return put('externalDeployments',{id:d.id,approvedDigest:digest,approvedBy:user.id,approvedAt:new Date().toISOString(),status:'linked'});
}
function approvedConnection(d:Row):Row {
 const c=get('externalConnections',d.connectionId);
 if(!c||d.approvedDigest!==c.digest)throw Error('Exact-content administrator approval is required');
 return c;
}
export function externalDetail(user:Row,id:string) {
 const d=externalAccess(user,id);
 return {...d,connection:get('externalConnections',d.connectionId),versions:all('externalConnections').filter(c=>c.deploymentId===id),operations:all('externalOperations').filter(o=>o.deploymentId===id).sort((a,b)=>b.created.localeCompare(a.created)).slice(0,50)};
}
export function setExternalPolicy(id:string,policy:'manual'|'yolo',user:Row):Row {
 externalAccess(user,id,true);audit(user.id,`external.policy.${policy}`,id);return put('externalDeployments',{id,policy});
}
export async function requestExternalOperation(id:string,input:unknown,user:Row):Promise<Row> {
 const b=operationSchema.parse(input);let d=externalAccess(user,id,b.operation==='deploy');let c=approvedConnection(d);
 if(b.operation==='deploy'){
  if(!b.revision)throw Error('Deploy requires an explicit full repository commit SHA');
  const r=get('repos',d.repoId)!;
  if(await git(r.path,'rev-parse','--verify',`${b.revision}^{commit}`)!==b.revision)throw Error('Unknown repository commit');
 }else if(b.revision)throw Error('Read operations do not accept a revision');
 // Recheck after Git I/O: a revision, role or connection may have changed meanwhile.
 d=externalAccess(user,id,b.operation==='deploy');c=approvedConnection(d);
 if(all('externalOperations').some(o=>o.deploymentId===id&&o.status==='running'))throw Error('An operation is already running');
 const automatic=b.operation!=='deploy'||d.policy==='yolo'&&get('repos',d.repoId)?.autonomy==='auto';
 const op=put('externalOperations',{...b,deploymentId:id,projectId:d.projectId,repoId:d.repoId,connectionId:c.id,digest:c.digest,actorId:user.id,status:automatic?'ready':'awaiting_approval',authorization:automatic?(b.operation==='deploy'?'yolo':'read'):null,log:''});
 audit(user.id,'external.operation.request',`${op.id}:${b.operation}:${b.revision||''}:${c.digest}`);
 if(automatic)void runExternalOperation(op.id);
 return op;
}
export function approveExternalOperation(id:string,digest:string,revision:string,user:Row):Row {
 const op=get('externalOperations',id);if(!op)throw Error('Operation not found');
 const d=externalAccess(user,op.deploymentId,true),c=approvedConnection(d);
 if(op.status!=='awaiting_approval'||op.digest!==digest||op.revision!==revision||c.id!==op.connectionId)throw Error('Operation or connection changed; request a new operation');
 audit(user.id,'external.operation.approve',`${id}:${digest}:${revision}`);
 const approved=put('externalOperations',{id,status:'ready',authorization:'manual',approvedBy:user.id});
 void runExternalOperation(id);return approved;
}
const active=new Map<string,ChildProcess>();
const busy=new Set<string>();
let stopping=false;
function authorizeRun(op:Row):{actor:Row;d:Row;c:Row} {
 const actor=get('users',op.actorId);if(!actor)throw Error('Operation owner unavailable');
 const d=externalAccess(actor,op.deploymentId,op.operation==='deploy'),c=approvedConnection(d);
 if(c.id!==op.connectionId||c.digest!==op.digest)throw Error('Connection changed; request a new operation');
 requireExternalAdmin(get('users',d.approvedBy)||{id:''} as Row);
 if(op.operation==='deploy'){
  if(op.authorization==='manual')requireExternalAdmin(get('users',op.approvedBy)||{id:''} as Row);
  else if(op.authorization!=='yolo'||d.policy!=='yolo'||get('repos',d.repoId)?.autonomy!=='auto')throw Error('Host mutation approval required');
 }
 return {actor,d,c};
}
export async function runExternalOperation(id:string):Promise<void> {
 let op=get('externalOperations',id);if(!op||op.status!=='ready'||stopping)return;
 if(busy.has(op.deploymentId)){put('externalOperations',{id,status:'failed',error:'Another operation is running; request again'});return}
 busy.add(op.deploymentId);
 let outputTail=Buffer.alloc(0),total=0,truncated=false;
 const boundedLog=()=>{const bytes=Buffer.from(redact(outputTail.toString('utf8')));let start=Math.max(0,bytes.length-65536);while(start<bytes.length&&(bytes[start]&0xc0)===0x80)start++;return bytes.subarray(start).toString('utf8')};
 try {
  const {d,c}=authorizeRun(op);
  op=put('externalOperations',{id,status:'running',started:new Date().toISOString()});
  audit(op.actorId,'external.operation.start',`${id}:${op.operation}:${op.revision||''}:${c.digest}`);
  const directory=join(dataDir,'external-runs',id);await mkdir(directory,{recursive:true,mode:0o700});
  const path=join(directory,'connection.mjs');await writeFile(path,c.content,{mode:0o400,flag:'wx'});
  // Only these host fields are provided. No provider credentials or API authorization tokens.
  const repo=get('repos',d.repoId)!;
  const timeoutMs=op.operation==='deploy'?120000:15000;
  const input={operation:op.operation,revision:op.revision,repository:{id:repo.id,source:repo.source,path:repo.path},deploymentId:d.id,lines:op.lines,timeoutMs,maxOutputBytes:65536};
  // No awaits between this authorization recheck and spawn.
  authorizeRun(op);
  if(stopping)throw Error('Service is stopping');
  await new Promise<void>((resolve,reject)=>{
   const child=spawn(process.execPath,['--import',import.meta.resolve('tsx'),fileURLToPath(new URL('./external-runner.ts',import.meta.url)),path],{cwd:directory,detached:true,env:{PATH:process.env.PATH,HOME:process.env.HOME,LANG:'C.UTF-8'},stdio:['pipe','pipe','pipe','ipc']});
   active.set(id,child);let reason='';
   const stop=(why:string)=>{reason=why;killGroup(child)};
   const timer=setTimeout(()=>stop(`Operation timed out after ${timeoutMs}ms; inspect for partial effects before retrying`),timeoutMs);
   const permissionTimer=setInterval(()=>{try{authorizeRun(op!)}catch{stop('Access, policy or connection approval revoked during operation')}},250);
   const output=(b:Buffer)=>{total+=b.length;const bytes=Buffer.concat([outputTail,b]);truncated ||= bytes.length>65536;outputTail=bytes.subarray(-65536);if(total>1048576)stop('Operation output limit exceeded (1 MiB)')};
   child.stdout?.on('data',output);child.stderr?.on('data',output);
   child.stdin?.on('error',()=>{});child.stdin?.end(JSON.stringify({input,checkoutPaths:c.checkoutPaths}));
   const cleanup=()=>{clearTimeout(timer);clearInterval(permissionTimer);killGroup(child);active.delete(id)};
   child.on('error',e=>{cleanup();reject(e)});
   child.on('close',code=>{cleanup();if(reason||code!==0)reject(Error(reason||`Connection exited ${code}; inspect output and permissions before retrying`));else resolve()});
  });
  put('externalOperations',{id,status:stopping?'interrupted':'succeeded',log:boundedLog(),truncated,finished:new Date().toISOString()});
  put('externalDeployments',{id:d.id,lastOperationId:id,...(op.operation==='deploy'?{lastDeployedRevision:op.revision}:{})});
 }catch(e){put('externalOperations',{id,status:stopping?'interrupted':'failed',error:redact(String(e)),log:boundedLog(),truncated,finished:new Date().toISOString()})}
 finally{busy.delete(op.deploymentId);active.delete(id);audit(op.actorId,'external.operation.finish',`${id}:${get('externalOperations',id)?.status}`)}
}
function killGroup(child:ChildProcess){if(child.pid)try{process.kill(-child.pid,'SIGKILL')}catch{child.kill('SIGKILL')}}
export function recoverExternalOperations():void {
 for(const op of all('externalOperations').filter(o=>['running','ready'].includes(o.status)))put('externalOperations',{id:op.id,status:'interrupted',error:'Service restarted; inspect for partial effects. Operations are never automatically replayed.'});
}
export function shutdownExternalOperations():void {stopping=true;for(const [id,child] of active){put('externalOperations',{id,status:'interrupted',error:'Service stopped; inspect for partial effects before retrying'});killGroup(child)}}
