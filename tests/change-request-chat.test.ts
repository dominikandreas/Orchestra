import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

const dir=await mkdtemp(join(tmpdir(),'relay-chat-test-'));
process.env.RELAY_DATA_DIR=join(dir,'data');

const store=await import('../src/server/store.js');
const git=await import('../src/server/git.js');
const {createApp}=await import('../src/server/app.js');
const {submitChangeForJob}=await import('../src/server/jobs.js');

let app:any,owner:any,project:any,repo:any,ownerToken:string;

before(async()=>{
  app=await createApp();
  const inv=store.issueInvite(undefined,'owner');
  const r=store.redeemInvite(inv.token,'Owner');
  owner=r.user;
  ownerToken=r.token;
  project=store.put('projects',{name:'Chat Test Project'});
  const source=join(dir,'source');
  await git.command('git',['init','-b','main',source]);
  await git.git(source,'config','user.name','Tests');
  await git.git(source,'config','user.email','tests@example.com');
  await writeFile(join(source,'README.md'),'# Initial\n');
  await git.git(source,'add','.');
  await git.git(source,'commit','-m','initial commit');
  repo=await git.importRepository(source,'Chat Repo',project.id);
});

after(async()=>{
  await app.close();
  store.db.close();
});

const request=(method:string,url:string,token?:string,payload?:any)=>
  app.inject({method,url,headers:token?{authorization:`Bearer ${token}`}:{},payload});

test('open change request task creation with auto branches, default title/kind, and attachments',async()=>{
  const res=await request('POST','/api/jobs',ownerToken,{
    repoId:repo.id,
    prompt:'Build a dark mode toggle button in the header',
    targetBranch:'auto',
    sourceBranch:'auto',
    images:[{type:'image',data:'aGVsbG8=',mimeType:'image/png',name:'screenshot.png'}],
    attachments:[{name:'requirements.txt',data:'Must support system preference',size:31}]
  });

  assert.equal(res.statusCode,200,res.body);
  const job=res.json();
  assert.equal(job.kind,'implement');
  assert.equal(job.title,'Build a dark mode toggle button in the header');
  assert.ok(job.prompt.includes('Build a dark mode toggle button'));
  assert.ok(job.prompt.includes('--- Attachment: requirements.txt ---'));
  assert.equal(job.images.length,1);
  assert.equal(job.images[0].name,'screenshot.png');
  assert.equal(job.attachments.length,1);

  // Check event record
  const evs=store.events(job.id);
  const userEvent=evs.find(e=>e.type==='user');
  assert.ok(userEvent);
  assert.equal(userEvent.data.images.length,1);
  assert.equal(userEvent.data.attachments.length,1);
});

test('submit-change rejects while job is actively running',async()=>{
  const job=store.put('jobs',{
    repoId:repo.id,
    projectId:project.id,
    authorId:owner.id,
    kind:'implement',
    title:'Running job',
    prompt:'Working...',
    status:'running'
  });

  const res=await request('POST',`/api/jobs/${job.id}/submit-change`,ownerToken,{});
  assert.equal(res.statusCode,400);
  assert.match(res.json().error,/running/i);
});

test('submit-change commits worktree changes and creates/links change request',async()=>{
  // Create worktree for job
  const path=await git.createWorktree(repo,'job-workspace-1',repo.base);
  await writeFile(join(path,'feature.js'),'console.log("new feature");\n');

  const job=store.put('jobs',{
    repoId:repo.id,
    projectId:project.id,
    authorId:owner.id,
    kind:'implement',
    title:'Add feature.js',
    prompt:'Add feature',
    path,
    status:'completed'
  });

  const res=await request('POST',`/api/jobs/${job.id}/submit-change`,ownerToken,{});
  assert.equal(res.statusCode,200,res.body);
  const data=res.json();
  assert.ok(data.change);
  assert.ok(data.job);
  assert.equal(data.job.changeId,data.change.id);
  assert.equal(data.change.title,'Add feature.js');
  assert.equal(data.change.status,'open');

  // Verify git state
  const updatedJob=store.get('jobs',job.id);
  assert.ok(updatedJob);
  assert.equal(updatedJob.changeId,data.change.id);
  assert.ok(updatedJob.sourceSha);

  // Submitting again refreshes the change request
  await writeFile(join(path,'feature.js'),'console.log("updated feature");\n');
  const res2=await request('POST',`/api/jobs/${job.id}/submit-change`,ownerToken,{});
  assert.equal(res2.statusCode,200);
  assert.equal(res2.json().change.id,data.change.id);
});

test('comments support image and file attachments',async()=>{
  const path=await git.createWorktree(repo,'comment-cr',repo.base);
  await writeFile(join(path,'test.txt'),'content\n');
  await git.git(path,'add','.');
  await git.git(path,'commit','-m','comment test commit');
  const c=await git.createChange(repo,'relay/comment-cr','main','Comment CR test',owner.id);

  const res=await request('POST',`/api/changes/${c.id}/comment`,ownerToken,{
    text:'Here is the mock design',
    images:[{type:'image',data:'ZGVzaWdu',mimeType:'image/png',name:'mock.png'}],
    attachments:[{name:'spec.json',data:'{"version":1}',size:15}]
  });

  assert.equal(res.statusCode,200,res.body);
  const comment=res.json();
  assert.equal(comment.text,'Here is the mock design');
  assert.equal(comment.images.length,1);
  assert.equal(comment.images[0].name,'mock.png');
  assert.equal(comment.attachments.length,1);
  assert.equal(comment.attachments[0].name,'spec.json');

  // Fetch change detail
  const changeRes=await request('GET',`/api/changes/${c.id}`,ownerToken);
  assert.equal(changeRes.statusCode,200);
  const changeData=changeRes.json();
  const fetchedComment=changeData.comments.find((cm:any)=>cm.id===comment.id);
  assert.ok(fetchedComment);
  assert.equal(fetchedComment.images.length,1);
});
