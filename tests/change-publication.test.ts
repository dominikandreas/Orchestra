import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
const root=await mkdtemp(join(tmpdir(),'orchestra-publication-'));
process.env.RELAY_DATA_DIR=join(root,'data');
const {git,createChange,createWorktree,revision}=await import('../src/server/git.js');
const {publishJobBranch,submitChangeForJob,stageJobChanges,runJob}=await import('../src/server/jobs.js');
const s=await import('../src/server/store.js');
after(async()=>{s.db.close();await rm(root,{recursive:true,force:true});});
async function fixture(name:string){
 const path=join(root,name);await mkdir(path);await git(path,'init','-b','main');
 await git(path,'config','user.name','Test');await git(path,'config','user.email','test@localhost');
 await writeFile(join(path,'file.txt'),'initial\n');await git(path,'add','.');await git(path,'commit','-m','Initial');
 await git(path,'branch','change/meaningful-task');
 const repo=s.put('repos',{path,base:'main',projectId:'project'});
 const change=await createChange(repo,'change/meaningful-task','main','Meaningful task','user');
 return {repo,change};
}
test('follow-up publication updates one existing change rather than creating a disconnected change',async()=>{
 const {repo,change}=await fixture('follow-up');
 const path=await createWorktree(repo,'followup',change.sourceSha,'Address feedback');
 const job=s.put('jobs',{repoId:repo.id,projectId:repo.projectId,path,changeId:change.id,sourceSha:change.sourceSha,status:'completed',title:'Address feedback'});
 await writeFile(join(path,'file.txt'),'addressed\n');
 const result=await submitChangeForJob(job,repo,{id:'user'} as any);
 assert.equal(result.change.id,change.id);assert.equal(result.change.source,change.source);
 assert.equal(s.all('changes').filter(c=>c.repoId===repo.id).length,1);
 assert.equal(await revision(repo,change.source),await git(path,'rev-parse','HEAD'));
 assert.equal((await submitChangeForJob(result.job,repo,{id:'user'} as any)).change.id,change.id);
});
test('automatic staging excludes newly installed dependencies/build output, not lockfiles or tracked changes',async()=>{
 const {repo}=await fixture('staging');
 await mkdir(join(repo.path,'node_modules','example'),{recursive:true});await mkdir(join(repo.path,'dist'),{recursive:true});
 await writeFile(join(repo.path,'node_modules','example','index.js'),'dependency');await writeFile(join(repo.path,'dist','bundle.js'),'generated');
 await writeFile(join(repo.path,'package-lock.json'),'{}');await writeFile(join(repo.path,'new file.ts'),'export {};');await writeFile(join(repo.path,'file.txt'),'changed');
 await stageJobChanges(repo.path);
 const staged=await git(repo.path,'diff','--cached','--name-only');
 assert.match(staged,/file.txt/);assert.match(staged,/new file.ts/);assert.match(staged,/package-lock.json/);
 assert.doesNotMatch(staged,/node_modules|bundle/);
});

test('publication refuses to overwrite a newer source branch',async()=>{
 const {repo,change}=await fixture('concurrent');
 const path=await createWorktree(repo,'stale',change.sourceSha,'Stale task');
 await writeFile(join(path,'file.txt'),'stale task\n');await git(path,'add','.');await git(path,'commit','-m','Stale task');
 const sha=await git(path,'rev-parse','HEAD');
 await git(repo.path,'checkout',change.source);await writeFile(join(repo.path,'file.txt'),'newer source\n');
 await git(repo.path,'add','.');await git(repo.path,'commit','-m','Newer source');
 const newer=await revision(repo,change.source);
 await assert.rejects(()=>publishJobBranch(repo,{sourceSha:change.sourceSha} as any,change.source,sha,change),/expected|cannot lock ref/);
 assert.equal(await revision(repo,change.source),newer);
 const user=s.put('users',{role:'owner'});
 const stale=s.put('jobs',{repoId:repo.id,projectId:repo.projectId,authorId:user.id,changeId:change.id,path,sourceSha:change.sourceSha,kind:'implement',status:'queued'});
 await runJob(stale);
 assert.equal(s.get('jobs',stale.id)!.status,'failed');
 assert.match(s.get('jobs',stale.id)!.error,/workspace is behind/);
 assert.equal(await revision(repo,change.source),newer);
});
