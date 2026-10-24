import { ModelRuntime, DefaultResourceLoader, SettingsManager } from '@earendil-works/pi-coding-agent';
import type { CredentialStore,Credential } from '@earendil-works/pi-ai';
import { all,get,put,del,encrypt,decrypt,transaction,token,dataDir } from './store.js';
import { packageManager, pluginPaths, adminDir } from './admin-control.js';
import { join } from 'node:path';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

let cachedExtensionProviders: any[] | null = null;
let lastExtensionFingerprint = '';

export function invalidateExtensionProvidersCache(){
 cachedExtensionProviders=null;
 lastExtensionFingerprint='';
}

export function ensureAgyEnvironment(){
 const binDir=join(dataDir,'bin');
 const wrapperPath=join(binDir,'agy-wrapper');
 if(!existsSync(wrapperPath)){
  try{
   mkdirSync(binDir,{recursive:true});
   writeFileSync(wrapperPath,'#!/bin/sh\nexec agy --dangerously-skip-permissions "$@"\n',{mode:0o755});
  }catch{}
 }
 if(!process.env.AGY_PI_BIN&&existsSync(wrapperPath)){
  process.env.AGY_PI_BIN=wrapperPath;
 }
 if(!process.env.AGY_PI_TURN_TIMEOUT_MS){
  process.env.AGY_PI_TURN_TIMEOUT_MS='600000';
 }
 if(!process.env.AGY_PI_MODELS){
  try{
   const res=spawnSync('agy',['models'],{encoding:'utf8',timeout:8000,env:{...process.env,HOME:process.env.HOME||''}});
   if(res.status===0&&res.stdout){
    const ids=res.stdout.split('\n')
      .map(l=>l.replace(/\r/g,'').trim().split('\t')[0]?.trim())
      .filter(id=>id&&!id.includes(' ')&&!id.includes('...'));
    if(ids.length)process.env.AGY_PI_MODELS=ids.join(',');
   }
  }catch{}
 }
}
export const ensureAgyModelsDiscovered = ensureAgyEnvironment;
ensureAgyEnvironment();

export async function getExtensionProviders(){
 const enabledRecords=all('adminPlugins').filter(p=>p.status==='enabled');
 const fingerprint=enabledRecords.map(p=>`${p.id}:${p.updated||p.created}`).sort().join(';');
 if(cachedExtensionProviders&&fingerprint===lastExtensionFingerprint)return cachedExtensionProviders;
 ensureAgyModelsDiscovered();
 const pm=packageManager();
 const paths=await pm.resolve(async()=>'skip');
 const enabledSources=new Set(enabledRecords.filter(p=>p.kind==='package').map(p=>p.source));
 const allowed=(r:any)=>r.enabled&&enabledSources.has(r.metadata.source);
 const extensionPaths=[...pluginPaths(),...paths.extensions.filter(allowed).map(r=>r.path)];
 if(!extensionPaths.length){
  cachedExtensionProviders=[];
  lastExtensionFingerprint=fingerprint;
  return [];
 }
 try{
  const loader=new DefaultResourceLoader({
   cwd:adminDir,
   agentDir:join(adminDir,'isolated-loader'),
   settingsManager:SettingsManager.inMemory(),
   noExtensions:true,
   noSkills:true,
   noPromptTemplates:true,
   noThemes:true,
   noContextFiles:true,
   additionalExtensionPaths:extensionPaths,
  });
  await loader.reload();
  cachedExtensionProviders=loader.getExtensions().runtime.pendingProviderRegistrations||[];
  lastExtensionFingerprint=fingerprint;
  return cachedExtensionProviders;
 }catch(err){
  console.error('Failed to resolve extension providers:',err);
  return cachedExtensionProviders||[];
 }
}

export function ensureDefaultConnections(){
 const hasAgyPlugin=all('adminPlugins').some(p=>p.kind==='package'&&p.source==='npm:agy-pi'&&p.status==='enabled');
 if(hasAgyPlugin){
  const hasAgyConn=all('connections').some(c=>c.provider==='agy');
  if(!hasAgyConn){
   const owner=all('users').find(u=>u.role==='owner')||all('users')[0];
   if(owner){
    put('connections',{
     name:'Agy CLI',
     provider:'agy',
     shared:true,
     projects:[],
     ownerId:owner.id,
     status:'connected'
    });
   }
  }
 }
}

export function credentialStore(connectionId:string):CredentialStore {
 const read=async()=>{const r=get('connections',connectionId);return r?.secret?decrypt(r.secret) as Credential:undefined;};
 async function exclusive<T>(fn:()=>Promise<T>):Promise<T>{const owner=token(),key=`credential:${connectionId}`;let held=false;for(let n=0;n<300&&!held;n++){held=transaction(()=>{const l=get('locks',key);if(l&&l.expires>Date.now())return false;put('locks',{id:key,owner,expires:Date.now()+120000});return true;});if(!held)await new Promise(r=>setTimeout(r,100));}if(!held)throw Error('Credential is busy; retry shortly');try{return await fn()}finally{if(get('locks',key)?.owner===owner)del('locks',key);}}
 return {read:async()=>read(),list:async()=>{const c=await read();const r=get('connections',connectionId);return c&&r?[{providerId:r.provider,type:c.type}]:[];},modify:async(_,fn)=>exclusive(async()=>{const next=await fn(await read());if(next){const r=get('connections',connectionId);if(!r)throw Error('Connection revoked');put('connections',{...r,secret:encrypt(next),status:'connected'});}return next||await read();}),delete:async()=>exclusive(async()=>{const r=get('connections',connectionId);if(r)put('connections',{...r,secret:null,status:'disconnected'});})};
}
export async function runtime(id?:string){
 const r=await ModelRuntime.create({credentials:id?credentialStore(id):{read:async()=>undefined,list:async()=>[],modify:async(_,fn)=>fn(undefined),delete:async()=>{}},modelsPath:null,refreshOnCreate:false});
 const extensionProviders=await getExtensionProviders();
 for(const reg of extensionProviders){
  try{r.registerProvider(reg.name,reg.config);}catch(err){console.error('Failed to register extension provider',reg.name,err);}
 }
 const c=id?get('connections',id):undefined;
 if(c?.config)r.registerProvider(c.provider,c.config);
 return r;
}
export function usable(connectionId:string,userId:string,projectId:string){const c=get('connections',connectionId);return c&&c.status==='connected'&&(c.ownerId===userId||c.shared&&(c.projects||[]).includes(projectId))?c:undefined;}
export function safeConnection(c:any,r?:any){
 const {secret,...safe}=c;
 if(safe.config?.models?.length){
  safe.models=safe.config.models;
 }else if(r){
  try{
   safe.models=r.getModels(safe.provider).map((m:any)=>({id:m.id,name:m.name}));
  }catch{
   safe.models=[];
  }
 }
 return safe;
}
