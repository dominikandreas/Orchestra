import {locked,mergeChange} from './git.js';
import { mkdir,writeFile } from 'node:fs/promises';
import { join,resolve,isAbsolute } from 'node:path';
import { spawn } from 'node:child_process';
import ts from 'typescript';
import { DefaultPackageManager,SettingsManager } from '@earendil-works/pi-coding-agent';
import { z } from 'zod';
import { all,get,put,admin,audit,event,dataDir,hash,transaction,redact,type Row } from './store.js';
import { activateDeployment,rollbackDeployment } from './self.js';
import { invalidateExtensionProvidersCache,ensureDefaultConnections } from './providers.js';
export const adminDir=join(dataDir,'admin-pi');
export function requireAdministrator(userId:string){const user=get('users',userId);if(!user||user.disabled||!admin(user))throw Error('Active administrator access required');return user;}
const text=z.string().trim().min(1);
export const actionSchema=z.discriminatedUnion('kind',[
 z.object({kind:z.literal('host'),command:text.max(20000),cwd:text.refine(isAbsolute,'Use an absolute working directory'),timeout:z.number().int().min(1).max(1800).default(120)}),
 z.object({kind:z.enum(['plugin_install','plugin_update','plugin_remove']),source:text.max(2000).regex(/^(npm:|git:|https:\/\/|git@)/,'Use a Pi npm: or Git package source')}),
 z.object({kind:z.enum(['extension_enable','extension_disable']),pluginId:z.string().uuid(),digest:text}),
 z.object({kind:z.literal('deploy'),deploymentId:z.string().uuid(),sha:text}),
 z.object({kind:z.literal('rollback'),selection:text}),
 z.object({kind:z.literal('merge'),changeId:z.string().uuid(),sourceSha:text,targetSha:text,force:z.boolean().default(true)}),
 z.object({kind:z.literal('repo_policy'),repoId:z.string().uuid(),autonomy:z.enum(['approve','prepare','auto'])})
]);
export function packageManager(){return new DefaultPackageManager({cwd:adminDir,agentDir:adminDir,settingsManager:SettingsManager.create(adminDir,adminDir)});}
export function proposeAction(userId:string,reason:string,input:unknown,threadId?:string){requireAdministrator(userId);const action=actionSchema.parse(input);const thread=threadId?get('adminThreads',threadId):undefined;if(threadId&&(!thread||thread.authorId!==userId))throw Error('Conversation access denied');const yolo=thread?.permissionMode==='yolo';const row=put('adminActions',{authorId:userId,threadId,reason,action,status:yolo?'running':'awaiting_approval',approvalMode:yolo?'yolo':'manual',...(yolo?{approvedBy:userId}: {})});audit(userId,yolo?'admin.yolo_execute':'admin.propose',row.id);if(yolo)void executeAction(row).catch(()=>{});return row;}
export function draftPlugin(userId:string,input:{name:string,content:string},threadId?:string){requireAdministrator(userId);const b=z.object({name:text.max(100),content:text.max(200000)}).parse(input);const parsed=ts.transpileModule(b.content,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext},reportDiagnostics:true});if(parsed.diagnostics?.some(d=>d.category===ts.DiagnosticCategory.Error))throw Error('Fix TypeScript syntax errors before saving this extension');return put('adminPlugins',{...b,authorId:userId,threadId,kind:'extension',status:'draft',digest:hash(b.content)});}
export function pluginPaths(){return all('adminPlugins').filter(p=>p.status==='enabled').map(p=>p.path).filter(Boolean);}
export async function decideAction(id:string,decision:'approve'|'reject',userId:string){requireAdministrator(userId);const row=transaction(()=>{const a=get('adminActions',id);if(!a||a.status!=='awaiting_approval')throw Error('This action is not awaiting approval');if(decision==='approve'){const author=a.authorId?get('users',a.authorId):undefined;if(!author||author.disabled||!admin(author))throw Error('Proposing administrator access is revoked or inactive');if(a.jobId&&get('jobs',a.jobId)?.status!=='running')throw Error('Owning task is no longer running');}return put('adminActions',{id,status:decision==='approve'?'running':'rejected',approvedBy:userId,decided:new Date().toISOString()});});audit(userId,`admin.${decision}`,id);if(row.jobId)event(row.jobId,'action_decided',{actionId:id,decision});if(decision==='approve')void executeAction(row).catch(()=>{});return row;}
const executing=new Set<Promise<void>>();
export async function waitForAdminActions(){await Promise.allSettled([...executing]);}
async function executeAction(row:Row){const work=locked('admin-actions',()=>performAction(row));executing.add(work);try{await work}finally{executing.delete(work)}}
async function performAction(row:Row){try{requireAdministrator(row.authorId);requireAdministrator(row.approvedBy);if(row.jobId&&get('jobs',row.jobId)?.status!=='running')throw Error('Owning task is no longer running');if(row.approvalMode==='yolo'&&get('adminThreads',row.threadId)?.permissionMode!=='yolo')throw Error('YOLO mode was disabled before execution');const a=actionSchema.parse(row.action);let result:any;
 if(a.kind==='host')result=await hostCommand(row.id,a);
 else if(a.kind==='plugin_install'||a.kind==='plugin_update'||a.kind==='plugin_remove'){
  await mkdir(adminDir,{recursive:true,mode:0o700});const pm=packageManager();pm.setProgressCallback(e=>put('adminActions',{id:row.id,log:redact(((get('adminActions',row.id)?.log||'')+'\n'+(e.message||e.action)).slice(-50000))}));
  if(a.kind==='plugin_install')await pm.installAndPersist(a.source);else if(a.kind==='plugin_update')await pm.update(a.source);else await pm.removeAndPersist(a.source);
  const old=all('adminPlugins').find(p=>p.kind==='package'&&p.source===a.source);put('adminPlugins',{...(old?{id:old.id}:{}),name:a.source,source:a.source,kind:'package',status:a.kind==='plugin_remove'?'removed':'enabled',authorId:row.authorId});invalidateExtensionProvidersCache();ensureDefaultConnections();result='Pi package '+a.kind.replace('plugin_','')+' completed. Changes apply to the next chat turn.';
 }else if(a.kind==='extension_enable'||a.kind==='extension_disable'){
  const p=get('adminPlugins',a.pluginId);if(!p||p.digest!==a.digest)throw Error('Extension changed; request a new approval');
  if(a.kind==='extension_enable'){await mkdir(join(adminDir,'extensions-approved'),{recursive:true,mode:0o700});const path=join(adminDir,'extensions-approved',p.id+'.ts');await writeFile(path,p.content,{mode:0o600});put('adminPlugins',{id:p.id,path,status:'enabled'});}else put('adminPlugins',{id:p.id,status:'disabled'});invalidateExtensionProvidersCache();ensureDefaultConnections();result='Extension '+(a.kind==='extension_enable'?'enabled':'disabled')+' for subsequent admin turns.';
 }else if(a.kind==='deploy'){const d=get('deployments',a.deploymentId);if(d?.sha!==a.sha)throw Error('Release changed; request a new approval');result=await activateDeployment(a.deploymentId,row.approvedBy);}
 else if(a.kind==='rollback'){const {readFile}=await import('node:fs/promises');if(hash(await readFile(join(dataDir,'active-release.json'),'utf8'))!==a.selection)throw Error('Active release changed; request rollback again');result=await rollbackDeployment(row.approvedBy);}
 else if(a.kind==='merge'){const c=get('changes',a.changeId);if(!c||c.sourceSha!==a.sourceSha||c.targetSha!==a.targetSha)throw Error('Change revisions changed; request approval again');result=await mergeChange(c.id,{sourceSha:a.sourceSha,targetSha:a.targetSha,force:{actorId:row.approvedBy,reason:row.reason}});}
 else if(a.kind==='repo_policy'){const repo=get('repos',a.repoId);if(!repo)throw Error('Repository not found');put('repos',{id:repo.id,autonomy:a.autonomy});result='Repository autonomy updated to '+a.autonomy;}
 put('adminActions',{id:row.id,status:'completed',result:redact(result),finished:new Date().toISOString()});
 }catch(e){put('adminActions',{id:row.id,status:'failed',error:redact(String(e)),finished:new Date().toISOString()});}}
