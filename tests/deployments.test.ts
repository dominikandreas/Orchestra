import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {mkdtemp,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

const dir=await mkdtemp(join(tmpdir(),'relay-deployments-test-'));
process.env.RELAY_DATA_DIR=join(dir,'data');

const store=await import('../src/server/store.js');
const git=await import('../src/server/git.js');
const {createApp}=await import('../src/server/app.js');
const {
  deploymentLink,
  previewLink,
  migratePreviewsToDeployments,
  notifyBranchUpdated,
  updateDeployment,
  configureDeployment,
  removeDeployment,
  cleanupStoppedDeployments
}=await import('../src/server/deployments.js');

let app:any,ownerToken:string,user:any,project:any,repo:any,sourcePath:string;
let mockServer:http.Server;
let mockPort:number;

before(async()=>{
  await new Promise<void>((resolve)=>{
    mockServer=http.createServer((req,res)=>{
      if(req.url==='/'){
        res.writeHead(200,{'content-type':'text/html'});
        res.end('<h1>Mock App Running</h1>');
        return;
      }
      res.writeHead(200,{'content-type':'text/plain'});
      res.end(`echo: ${req.url}`);
    });
    mockServer.listen(0,'127.0.0.1',()=>{
      mockPort=(mockServer.address() as any).port;
      resolve();
    });
  });

  app=await createApp();
  const inv=store.issueInvite(undefined,'owner');
  const r=store.redeemInvite(inv.token,'Deployment Owner');
  user=r.user;
  ownerToken=r.token;
  project=store.put('projects',{name:'Deployments Project'});

  sourcePath=join(dir,'repo-src');
  await git.command('git',['init','-b','main',sourcePath]);
  await git.git(sourcePath,'config','user.name','Deployer');
  await git.git(sourcePath,'config','user.email','deployer@example.com');
  await writeFile(join(sourcePath,'app.txt'),'version 1\n');
  await git.git(sourcePath,'add','.');
  await git.git(sourcePath,'commit','-m','initial commit');

  // Create another branch: feature-v2
  await git.git(sourcePath,'checkout','-b','feature-v2');
  await writeFile(join(sourcePath,'app.txt'),'version 2\n');
  await git.git(sourcePath,'add','.');
  await git.git(sourcePath,'commit','-m','feature commit');
  await git.git(sourcePath,'checkout','main');

  repo=await git.importRepository(sourcePath,'deployment-repo',project.id);
  repo=store.put('repos',{
    id:repo.id,
    port:mockPort,
    previewCommand:'echo ready'
  });
});

after(async()=>{
  await app.close();
  await new Promise<void>(resolve=>mockServer.close(()=>resolve()));
  store.db.close();
});

test('migratePreviewsToDeployments copies legacy previews to deployments table with branch info',async()=>{
  const p=store.put('previews',{
    repoId:repo.id,
    projectId:project.id,
    userId:user.id,
    status:'stopped',
    name:'legacy-preview'
  });

  migratePreviewsToDeployments();

  const migrated=store.get('deployments',p.id);
  assert.ok(migrated);
  assert.equal(migrated.repoId,repo.id);
  assert.equal(migrated.branch,'main');
  assert.equal(store.get('previews',p.id),undefined);
});

test('deploymentLink returns external URL with /deployment/ prefix and previewLink uses /preview/ prefix',async()=>{
  const d=store.put('deployments',{
    repoId:repo.id,
    projectId:project.id,
    userId:user.id,
    branch:'feature-v2',
    status:'running',
    port:mockPort,
    name:'mock-deploy'
  });

  const dLink=deploymentLink(d,user.id,'https://orchestra.example.com');
  assert.ok(dLink.startsWith(`https://orchestra.example.com/deployment/${d.id}/open#`));

  const pLink=previewLink(d,user.id,'https://orchestra.example.com');
  assert.ok(pLink.startsWith(`https://orchestra.example.com/preview/${d.id}/open#`));

  const linkRes=await app.inject({
    method:'POST',
    url:`/api/deployments/${d.id}/link`,
    headers:{authorization:`Bearer ${ownerToken}`,host:'orchestra.example.com'}
  });
  assert.equal(linkRes.statusCode,200);
  assert.ok(linkRes.json().url.includes(`/deployment/${d.id}/open#`));
});

test('deployment ingress supports claim, cookie auth, and proxying under /deployment/:id/',async()=>{
  const d=store.put('deployments',{
    repoId:repo.id,
    projectId:project.id,
    userId:user.id,
    branch:'main',
    status:'running',
    port:mockPort,
    name:'mock-ingress-deploy'
  });

  const link=deploymentLink(d,user.id,'http://localhost:4310');
  const token=link.split('#')[1];
  assert.ok(token);

  // 1. Open page
  const openRes=await app.inject({
    method:'GET',
    url:`/deployment/${d.id}/open`
  });
  assert.equal(openRes.statusCode,200);
  assert.ok(openRes.body.includes('Opening deployment'));
  assert.ok(openRes.body.includes(`/deployment/${d.id}/claim`));

  // 2. Claim token via POST
  const claimRes=await app.inject({
    method:'POST',
    url:`/deployment/${d.id}/claim`,
    payload:token
  });
  assert.equal(claimRes.statusCode,200);
  assert.equal(claimRes.body,'ok');
  const cookies=claimRes.headers['set-cookie'];
  assert.ok(cookies);
  const cookieStr=Array.isArray(cookies)?cookies.map((c:string)=>c.split(';')[0]).join('; '):String(cookies).split(';')[0];
  assert.ok(cookieStr.includes(`relay_deployment_${d.id}=`));

  // 3. Proxied request
  const rootRes=await app.inject({
    method:'GET',
    url:`/deployment/${d.id}/`,
    headers:{cookie:cookieStr}
  });
  assert.equal(rootRes.statusCode,200);
  assert.ok(rootRes.body.includes('Mock App Running'));
});

test('deployments track specific branch and auto-update worktree when branch SHA updates',async()=>{
  const initialSha=await git.revision(repo,'feature-v2');
  const wtPath=await git.createWorktree(repo,`test-deploy-wt-${Date.now()}`,'feature-v2');

  const d=store.put('deployments',{
    repoId:repo.id,
    projectId:project.id,
    userId:user.id,
    branch:'feature-v2',
    sha:initialSha,
    status:'running',
    port:mockPort,
    path:wtPath,
    name:undefined // No Docker container to kill in mock test
  });

  // Verify initial worktree contents
  assert.equal(await (await import('node:fs/promises')).readFile(join(wtPath,'app.txt'),'utf8'),'version 2\n');

  // Push a new commit to feature-v2
  await git.git(sourcePath,'checkout','feature-v2');
  await writeFile(join(sourcePath,'app.txt'),'version 2 - updated dynamically\n');
  await git.git(sourcePath,'add','.');
  await git.git(sourcePath,'commit','-m','feature-v2 commit 2');
  const newSha=await git.git(sourcePath,'rev-parse','HEAD');

  // Fetch updated feature-v2 commit from source into repo
  await git.git(repo.path,'fetch',sourcePath,'+refs/heads/feature-v2:refs/heads/feature-v2');
  assert.equal(await git.revision(repo,'feature-v2'),newSha);

  // Trigger branch update notification
  notifyBranchUpdated(repo.id,'feature-v2');

  // Let async updateDeployment execute
  for(let i=0;i<20;i++){
    const updated=store.get('deployments',d.id);
    if(updated?.sha===newSha)break;
    await new Promise(r=>setTimeout(r,100));
  }

  // Verify deployment record SHA was updated
  const updated=store.get('deployments',d.id);
  assert.equal(updated?.sha,newSha);

  // Verify worktree file was reset to the new commit automatically
  assert.equal(await (await import('node:fs/promises')).readFile(join(wtPath,'app.txt'),'utf8'),'version 2 - updated dynamically\n');

  // Clean up worktree
  await git.git(repo.path,'worktree','remove','--force',wtPath).catch(()=>{});
});

test('configureDeployment allows changing customName, branch and lifetimeMinutes', async () => {
  const dep = store.put('deployments', {
    repoId: repo.id,
    projectId: project.id,
    userId: user.id,
    branch: 'main',
    status: 'stopped',
    lifetimeMinutes: 30
  });

  // Configure customName and infinite lifetime (0) via direct function
  const configured = await configureDeployment(dep.id, {
    customName: 'My Staging Server',
    lifetimeMinutes: 0
  });

  assert.equal(configured?.customName, 'My Staging Server');
  assert.equal(configured?.lifetimeMinutes, 0);

  // Configure branch via HTTP PATCH endpoint
  const res = await app.inject({
    method: 'PATCH',
    url: `/api/deployments/${dep.id}`,
    headers: { authorization: `Bearer ${ownerToken}` },
    payload: {
      branch: 'feature-v2',
      lifetimeMinutes: 1440
    }
  });

  assert.equal(res.statusCode, 200);
  const body = JSON.parse(res.body);
  assert.equal(body.branch, 'feature-v2');
  assert.equal(body.lifetimeMinutes, 1440);
  assert.equal(body.customName, 'My Staging Server');
});

test('removeDeployment and DELETE /api/deployments/:id deletes deployment record', async () => {
  const dep = store.put('deployments', {
    repoId: repo.id,
    projectId: project.id,
    userId: user.id,
    branch: 'main',
    status: 'stopped'
  });

  const res = await app.inject({
    method: 'DELETE',
    url: `/api/deployments/${dep.id}`,
    headers: { authorization: `Bearer ${ownerToken}` }
  });

  assert.equal(res.statusCode, 200);
  assert.equal(store.get('deployments', dep.id), undefined);
});

test('cleanupStoppedDeployments removes stopped/failed deployments and preserves running ones', async () => {
  const d1 = store.put('deployments', {
    repoId: repo.id,
    projectId: project.id,
    status: 'stopped',
    branch: 'main'
  });
  const d2 = store.put('deployments', {
    repoId: repo.id,
    projectId: project.id,
    status: 'failed',
    branch: 'main'
  });
  const d3 = store.put('deployments', {
    repoId: repo.id,
    projectId: project.id,
    status: 'running',
    branch: 'main'
  });

  const res = await app.inject({
    method: 'POST',
    url: '/api/deployments/cleanup',
    headers: { authorization: `Bearer ${ownerToken}` },
    payload: { projectId: project.id }
  });

  assert.equal(res.statusCode, 200);
  const body = JSON.parse(res.body);
  assert.equal(body.removed >= 2, true);

  assert.equal(store.get('deployments', d1.id), undefined);
  assert.equal(store.get('deployments', d2.id), undefined);
  assert.ok(store.get('deployments', d3.id)); // running preserved
});
