import {recoverAdminRuns,shutdownAdmin} from './admin-agent.js';
import {recoverExternalOperations,shutdownExternalOperations} from './external.js';
import { createApp } from './app.js';
import { startQueue,shutdownJobs } from './jobs.js';
import { serveDeployments,migratePreviewsToDeployments } from './deployments.js';
import { servePreviews } from './previews.js';
import { all,issueInvite,dataDir,put } from './store.js';
import { ensureDefaultConnections } from './providers.js';
import { writeFileSync,existsSync,readFileSync } from 'node:fs';
import { stopSandbox } from './docker.js';
import { join } from 'node:path';
const host=process.env.RELAY_HOST||'0.0.0.0',port=Number(process.env.PORT||4310);
migratePreviewsToDeployments();
for(const j of all('jobs').filter(j=>j.status==='running')){await stopSandbox(`relay-job-${j.id}`);await stopSandbox(`relay-test-${j.id}`);}
for(const d of all('releases').concat(all('deployments')).filter(d=>d.status==='building')){await stopSandbox(`relay-release-${d.id}`);put('releases',{id:d.id,status:'failed',error:'Build interrupted by restart'});}
for(const p of all('deployments').concat(all('previews')).filter(p=>p.status==='starting')){await stopSandbox(`relay-preview-${p.id}`);await stopSandbox(`relay-deploy-${p.id}`);put('deployments',{id:p.id,status:'failed',error:'Deployment startup interrupted'});}
recoverAdminRuns();
recoverExternalOperations();
ensureDefaultConnections();
const app=await createApp();await app.listen({host,port});const previewServer=servePreviews(host);startQueue();
const url=process.env.RELAY_BASE_URL||`${process.env.RELAY_TLS_CERT?'https':'http'}://localhost:${port}`;
console.log(`Orchestra is running at ${url}`);
if(!all('users').length){const path=join(dataDir,'bootstrap-url');if(!existsSync(path)){const inv=issueInvite(undefined,'owner',[],24);writeFileSync(path,`${url}/onboarding#${inv.token}`,{mode:0o600});}console.log(`Setup link saved to ${path}`);}
const shutdown=async()=>{shutdownExternalOperations();await shutdownAdmin();await shutdownJobs();previewServer.close();await app.close();process.exit(0)};process.on('SIGTERM',shutdown);process.on('SIGINT',shutdown);
