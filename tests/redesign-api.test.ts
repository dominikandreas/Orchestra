import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import type {Row} from '../src/server/store.js';

// Isolation must precede ALL server imports: store initializes SQLite on import.
const root=await mkdtemp(join(tmpdir(),'orchestra-redesign-api-'));
process.env.RELAY_DATA_DIR=join(root,'data');
process.env.ORCHESTRA_DATA_DIR=process.env.RELAY_DATA_DIR;
delete process.env.RELAY_TLS_CERT;delete process.env.RELAY_TLS_KEY;
const s=await import('../src/server/store.js');
const g=await import('../src/server/git.js');
const metadata=await import('../src/server/project-metadata.js');
const {createApp}=await import('../src/server/app.js');
const project=s.put('projects',{name:'Independent knowledge'});
const codeProject=s.put('projects',{name:'Code project'});
const other=s.put('projects',{name:'Other project'});
const account=(role:string,projects:string[])=>s.redeemInvite(s.issueInvite(undefined,role,projects).token,role);
const operator=account('operator',[project.id,codeProject.id]);
const colleague=account('operator',[project.id,codeProject.id]);
const viewer=account('viewer',[project.id,codeProject.id]);
const outsider=account('operator',[other.id]);
let app:Awaited<ReturnType<typeof createApp>>,repo:Row,change:Row;
const request=(method:string,path:string,who=operator,payload?:unknown)=>app.inject({method:method as any,url:'/api'+path,headers:{authorization:'Bearer '+who.token},payload:payload as any});
const ok=(r:any)=>{assert.equal(r.statusCode,200,r.body);return r.json();};
const refused=(r:any)=>assert.ok(r.statusCode>=400&&r.statusCode<500,`${r.statusCode}: ${r.body}`);
const detail=async()=>ok(await request('GET',`/changes/${change.id}`));
before(async()=>{
 const source=join(root,'source');await g.command('git',['init','-b','main',source]);
 await g.git(source,'config','user.name','Regression fixture');await g.git(source,'config','user.email','test@example.invalid');
 await writeFile(join(source,'hello.ts'),'export const greeting = "before";\nexport const keep = true;\n');
 await writeFile(join(source,'notes with spaces.md'),'# Base\n');
 await g.git(source,'add','.');await g.git(source,'commit','-m','base');
 await g.git(source,'checkout','-b','candidate');
 await writeFile(join(source,'hello.ts'),'export const greeting = "after";\nexport const keep = true;\nexport const added = 42;\n');
 await writeFile(join(source,'notes with spaces.md'),'# Updated\n');
 await g.git(source,'add','.');await g.git(source,'commit','-m','candidate');await g.git(source,'checkout','main');
 repo=await g.importRepository(source,'Fixture code',codeProject.id,'main');
 change=await g.createChange(repo,'candidate','main','Regression change',operator.user.id);
 app=await createApp();await app.ready();
});
after(async()=>{await app?.close();s.db.close();await rm(root,{recursive:true,force:true});});

