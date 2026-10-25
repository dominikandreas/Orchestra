import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, mkdir, rm, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
const root=await mkdtemp(join(tmpdir(),'orchestra-backend-'));
process.env.RELAY_DATA_DIR=join(root,'data');
const g=await import('../src/server/git.js');
const store=await import('../src/server/store.js');
const d=await import('../src/server/structured-diff.js');
const m=await import('../src/server/project-metadata.js');
const {gitOutput}=await import('../src/server/git-process.js');
after(async()=>{store.db.close();await rm(root,{recursive:true,force:true});});
async function repository(name:string){
 const path=join(root,name);await mkdir(path);
 await g.git(path,'init','-b','main');await g.git(path,'config','user.name','Test');await g.git(path,'config','user.email','test@localhost');
 await writeFile(join(path,'hello.txt'),'one\ntwo\nthree\n');await commit(path,'initial');
 return store.put('repos',{path,base:'main',projectId:'project'});
}
async function commit(path:string,message:string){await g.git(path,'add','-A');await g.git(path,'commit','-m',message);return g.git(path,'rev-parse','HEAD');}

test('refresh distinguishes clean merges, actual conflicts, and operational errors without persisting false conflicts',async()=>{
 const repo=await repository('conflicts');await g.git(repo.path,'checkout','-b','feature');
 await writeFile(join(repo.path,'hello.txt'),'feature\n');await commit(repo.path,'feature');
 await g.git(repo.path,'checkout','main');
 const change=await g.createChange(repo,'feature','main','Feature','user');
 assert.equal((await g.refreshChange(change)).conflict,false);
 await writeFile(join(repo.path,'hello.txt'),'main\n');await commit(repo.path,'main');
 assert.equal((await g.refreshChange(change)).conflict,true);
 await g.git(repo.path,'checkout','--orphan','unrelated');await g.git(repo.path,'rm','-rf','.');await writeFile(join(repo.path,'new.txt'),'unrelated');await commit(repo.path,'unrelated');
 const unrelated=await g.createChange(repo,'unrelated','main','Unrelated','user');
 await assert.rejects(()=>g.refreshChange(unrelated),/unrelated histories/);
 assert.equal(store.get('changes',unrelated.id)?.conflict,undefined);
 await assert.rejects(()=>g.mergeConflict(repo,'0'.repeat(40),change.sourceSha));
 await assert.rejects(()=>g.refreshChange({...change,source:'missing'}));
});

test('optional titles create safe meaningful names; existing worktree callers retain exact branch names',async()=>{
 const repo=await repository('worktrees');
 const legacy=await g.createWorktree(repo,'legacy',repo.base);
 assert.equal(await g.git(legacy,'branch','--show-current'),'relay/legacy');
 const path=await g.createWorktree(repo,'task-123',repo.base,'Fix Café / login: [urgent]');
 assert.equal(await g.git(path,'branch','--show-current'),'relay/fix-cafe-login-urgent-task-123');
 assert.equal(g.worktreeBranchName('task-123','💥'),'relay/task-123');
 assert.throws(()=>g.worktreeBranchName('../escape','Bad'),/Invalid/);
 assert.notEqual(g.worktreeBranchName('one','Same'),g.worktreeBranchName('two','Same'));
 await writeFile(join(path,'untracked'),'temporary');
 const recreated=await g.createWorktree(repo,'task-123',repo.base,'Fix Café / login: [urgent]');
 assert.equal(await g.git(recreated,'branch','--show-current'),'relay/fix-cafe-login-urgent-task-123');
});

