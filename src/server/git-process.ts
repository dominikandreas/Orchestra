import { spawn } from 'node:child_process';

export class GitCommandError extends Error {
 constructor(message:string, public readonly code:number|null, public readonly stdout:string, public readonly stderr:string) { super(message); }
}

/** Raw, bounded output: never silently trim a diff, filename, or merge result. */
export async function gitOutput(cwd:string,args:string[],maxBytes=2*1024*1024,timeout=120000):Promise<string> {
 return new Promise((resolve,reject)=>{
  const p=spawn('git',['-c','core.hooksPath=/dev/null','-c','core.quotePath=false',...args],{
   cwd,env:{...process.env,GIT_TERMINAL_PROMPT:'0',GIT_LITERAL_PATHSPECS:'1'},stdio:['ignore','pipe','pipe']
  });
  const out:Buffer[]=[],err:Buffer[]=[];let size=0,errSize=0,failed=false;
  const fail=(e:Error)=>{if(failed)return;failed=true;clearTimeout(timer);p.kill('SIGKILL');reject(e);};
  const timer=setTimeout(()=>fail(new GitCommandError('Git timed out',null,'','')),timeout);
  p.stdout.on('data',(b:Buffer)=>{size+=b.length;if(size>maxBytes)fail(new GitCommandError('Git output exceeds size limit',null,'',''));else out.push(b);});
  p.stderr.on('data',(b:Buffer)=>{if(errSize<20000){err.push(b.subarray(0,20000-errSize));errSize+=b.length;}});
  p.on('error',fail);
  p.on('close',code=>{clearTimeout(timer);if(failed)return;const stdout=Buffer.concat(out).toString('utf8'),stderr=Buffer.concat(err).toString('utf8');
   if(code===0)resolve(stdout);else reject(new GitCommandError(stderr.trim()||`Git exited ${code}`,code,stdout,stderr));
  });
 });
}

export async function commitId(cwd:string,ref:string) {
 if(!ref||ref.startsWith('-')||ref.includes('\0')||ref.length>1024)throw Error('Invalid ref');
 return (await gitOutput(cwd,['rev-parse','--verify','--end-of-options',`${ref}^{commit}`],1024)).trim();
}
