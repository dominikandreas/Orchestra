import { spawn } from 'node:child_process';
import { mkdir, realpath, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { dataDir, get, put, all, del, admin, type Row } from './store.js';
export async function command(exe:string,args:string[],cwd?:string,timeout=120000):Promise<string>{return new Promise((res,rej)=>{const p=spawn(exe,args,{cwd,env:{...process.env,GIT_TERMINAL_PROMPT:'0'},stdio:['ignore','pipe','pipe']});let out='',err='';const t=setTimeout(()=>{p.kill('SIGKILL');rej(Error(`${exe} timed out`));},timeout);p.stdout.on('data',b=>{out=(out+b).slice(-2000000);});p.stderr.on('data',b=>{err=(err+b).slice(-20000);});p.on('error',e=>{clearTimeout(t);rej(e)});p.on('close',code=>{clearTimeout(t);code===0?res(out.trim()):rej(Error(err||`${exe} exited ${code}`));});});}
export const git=(cwd:string,...args:string[])=>command('git',['-c','core.hooksPath=/dev/null','-c','protocol.file.allow=always',...args],cwd);
type BranchUpdateListener=(repoId:string,branchName:string)=>void;
const branchListeners:BranchUpdateListener[]=[];
export function onBranchUpdated(listener:BranchUpdateListener){branchListeners.push(listener);}
export function emitBranchUpdated(repoId:string,branchName:string){for(const l of branchListeners){try{l(repoId,branchName);}catch{}}}
const locks=new Map<string,Promise<any>>();
export async function locked<T>(id:string,fn:()=>Promise<T>):Promise<T>{const prev=locks.get(id)||Promise.resolve();const next=prev.catch(()=>{}).then(fn);locks.set(id,next);try{return await next;}finally{if(locks.get(id)===next)locks.delete(id);}}
export async function createLocalRepository(destinationPath:string,name:string,defaultBranch='main'){
 if(destinationPath.startsWith('-'))throw Error('Invalid repository location');
 const target=resolve(destinationPath.replace(/^~(?=$|\/)/,process.env.HOME||''));
 await mkdir(target,{recursive:true});
 try{
  await git(target,'rev-parse','--git-dir');
 }catch{
  await command('git',['init','-b',defaultBranch,target]);
  await git(target,'config','user.name','Orchestra');
  await git(target,'config','user.email','orchestra@localhost');
 }
 const readmePath=join(target,'README.md');
 if(!existsSync(readmePath)){
  await writeFile(readmePath,`# ${name}\n\nCreated with Orchestra.\n`,{flag:'wx'}).catch(()=>{});
 }
 const gitignorePath=join(target,'.gitignore');
 if(!existsSync(gitignorePath)){
  await writeFile(gitignorePath,"node_modules/\ndist/\n.DS_Store\n*.log\n.env\n",{flag:'wx'}).catch(()=>{});
 }
 try{
  await git(target,'add','.');
  await git(target,'commit','-m','Initial commit');
 }catch{}
 return target;
}
export async function importRepository(source:string,name:string,projectId:string,base?:string){
 if(source.startsWith('-'))throw Error('Invalid repository location');
 const isRemote=/^(https:\/\/|ssh:\/\/|git@)/.test(source);
 if(!isRemote)source=await realpath(resolve(source));
 const row=put('repos',{name,projectId,source,status:'importing',autonomy:'prepare',requireReview:true,testCommand:'',previewCommand:'',image:'node:24-bookworm',port:5173});
 const path=join(dataDir,'repos',row.id);
 try{
  await mkdir(join(dataDir,'repos'),{recursive:true});
  await command('git',['clone','--bare','--no-hardlinks','--',source,path],undefined,180000);
  await git(path,'config','user.name','Orchestra');
  await git(path,'config','user.email','orchestra@localhost');
  const current=base||await git(path,'branch','--show-current').catch(()=>'')||'main';
  const hasCommits=await git(path,'rev-list','-n','1','--all').then(out=>Boolean(out.trim())).catch(()=>false);
  if(!hasCommits){
   let treeSha:string;
   if(!isRemote){
    try{
     await command('git',['--git-dir='+path,'--work-tree='+source,'add','-A']);
     treeSha=await git(path,'write-tree');
     await rm(join(path,'index'),{force:true}).catch(()=>{});
    }catch{
     treeSha=await git(path,'hash-object','-t','tree','/dev/null');
    }
   }else{
    treeSha=await git(path,'hash-object','-t','tree','/dev/null');
   }
   const commit=await command('git',['commit-tree',treeSha,'-m','Initial repository commit'],path);
   await git(path,'update-ref',`refs/heads/${current}`,commit.trim());
   await git(path,'symbolic-ref','HEAD',`refs/heads/${current}`);
  }
  await git(path,'rev-parse','--verify',`${current}^{commit}`);
  return put('repos',{...row,path,base:current,status:'ready',error:null});
 }catch(e){
  put('repos',{...row,status:'error',error:String(e)});
  throw e;
 }
}
export async function branches(repo:Row){return (await git(repo.path,'for-each-ref','--format=%(refname:short)','refs/heads')).split('\n').filter(Boolean);}
export async function branchDetails(repo:Row){
 if(!repo.path||!existsSync(repo.path))return [];
 try{
  const lines=(await git(repo.path,'for-each-ref','--format=%(refname:short)%00%(objectname)%00%(committerdate:iso-strict)%00%(subject)%00%(authorname)','refs/heads')).split('\n').filter(Boolean);
  return lines.map(line=>{
   const [name='',sha='',date='',subject='',author='']=line.split('\0');
   return {name,sha,date,subject,author,isBase:name===repo.base};
  });
 }catch{
  return [];
 }
}
export async function createBranch(repo:Row,name:string,from?:string){
 if(!repo.path||!existsSync(repo.path))throw Error('Repository not found');
 const cleanName=name.trim();
 if(!cleanName||cleanName.startsWith('-')||cleanName.includes('..'))throw Error('Invalid branch name');
 const base=from||repo.base||'main';
 await git(repo.path,'branch',cleanName,base);
 emitBranchUpdated(repo.id,cleanName);
 return {ok:true,name:cleanName};
}
export async function deleteBranch(repo:Row,name:string){
 if(!repo.path||!existsSync(repo.path))throw Error('Repository not found');
 if(name===repo.base)throw Error('Cannot delete base branch');
 await git(repo.path,'branch','-D',name);
 emitBranchUpdated(repo.id,name);
 return {ok:true,name};
}
export async function repoTree(repo:Row,ref?:string,path='',recursive=false){
 if(!repo.path||!existsSync(repo.path))return {ref:ref||repo.base||'main',path,entries:[],files:[]};
 const targetRef=ref&&ref.trim()?ref.trim():(repo.base||'main');
 if(targetRef.startsWith('-')||targetRef.includes('..'))throw Error('Invalid ref');
 const cleanPath=path?path.trim().replace(/^\/+/,'').replace(/\/+$/,''):'';
 if(cleanPath.startsWith('-')||cleanPath.includes('..'))throw Error('Invalid path');

 if(recursive){
  const out=await git(repo.path,'ls-tree','-r','--name-only',targetRef).catch(()=>'');
  const files=out.split('\n').filter(Boolean);
  return {ref:targetRef,path:cleanPath,files};
 }

 const targetArg=cleanPath?`${cleanPath}/`:'';
 const args=['ls-tree','-l',targetRef];
 if(targetArg)args.push(targetArg);
 const out=await git(repo.path,...args).catch(()=>'');
 const lines=out.split('\n').filter(Boolean);
 const entries=lines.map(l=>{
  const m=l.match(/^(\d+)\s+(\w+)\s+([0-9a-f]+)\s+(\S+)\t(.+)$/);
  if(!m)return null;
  const fullPath=m[5];
  const name=fullPath.split('/').pop()||fullPath;
  return {
   mode:m[1],
   type:m[2] as 'blob'|'tree',
   sha:m[3],
   size:m[4]==='-'?null:parseInt(m[4],10),
   path:fullPath,
   name
  };
 }).filter(Boolean);
 entries.sort((a,b)=>{
  if(a!.type!==b!.type)return a!.type==='tree'?-1:1;
  return a!.name.localeCompare(b!.name);
 });
 return {ref:targetRef,path:cleanPath,entries};
}
export async function repoBlob(repo:Row,ref?:string,path=''){
 if(!repo.path||!existsSync(repo.path))throw Error('Repository not found');
 const targetRef=ref&&ref.trim()?ref.trim():(repo.base||'main');
 if(targetRef.startsWith('-')||targetRef.includes('..'))throw Error('Invalid ref');
 const cleanPath=path?path.trim().replace(/^\/+/,''):'';
 if(!cleanPath||cleanPath.startsWith('-')||cleanPath.includes('..'))throw Error('Invalid path');

 const sizeStr=await git(repo.path,'cat-file','-s',`${targetRef}:${cleanPath}`).catch(()=>'0');
 const size=parseInt(sizeStr.trim(),10)||0;
 if(size>2*1024*1024){
  return {ref:targetRef,path:cleanPath,size,isBinary:false,isTooLarge:true,content:''};
 }
 const content=await git(repo.path,'show',`${targetRef}:${cleanPath}`).catch(e=>{
  throw Error(`Could not read file: ${e instanceof Error?e.message:String(e)}`);
 });
 const isBinary=content.slice(0,4000).includes('\0');
 return {ref:targetRef,path:cleanPath,size,isBinary,isTooLarge:false,content:isBinary?'':content};
}
export async function repoCommits(repo:Row,ref?:string,limit=30){
 if(!repo.path||!existsSync(repo.path))return [];
 const targetRef=ref&&ref.trim()?ref.trim():(repo.base||'main');
 if(targetRef.startsWith('-')||targetRef.includes('..'))throw Error('Invalid ref');
 const cleanLimit=Math.min(100,Math.max(1,limit));
 const out=await git(repo.path,'log',`-n${cleanLimit}`,'--format=%H%x00%an%x00%ae%x00%aI%x00%s',targetRef).catch(()=>'');
 const lines=out.split('\n').filter(Boolean);
 return lines.map(line=>{
  const [sha='',author='',email='',date='',message='']=line.split('\0');
  return {sha,author,email,date,message};
 });
}
export async function revision(repo:Row,branch:string){if(branch.startsWith('-')||branch.includes('..'))throw Error('Invalid branch');return git(repo.path,'rev-parse','--verify',`refs/heads/${branch}^{commit}`);}
export async function createWorktree(repo:Row,id:string,base:string){
 const path=join(dataDir,'worktrees',id);
 if(existsSync(path)){
  await rm(path,{recursive:true,force:true}).catch(()=>{});
  await git(repo.path,'worktree','prune').catch(()=>{});
  await git(repo.path,'branch','-D',`relay/${id}`).catch(()=>{});
 }
 await mkdir(join(dataDir,'worktrees'),{recursive:true});
 await git(repo.path,'worktree','add','-b',`relay/${id}`,path,base);
 return path;
}
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
   emitBranchUpdated(r.id,c.target);
   if(attempt)put('audit',{id:attempt.id,status:'completed',mergedSha:merged});return result;
  }catch(e){if(attempt)put('audit',{id:attempt.id,status:'failed',error:String(e)});throw e;}
  finally{if(p)await git(r.path,'worktree','remove','--force',p).catch(()=>{});}
 });
}
export async function syncRepository(repo:Row){return locked(repo.id,async()=>{await git(repo.path,'fetch','--no-tags','origin','+refs/heads/*:refs/remotes/source/*');const refs=(await git(repo.path,'for-each-ref','--format=%(refname:strip=3) %(objectname)','refs/remotes/source')).split('\n').filter(Boolean);const diverged:string[]=[];for(const ref of refs){const [name,sha]=ref.split(' ');if(name.startsWith('relay/'))continue;let old:string|undefined;try{old=await revision(repo,name)}catch{}if(old===sha)continue;if(old){try{await git(repo.path,'merge-base','--is-ancestor',old,sha)}catch{diverged.push(name);continue;}}await git(repo.path,'update-ref',`refs/heads/${name}`,sha,old||'0'.repeat(40));emitBranchUpdated(repo.id,name);}put('repos',{id:repo.id,lastSync:new Date().toISOString(),diverged,error:null});return {diverged};});}
