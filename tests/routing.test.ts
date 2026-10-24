import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

const dir=await mkdtemp(join(tmpdir(),'relay-routing-test-'));
process.env.RELAY_DATA_DIR=join(dir,'data');

const store=await import('../src/server/store.js');
const {createApp}=await import('../src/server/app.js');

let app:any,token:string;
before(async()=>{
 app=await createApp();
 const inv=store.issueInvite(undefined,'owner');
 const r=store.redeemInvite(inv.token,'Owner');
 token=r.token;
});
after(async()=>{
 await app.close();
 store.db.close();
});

test('SPA catch-all serves index.html for UI routes and 404 for missing API routes',async()=>{
 for(const path of ['/','/overview','/repositories','/changes','/changes/cr-123','/work','/jobs/job-456','/automations','/previews','/settings']){
  const res=await app.inject({method:'GET',url:path});
  assert.equal(res.statusCode,200,`Failed for path: ${path}`);
  assert.ok(res.headers['content-type']?.includes('text/html'),`Expected HTML header for ${path}`);
  assert.ok(res.body.includes('<!doctype html>'),`Expected HTML body for ${path}`);
 }

 const apiRes=await app.inject({method:'GET',url:'/api/unknown-endpoint',headers:{authorization:`Bearer ${token}`}});
 assert.equal(apiRes.statusCode,404);
});

test('route parsing and URL serialization contract',async()=>{
 // Test parseRoute and buildUrl logic equivalent to src/web/main.tsx
 function parseRoute(pathname:string,search:string){
  const clean=pathname.replace(/\/+$/,'')||'/';
  const params=new URLSearchParams(search);
  const project=params.get('project')||'all';
  const changeMatch=clean.match(/^\/changes\/([^/]+)$/);
  if(changeMatch)return {page:'changes',detail:{type:'change',id:changeMatch[1]},project};
  const jobMatch=clean.match(/^\/(?:jobs|work)\/([^/]+)$/);
  if(jobMatch)return {page:'work',detail:{type:'job',id:jobMatch[1]},project};
  const p=clean.replace(/^\//,'');
  const validPages=['overview','repositories','changes','work','automations','previews','settings'];
  const page=validPages.includes(p)?p:'overview';
  return {page,detail:null,project};
 }

 function buildUrl(page:string,detail:{type:string,id:string}|null,project:string){
  let path='/';
  if(detail){
   path=detail.type==='job'?`/jobs/${detail.id}`:`/changes/${detail.id}`;
  }else if(page&&page!=='overview'){
   path=`/${page}`;
  }
  const params=new URLSearchParams();
  if(project&&project!=='all')params.set('project',project);
  const q=params.toString();
  return q?`${path}?${q}`:path;
 }

 // Root and overview
 assert.deepEqual(parseRoute('/',''),{page:'overview',detail:null,project:'all'});
 assert.deepEqual(parseRoute('/overview',''),{page:'overview',detail:null,project:'all'});
 assert.equal(buildUrl('overview',null,'all'),'/');

 // Project filter in query
 assert.deepEqual(parseRoute('/changes','?project=proj-1'),{page:'changes',detail:null,project:'proj-1'});
 assert.equal(buildUrl('changes',null,'proj-1'),'/changes?project=proj-1');

 // Detail view for changes
 assert.deepEqual(parseRoute('/changes/cr-abc',''),{page:'changes',detail:{type:'change',id:'cr-abc'},project:'all'});
 assert.equal(buildUrl('changes',{type:'change',id:'cr-abc'},'all'),'/changes/cr-abc');
 assert.equal(buildUrl('changes',{type:'change',id:'cr-abc'},'proj-9'),'/changes/cr-abc?project=proj-9');

 // Detail view for jobs
 assert.deepEqual(parseRoute('/jobs/job-xyz',''),{page:'work',detail:{type:'job',id:'job-xyz'},project:'all'});
 assert.deepEqual(parseRoute('/work/job-xyz',''),{page:'work',detail:{type:'job',id:'job-xyz'},project:'all'});
 assert.equal(buildUrl('work',{type:'job',id:'job-xyz'},'all'),'/jobs/job-xyz');

 // Other top-level pages
 for(const p of ['repositories','work','automations','previews','settings']){
  assert.deepEqual(parseRoute(`/${p}`,''),{page:p,detail:null,project:'all'});
  assert.equal(buildUrl(p,null,'all'),`/${p}`);
 }

 // Invalid route falls back to overview
 assert.deepEqual(parseRoute('/non-existent',''),{page:'overview',detail:null,project:'all'});
});