test('structured diffs navigate hunks, renamed and unusual filenames, hidden files, binary files, and limits',async()=>{
 const repo=await repository('diff');
 await writeFile(join(repo.path,'rename.txt'),'unchanged content\n');await writeFile(join(repo.path,'delete.txt'),'delete\n');await commit(repo.path,'base');
 const base=await g.git(repo.path,'rev-parse','HEAD');await g.git(repo.path,'checkout','-b','feature');
 await writeFile(join(repo.path,'hello.txt'),'one\nTWO\nthree\n');
 await g.git(repo.path,'mv','rename.txt','renamed.txt');await rm(join(repo.path,'delete.txt'));
 for(const dir of ['node_modules/pkg','dist','src'])await mkdir(join(repo.path,dir),{recursive:true});
 await writeFile(join(repo.path,'node_modules/pkg/index.js'),'dependency\n');await writeFile(join(repo.path,'dist/app.js'),'generated\n');
 await writeFile(join(repo.path,'package-lock.json'),'{}\n');
 await writeFile(join(repo.path,'src/odd\tname\n.txt'),'odd\n');
 await writeFile(join(repo.path,'binary.dat'),Buffer.from([0,1,2,3]));
 await writeFile(join(repo.path,'large.txt'),'x'.repeat(d.MAX_DIFF_FILE_BYTES+1));
 await writeFile(join(repo.path,'expanded.txt'),('short line\n').repeat(30000));
 const head=await commit(repo.path,'changes');
 const summary=await d.structuredDiff(repo,base,head);
 assert.equal(summary.counts.total,10);assert.equal(summary.counts.hidden,3);assert.equal(summary.counts.returned,7);
 assert.ok(summary.files.every(f=>!f.hidden));
 const all=await d.structuredDiff(repo,base,head,{includeHidden:true,limit:2});assert.equal(all.counts.matching,10);assert.equal(all.files.length,2);assert.equal(all.hasMore,true);
 assert.equal((await d.structuredDiff(repo,base,head,{includeHidden:true,offset:2,limit:2})).files.length,2);
 await assert.rejects(()=>d.structuredDiff(repo,base,head,{limit:NaN}),/pagination/);
 const content=await d.structuredFileDiff(repo,base,head,'hello.txt');
 assert.equal(content.file.additions,1);assert.equal(content.file.deletions,1);
 assert.deepEqual(content.hunks[0].lines.find(l=>l.kind==='addition'),{kind:'addition',text:'TWO',oldLine:null,newLine:2});
 assert.equal(content.hunks[0].lines.find(l=>l.kind==='deletion')?.oldLine,2);
 assert.equal((await d.structuredFileDiff(repo,base,head,'renamed.txt')).file.oldPath,'rename.txt');
 assert.equal((await d.structuredFileDiff(repo,base,head,'src/odd\tname\n.txt')).hunks.length,1);
 assert.equal((await d.structuredFileDiff(repo,base,head,'delete.txt')).file.deletions,1);
 assert.equal((await d.structuredFileDiff(repo,base,head,'binary.dat')).file.binary,true);
 assert.equal((await d.structuredFileDiff(repo,base,head,'dist/app.js')).patch,'');
 assert.ok((await d.structuredFileDiff(repo,base,head,'dist/app.js',{includeHidden:true})).patch.includes('generated'));
 assert.equal((await d.structuredFileDiff(repo,base,head,'large.txt')).tooLarge,true);
 assert.equal((await d.structuredFileDiff(repo,base,head,'expanded.txt')).tooLarge,true);
 const change={id:'diff-change',created:'',updated:'',repoId:repo.id,targetSha:base,sourceSha:head};
 const raw=await g.diffChange(change);assert.ok(!raw.includes('node_modules/pkg/index.js'));assert.ok(!raw.includes('dist/app.js'));
 const full=await g.diffChange(change,{includeGenerated:true});assert.ok(full.includes('node_modules/pkg/index.js'));assert.ok(full.includes('dist/app.js'));
 await assert.rejects(()=>d.structuredFileDiff(repo,base,head,':(glob)**'));
 await assert.rejects(()=>gitOutput(repo.path,['show',`${head}:large.txt`],20),/size limit/);
 assert.equal(await gitOutput(repo.path,['show',`${head}:hello.txt`]),'one\nTWO\nthree\n');
});

test('project knowledge is independent, versioned, bounded, and protected against stale updates',async()=>{
 const initial=await m.createProjectMetadata('standalone',{name:'No code repository',knowledge:'First knowledge\n'});
 assert.equal(store.all('repos').some(r=>r.projectId==='standalone'),false);
 assert.equal(initial.metadata.description,'');
 const updated=await m.updateProjectMetadata('standalone',{knowledge:'New knowledge\n',description:'Project only'},initial.revision);
 assert.notEqual(initial.revision,updated.revision);
 assert.equal((await m.readProjectMetadata('standalone',initial.revision)).metadata.knowledge,'First knowledge\n');
 assert.equal((await m.readProjectMetadata('standalone')).metadata.knowledge,'New knowledge\n');
 assert.equal((await m.projectMetadataHistory('standalone')).length,2);
 assert.equal((await m.updateProjectMetadata('standalone',{},updated.revision)).revision,updated.revision);
 await assert.rejects(()=>m.updateProjectMetadata('standalone',{name:'Lost edit'},initial.revision),/changed/);
 await assert.rejects(()=>m.updateProjectMetadata('standalone',{knowledge:'x'.repeat(m.MAX_PROJECT_METADATA_BYTES)},updated.revision),/size limit/);
 await assert.rejects(()=>m.createProjectMetadata('standalone',{name:'Duplicate'}),/already exists/);
 await assert.rejects(()=>m.createProjectMetadata('../escape',{name:'Invalid'}),/Invalid/);
 await assert.rejects(()=>m.updateProjectMetadata('standalone',{knowledge:undefined},updated.revision),/Invalid/);
 const outcomes=await Promise.allSettled([m.updateProjectMetadata('standalone',{knowledge:'Concurrent one'},updated.revision),m.updateProjectMetadata('standalone',{knowledge:'Concurrent two'},updated.revision)]);
 assert.equal(outcomes.filter(r=>r.status==='fulfilled').length,1);
 assert.equal((await m.projectMetadataHistory('standalone')).length,3);
 assert.ok((await readFile(join(m.projectMetadataPath('standalone'),'project.json'),'utf8')).includes('Concurrent'));
 const project={id:'files-project',name:'Knowledge files'};
 assert.equal((await g.projectKnowledge(project)).files[0].path,'knowledge.md');
 await g.saveProjectKnowledge(project,'docs/design.md','Design knowledge','editor');
 assert.equal((await g.projectKnowledge(project)).files.find(f=>f.path==='docs/design.md')?.content,'Design knowledge');
 for(const path of ['../escape','/absolute','a/../b','.git/config','a\\b','a\0b'])await assert.rejects(()=>g.saveProjectKnowledge(project,path,'unsafe'),/Invalid knowledge path/);
 assert.equal((await m.projectMetadataHistory(project.id)).length,2);
});
