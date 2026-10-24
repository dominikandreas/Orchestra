import { spawn } from 'node:child_process';
import { mkdir, realpath } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { dataDir, get, put, all, admin, type Row } from './store.js';
export async function command(exe:string,args:string[],cwd?:string,timeout=120000):Promise<string>{return new Promise((res,rej)=>{const p=spawn(exe,args,{cwd,env:{...process.env,GIT_TERMINAL_PROMPT:'0'},stdio:['ignore','pipe','pipe']});let out='',err='';const t=setTimeout(()=>{p.kill('SIGKILL');rej(Error(`${exe} timed out`));},timeout);p.stdout.on('data',b=>{out=(out+b).slice(-2000000);});p.stderr.on('data',b=>{err=(err+b).slice(-20000);});p.on('error',e=>{clearTimeout(t);rej(e)});p.on('close',code=>{clearTimeout(t);code===0?res(out.trim()):rej(Error(err||`${exe} exited ${code}`));});});}
export const git=(cwd:string,...args:string[])=>command('git',['-c','core.hooksPath=/dev/null','-c','protocol.file.allow=always',...args],cwd);
const locks=new Map<string,Promise<any>>();
export async function locked<T>(id:string,fn:()=>Promise<T>):Promise<T>{const prev=locks.get(id)||Promise.resolve();const next=prev.catch(()=>{}).then(fn);locks.set(id,next);try{return await next;}finally{if(locks.get(id)===next)locks.delete(id);}}
export async function importRepository(source:string,name:string,projectId:string,base?:string){if(source.startsWith('-'))throw Error('Invalid repository location');if(!/^(https:\/\/|ssh:\/\/|git@)/.test(source))source=await realpath(resolve(source));const row=put('repos',{name,projectId,source,status:'importing',autonomy:'prepare',requireReview:true,testCommand:'',previewCommand:'',image:'node:24-bookworm',port:5173});const path=join(dataDir,'repos',row.id);try{await mkdir(join(dataDir,'repos'),{recursive:true});await command('git',['clone','--bare','--no-hardlinks','--',source,path],undefined,180000);await git(path,'config','user.name','Orchestra');await git(path,'config','user.email','orchestra@localhost');const current=base||await git(path,'branch','--show-current');await git(path,'rev-parse','--verify',`${current}^{commit}`);return put('repos',{...row,path,base:current,status:'ready'});}catch(e){put('repos',{...row,status:'error',error:String(e)});throw e;}}
export async function branches(repo:Row){return (await git(repo.path,'for-each-ref','--format=%(refname:short)','refs/heads')).split('\n').filter(Boolean);}
export async function revision(repo:Row,branch:string){if(branch.startsWith('-')||branch.includes('..'))throw Error('Invalid branch');return git(repo.path,'rev-parse','--verify',`refs/heads/${branch}^{commit}`);}
export async function createWorktree(repo:Row,id:string,base:string){const path=join(dataDir,'worktrees',id);await mkdir(join(dataDir,'worktrees'),{recursive:true});await git(repo.path,'worktree','add','-b',`relay/${id}`,path,base);return path;}
export async function createChange(repo:Row,source:string,target:string,title:string,authorId:string){if(source===target)throw Error('Choose different source and target branches');return put('changes',{repoId:repo.id,projectId:repo.projectId,title,source,target,sourceSha:await revision(repo,source),targetSha:await revision(repo,target),status:'open',authorId});}
export async function diffChange(c:Row){const r=get('repos',c.repoId)!;return git(r.path,'diff','--no-ext-diff',`${c.targetSha}...${c.sourceSha}`);}
export async function refreshChange(c:Row){const r=get('repos',c.repoId)!;const sourceSha=await revision(r,c.source),targetSha=await revision(r,c.target);let conflict=false;try{await git(r.path,'merge-tree','--write-tree',targetSha,sourceSha)}catch{conflict=true}return put('changes',{...c,sourceSha,targetSha,conflict});}
export type MergeOptions={sourceSha:string,targetSha:string,force?:{actorId:string,reason:string}};
export async function mergeChange(id:string,options?:MergeOptions){
 const initial=get('changes',id);if(!initial||initial.status!=='open')throw Error('Change request is not open');
 return locked(initial.repoId,async()=>{
  const c=get('changes',id)!;if(c.status!=='open')throw Error('Change request is not open');
  const r=get('repos',c.repoId)!;
  const authorize=()=>{if(options?.force){const u=get('users',options.force.actorId);if(!u||u.disabled||!admin(u))throw Error('Active administrator access required');if(!options.force.reason.trim())throw Error('Force merge requires a reason');}};authorize();
  const source=await revision(r,c.source),target=await revision(r,c.target);
  if(source!==c.sourceSha||target!==c.targetSha||options&&(options.sourceSha!==source||options.targetSha!==target))throw Error('Branches changed. Refresh and retest before merging.');
  const checks=all('checks').filter(x=>x.changeId===id&&x.sourceSha===source&&x.targetSha===target).sort((a,b)=>b.created.localeCompare(a.created));
  const reviews=all('reviews').filter(x=>x.changeId===id&&x.sourceSha===source&&x.targetSha===target).sort((a,b)=>a.created.localeCompare(b.created));
  const latest=[...new Map(reviews.map(x=>[x.ai?'ai':x.authorId,x])).values()];
  const humanReviews=latest.filter(x=>!x.ai);
  const humanApproved=humanReviews.some(x=>x.verdict==='approved');
  const humanChangesRequested=humanReviews.some(x=>x.verdict==='changes_requested');
  const hasApproved=latest.some(x=>x.verdict==='approved');
  const blockedByChanges=humanApproved?humanChangesRequested:latest.some(x=>x.verdict==='changes_requested');
  const bypassed:string[]=[];
  if(r.testCommand&&checks[0]?.status!=='passed')bypassed.push('A passing latest test run for the current revisions is required.');
  if(r.requireReview&&(!hasApproved||blockedByChanges))bypassed.push('An approved review with no outstanding requested changes is required.');
  if(!options?.force&&bypassed.length)throw Error(bypassed[0]);
  const attempt=options?.force?put('audit',{actor:options.force.actorId,action:'change.force_merge',target:id,reason:options.force.reason,sourceSha:source,targetSha:target,bypassed,status:'started'}):undefined;
  let p:string|undefined;
  try{
   p=await createWorktree(r,`merge-${id}-${Date.now()}`,target);
   await git(p,'merge','--no-ff','--no-edit',source);
   const merged=await git(p,'rev-parse','HEAD');authorize();
   if(await revision(r,c.source)!==source)throw Error('Source changed during merge');
   await git(r.path,'update-ref',`refs/heads/${c.target}`,merged,target);
   const result=put('changes',{...c,status:'merged',mergedSha:merged});
   if(attempt)put('audit',{id:attempt.id,status:'completed',mergedSha:merged});return result;
  }catch(e){if(attempt)put('audit',{id:attempt.id,status:'failed',error:String(e)});throw e;}
  finally{if(p)await git(r.path,'worktree','remove','--force',p).catch(()=>{});}
 });
}
export async function syncRepository(repo:Row){return locked(repo.id,async()=>{await git(repo.path,'fetch','--no-tags','origin','+refs/heads/*:refs/remotes/source/*');const refs=(await git(repo.path,'for-each-ref','--format=%(refname:strip=3) %(objectname)','refs/remotes/source')).split('\n').filter(Boolean);const diverged:string[]=[];for(const ref of refs){const [name,sha]=ref.split(' ');if(name.startsWith('relay/'))continue;let old:string|undefined;try{old=await revision(repo,name)}catch{}if(old===sha)continue;if(old){try{await git(repo.path,'merge-base','--is-ancestor',old,sha)}catch{diverged.push(name);continue;}}await git(repo.path,'update-ref',`refs/heads/${name}`,sha,old||'0'.repeat(40));}put('repos',{id:repo.id,lastSync:new Date().toISOString(),diverged,error:null});return {diverged};});}