test('knowledge works without a code repository, versions writes and enforces project/operator access',async()=>{
 const path=`/projects/${project.id}/knowledge`;
 assert.equal(s.all('repos').filter(r=>r.projectId===project.id).length,0);
 const initial=ok(await request('GET',path));assert.equal(initial.projectId,project.id);assert.match(initial.revision,/^[a-f0-9]{40,64}$/);assert.ok(initial.files.some((f:any)=>f.path==='knowledge.md'));
 const content='# Decisions\n\nLiteral <script> and Unicode: café.\n';
 const saved=ok(await request('PUT',path,operator,{path:'decisions/architecture.md',content}));
 assert.notEqual(saved.revision,initial.revision);
 const read=ok(await request('GET',path,viewer));assert.equal(read.files.find((f:any)=>f.path==='decisions/architecture.md')?.content,content);
 const historical=await metadata.readProjectMetadata(project.id,initial.revision);
 assert.equal(historical.metadata.files?.['decisions/architecture.md'],undefined);
 const current=await metadata.readProjectMetadata(project.id,read.revision);
 assert.equal(current.metadata.files?.['decisions/architecture.md'],content);
 const history=ok(await request('GET',path+'/history',viewer));assert.ok(history.history.some((h:any)=>h.revision===initial.revision));assert.ok(history.history.some((h:any)=>h.revision===read.revision));
 assert.equal(ok(await request('GET',path+'/revision/'+read.revision,viewer)).metadata.files['decisions/architecture.md'],content);
 refused(await request('PUT',path,operator,{path:'decisions/architecture.md',content:'stale overwrite',revision:initial.revision}));
 refused(await request('PUT',path,viewer,{path:'decisions/architecture.md',content:'viewer overwrite'}));
 refused(await request('GET',path,outsider));refused(await request('PUT',path,outsider,{path:'private.md',content:'no'}));
 for(const invalid of ['../escape.md','/absolute.md','a/../escape.md','.git/config','a\\b.md'])refused(await request('PUT',path,operator,{path:invalid,content:'no'}));
 const final=ok(await request('GET',path));assert.equal(final.revision,read.revision);assert.equal(s.all('repos').filter(r=>r.projectId===project.id).length,0);
});

test('old/new inline anchors persist both revisions; invalid and stale anchors never write comments',async()=>{
 const path=`/changes/${change.id}/comment`,c=await detail();
 const anchor={file:'hello.ts',sourceSha:c.sourceSha,targetSha:c.targetSha};
 for(const [side,line] of [['old',1],['new',3]] as const){
  const text=`${side} anchored regression`,saved=ok(await request('POST',path,operator,{...anchor,side,line,text}));
  assert.equal(saved.side,side);assert.equal(saved.line,line);assert.equal(saved.file,'hello.ts');assert.equal(saved.sourceSha,c.sourceSha);assert.equal(saved.targetSha,c.targetSha);
  const persisted=(await detail()).comments.find((x:any)=>x.id===saved.id);assert.equal(persisted.side,side);assert.equal(persisted.targetSha,c.targetSha);
 }
 const invalid=[{side:'left',line:1},{side:'new',line:9999},{side:'old',line:3},{side:'new',line:0},{side:'new',line:3,file:'missing.ts'},{side:'new',line:3,sourceSha:'0'.repeat(40)},{side:'old',line:1,targetSha:'0'.repeat(40)}];
 const count=(await detail()).comments.length;
 for(const patch of invalid)refused(await request('POST',path,operator,{...anchor,...patch,text:'must not persist'}));
 refused(await request('POST',path,viewer,{...anchor,side:'new',line:3,text:'viewer denied'}));
 refused(await request('POST',path,outsider,{...anchor,side:'new',line:3,text:'outsider denied'}));
 assert.equal((await detail()).comments.length,count);
 // A ref can move before detail polling updates the stored change. Reject both that
 // race and an explicit old client anchor after the detail has refreshed.
 const tree=await g.git(repo.path,'rev-parse',`${c.sourceSha}^{tree}`);
 const advanced=await g.git(repo.path,'-c','user.name=QA','-c','user.email=qa@example.invalid','commit-tree',tree.trim(),'-p',c.sourceSha,'-m','advance revision');
 try{
  await g.git(repo.path,'update-ref',`refs/heads/${change.source}`,advanced.trim(),c.sourceSha);
  refused(await request('POST',path,operator,{...anchor,side:'new',line:3,text:'race must fail'}));
  assert.notEqual((await detail()).sourceSha,c.sourceSha);
  refused(await request('POST',path,operator,{...anchor,side:'new',line:3,text:'stale client must fail'}));
  assert.equal((await detail()).comments.length,count);
 }finally{await g.git(repo.path,'update-ref',`refs/heads/${change.source}`,c.sourceSha);await detail();}
 // Legacy general discussion remains unanchored and usable.
 const general=ok(await request('POST',path,operator,{text:'General discussion'}));assert.equal(general.file,undefined);assert.equal(general.line,undefined);
});

