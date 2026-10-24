import { ModelRuntime } from '@earendil-works/pi-coding-agent';
import type { CredentialStore,Credential } from '@earendil-works/pi-ai';
import { all,get,put,del,encrypt,decrypt,transaction,token } from './store.js';
export function credentialStore(connectionId:string):CredentialStore {
 const read=async()=>{const r=get('connections',connectionId);return r?.secret?decrypt(r.secret) as Credential:undefined;};
 async function exclusive<T>(fn:()=>Promise<T>):Promise<T>{const owner=token(),key=`credential:${connectionId}`;let held=false;for(let n=0;n<300&&!held;n++){held=transaction(()=>{const l=get('locks',key);if(l&&l.expires>Date.now())return false;put('locks',{id:key,owner,expires:Date.now()+120000});return true;});if(!held)await new Promise(r=>setTimeout(r,100));}if(!held)throw Error('Credential is busy; retry shortly');try{return await fn()}finally{if(get('locks',key)?.owner===owner)del('locks',key);}}
 return {read:async()=>read(),list:async()=>{const c=await read();const r=get('connections',connectionId);return c&&r?[{providerId:r.provider,type:c.type}]:[];},modify:async(_,fn)=>exclusive(async()=>{const next=await fn(await read());if(next){const r=get('connections',connectionId);if(!r)throw Error('Connection revoked');put('connections',{...r,secret:encrypt(next),status:'connected'});}return next||await read();}),delete:async()=>exclusive(async()=>{const r=get('connections',connectionId);if(r)put('connections',{...r,secret:null,status:'disconnected'});})};
}
export async function runtime(id?:string){const r=await ModelRuntime.create({credentials:id?credentialStore(id):{read:async()=>undefined,list:async()=>[],modify:async(_,fn)=>fn(undefined),delete:async()=>{}},modelsPath:null,refreshOnCreate:false});const c=id?get('connections',id):undefined;if(c?.config)r.registerProvider(c.provider,c.config);return r;}
export function usable(connectionId:string,userId:string,projectId:string){const c=get('connections',connectionId);return c&&c.status==='connected'&&(c.ownerId===userId||c.shared&&(c.projects||[]).includes(projectId))?c:undefined;}
export const safeConnection=(c:any)=>{const {secret,...safe}=c;return safe;};
