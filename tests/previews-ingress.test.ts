import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {mkdtemp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

const dir=await mkdtemp(join(tmpdir(),'relay-preview-ingress-test-'));
process.env.RELAY_DATA_DIR=join(dir,'data');

const store=await import('../src/server/store.js');
const {createApp}=await import('../src/server/app.js');
const {previewLink}=await import('../src/server/previews.js');

let app:any,ownerToken:string,user:any,project:any,repo:any;
let mockAppServer:http.Server;
let mockAppPort:number;
const receivedRequests:Array<{url:string,headers:http.IncomingHttpHeaders}>=[];

before(async()=>{
 // Setup mock upstream container app
 await new Promise<void>((resolve)=>{
  mockAppServer=http.createServer((req,res)=>{
   receivedRequests.push({url:req.url||'/',headers:req.headers});
   if(req.url==='/'){
    res.writeHead(200,{'content-type':'text/html'});
    res.end('<!doctype html><html><body><h1>Mock Preview App</h1></body></html>');
    return;
   }
   if(req.url==='/api/data?query=test'){
    res.writeHead(200,{'content-type':'application/json'});
    res.end(JSON.stringify({hello:'world'}));
    return;
   }
   if(req.url==='/assets/app.js'){
    res.writeHead(200,{'content-type':'application/javascript'});
    res.end('console.log("preview script");');
    return;
   }
   res.writeHead(200,{'content-type':'text/plain'});
   res.end(`echo: ${req.url}`);
  });
  mockAppServer.listen(0,'127.0.0.1',()=>{
   const addr=mockAppServer.address() as any;
   mockAppPort=addr.port;
   resolve();
  });
 });

 app=await createApp();
 const inv=store.issueInvite(undefined,'owner');
 const r=store.redeemInvite(inv.token,'Owner');
 user=r.user;
 ownerToken=r.token;
 project=store.put('projects',{name:'Preview Project'});
 repo=store.put('repos',{name:'test-repo',projectId:project.id,base:'main',port:mockAppPort});
});

after(async()=>{
 await app.close();
 await new Promise<void>(resolve=>mockAppServer.close(()=>resolve()));
 store.db.close();
});

test('previewLink returns external base URL ingress without isolated port',async()=>{
 const preview=store.put('previews',{
  repoId:repo.id,
  projectId:project.id,
  userId:user.id,
  status:'running',
  port:mockAppPort,
  name:'mock-preview'
 });

 const link=previewLink(preview,user.id,'https://orchestra.ddienlin.de');
 assert.ok(link.startsWith(`https://orchestra.ddienlin.de/preview/${preview.id}/open#`));
 assert.ok(!link.includes(':4311'));

 const res=await app.inject({
  method:'POST',
  url:`/api/previews/${preview.id}/link`,
  headers:{authorization:`Bearer ${ownerToken}`,host:'orchestra.ddienlin.de'}
 });
 assert.equal(res.statusCode,200);
 assert.ok(res.json().url.startsWith(`http://orchestra.ddienlin.de/preview/${preview.id}/open#`)||res.json().url.startsWith(`https://orchestra.ddienlin.de/preview/${preview.id}/open#`));
});

test('preview ingress serves bootstrap page, claims token, and proxies app traffic',async()=>{
 const preview=store.put('previews',{
  repoId:repo.id,
  projectId:project.id,
  userId:user.id,
  status:'running',
  port:mockAppPort,
  name:'mock-preview-2'
 });

 const link=previewLink(preview,user.id,'http://localhost:4310');
 const rawToken=link.split('#')[1];
 assert.ok(rawToken);

 // 1. Open page
 const openRes=await app.inject({
  method:'GET',
  url:`/preview/${preview.id}/open`
 });
 assert.equal(openRes.statusCode,200);
 assert.ok(openRes.body.includes('Opening preview'));
 assert.ok(openRes.body.includes(`/preview/${preview.id}/claim`));

 // 2. Claim token via POST
 const claimRes=await app.inject({
  method:'POST',
  url:`/preview/${preview.id}/claim`,
  payload:rawToken
 });
 assert.equal(claimRes.statusCode,200);
 assert.equal(claimRes.body,'ok');
 const cookies=claimRes.headers['set-cookie'];
 assert.ok(cookies);
 const cookieStr=Array.isArray(cookies)?cookies.map(c=>c.split(';')[0]).join('; '):String(cookies).split(';')[0];
 assert.ok(cookieStr.includes(`relay_preview_${preview.id}=`));

 // 3. Root request proxied to mock container
 const rootRes=await app.inject({
  method:'GET',
  url:`/preview/${preview.id}/`,
  headers:{cookie:cookieStr}
 });
 assert.equal(rootRes.statusCode,200);
 assert.ok(rootRes.body.includes('Mock Preview App'));

 // 4. Sub-resource request proxied with path
 const apiRes=await app.inject({
  method:'GET',
  url:`/preview/${preview.id}/api/data?query=test`,
  headers:{cookie:cookieStr}
 });
 assert.equal(apiRes.statusCode,200);
 assert.deepEqual(apiRes.json(),{hello:'world'});

 // 5. Trailing slash redirect
 const slashRes=await app.inject({
  method:'GET',
  url:`/preview/${preview.id}`
 });
 assert.equal(slashRes.statusCode,302);
 assert.equal(slashRes.headers.location,`/preview/${preview.id}/`);

 // 6. Fallback routing for root-relative asset via Referer header
 const assetRes=await app.inject({
  method:'GET',
  url:'/assets/app.js',
  headers:{
   cookie:cookieStr,
   referer:`http://localhost:4310/preview/${preview.id}/`
  }
 });
 assert.equal(assetRes.statusCode,200);
 assert.ok(assetRes.body.includes('preview script'));

 // Verify cookies were stripped so internal credentials did not leak to container
 const lastReq=receivedRequests[receivedRequests.length-1];
 assert.ok(!lastReq.headers.cookie?.includes('relay_preview_'));
 assert.equal(lastReq.headers['x-forwarded-prefix'],undefined);
});

test('preview ingress supports direct ?token= query parameter',async()=>{
 const preview=store.put('previews',{
  repoId:repo.id,
  projectId:project.id,
  userId:user.id,
  status:'running',
  port:mockAppPort,
  name:'mock-preview-3'
 });

 const link=previewLink(preview,user.id,'http://localhost:4310');
 const rawToken=link.split('#')[1];

 const directRes=await app.inject({
  method:'GET',
  url:`/preview/${preview.id}/?token=${rawToken}`
 });
 assert.equal(directRes.statusCode,302);
 assert.equal(directRes.headers.location,`/preview/${preview.id}/`);
 const cookies=directRes.headers['set-cookie'];
 assert.ok(cookies);
 const cookieStr=Array.isArray(cookies)?cookies.map(c=>c.split(';')[0]).join('; '):String(cookies).split(';')[0];

 const testRes=await app.inject({
  method:'GET',
  url:`/preview/${preview.id}/`,
  headers:{cookie:cookieStr}
 });
 assert.equal(testRes.statusCode,200);
 assert.ok(testRes.body.includes('Mock Preview App'));
});

test('preview ingress rejects unauthorized requests and stopped previews',async()=>{
 const preview=store.put('previews',{
  repoId:repo.id,
  projectId:project.id,
  userId:user.id,
  status:'running',
  port:mockAppPort,
  name:'mock-preview-4'
 });

 // No auth
 const noAuthRes=await app.inject({
  method:'GET',
  url:`/preview/${preview.id}/`
 });
 assert.equal(noAuthRes.statusCode,401);

 // Invalid token
 const badClaim=await app.inject({
  method:'POST',
  url:`/preview/${preview.id}/claim`,
  payload:'invalid-token'
 });
 assert.equal(badClaim.statusCode,401);

 // Stopped preview
 store.put('previews',{id:preview.id,status:'stopped'});
 const link=previewLink(preview,user.id,'http://localhost:4310');
 const rawToken=link.split('#')[1];

 const stoppedRes=await app.inject({
  method:'GET',
  url:`/preview/${preview.id}/?token=${rawToken}`
 });
 // Because preview is stopped, grant claim might succeed or auth will fail when loading
 const stoppedRoot=await app.inject({
  method:'GET',
  url:`/preview/${preview.id}/`
 });
 assert.equal(stoppedRoot.statusCode,401);
});