test('structured file manifest and lazy patches expose exact revisions, paths and side lines',async()=>{
 const path=`/changes/${change.id}`,c=await detail();
 const manifest=ok(await request('GET',path+'/files?limit=1',viewer));
 assert.equal(manifest.sourceSha,c.sourceSha);assert.equal(manifest.targetSha,c.targetSha);assert.equal(manifest.files.length,1);assert.equal(manifest.hasMore,true);
 const next=ok(await request('GET',path+'/files?offset=1&limit=1'));assert.equal(next.files.length,1);assert.notEqual(next.files[0].path,manifest.files[0].path);
 for(const file of ['hello.ts','notes with spaces.md']){
  const patch=ok(await request('GET',path+'/file?path='+encodeURIComponent(file),viewer));assert.equal(patch.file.path,file);assert.equal(patch.sourceSha,c.sourceSha);assert.ok(patch.hunks.length);
 }
 const patch=ok(await request('GET',path+'/file?path=hello.ts'));
 assert.ok(patch.hunks.flatMap((h:any)=>h.lines).some((l:any)=>l.oldLine===1));assert.ok(patch.hunks.flatMap((h:any)=>h.lines).some((l:any)=>l.newLine===3));
 refused(await request('GET',path+'/files',outsider));refused(await request('GET',path+'/file?path=hello.ts',outsider));
 refused(await request('GET',path+'/file?path=missing.ts'));refused(await request('GET',path+'/files?limit=501'));
 const lightweight=ok(await request('GET',path+'?includeDiff=false'));assert.equal(lightweight.diff,undefined);assert.ok(Array.isArray(lightweight.comments));
});

test('createApp registers canonical project/change conversations with shared threads and scoped access',async()=>{
 const projectPath=`/projects/${codeProject.id}/conversation`,changePath=`/changes/${change.id}/conversation`;
 const p=ok(await request('GET',projectPath)),c=ok(await request('GET',changePath));
 assert.ok(p.thread.id);assert.ok(c.thread.id);assert.notEqual(p.thread.id,c.thread.id);
 for(const path of [projectPath,changePath]){
  const first=ok(await request('GET',path));assert.equal(ok(await request('GET',path,colleague)).thread.id,first.thread.id);assert.equal(ok(await request('GET',path,viewer)).thread.id,first.thread.id);
  assert.ok(Array.isArray(first.messages));assert.ok(Array.isArray(first.runs));
  refused(await request('GET',path,outsider));refused(await request('POST',path,viewer,{message:'no',connectionId:'fixture',model:'fixture'}));refused(await request('POST',path+'/stop',viewer,{}));
 }
 assert.equal((await app.inject({url:'/api'+projectPath})).statusCode,401);
 assert.equal(s.all('projectRuns').length,0,'smoke must never launch a coordinator');
});

test('createApp registers pipeline read/start/stop routes without executing jobs',async()=>{
 const path=`/changes/${change.id}/pipeline`;
 assert.equal(ok(await request('GET',path,viewer)).pipeline,null);
 refused(await request('GET',path,outsider));refused(await request('POST',path,viewer,{}));
 const started=ok(await request('POST',path,operator,{}));assert.equal(started.status,'running');assert.equal(started.stage,'design');assert.equal(started.changeId,change.id);
 assert.equal(ok(await request('GET',path,colleague)).pipeline.id,started.id);
 refused(await request('POST',path,operator,{}));refused(await request('POST',path+'/stop',viewer,{}));
 assert.equal(ok(await request('POST',path+'/stop',colleague,{})).status,'stopped');
 assert.equal(ok(await request('GET',path)).pipeline.status,'stopped');assert.equal(s.all('jobs').length,0,'createApp must not run the pipeline queue');
});
