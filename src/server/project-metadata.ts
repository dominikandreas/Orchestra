import { mkdir, writeFile, rm,rename } from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { dataDir } from './store.js';
import { locked } from './git.js';
import { commitId, gitOutput } from './git-process.js';

export type ProjectMetadata={name:string;description:string;knowledge:string;files?:Record<string,string>};
function knowledgePath(path:string){
 if(!path||path.length>240||path.includes('\\')||path.startsWith('/')||path.split('/').some(s=>!s||s==='.'||s==='..'||s.toLowerCase()==='.git')||/[\x00-\x1f\x7f]/.test(path))throw Error('Invalid knowledge path');
 return path;
}
export const MAX_PROJECT_METADATA_BYTES=256*1024;
const file='project.json';
/** A dedicated Git repository; never initializes, writes, or requires a code repository. */
export function projectMetadataPath(projectId:string){
 if(!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,159}$/.test(projectId))throw Error('Invalid project id');
 return join(dataDir,'project-metadata',projectId);
}
function encode(value:ProjectMetadata){
 if(typeof value.name!=='string'||!value.name.trim()||typeof value.description!=='string'||typeof value.knowledge!=='string')throw Error('Invalid project metadata');
 if(value.files!==undefined){if(!value.files||typeof value.files!=='object'||Array.isArray(value.files))throw Error('Invalid knowledge files');for(const [path,content] of Object.entries(value.files)){knowledgePath(path);if(typeof content!=='string')throw Error('Invalid knowledge content');}}
 const text=JSON.stringify({name:value.name,description:value.description,knowledge:value.knowledge,...(value.files?{files:value.files}:{})},null,2)+'\n';
 if(Buffer.byteLength(text)>MAX_PROJECT_METADATA_BYTES)throw Error('Project metadata exceeds size limit');
 return text;
}
async function commit(path:string,message:string,author?:{id?:string;name?:string},authorize?:()=>void){
 await gitOutput(path,['add','--',file]);
 const name=(author?.name||'Orchestra').replace(/[\r\n<>]/g,' ').trim()||'Orchestra';
 const email=author?.id&&/^[a-zA-Z0-9_-]+$/.test(author.id)?`${author.id}@orchestra.local`:'orchestra@localhost';
 authorize?.();
 await gitOutput(path,['-c',`user.name=${name}`,'-c',`user.email=${email}`,'-c','commit.gpgsign=false','commit','-m',message,'--',file]);
}
export async function createProjectMetadata(projectId:string,initial:{name:string;description?:string;knowledge?:string}){
 return locked(`project-metadata:${projectId}`,()=>initializeProjectMetadata(projectId,initial));
}
async function initializeProjectMetadata(projectId:string,initial:{name:string;description?:string;knowledge?:string}){
 const destination=projectMetadataPath(projectId),path=`${destination}.initializing-${randomUUID()}`;
 const text=encode({name:initial.name,description:initial.description??'',knowledge:initial.knowledge??''});
 if(existsSync(destination))throw Error('Project metadata already exists');
 await mkdir(path,{recursive:true,mode:0o700});
 try{
  await gitOutput(path,['init','-b','main','.']);
  await writeFile(join(path,file),text,{mode:0o600,flag:'wx'});
  await commit(path,'Create project knowledge');
  await rename(path,destination);
  return readProjectMetadata(projectId);
 }catch(e){await rm(path,{recursive:true,force:true});throw e;}
}
export async function readProjectMetadata(projectId:string,ref='HEAD'){
 const path=projectMetadataPath(projectId),revision=await commitId(path,ref);
 const text=await gitOutput(path,['show',`${revision}:${file}`],MAX_PROJECT_METADATA_BYTES);
 const metadata=JSON.parse(text) as ProjectMetadata;encode(metadata);
 return {projectId,revision,metadata};
}
/** Compare-and-swap guards against two editors overwriting each other's knowledge. */
export async function updateProjectMetadata(projectId:string,patch:Partial<ProjectMetadata>,expectedRevision:string,author?:{id?:string;name?:string},authorize?:()=>void){
 return locked(`project-metadata:${projectId}`,async()=>{
  authorize?.();
  const current=await readProjectMetadata(projectId);
  authorize?.();
  if(current.revision!==expectedRevision)throw Error('Project metadata changed. Reload before updating.');
  if(Object.keys(patch).some(key=>!['name','description','knowledge','files'].includes(key)))throw Error('Invalid project metadata field');
  const text=encode({...current.metadata,...patch});
  if(text===encode(current.metadata))return current;
  const path=projectMetadataPath(projectId);
  await writeFile(join(path,file),text,{mode:0o600});
  await commit(path,'Update project knowledge',author,authorize);
  return readProjectMetadata(projectId);
 });
}
/** Route-facing knowledge files live inside the versioned metadata document, not on disk paths. */
export async function ensureProjectKnowledge(project:{id:string;name?:string;description?:string}){
 return locked(`project-metadata:${project.id}`,async()=>{
  const path=projectMetadataPath(project.id);
  if(existsSync(path)){
   try{return await readProjectMetadata(project.id);}catch(error){
    // Retain incomplete legacy initialization for inspection, never overwrite committed history.
    const refs=await gitOutput(path,[`--git-dir=${join(path,'.git')}`,'for-each-ref','--format=%(refname)']).catch(()=>null);
    if(refs?.trim()||(refs===null&&existsSync(join(path,'.git','HEAD'))))throw error;
    await rename(path,`${path}.incomplete-${randomUUID()}`);
   }
  }
  return initializeProjectMetadata(project.id,{name:project.name||'Project',description:project.description||'',knowledge:'# Project knowledge\n\n'});
 });
}
export async function projectKnowledge(project:{id:string;name?:string;description?:string}){
 const state=await ensureProjectKnowledge(project);
 const files=state.metadata.files??{'knowledge.md':state.metadata.knowledge};
 return {projectId:project.id,revision:state.revision,files:Object.entries(files).map(([path,content])=>({path,content}))};
}
export async function saveProjectKnowledge(project:{id:string;name?:string;description?:string},path:string,content:string,author?:{id?:string;name?:string}|string,expectedRevision?:string,authorize?:()=>void){
 knowledgePath(path);if(typeof content!=='string')throw Error('Invalid knowledge content');
 return locked(`project-knowledge:${project.id}`,async()=>{
  authorize?.();
  const current=await ensureProjectKnowledge(project);
  authorize?.();
  if(expectedRevision&&current.revision!==expectedRevision)throw Error('Project knowledge changed. Reload before saving.');
  const files=Object.fromEntries(Object.entries(current.metadata.files??{'knowledge.md':current.metadata.knowledge}));
  Object.defineProperty(files,path,{value:content,enumerable:true,configurable:true,writable:true});
  await updateProjectMetadata(project.id,{files,...(path==='knowledge.md'?{knowledge:content}:{})},current.revision,typeof author==='string'?{name:author}:author,authorize);
  return projectKnowledge(project);
 });
}
export async function projectMetadataHistory(projectId:string,limit=30){
 if(!Number.isSafeInteger(limit)||limit<1||limit>100)throw Error('Invalid history limit');
 const out=await gitOutput(projectMetadataPath(projectId),['log',`-n${limit}`,'--format=%H%x00%aI%x00%s','--',file]);
 return out.trim().split('\n').filter(Boolean).map(line=>{const [revision,created,message]=line.split('\0');return {revision,created,message};});
}
