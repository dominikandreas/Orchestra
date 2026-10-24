import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { randomBytes, createHash, createCipheriv, createDecipheriv, randomUUID } from 'node:crypto';
// Accept Orchestra settings while retaining compatibility with existing installations.
for(const [name,value] of Object.entries(process.env)){if(name.startsWith('ORCHESTRA_')&&value!==undefined)process.env['RELAY_'+name.slice(10)]=value;}
export const dataDir=resolve(process.env.RELAY_DATA_DIR||'.data');
mkdirSync(dataDir,{recursive:true,mode:0o700});
export const db=new DatabaseSync(join(dataDir,'relay.sqlite'));
db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000; CREATE TABLE IF NOT EXISTS records(kind TEXT NOT NULL,id TEXT NOT NULL,data TEXT NOT NULL,PRIMARY KEY(kind,id)); CREATE TABLE IF NOT EXISTS events(seq INTEGER PRIMARY KEY AUTOINCREMENT,job TEXT NOT NULL,type TEXT NOT NULL,data TEXT NOT NULL,created TEXT NOT NULL); CREATE INDEX IF NOT EXISTS events_job ON events(job,seq); PRAGMA user_version=1;`);
export type Row={id:string;created:string;updated:string;[key:string]:any};
export function all(kind:string):Row[]{return (db.prepare('SELECT data FROM records WHERE kind=?').all(kind) as any[]).map(r=>JSON.parse(r.data));}
export function get(kind:string,id:string):Row|undefined{if(!id)return undefined;const r=db.prepare('SELECT data FROM records WHERE kind=? AND id=?').get(kind,id) as any;return r?JSON.parse(r.data):undefined;}
export function put(kind:string,entry:Partial<Row>&{id?:string}):Row{const old=entry.id?get(kind,entry.id):undefined;const now=new Date().toISOString();const row={id:randomUUID(),created:now,...old,...entry,updated:now} as Row;db.prepare('INSERT OR REPLACE INTO records(kind,id,data) VALUES(?,?,?)').run(kind,row.id,JSON.stringify(row));return row;}
export function del(kind:string,id:string){db.prepare('DELETE FROM records WHERE kind=? AND id=?').run(kind,id);}
export function transaction<T>(fn:()=>T):T{db.exec('BEGIN IMMEDIATE');try{const result=fn();db.exec('COMMIT');return result;}catch(e){db.exec('ROLLBACK');throw e;}}
export const hash=(s:string)=>createHash('sha256').update(s).digest('hex');
export const token=()=>randomBytes(32).toString('base64url');
const keyPath=join(dataDir,'master.key');if(!existsSync(keyPath))writeFileSync(keyPath,randomBytes(32),{mode:0o600});const key=readFileSync(keyPath);
export function encrypt(value:any){const iv=randomBytes(12),c=createCipheriv('aes-256-gcm',key,iv);const body=Buffer.concat([c.update(JSON.stringify(value),'utf8'),c.final()]);return Buffer.concat([iv,c.getAuthTag(),body]).toString('base64');}
export function decrypt(value:string){const b=Buffer.from(value,'base64'),d=createDecipheriv('aes-256-gcm',key,b.subarray(0,12));d.setAuthTag(b.subarray(12,28));return JSON.parse(Buffer.concat([d.update(b.subarray(28)),d.final()]).toString());}
export function event(job:string,type:string,data:any){db.prepare('INSERT INTO events(job,type,data,created) VALUES(?,?,?,?)').run(job,type,JSON.stringify(redact(data)),new Date().toISOString());}
export function events(job:string,after=0){return (db.prepare('SELECT * FROM events WHERE job=? AND seq>? ORDER BY seq LIMIT 500').all(job,after) as any[]).map(r=>({...r,data:JSON.parse(r.data)}));}
export const admin=(u:Row)=>['owner','admin'].includes(u.role);
export const canProject=(u:Row,id:string)=>admin(u)||(u.projects||[]).includes(id);
export const canOperate=(u:Row,id:string)=>canProject(u,id)&&u.role!=='viewer';
export function audit(actor:string,action:string,target:string){put('audit',{actor,action,target});}
export function issueInvite(userId?:string,role='viewer',projects:string[]=[],hours=24){const secret=token();const row=put('invites',{hash:hash(secret),userId,role,projects,expires:Date.now()+hours*3600000});return {id:row.id,token:secret};}
export function redeemInvite(secret:string,name:string){return transaction(()=>{const invite=all('invites').find(i=>i.hash===hash(secret)&&i.expires>Date.now());if(!invite)throw Error('This invite has expired or was already used.');const user=invite.userId?get('users',invite.userId):put('users',{name,role:invite.role,projects:invite.projects});if(!user||user.disabled)throw Error('Account unavailable');const raw=token();put('devices',{userId:user.id,name:'Browser',hash:hash(raw)});del('invites',invite.id);return {token:raw,user};});}

export function redact(value:any):any{let text=JSON.stringify(value);if(text===undefined)return value;for(const c of all('connections')){if(!c.secret)continue;try{const secret=decrypt(c.secret);for(const key of ['key','access','refresh'])if(typeof secret[key]==='string'&&secret[key].length>7)text=text.split(secret[key]).join('[REDACTED]');}catch{}}try{return JSON.parse(text)}catch{return '[Redacted output]';}}

// Persist across restarts and share across provider connections on this installation.
export function installationDeviceId():string {
 return transaction(()=>{
  const existing=get('system','installation');
  if(existing?.deviceId)return existing.deviceId;
  return put('system',{id:'installation',deviceId:randomUUID()}).deviceId;
 });
}
