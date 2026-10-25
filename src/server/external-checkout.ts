import { spawn } from 'node:child_process';
import { realpath } from 'node:fs/promises';

// This helper is also used by the host child. No application store/credentials are imported.
export function checkoutGit(path:string,args:string[]):Promise<string> {
 return new Promise((resolve,reject)=>{
  const child=spawn('git',['-c','core.hooksPath=/dev/null','-c','core.fsmonitor=false','-c','merge.autostash=false','-c','submodule.recurse=false','-c','protocol.file.allow=always',...args],{cwd:path,env:{PATH:process.env.PATH,HOME:process.env.HOME,GIT_TERMINAL_PROMPT:'0',GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:'/dev/null'},stdio:['ignore','pipe','pipe']});
  let out='',err='',size=0,reason='';
  const stop=(message:string)=>{reason=message;child.kill('SIGKILL')};
  const timer=setTimeout(()=>stop('Checkout command timed out'),30000);
  child.stdout.on('data',b=>{size+=b.length;if(size>65536)stop('Checkout output limit exceeded');else out+=b});
  child.stderr.on('data',b=>{err=(err+b).slice(-4000)});
  child.on('error',e=>{clearTimeout(timer);reject(e)});
  child.on('close',code=>{clearTimeout(timer);code===0&&!reason?resolve(out.trim()):reject(Error(reason||err||`Git exited ${code}`))});
 });
}
export async function assertCleanCheckout(path:string):Promise<void> {
 if(await checkoutGit(path,['rev-parse','--is-bare-repository'])!=='false')throw Error('Expected a working checkout');
 const root=await checkoutGit(path,['rev-parse','--show-toplevel']);
 if(await realpath(root)!==await realpath(path))throw Error('Declare the checkout root, not a subdirectory');
 const tracked=await checkoutGit(path,['ls-files','-v','-z']);
 if(tracked.split('\0').some(entry=>/^[a-zS] /.test(entry)))throw Error('Checkout has assume-unchanged or skip-worktree entries; resolve manually before deploying');
 if(await checkoutGit(path,['status','--porcelain=v1','--untracked-files=all','--ignored','--ignore-submodules=none']))throw Error('Checkout has local changes or untracked/ignored files; preserve them and resolve manually before deploying');
}
export async function updateCheckout(path:string,allowed:string[],repositoryPath:string,revision:string):Promise<string> {
 if(!allowed.includes(path))throw Error('Checkout path is not declared in the approved connection');
 if(!/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(revision))throw Error('A full commit SHA is required');
 await assertCleanCheckout(path);
 if(await checkoutGit(repositoryPath,['rev-parse','--verify',`${revision}^{commit}`])!==revision)throw Error('Unknown repository revision');
 await checkoutGit(path,['fetch','--no-tags','--no-recurse-submodules','--',repositoryPath,revision]);
 await assertCleanCheckout(path);
 await checkoutGit(path,['merge-base','--is-ancestor','HEAD',revision]);
 await checkoutGit(path,['-c','core.hooksPath=/dev/null','merge','--ff-only','--no-edit',revision]);
 return checkoutGit(path,['rev-parse','HEAD']);
}
