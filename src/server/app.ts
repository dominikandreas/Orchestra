import {adminSnapshot,adminThread,createAdminThread,startAdminTurn,stopAdminTurn,deleteAdminThread,editAdminMessage,deleteAdminMessage,forkAdminThread} from './admin-agent.js';
import {registerProjectAgentRoutes} from './project-agent.js';
import {registerPlannedChangeRoutes} from './planned-change.js';
import {registerChangePipelineRoutes,getChangePipeline} from './change-pipeline.js';
import {ensureProjectKnowledge,projectKnowledge,saveProjectKnowledge,projectMetadataHistory,readProjectMetadata,updateProjectMetadata} from './project-metadata.js';
import {structuredChangeDiff,structuredChangeFileDiff} from './structured-diff.js';
import {proposeAction,decideAction,draftPlugin} from './admin-control.js';
import Fastify from 'fastify';
import ts from 'typescript';
import {registerSelf,prepareDeployment,activateDeployment,rollbackDeployment,restartApp} from './self.js';
import fastifyStatic from '@fastify/static';
import { z } from 'zod';
import { resolve,join } from 'node:path';
import { existsSync,readFileSync } from 'node:fs';
import { readFile,writeFile,mkdir,rm } from 'node:fs/promises';
import { all,get,put,del,hash,admin,canProject,canOperate,issueInvite,redeemInvite,audit,event,events,eventBus,searchEvents,encrypt,dataDir,installationDeviceId,type Row } from './store.js';
import { importRepository,createLocalRepository,branches,branchDetails,createBranch,deleteBranch,repoTree,repoBlob,repoCommits,createChange,diffChange,refreshChange,mergeChange,command,git,syncRepository,revision } from './git.js';
import { runtime,safeConnection,usable } from './providers.js';
import { enqueue,signalJob,emitAutomation,maybeAutoMerge,submitChangeForJob,updateJobSettings,forkJob,jobDiff,visibleAgent } from './jobs.js';
import { startDeployment,stopDeployment,restartDeployment,configureDeployment,removeDeployment,cleanupStoppedDeployments,deploymentLink,registerDeploymentIngress,migratePreviewsToDeployments,startPreview,stopPreview,previewLink,registerPreviewIngress } from './deployments.js';
import { connectionContract } from './external-contract.js';
import { externalAccess,externalDetail,saveConnectionDraft,approveConnection,requestExternalOperation,approveExternalOperation,setExternalPolicy } from './external.js';
import { syncMcpServerTools,safeMcpServer } from './mcp.js';
const str=z.string().trim().min(1).max(20000),id=z.string().uuid();
const mode=z.enum(['approve','prepare','auto']);
const kind=z.enum(['implement','review','address','conflict','test','coverage','improve','adapt','system']);
const thinking=z.enum(['off','minimal','low','medium','high','xhigh']);
const optId=id.or(z.literal('')).nullable().optional();
const optMode=mode.or(z.literal('')).nullable().optional();
const optThinking=thinking.or(z.literal('')).nullable().optional();
const snippet=(text:string|undefined,needle:string)=>{if(!text)return undefined;const idx=text.toLowerCase().indexOf(needle);if(idx===-1)return undefined;const start=Math.max(0,idx-40),end=Math.min(text.length,idx+needle.length+80);return (start>0?'…':'')+text.slice(start,end).replace(/\s+/g,' ').trim()+(end<text.length?'…':'');};
const imageSchema=z.object({type:z.literal('image'),data:z.string(),mimeType:z.string(),name:z.string().optional(),url:z.string().optional()});
const attachmentSchema=z.object({name:z.string(),size:z.number().optional(),type:z.string().optional(),data:z.string()});
const body=(req:any,schema:z.ZodType<any>)=>schema.parse(req.body);
export async function createApp(){const app=Fastify({logger:false,forceCloseConnections:true,bodyLimit:1024*1024,...(process.env.RELAY_TLS_CERT?{https:{cert:readFileSync(process.env.RELAY_TLS_CERT),key:readFileSync(process.env.RELAY_TLS_KEY!)}}:{})});
 registerDeploymentIngress(app);
 migratePreviewsToDeployments();
 app.setErrorHandler((err:any,_req,reply)=>{reply.code(err.statusCode||400).send({error:err instanceof z.ZodError?err.issues.map(i=>`${i.path.join('.')}: ${i.message}`).join('; '):err.message});});
 app.addHook('onSend',async(_req,reply,payload)=>{reply.header('X-Content-Type-Options','nosniff').header('Referrer-Policy','no-referrer').header('X-Frame-Options','DENY').header('Content-Security-Policy',"default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'");return payload;});
 app.addHook('preHandler',async(req:any,reply)=>{const route=req.routeOptions.url||req.url; if(!route.startsWith('/api/')||['/api/health','/api/setup','/api/redeem'].includes(route))return;const raw=req.headers.authorization?.replace(/^Bearer /,'');const d=raw&&all('devices').find(d=>d.hash===hash(raw));const u=d&&get('users',d.userId);if(!u||u.disabled)return reply.code(401).send({error:'Sign in with a device invitation.'});req.user=u;req.device=d;});
 const user=(req:any):Row=>req.user;const needAdmin=(req:any)=>{if(!admin(user(req)))throw Error('Administrator access required')};
 const entity=(req:any,type:string,key:string,write=false)=>{const r=get(type,key);if(!r)throw Error('Not found');const projectId=type==='projects'?r.id:r.projectId;const allowed=!projectId?(write?admin(user(req)):true):(write?canOperate(user(req),projectId):canProject(user(req),projectId));if(!allowed)throw Error('Project access denied');return r;};
 const guardProjectWrite=(req:any,projectId:string)=>{const actor=get('users',user(req).id);if(!actor||actor.disabled||!get('projects',projectId)||!canOperate(actor,projectId))throw Error('Project access denied');};
 const base=(req:any)=>process.env.RELAY_BASE_URL||`${process.env.RELAY_TLS_CERT?'https':'http'}://${req.headers.host}`;
 registerProjectAgentRoutes(app);
 registerChangePipelineRoutes(app);
 registerPlannedChangeRoutes(app);
 app.get('/api/health',()=>({ok:true,name:'Orchestra'}));
 app.get('/api/setup',()=>({initialized:all('users').length>0}));
 const attempts=new Map<string,{n:number,until:number}>();
 app.post('/api/redeem',async(req,reply)=>{const key=req.ip,prev=attempts.get(key);if(prev&&prev.until>Date.now()&&prev.n>=20)return reply.code(429).send({error:'Too many attempts. Try again in a minute.'});attempts.set(key,{n:prev&&prev.until>Date.now()?prev.n+1:1,until:Date.now()+60000});const b=body(req,z.object({token:str,name:z.string().trim().min(1).max(80)}));return redeemInvite(b.token,b.name)});
 app.get('/api/me',(req:any)=>({user:req.user,deviceId:req.device.id}));
 app.get('/api/state',async(req)=>{
  const u=user(req);
  const visible=(x:Row)=>!x.projectId||canProject(u,x.projectId);
  const r=await runtime();
  const providers=r.getProviders().map(p=>({id:p.id,name:p.name,methods:r.hasConfiguredAuth(p.id)||(p as any).baseUrl?.startsWith('cli:')?[]:[...(p.auth.apiKey?.login?['api_key']:[]),...(p.auth.oauth?['oauth']:[])],models:r.getModels(p.id).map(m=>({id:m.id,name:m.name}))}));
  return {
   projects:all('projects').filter(p=>canProject(u,p.id)),
   repos:all('repos').filter(visible),
   changes:all('changes').filter(visible),
   jobs:all('jobs').filter(visible),
   workflows:all('workflows').filter(visible),
   agents:all('agents').filter(a=>!a.projectId||canProject(u,a.projectId)),
   threads:admin(u)?all('adminThreads').filter(t=>t.authorId===u.id).map(t=>({id:t.id,title:t.title,updated:t.updated,created:t.created,permissionMode:t.permissionMode,parentThreadId:t.parentThreadId,running:all('adminRuns').some(row=>row.threadId===t.id&&row.status==='running')})):[],
   previews:all('deployments').concat(all('previews')).filter(visible),
   deployments:all('deployments').concat(all('previews')).filter(visible),
   externalDeployments:all('externalDeployments').filter(visible),
   resources:all('resources').filter(visible),
   mcpServers:all('mcpServers').filter(s=>!s.projectId||canProject(u,s.projectId)).map(s=>safeMcpServer(s,u)),
   connections:all('connections').filter(c=>c.ownerId===u.id||admin(u)||c.shared&&(c.projects||[]).some((p:string)=>canProject(u,p))).map(c=>safeConnection(c,r)),
   providers
  };
 });
 // External host integrations are deliberately separate from app releases and previews.
 app.post('/api/external-deployments',req=>{needAdmin(req);const b=body(req,z.object({repoId:id,name:str,prompt:str}));const r=entity(req,'repos',b.repoId,true);if(r.status!=='ready')throw Error('Repository is not ready');
  const d=put('externalDeployments',{repoId:r.id,projectId:r.projectId,name:b.name,prompt:b.prompt,authorId:user(req).id,status:'authoring',policy:'manual'});
  try{const j=enqueue({repoId:r.id,kind:'deployment_connection',title:`Connect deployment: ${b.name}`,prompt:b.prompt,autonomy:'prepare'},user(req));put('jobs',{id:j.id,deploymentId:d.id});audit(user(req).id,'external.link.request',d.id);return put('externalDeployments',{id:d.id,jobId:j.id})}catch(e){put('externalDeployments',{id:d.id,status:'failed',error:String(e)});throw e}
 });
 app.get('/api/external-deployments/contract',()=>({contract:connectionContract}));
 app.get('/api/external-deployments/:id',(req:any)=>externalDetail(user(req),req.params.id));
 app.post('/api/external-deployments/:id/revise',(req:any)=>{const d=externalAccess(user(req),req.params.id,true);const b=body(req,z.object({prompt:str}));if(d.jobId&&['queued','running','awaiting_approval'].includes(get('jobs',d.jobId)?.status))throw Error('Finish or cancel the current onboarding job first');const j=enqueue({repoId:d.repoId,kind:'deployment_connection',title:`Revise connection: ${d.name}`,prompt:b.prompt,autonomy:'prepare'},user(req));put('jobs',{id:j.id,deploymentId:d.id});audit(user(req).id,'external.connection.revise',d.id);return put('externalDeployments',{id:d.id,jobId:j.id,status:'authoring',approvedDigest:null,approvedBy:null,approvedAt:null});});
 app.post('/api/external-deployments/:id/draft',(req:any)=>saveConnectionDraft(req.params.id,req.body,user(req)));
 app.post('/api/external-deployments/:id/approve',(req:any)=>{const b=body(req,z.object({digest:z.string().regex(/^[0-9a-f]{64}$/)}));return approveConnection(req.params.id,b.digest,user(req))});
 app.patch('/api/external-deployments/:id/policy',(req:any)=>{const b=body(req,z.object({policy:z.enum(['manual','yolo'])}));return setExternalPolicy(req.params.id,b.policy,user(req))});
 app.post('/api/external-deployments/:id/operations',(req:any)=>{const b=body(req,z.object({operation:z.enum(['status','logs','inspect','deploy']),revision:z.string().regex(/^[0-9a-f]{40}$|^[0-9a-f]{64}$/).optional(),lines:z.number().int().min(1).max(500).default(100)}));return requestExternalOperation(req.params.id,b,user(req))});
 app.post('/api/external-operations/:id/approve',(req:any)=>{const b=body(req,z.object({digest:z.string().regex(/^[0-9a-f]{64}$/),revision:z.string().regex(/^[0-9a-f]{40}$|^[0-9a-f]{64}$/)}));return approveExternalOperation(req.params.id,b.digest,b.revision,user(req))});
 app.get('/api/search',(req:any)=>{
  const u=user(req);
  const q=String(req.query?.q||'').trim();
  const limit=Math.min(Math.max(Number(req.query?.limit)||30,1),100);
  if(q.length<2)return {sessions:[],changes:[]};
  const needle=q.toLowerCase();
  const visibleJobs=all('jobs').filter(j=>canProject(u,j.projectId)).sort((a,b)=>b.updated.localeCompare(a.updated));
  const jobSet=new Set(visibleJobs.map(j=>j.id));
  const eventSnippets=new Map<string,string>();
  for(const ev of searchEvents(q,['user','text','result','final_text'])){
   if(!jobSet.has(ev.job)||eventSnippets.has(ev.job))continue;
   const text=typeof ev.data==='string'?ev.data:typeof ev.data?.text==='string'?ev.data.text:'';
   const s=snippet(text,needle);
   if(s)eventSnippets.set(ev.job,s);
  }
  const sessions:any[]=[];
  for(const j of visibleJobs){
   if(sessions.length>=limit)break;
   const titleMatch=snippet(j.title,needle);
   const promptMatch=snippet(j.prompt,needle);
   const evMatch=eventSnippets.get(j.id);
   const matched=promptMatch||evMatch||titleMatch;
   if(matched)sessions.push({id:j.id,title:j.title,repoId:j.repoId,projectId:j.projectId,status:j.status,updated:j.updated,snippet:matched});
  }
  const visibleChanges=all('changes').filter(c=>canProject(u,c.projectId)).sort((a,b)=>b.updated.localeCompare(a.updated));
  const comments=all('comments'),reviews=all('reviews');
  const changes:any[]=[];
  for(const c of visibleChanges){
   if(changes.length>=limit)break;
   let matched=snippet(c.title,needle)||snippet(c.source,needle)||snippet(c.target,needle);
   if(!matched){for(const cm of comments){if(cm.changeId===c.id){matched=snippet(cm.text,needle);if(matched)break;}}}
   if(!matched){for(const rv of reviews){if(rv.changeId===c.id){matched=snippet(rv.body,needle);if(matched)break;}}}
   if(matched)changes.push({id:c.id,title:c.title,repoId:c.repoId,projectId:c.projectId,status:c.status,updated:c.updated,snippet:matched});
  }
  return {sessions,changes};
 });
 app.post('/api/agents',req=>{
  const b=body(req,z.object({name:z.string().trim().min(1).max(200),description:z.string().max(2000).default(''),instructions:str,projectId:optId,connectionId:z.string().nullable().optional(),model:z.string().nullable().optional(),thinkingLevel:optThinking,autonomy:optMode,kind:kind.default('implement'),tools:z.array(z.string()).optional(),mcpServers:z.array(z.string()).optional()}));
  const projectId=b.projectId||undefined;
  if(projectId)entity(req,'projects',projectId,true);else needAdmin(req);
  const agent=put('agents',{name:b.name,description:b.description,instructions:b.instructions,projectId,connectionId:b.connectionId||undefined,model:b.model||undefined,thinkingLevel:b.thinkingLevel||undefined,autonomy:b.autonomy||undefined,kind:b.kind||'implement',tools:b.tools,mcpServers:b.mcpServers,authorId:user(req).id});
  audit(user(req).id,'agent.create',agent.id);
  return agent;
 });
 app.patch('/api/agents/:id',(req:any)=>{
  const a=get('agents',req.params.id);if(!a)throw Error('Not found');
  if(a.projectId)entity(req,'projects',a.projectId,true);else needAdmin(req);
  const b=body(req,z.object({name:z.string().trim().min(1).max(200).optional(),description:z.string().max(2000).optional(),instructions:str.optional(),projectId:optId,connectionId:z.string().nullable().optional(),model:z.string().nullable().optional(),thinkingLevel:optThinking,autonomy:optMode,kind:kind.optional(),tools:z.array(z.string()).optional(),mcpServers:z.array(z.string()).optional()}));
  if(b.projectId!==undefined){if(b.projectId)entity(req,'projects',b.projectId,true);else needAdmin(req);}
  const patch:Record<string,any>={id:a.id};
  for(const [k,v] of Object.entries(b))if(v!==undefined)patch[k]=v===null||(v===''&&k!=='description')?undefined:v;
  const updated=put('agents',patch);
  audit(user(req).id,'agent.update',a.id);
  return updated;
 });
 app.delete('/api/agents/:id',(req:any)=>{
  const a=get('agents',req.params.id);if(!a)throw Error('Not found');
  if(a.projectId)entity(req,'projects',a.projectId,true);else needAdmin(req);
  del('agents',a.id);
  audit(user(req).id,'agent.delete',a.id);
  return {ok:true,id:a.id};
 });
 app.get('/api/mcp-servers',req=>{
  const u=user(req);
  return all('mcpServers').filter(s=>!s.projectId||canProject(u,s.projectId)).map(s=>safeMcpServer(s,u));
 });
 app.post('/api/mcp-servers',async req=>{
  needAdmin(req);
  const b=body(req,z.object({name:z.string().trim().min(1).max(100),description:z.string().max(2000).default(''),type:z.enum(['stdio','sse']).default('stdio'),command:z.string().trim().optional(),args:z.array(z.string()).or(z.string().transform(s=>s.split(/\s+/).filter(Boolean))).optional(),cwd:z.string().optional(),env:z.record(z.string(),z.string()).optional(),url:z.string().url().optional(),enabled:z.boolean().default(true),projectId:optId}));
  const projectId=b.projectId||undefined;
  if(projectId)entity(req,'projects',projectId,true);else needAdmin(req);
  const server=put('mcpServers',{name:b.name,description:b.description,type:b.type,command:b.command,args:b.args||[],cwd:b.cwd,env:b.env,url:b.url,enabled:b.enabled,projectId,authorId:user(req).id});
  audit(user(req).id,'mcp_server.create',server.id);
  if(server.enabled)void syncMcpServerTools(server).catch(()=>{});
  return server;
 });
 app.patch('/api/mcp-servers/:id',async(req:any)=>{
  needAdmin(req);
  const s=get('mcpServers',req.params.id);if(!s)throw Error('MCP server not found');
  if(s.projectId)entity(req,'projects',s.projectId,true);else needAdmin(req);
  const b=body(req,z.object({name:z.string().trim().min(1).max(100).optional(),description:z.string().max(2000).optional(),type:z.enum(['stdio','sse']).optional(),command:z.string().trim().optional(),args:z.array(z.string()).or(z.string().transform(s=>s.split(/\s+/).filter(Boolean))).optional(),cwd:z.string().optional(),env:z.record(z.string(),z.string()).optional(),url:z.string().url().optional(),enabled:z.boolean().optional(),projectId:optId}));
  if(b.projectId!==undefined){if(b.projectId)entity(req,'projects',b.projectId,true);else needAdmin(req);}
  const patch:Record<string,any>={id:s.id};
  for(const [k,v] of Object.entries(b))if(v!==undefined)patch[k]=v===null||(v===''&&k!=='description')?undefined:v;
  const updated=put('mcpServers',patch);
  audit(user(req).id,'mcp_server.update',s.id);
  return updated;
 });
 app.delete('/api/mcp-servers/:id',(req:any)=>{
  needAdmin(req);
  const s=get('mcpServers',req.params.id);if(!s)throw Error('MCP server not found');
  if(s.projectId)entity(req,'projects',s.projectId,true);else needAdmin(req);
  del('mcpServers',s.id);
  audit(user(req).id,'mcp_server.delete',s.id);
  return {ok:true,id:s.id};
 });
 app.post('/api/mcp-servers/:id/sync',async(req:any)=>{
  needAdmin(req);
  const s=get('mcpServers',req.params.id);if(!s)throw Error('MCP server not found');
  if(s.projectId)entity(req,'projects',s.projectId,true);else needAdmin(req);
  const tools=await syncMcpServerTools(s);
  audit(user(req).id,'mcp_server.sync',s.id);
  return {ok:true,tools};
 });
 app.post('/api/projects',async req=>{needAdmin(req);const p=put('projects',body(req,z.object({name:str,description:z.string().max(2000).default('')})));try{await ensureProjectKnowledge(p);return p;}catch(e){del('projects',p.id);throw e;}});
 app.get('/api/projects/:id/knowledge',async(req:any)=>{const p=entity(req,'projects',req.params.id);return projectKnowledge(p);});
 app.put('/api/projects/:id/knowledge',async(req:any)=>{const p=entity(req,'projects',req.params.id,true);const b=body(req,z.object({path:z.string().min(1).max(240),content:z.string().max(256*1024),revision:z.string().optional()}));const result=await saveProjectKnowledge(p,b.path,b.content,user(req),b.revision,()=>guardProjectWrite(req,p.id));audit(user(req).id,'project.knowledge.update',`${p.id}:${b.path}`);return result;});
 app.get('/api/projects/:id/knowledge/history',async(req:any)=>{const p=entity(req,'projects',req.params.id);await ensureProjectKnowledge(p);return {history:await projectMetadataHistory(p.id)};});
 app.get('/api/projects/:id/knowledge/revision/:revision',async(req:any)=>{const p=entity(req,'projects',req.params.id);await ensureProjectKnowledge(p);return readProjectMetadata(p.id,req.params.revision);});
 app.patch('/api/projects/:id',async req=>{needAdmin(req);const p=entity(req,'projects',(req.params as any).id,true);const b=body(req,z.object({name:str.optional(),description:z.string().max(2000).optional()}));const metadata=await ensureProjectKnowledge(p);await updateProjectMetadata(p.id,b,metadata.revision,user(req),()=>{guardProjectWrite(req,p.id);const actor=get('users',user(req).id)!;if(!admin(actor))throw Error('Administrator access required');});audit(user(req).id,'project.update',p.id);return put('projects',{id:p.id,...b});});
 app.delete('/api/projects/:id',async req=>{needAdmin(req);const p=entity(req,'projects',(req.params as any).id,true);const reposInProject=all('repos').filter(r=>r.projectId===p.id);if(reposInProject.length>0)throw Error(`Cannot delete project "${p.name}". It contains ${reposInProject.length} repository/repositories. Please remove or delete them first.`);del('projects',p.id);for(const w of all('workflows').filter(w=>w.projectId===p.id))del('workflows',w.id);for(const res of all('resources').filter(res=>res.projectId===p.id))del('resources',res.id);for(const a of all('agents').filter(a=>a.projectId===p.id))del('agents',a.id);audit(user(req).id,'project.delete',p.id);return {ok:true,id:p.id};});
 app.post('/api/repos',async req=>{needAdmin(req);const b=body(req,z.object({projectId:id,name:str,source:str,base:z.string().optional(),createLocal:z.boolean().optional().default(false)}));entity(req,'projects',b.projectId,true);let source=b.source.trim();if(b.createLocal){source=await createLocalRepository(source,b.name,b.base||'main');}const repo=await importRepository(source,b.name,b.projectId,b.base);audit(user(req).id,b.createLocal?'repository.create':'repository.import',repo.id);return repo;});
 app.delete('/api/repos/:id',async req=>{needAdmin(req);const r=entity(req,'repos',(req.params as any).id,true);if(r.self)throw Error('Cannot delete Orchestra self-repository');del('repos',r.id);if(r.path)await rm(r.path,{recursive:true,force:true}).catch(()=>{});for(const j of all('jobs').filter(j=>j.repoId===r.id)){await rm(join(dataDir,'worktrees',j.id),{recursive:true,force:true}).catch(()=>{});del('jobs',j.id);}for(const c of all('changes').filter(c=>c.repoId===r.id))del('changes',c.id);for(const w of all('workflows').filter(w=>w.repoId===r.id))del('workflows',w.id);audit(user(req).id,'repository.delete',r.id);return {ok:true,id:r.id};});
 app.get('/api/repos/:id/inspect',async(req:any)=>{const r=entity(req,'repos',req.params.id);let scripts:any={};try{scripts=JSON.parse(await git(r.path,'show',`${r.base}:package.json`)).scripts||{}}catch{}return {branches:await branches(r),scripts,suggestions:{testCommand:scripts.test?'npm ci && npm test':'',previewCommand:scripts.dev?'npm ci && npm run dev -- --host 0.0.0.0':''}}});
 app.patch('/api/repos/:id',async(req:any)=>{needAdmin(req);const r=entity(req,'repos',req.params.id,true);const b=body(req,z.object({name:str.optional(),base:str.optional(),testCommand:z.string().max(5000).optional(),previewCommand:z.string().max(5000).optional(),image:z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._/:@-]+$/).optional(),port:z.number().int().min(1).max(65535).optional(),autonomy:mode.optional(),connectionId:z.string().optional(),model:z.string().optional(),thinkingLevel:thinking.optional(),requireReview:z.boolean().optional()}));if(b.base&&!(await branches(r)).includes(b.base))throw Error('Base branch does not exist');audit(user(req).id,'repository.configure',r.id);return put('repos',{id:r.id,...b});});
 app.post('/api/repos/:id/sync',async(req:any)=>{needAdmin(req);return syncRepository(entity(req,'repos',req.params.id,true));});
 app.get('/api/repos/:id/branches',async(req:any)=>{const r=entity(req,'repos',req.params.id);return {branches:await branchDetails(r)}});
 app.post('/api/repos/:id/branches',async(req:any)=>{const r=entity(req,'repos',req.params.id,true);const b=body(req,z.object({name:str,from:z.string().optional()}));const res=await createBranch(r,b.name,b.from);audit(user(req).id,'branch.create',`${r.id}:${b.name}`);return res;});
 app.delete('/api/repos/:id/branches/:branch',async(req:any)=>{const r=entity(req,'repos',req.params.id,true);const res=await deleteBranch(r,req.params.branch);audit(user(req).id,'branch.delete',`${r.id}:${req.params.branch}`);return res;});
 app.get('/api/repos/:id/tree',async(req:any)=>{const r=entity(req,'repos',req.params.id);const q=req.query||{};const recursive=q.recursive==='true'||q.recursive==='1';return repoTree(r,q.ref,q.path,recursive);});
 app.get('/api/repos/:id/blob',async(req:any)=>{const r=entity(req,'repos',req.params.id);const q=req.query||{};return repoBlob(r,q.ref,q.path);});
 app.get('/api/repos/:id/commits',async(req:any)=>{const r=entity(req,'repos',req.params.id);const q=req.query||{};const limit=parseInt(q.limit as string,10)||30;return {commits:await repoCommits(r,q.ref,limit)};});
 app.get('/api/repos/:id/activity',async(req:any)=>{const r=entity(req,'repos',req.params.id);const repoChanges=all('changes').filter(c=>c.repoId===r.id);const changeIds=new Set(repoChanges.map(c=>c.id));const reviews=all('reviews').filter(rv=>changeIds.has(rv.changeId)).sort((a,b)=>b.created.localeCompare(a.created));const checks=all('checks').filter(ck=>changeIds.has(ck.changeId)).sort((a,b)=>b.created.localeCompare(a.created));return {reviews,checks};});
 app.post('/api/changes',async req=>{const b=body(req,z.object({repoId:id,source:str,target:str,title:str}));const r=entity(req,'repos',b.repoId,true);const c=await createChange(r,b.source,b.target,b.title,user(req).id);emitAutomation('change_created',c);return c;});
 app.get('/api/changes/:id',async(req:any)=>{let c=entity(req,'changes',req.params.id);let mergeCheckError:string|undefined;if(c.status==='open'){try{c=await refreshChange(c);}catch(e){mergeCheckError=e instanceof Error?e.message:String(e);}}return {...c,...(mergeCheckError?{conflict:null,mergeCheckError}:{}),...(req.query.includeDiff==='false'?{}:{diff:await diffChange(c,{includeGenerated:req.query.includeGenerated==='true'})}),pipeline:getChangePipeline(c.id)||null,comments:all('comments').filter(x=>x.changeId===c.id),reviews:all('reviews').filter(x=>x.changeId===c.id),checks:all('checks').filter(x=>x.changeId===c.id)}});
 app.get('/api/changes/:id/files',async(req:any)=>{const c=entity(req,'changes',req.params.id);const q=z.object({includeHidden:z.enum(['true','false']).optional(),offset:z.coerce.number().int().nonnegative().optional(),limit:z.coerce.number().int().min(1).max(500).optional()}).parse(req.query);return structuredChangeDiff(c,{includeHidden:q.includeHidden==='true',offset:q.offset,limit:q.limit});});
 app.get('/api/changes/:id/file',async(req:any)=>{const c=entity(req,'changes',req.params.id);const q=z.object({path:z.string().min(1),includeHidden:z.enum(['true','false']).optional()}).parse(req.query);return structuredChangeFileDiff(c,q.path,{includeHidden:q.includeHidden==='true'});});
 app.post('/api/changes/:id/refresh',async(req:any)=>{const c=await refreshChange(entity(req,'changes',req.params.id,true));emitAutomation('change_updated',c);return c});
 app.post('/api/changes/:id/force-merge',async(req:any)=>{needAdmin(req);entity(req,'changes',req.params.id,true);const b=z.object({sourceSha:z.string().min(1),targetSha:z.string().min(1),reason:z.string().trim().min(1).max(2000)}).parse(req.body);return mergeChange(req.params.id,{...b,force:{actorId:user(req).id,reason:b.reason}});});
 app.post('/api/changes/:id/merge',async(req:any)=>{entity(req,'changes',req.params.id,true);const r=await mergeChange(req.params.id);audit(user(req).id,'change.merge',r.id);return r;});
 app.post('/api/changes/:id/close',async(req:any)=>{const c=entity(req,'changes',req.params.id,true);if(c.status!=='open')throw Error('Only open change requests can be closed');const updated=put('changes',{id:c.id,status:'closed',closedBy:user(req).id,closedAt:new Date().toISOString()});audit(user(req).id,'change.close',c.id);return updated;});
 app.post('/api/changes/:id/reopen',async(req:any)=>{const c=entity(req,'changes',req.params.id,true);if(c.status!=='closed')throw Error('Only closed change requests can be reopened');const updated=put('changes',{id:c.id,status:'open',reopenedBy:user(req).id,reopenedAt:new Date().toISOString()});audit(user(req).id,'change.reopen',c.id);return updated;});
 app.delete('/api/changes/:id',async(req:any)=>{const c=entity(req,'changes',req.params.id,true);const u=user(req);if(!admin(u)&&c.authorId!==u.id)throw Error('Only administrators or the author can delete a change request');del('changes',c.id);for(const item of all('comments').filter(x=>x.changeId===c.id))del('comments',item.id);for(const item of all('reviews').filter(x=>x.changeId===c.id))del('reviews',item.id);for(const item of all('checks').filter(x=>x.changeId===c.id))del('checks',item.id);audit(u.id,'change.delete',c.id);return {ok:true,id:c.id};});
 app.post('/api/changes/:id/comment',async(req:any)=>{const c=entity(req,'changes',req.params.id,true);const b=body(req,z.object({text:str,file:z.string().min(1).max(4096).optional(),path:z.string().min(1).max(4096).optional(),line:z.number().int().positive().optional(),side:z.enum(['old','new']).optional(),sourceSha:z.string().optional(),targetSha:z.string().optional(),images:z.array(imageSchema).optional(),attachments:z.array(attachmentSchema).optional()}));
  if(b.path&&b.file&&b.path!==b.file)throw Error('Comment paths do not match');
  const file=b.path||b.file;
  if(Boolean(file)!==Boolean(b.line))throw Error('Inline comments require both a file and line');
  if((b.side||b.sourceSha||b.targetSha)&&!file)throw Error('Revision anchors require an inline comment');
  if(file){
   const sourceSha=await revision(get('repos',c.repoId)!,c.source),targetSha=await revision(get('repos',c.repoId)!,c.target);
   if(sourceSha!==c.sourceSha||targetSha!==c.targetSha||(b.sourceSha&&b.sourceSha!==sourceSha)||(b.targetSha&&b.targetSha!==targetSha))throw Error('Change revisions changed. Refresh before commenting.');
   const diff=await structuredChangeFileDiff(c,file,{includeHidden:true});
   const side=b.side||'new';
   if(!diff.hunks.some(h=>h.lines.some(l=>(side==='old'?l.oldLine:l.newLine)===b.line)))throw Error('Comment line is not present on this side of the diff');
  }
  const comment=put('comments',{...b,...(file?{file,path:file,side:b.side||'new',targetSha:c.targetSha}:{}),changeId:c.id,projectId:c.projectId,authorId:user(req).id,author:user(req).name,sourceSha:c.sourceSha});emitAutomation('comment',c,comment.id);return comment});
 app.post('/api/changes/:id/review',async(req:any)=>{const c=entity(req,'changes',req.params.id,true);const b=body(req,z.object({body:str,verdict:z.enum(['approved','changes_requested','commented'])}));const review=put('reviews',{...b,changeId:c.id,authorId:user(req).id,sourceSha:c.sourceSha,targetSha:c.targetSha,ai:false});await maybeAutoMerge(c.id);return review;});
 app.post('/api/jobs',req=>{const b=body(req,z.object({repoId:id,changeId:optId,agentId:optId,title:str.optional(),prompt:str,kind:kind.optional(),autonomy:optMode,connectionId:z.string().optional(),model:z.string().optional(),thinkingLevel:optThinking,targetBranch:z.string().optional(),sourceBranch:z.string().optional(),images:z.array(imageSchema).optional(),attachments:z.array(attachmentSchema).optional()}));return enqueue({...b,changeId:b.changeId||undefined,agentId:b.agentId||undefined,autonomy:b.autonomy||undefined,thinkingLevel:b.thinkingLevel||undefined},user(req));});
 app.get('/api/jobs/:id',(req:any)=>{const j=entity(req,'jobs',req.params.id);return {...j,events:events(j.id),checks:all('checks').filter(x=>x.jobId===j.id)};});
 app.get('/api/jobs/:id/diff',async(req:any)=>jobDiff(entity(req,'jobs',req.params.id)));
 app.get('/api/jobs/:id/events',async(req:any,reply)=>{
  const j=entity(req,'jobs',req.params.id);
  let after=Number(req.query.after)||0;
  reply.hijack();
  reply.raw.writeHead(200,{'Content-Type':'text/event-stream','Cache-Control':'no-cache','Connection':'keep-alive'});
  const sendPast=()=>{
   const current=get('users',user(req).id);
   if(!current||current.disabled||!canProject(current,j.projectId)){reply.raw.end();return false;}
   for(const e of events(j.id,after)){
    reply.raw.write(`id: ${e.seq}\ndata: ${JSON.stringify(e)}\n\n`);
    after=Math.max(after,e.seq);
   }
   return true;
  };
  if(!sendPast())return;
  const channel=`event:${j.id}`;
  const onNewEvent=(e:any)=>{
   if(e.seq>after){
    const current=get('users',user(req).id);
    if(!current||current.disabled||!canProject(current,j.projectId)){reply.raw.end();return;}
    reply.raw.write(`id: ${e.seq}\ndata: ${JSON.stringify(e)}\n\n`);
    after=e.seq;
   }
  };
  eventBus.on(channel,onNewEvent);
  const heartbeat=setInterval(()=>{
   try{
    sendPast();
    reply.raw.write(': heartbeat\n\n');
   }catch{
    clearInterval(heartbeat);
    eventBus.off(channel,onNewEvent);
   }
  },5000);
  reply.raw.on('close',()=>{
   clearInterval(heartbeat);
   eventBus.off(channel,onNewEvent);
  });
 });
 app.patch('/api/jobs/:id',async(req:any)=>{const j=entity(req,'jobs',req.params.id,true);const b=body(req,z.object({title:z.string().trim().min(1).max(200).optional(),archived:z.boolean().optional(),connectionId:z.string().optional(),model:z.string().optional(),thinkingLevel:thinking.optional()}));const targetConnId=b.connectionId!==undefined?b.connectionId:j.connectionId;const conn=targetConnId?usable(targetConnId,user(req).id,j.projectId):undefined;const updated=put('jobs',{id:j.id,...(b.title!==undefined?{title:b.title}:{}),...(b.archived!==undefined?{archived:b.archived}:{}),...(b.connectionId!==undefined?{connectionId:b.connectionId,provider:conn?.provider}:(conn?{provider:conn.provider}:{})),...(b.model!==undefined?{model:b.model}:{}),...(b.thinkingLevel!==undefined?{thinkingLevel:b.thinkingLevel}:{})});if(b.thinkingLevel)updateJobSettings(j.id,b.thinkingLevel);audit(user(req).id,'job.configure',j.id);return updated;});
 app.post('/api/jobs/:id/fork',async(req:any)=>{const j=entity(req,'jobs',req.params.id,true);const b=req.body?body(req,z.object({title:z.string().trim().min(1).max(200).or(z.literal('')).optional()})):{};const forked=await forkJob(j,user(req),b.title||undefined);audit(user(req).id,'job.fork',forked.id);return forked;});
 app.post('/api/jobs/:id/action',(req:any)=>{const j=entity(req,'jobs',req.params.id,true);if(j.deploymentId)needAdmin(req);const b=body(req,z.object({action:z.enum(['cancel','steer','followup','resume','approve']),text:z.string().max(20000).optional(),images:z.array(imageSchema).optional(),attachments:z.array(attachmentSchema).optional(),connectionId:z.string().optional(),model:z.string().optional(),thinkingLevel:thinking.optional()}));if(['cancel','steer','followup'].includes(b.action)){signalJob(j.id,b.action,b.text,b.images,b.attachments);return {ok:true}}if(['running','queued'].includes(j.status))throw Error('Job is already active');if(j.status==='awaiting_approval'&&b.action!=='approve')throw Error('Approve this job before it can edit files');if(b.action==='approve'&&j.status!=='awaiting_approval')throw Error('Job is not waiting for approval');const repo=get('repos',j.repoId)!;const targetConnId=b.connectionId!==undefined?b.connectionId:(j.connectionId||repo.connectionId);const targetModel=b.model!==undefined?b.model:(j.model||repo.model);const targetThinking=b.thinkingLevel!==undefined?b.thinkingLevel:(j.thinkingLevel||repo.thinkingLevel||'off');const conn=targetConnId?usable(targetConnId,user(req).id,j.projectId):undefined;if(b.text?.trim()||b.images?.length||b.attachments?.length)event(j.id,'user',{text:b.text,images:b.images,attachments:b.attachments,mode:'resume'});let resumeText=b.text?.trim()||'';if(b.attachments?.length){for(const att of b.attachments)resumeText+=`\n\n--- Attachment: ${att.name} ---\n${att.data}`;}audit(user(req).id,`job.${b.action}`,j.id);return put('jobs',{id:j.id,status:'queued',error:null,connectionId:targetConnId,provider:conn?.provider||j.provider,model:targetModel,thinkingLevel:targetThinking,resumePrompt:b.action==='approve'&&!resumeText?null:resumeText||(j.sessionFile?'Continue the previous task. Inspect the current state before repeating actions.':null),images:b.images||j.images,attachments:b.attachments||j.attachments});});
 app.post('/api/jobs/:id/submit-change',async(req:any)=>{const j=entity(req,'jobs',req.params.id,true);const repo=entity(req,'repos',j.repoId,true);const result=await submitChangeForJob(j,repo,user(req));audit(user(req).id,'job.submit_change',j.id);return result;});
 app.post('/api/workflows',req=>{const b=body(req,z.object({repoId:id,agentId:optId,name:str,prompt:str,kind:kind.optional(),trigger:z.enum(['schedule','change_created','change_updated','comment','conflict','test_failed']),intervalMinutes:z.number().int().min(5).max(525600).default(60),thinkingLevel:optThinking,autonomy:optMode}));const r=entity(req,'repos',b.repoId,true);const agent=b.agentId?visibleAgent(user(req),b.agentId,r.projectId):undefined;return put('workflows',{...b,agentId:agent?.id,kind:b.kind||agent?.kind||'implement',autonomy:b.autonomy||agent?.autonomy||'prepare',thinkingLevel:b.thinkingLevel||agent?.thinkingLevel||undefined,projectId:r.projectId,authorId:user(req).id,enabled:true,nextRun:Date.now()+b.intervalMinutes*60000});});
 app.patch('/api/workflows/:id',(req:any)=>{const w=entity(req,'workflows',req.params.id,true);const b=body(req,z.object({name:str.optional(),prompt:str.optional(),agentId:optId,kind:kind.optional(),intervalMinutes:z.number().int().min(5).max(525600).optional(),thinkingLevel:optThinking,autonomy:optMode,enabled:z.boolean().optional()}));if(b.agentId)visibleAgent(user(req),b.agentId,w.projectId);const patch:Record<string,any>={id:w.id};for(const [k,v] of Object.entries(b))if(v!==undefined)patch[k]=v===null||v===''?undefined:v;audit(user(req).id,'workflow.update',w.id);return put('workflows',patch);});
 app.delete('/api/workflows/:id',(req:any)=>{const w=entity(req,'workflows',req.params.id,true);del('workflows',w.id);audit(user(req).id,'workflow.delete',w.id);return {ok:true,id:w.id};});
 app.get('/api/providers',async()=>{const r=await runtime();return r.getProviders().map(p=>({id:p.id,name:p.name,methods:r.hasConfiguredAuth(p.id)||(p as any).baseUrl?.startsWith('cli:')?[]:[...(p.auth.apiKey?.login?['api_key']:[]),...(p.auth.oauth?['oauth']:[])],models:r.getModels(p.id).map(m=>({id:m.id,name:m.name,reasoning:Boolean(m.reasoning)}))}));});
 const logins=new Map<string,any>();
 app.post('/api/connections',async req=>{const b=body(req,z.object({name:str,provider:str,shared:z.boolean().default(false),projects:z.array(id).default([]),config:z.object({name:str,baseUrl:z.url(),api:z.enum(['openai-completions','openai-responses','anthropic-messages','google-generative-ai']),models:z.array(z.object({id:str,name:str,reasoning:z.boolean().default(false),input:z.array(z.enum(['text','image'])).default(['text']),contextWindow:z.number().positive().default(128000),maxTokens:z.number().positive().default(8192),cost:z.object({input:z.number(),output:z.number(),cacheRead:z.number(),cacheWrite:z.number()}).default({input:0,output:0,cacheRead:0,cacheWrite:0})})).min(1)}).optional()}));if(b.config)needAdmin(req);if(b.shared)needAdmin(req);for(const p of b.projects)entity(req,'projects',p);const r=await runtime();const isAutoConnected=r.hasConfiguredAuth(b.provider)||(!b.config&&(r.getProvider(b.provider) as any)?.baseUrl?.startsWith('cli:'));return safeConnection(put('connections',{...b,ownerId:user(req).id,status:isAutoConnected?'connected':'disconnected'}),r);});
 const connection=(req:any)=>{const c=get('connections',req.params.id);if(!c||c.ownerId!==user(req).id&&!admin(user(req)))throw Error('Connection access denied');return c;};
 app.delete('/api/connections/:id',(req:any)=>{const c=connection(req);logins.get(c.id)?.abort.abort();logins.delete(c.id);del('connections',c.id);return {ok:true}});
 app.post('/api/connections/:id/cancel-login',(req:any)=>{const c=connection(req),b=body(req,z.object({discard:z.boolean().default(false)}));logins.get(c.id)?.abort.abort();logins.delete(c.id);if(b.discard&&!c.secret)del('connections',c.id);return {ok:true};});
 app.post('/api/connections/:id/login',async(req:any)=>{const c=connection(req),b=body(req,z.object({method:z.enum(['api_key','oauth','ambient'])}));const r=await runtime(c.id);if(b.method==='ambient'||r.hasConfiguredAuth(c.provider)||(r.getProvider(c.provider) as any)?.baseUrl?.startsWith('cli:')){put('connections',{...c,status:'connected'});return {ok:true,status:'connected'};}connection(req);if(logins.get(c.id)?.status==='pending')throw Error('A login is already in progress');const state:any={status:'pending',events:[],prompt:null,resolve:null,abort:new AbortController()};logins.set(c.id,state);const timeout=setTimeout(()=>state.abort.abort(),10*60000);void r.login(c.provider,b.method,{signal:state.abort.signal,notify:e=>state.events.push(e),prompt:p=>new Promise((resolve,reject)=>{state.prompt={...p,signal:undefined};state.resolve=resolve;state.abort.signal.addEventListener('abort',()=>reject(Error('Login timed out')),{once:true});})},{getDeviceId:installationDeviceId,agentName:'Orchestra'}).then(()=>{state.status='connected';state.prompt=null}).catch(e=>{state.status='error';state.error=String(e);state.prompt=null}).finally(()=>clearTimeout(timeout));return {ok:true};});
 app.get('/api/connections/:id/login',(req:any)=>{connection(req);const s=logins.get(req.params.id);return s?{status:s.status,events:s.events,prompt:s.prompt,error:s.error}:{status:'idle'};});
 app.post('/api/connections/:id/answer',(req:any)=>{connection(req);const b=body(req,z.object({answer:z.string().min(1).max(20000)})),s=logins.get(req.params.id);if(!s?.resolve)throw Error('No authentication prompt pending');const resolve=s.resolve;s.resolve=null;s.prompt=null;resolve(b.answer);return {ok:true};});
 const getDeploymentEntity=(req:any,deployId:string,write=false)=>{const p=get('deployments',deployId)||get('previews',deployId);if(!p)throw Error('Deployment not found');const projectId=p.projectId;if(!(write?canOperate(user(req),projectId):canProject(user(req),projectId)))throw Error('Project access denied');return p;};
 const handleStartDeployment=async(req:any)=>{const b=body(req,z.object({repoId:id,jobId:id.optional(),branch:str.optional(),lifetimeMinutes:z.number().int().min(0).max(525600).optional(),customName:str.optional()}));const r=entity(req,'repos',b.repoId,true),j=b.jobId?entity(req,'jobs',b.jobId,true):undefined;if(j&&j.repoId!==r.id)throw Error('Job belongs to another repository');void startDeployment(r,j,user(req).id,{branch:b.branch,lifetimeMinutes:b.lifetimeMinutes,customName:b.customName}).catch(()=>{});return {ok:true};};
 app.post('/api/deployments',handleStartDeployment);
 app.post('/api/previews',handleStartDeployment);
 const handleDeploymentLink=(req:any)=>{const p=getDeploymentEntity(req,req.params.id);if(p.status!=='running')throw Error('Deployment is not running');return {url:deploymentLink(p,user(req).id,base(req))};};
 app.post('/api/deployments/:id/link',handleDeploymentLink);
 app.post('/api/previews/:id/link',(req:any)=>{const p=getDeploymentEntity(req,req.params.id);if(p.status!=='running')throw Error('Preview is not running');return {url:previewLink(p,user(req).id,base(req))};});
 const handleDeploymentLogs=async(req:any)=>{const p=getDeploymentEntity(req,req.params.id);return {log:await command('docker',['logs','--tail','100',p.name]).catch(String)}};
 app.get('/api/deployments/:id/logs',handleDeploymentLogs);
 app.get('/api/previews/:id/logs',handleDeploymentLogs);
 const handleDeploymentStop=(req:any)=>{getDeploymentEntity(req,req.params.id,true);return stopDeployment(req.params.id)};
 app.post('/api/deployments/:id/stop',handleDeploymentStop);
 app.post('/api/previews/:id/stop',handleDeploymentStop);
 const handleDeploymentRestart=(req:any)=>{getDeploymentEntity(req,req.params.id,true);return restartDeployment(req.params.id)};
 app.post('/api/deployments/:id/restart',handleDeploymentRestart);
 app.post('/api/previews/:id/restart',handleDeploymentRestart);
 const handleDeploymentConfigure=async(req:any)=>{getDeploymentEntity(req,req.params.id,true);const b=body(req,z.object({branch:str.optional(),lifetimeMinutes:z.number().int().min(0).max(525600).optional(),customName:str.optional()}));return configureDeployment(req.params.id,b);};
 app.patch('/api/deployments/:id',handleDeploymentConfigure);
 app.patch('/api/previews/:id',handleDeploymentConfigure);
 const handleDeploymentRemove=async(req:any)=>{getDeploymentEntity(req,req.params.id,true);return removeDeployment(req.params.id);};
 app.delete('/api/deployments/:id',handleDeploymentRemove);
 app.delete('/api/previews/:id',handleDeploymentRemove);
 const handleDeploymentCleanup=async(req:any)=>{const b=body(req,z.object({projectId:id.optional()}).default({}));if(b.projectId&&b.projectId!=='all'){if(!canOperate(user(req),b.projectId))throw Error('Project access denied');}return cleanupStoppedDeployments(b.projectId);};
 app.post('/api/deployments/cleanup',handleDeploymentCleanup);
 app.post('/api/previews/cleanup',handleDeploymentCleanup);
 app.get('/api/access',req=>{const u=user(req);return {users:admin(u)?all('users'):[u],devices:all('devices').filter(d=>admin(u)||d.userId===u.id).map(({hash,...d})=>d),invites:admin(u)?all('invites').map(({hash,...i})=>i):[]}});
 app.post('/api/invites',req=>{const b=body(req,z.object({userId:id.optional(),role:z.enum(['admin','operator','viewer']).default('viewer'),projects:z.array(id).default([])}));if(!b.userId||b.userId!==user(req).id)needAdmin(req);if(b.userId&&!get('users',b.userId))throw Error('User not found');const inv=issueInvite(b.userId,b.role,b.projects);audit(user(req).id,'invite.create',inv.id);return {url:`${base(req)}/onboarding#${inv.token}`,id:inv.id};});
 app.delete('/api/invites/:id',(req:any)=>{needAdmin(req);del('invites',req.params.id);return {ok:true}});
 app.delete('/api/devices/:id',(req:any)=>{const d=get('devices',req.params.id);if(d?.userId!==user(req).id)needAdmin(req);del('devices',req.params.id);return {ok:true}});
 app.patch('/api/users/:id',(req:any)=>{needAdmin(req);const b=body(req,z.object({role:z.enum(['owner','admin','operator','viewer']).optional(),projects:z.array(id).optional(),disabled:z.boolean().optional()}));const target=get('users',req.params.id);if(!target)throw Error('User not found');if((target.role==='owner'||b.role==='owner')&&user(req).role!=='owner')throw Error('Only an owner can manage owners');if(target.role==='owner'&&(b.disabled||b.role&&b.role!=='owner')&&all('users').filter(u=>u.role==='owner'&&!u.disabled).length===1)throw Error('Keep at least one active owner');return put('users',{id:target.id,...b});});
 app.post('/api/resources',req=>{const b=body(req,z.object({projectId:id.optional(),name:str,kind:z.enum(['prompt','skill','extension']),content:z.string().min(1).max(200000),parentId:id.optional()}));if(b.projectId)entity(req,'projects',b.projectId,true);else needAdmin(req);return put('resources',{...b,authorId:user(req).id,active:false,version:all('resources').filter(r=>(r.projectId||undefined)===(b.projectId||undefined)&&r.name===b.name).length+1});});
 app.post('/api/resources/:id/activate',async(req:any)=>{const r=entity(req,'resources',req.params.id,true);if(r.kind==='extension'||!r.projectId)needAdmin(req);if(r.kind==='extension'){const parsed=ts.transpileModule(r.content,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext},reportDiagnostics:true});if(parsed.diagnostics?.some(d=>d.category===ts.DiagnosticCategory.Error))throw Error('Extension has TypeScript syntax errors. Fix the draft before activation.');await mkdir(join(dataDir,'extensions'),{recursive:true});const path=join(dataDir,'extensions',`${r.id}.ts`);await writeFile(path,r.content,{mode:0o600});put('resources',{id:r.id,path});}for(const old of all('resources').filter(x=>(x.projectId||undefined)===(r.projectId||undefined)&&x.name===r.name))put('resources',{id:old.id,active:false});audit(user(req).id,'resource.activate',r.id);return put('resources',{id:r.id,active:true});});
 app.get('/api/self',req=>{needAdmin(req);return {repo:all('repos').find(r=>r.self),deployments:all('releases')};});
 app.post('/api/self/register',async req=>{needAdmin(req);return registerSelf()});
 app.post('/api/self/build',async req=>{needAdmin(req);const b=body(req,z.object({changeId:id}));return prepareDeployment(b.changeId,user(req).id)});
 app.post('/api/self/activate',async req=>{needAdmin(req);const b=body(req,z.object({id}));return activateDeployment(b.id,user(req).id)});
 app.post('/api/self/rollback',async req=>{needAdmin(req);return rollbackDeployment(user(req).id)});
 app.post('/api/self/restart',async req=>{needAdmin(req);return restartApp(user(req).id)});
 app.get('/api/admin',req=>{needAdmin(req);return adminSnapshot(user(req).id)});
 app.post('/api/admin/threads',req=>{needAdmin(req);return createAdminThread(user(req).id)});
 app.patch('/api/admin/threads/:id',async(req:any)=>{needAdmin(req);adminThread(req.params.id,user(req).id);const b=z.object({permissionMode:z.enum(['manual','yolo'])}).parse(req.body);audit(user(req).id,'admin.mode.'+b.permissionMode,req.params.id);return put('adminThreads',{id:req.params.id,...b});});
 app.get('/api/admin/threads/:id',(req:any)=>{needAdmin(req);return adminThread(req.params.id,user(req).id)});
 app.post('/api/admin/threads/:id/messages',(req:any)=>{needAdmin(req);return startAdminTurn(req.params.id,user(req).id,req.body)});
 app.patch('/api/admin/threads/:id/messages/:messageId',async(req:any)=>{needAdmin(req);const b=body(req,z.object({text:z.string().min(1).max(50000)}));return editAdminMessage(req.params.id,req.params.messageId,user(req).id,b.text);});
 app.delete('/api/admin/threads/:id/messages/:messageId',(req:any)=>{needAdmin(req);return deleteAdminMessage(req.params.id,req.params.messageId,user(req).id);});
 app.post('/api/admin/threads/:id/fork',async(req:any)=>{needAdmin(req);const b=body(req,z.object({title:z.string().optional(),messageId:z.string().optional()}).default({}));return forkAdminThread(req.params.id,user(req).id,b);});
 app.post('/api/admin/threads/:id/stop',(req:any)=>{needAdmin(req);return stopAdminTurn(req.params.id,user(req).id)});
 app.delete('/api/admin/threads/:id',(req:any)=>{needAdmin(req);return deleteAdminThread(req.params.id,user(req).id);});
 app.post('/api/admin/actions',req=>{needAdmin(req);const b=body(req,z.object({reason:str,action:z.unknown()}));return proposeAction(user(req).id,b.reason,b.action)});
 app.post('/api/admin/actions/:id/decision',(req:any)=>{needAdmin(req);const b=body(req,z.object({decision:z.enum(['approve','reject'])}));return decideAction(req.params.id,b.decision,user(req).id)});
 app.delete('/api/admin/actions/:id',(req:any)=>{needAdmin(req);del('adminActions',req.params.id);return {ok:true,id:req.params.id};});
 app.post('/api/admin/plugins',req=>{needAdmin(req);return draftPlugin(user(req).id,body(req,z.object({name:str,content:z.string().min(1).max(200000)})))});
 if(existsSync(resolve('dist')))await app.register(fastifyStatic,{root:resolve('dist')});
 app.setNotFoundHandler((req,reply)=>req.url.startsWith('/api/')?reply.code(404).send({error:'Not found'}):reply.sendFile('index.html'));
 return app;}
