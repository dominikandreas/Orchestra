import type { Row } from './store.js';
import { get } from './store.js';
import { commitId, gitOutput, GitCommandError } from './git-process.js';

export type DiffOptions={includeHidden?:boolean;offset?:number;limit?:number};
export type DiffFile={path:string;oldPath?:string;status:string;additions:number;deletions:number;binary:boolean;hidden:boolean;hiddenReason:'dependency'|'generated'|null};
export type DiffLine={kind:'context'|'addition'|'deletion';text:string;oldLine:number|null;newLine:number|null};
export type DiffHunk={header:string;oldStart:number;oldCount:number;newStart:number;newCount:number;lines:DiffLine[]};
export const MAX_DIFF_FILE_BYTES=512*1024;
export const MAX_DIFF_PATCH_BYTES=256*1024;

export function hiddenDiffReason(path:string):DiffFile['hiddenReason'] {
 if(/(^|\/)(node_modules|vendor|bower_components|\.yarn|\.pnpm-store)(\/|$)/i.test(path))return 'dependency';
 if(/(^|\/)(dist|build|coverage|\.next|\.nuxt|\.cache|generated|__generated__)(\/|$)/i.test(path)||/(\.min\.(js|css)|\.map|\.generated\.[^/]+)$/i.test(path)||/(^|\/)(package-lock\.json|yarn\.lock|pnpm-lock\.yaml|bun\.lockb?|Cargo\.lock|poetry\.lock|composer\.lock|Gemfile\.lock)$/i.test(path))return 'generated';
 return null;
}
const diffArgs=['diff','--no-color','--no-ext-diff','--no-textconv','--find-renames'];
async function manifest(repo:Row,target:string,source:string){
 const targetSha=await commitId(repo.path,target),sourceSha=await commitId(repo.path,source);
 const baseSha=(await gitOutput(repo.path,['merge-base',targetSha,sourceSha],1024)).trim();
 const names=(await gitOutput(repo.path,[...diffArgs,'--name-status','-z',baseSha,sourceSha,'--'])).split('\0');
 const stats=(await gitOutput(repo.path,[...diffArgs,'--numstat','-z',baseSha,sourceSha,'--'])).split('\0');
 const byPath=new Map<string,{additions:number;deletions:number;binary:boolean}>();
 for(let i=0;i<stats.length&&stats[i];i++){
  const m=/^([^\t]+)\t([^\t]+)\t([\s\S]*)$/.exec(stats[i]);if(!m)throw Error('Invalid Git diff statistics');
  let path=m[3];if(!path){i++;path=stats[++i];}
  byPath.set(path,{additions:m[1]==='-'?0:Number(m[1]),deletions:m[2]==='-'?0:Number(m[2]),binary:m[1]==='-'});
 }
 const files:DiffFile[]=[];
 for(let i=0;i<names.length&&names[i];i++){
  const status=names[i];let path=names[++i],oldPath:string|undefined;
  if(status.startsWith('R')||status.startsWith('C')){oldPath=path;path=names[++i];}
  const hiddenReason=hiddenDiffReason(path)||(oldPath?hiddenDiffReason(oldPath):null);
  files.push({path,oldPath,status,hidden:hiddenReason!==null,hiddenReason,...byPath.get(path)!});
 }
 return {targetSha,sourceSha,baseSha,files};
}
function pageNumber(value:number|undefined,fallback:number,max:number){if(value===undefined)return fallback;if(!Number.isSafeInteger(value)||value<0)throw Error('Invalid pagination');return Math.min(value,max);}
/** Metadata only, paginated; hidden counts always describe the complete comparison. */
export async function structuredDiff(repo:Row,target:string,source:string,options:DiffOptions={}) {
 const {files,...refs}=await manifest(repo,target,source);
 const hiddenFiles=files.filter(f=>f.hidden).length;
 const visible=options.includeHidden?files:files.filter(f=>!f.hidden);
 const offset=pageNumber(options.offset,0,files.length),limit=pageNumber(options.limit,100,500);
 return {...refs,files:visible.slice(offset,offset+limit),counts:{total:files.length,hidden:hiddenFiles,visible:files.length-hiddenFiles,matching:visible.length,returned:visible.slice(offset,offset+limit).length},offset,limit,hasMore:offset+limit<visible.length};
}
export function parseDiffHunks(patch:string):DiffHunk[]{
 const hunks:DiffHunk[]=[];let h:DiffHunk|undefined,old=0,next=0;
 for(const line of patch.split('\n')){
  const m=/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(line);
  if(m){old=Number(m[1]);next=Number(m[3]);h={header:line,oldStart:old,oldCount:Number(m[2]??1),newStart:next,newCount:Number(m[4]??1),lines:[]};hunks.push(h);continue;}
  if(!h)continue;
  if(line.startsWith('+'))h.lines.push({kind:'addition',text:line.slice(1),oldLine:null,newLine:next++});
  else if(line.startsWith('-'))h.lines.push({kind:'deletion',text:line.slice(1),oldLine:old++,newLine:null});
  else if(line.startsWith(' '))h.lines.push({kind:'context',text:line.slice(1),oldLine:old++,newLine:next++});
 }
 return hunks;
}
/** Exact manifest path required. Hidden content needs a separate explicit opt-in. */
export async function structuredFileDiff(repo:Row,target:string,source:string,path:string,options:Pick<DiffOptions,'includeHidden'>={}) {
 const {files,...refs}=await manifest(repo,target,source);
 const file=files.find(f=>f.path===path);if(!file)throw Error('File is not in this diff');
 const result={...refs,file,hunks:[] as DiffHunk[],patch:'',tooLarge:false};
 if(file.hidden&&!options.includeHidden)return {...result,hidden:true};
 if(file.binary)return {...result,hidden:false};
 for(const [ref,name] of [[refs.baseSha,file.oldPath||path],[refs.sourceSha,path]]){
  if((ref===refs.baseSha&&file.status==='A')||(ref===refs.sourceSha&&file.status==='D'))continue;
  const size=Number((await gitOutput(repo.path,['cat-file','-s',`${ref}:${name}`],1024)).trim());
  if(size>MAX_DIFF_FILE_BYTES)return {...result,tooLarge:true,hidden:false};
 }
 try{
  const patch=await gitOutput(repo.path,[...diffArgs,'--unified=3',refs.baseSha,refs.sourceSha,'--',...(file.oldPath?[file.oldPath,path]:[path])],MAX_DIFF_PATCH_BYTES);
  return {...result,patch,hunks:parseDiffHunks(patch),hidden:false};
 }catch(e){if(e instanceof GitCommandError&&e.code===null&&e.message==='Git output exceeds size limit')return {...result,tooLarge:true,hidden:false};throw e;}
}
/** Compatibility text endpoint; dependency/generated files are hidden unless opted in. */
export async function rawChangeDiff(change:Row,options:{includeGenerated?:boolean}={}){
 const repo=changeRepo(change),{files,baseSha,sourceSha}=await manifest(repo,change.targetSha,change.sourceSha);
 const visible=options.includeGenerated?files:files.filter(f=>!f.hidden);
 if(!visible.length)return '';
 const paths=[...new Set(visible.flatMap(f=>f.oldPath?[f.oldPath,f.path]:[f.path]))];
 if(paths.length>5000||Buffer.byteLength(paths.join('\0'))>128*1024)throw Error('Diff contains too many paths; use the structured diff API');
 return gitOutput(repo.path,[...diffArgs,baseSha,sourceSha,'--',...paths]);
}
function changeRepo(change:Row){const repo=get('repos',change.repoId);if(!repo)throw Error('Repository not found');return repo;}
export const structuredChangeDiff=(change:Row,options:DiffOptions={})=>structuredDiff(changeRepo(change),change.targetSha,change.sourceSha,options);
export const structuredChangeFileDiff=(change:Row,path:string,options:Pick<DiffOptions,'includeHidden'>={})=>structuredFileDiff(changeRepo(change),change.targetSha,change.sourceSha,path,options);