function hostCommand(id:string,a:{command:string,cwd:string,timeout:number}):Promise<string>{return new Promise((resolvePromise,reject)=>{
 const child=spawn('/bin/bash',['-lc',a.command],{cwd:resolve(a.cwd),detached:true,env:{PATH:process.env.PATH,HOME:process.env.HOME,LANG:'C.UTF-8'},stdio:['ignore','pipe','pipe']});let output='',expired=false;
 const kill=()=>{try{process.kill(-child.pid!,'SIGKILL')}catch{child.kill('SIGKILL')}};
 let cancelled=false;
 const timer=setTimeout(()=>{expired=true;kill();},a.timeout*1000);
 const monitor=setInterval(()=>{const action=get('adminActions',id);if(action?.jobId&&get('jobs',action.jobId)?.status!=='running'){cancelled=true;kill();}},250);
 const collect=(b:Buffer)=>{output=redact((output+b.toString()).slice(-50000));put('adminActions',{id,log:output});};child.stdout.on('data',collect);child.stderr.on('data',collect);child.on('error',e=>{clearTimeout(timer);clearInterval(monitor);reject(e)});child.on('close',code=>{clearTimeout(timer);clearInterval(monitor);if(cancelled)reject(Error('Owning task was cancelled or stopped'));else if(expired)reject(Error('Approved command timed out'));else if(code!==0)reject(Error(`Approved command exited ${code}. See output.`));else resolvePromise(output||'Command completed.');});
});}
