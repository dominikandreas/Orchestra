import React,{useEffect,useRef,useState} from 'react';
import {ArrowRight,BookOpen,FileText,FolderGit2,GitPullRequest,Plus,RefreshCw,Save,Search,Sparkles,Zap} from 'lucide-react';
import {api,ago,attentionStatuses,triggerLabel,type Item} from './lib';
import {ErrorNote,Spinner,Status,useWorkspace} from './ui';
import {Markdown} from './markdown';
import {ProjectConversation} from './project-conversation';
import {PlannedChangeButton} from './planned-change';
import './project-workspace.css';

type KnowledgeFile={path:string,content?:string};
type Draft={content:string,saved:string,revision?:string};
type Drafts=Map<string,Draft>;
const draftStorageKey='orchestra:project-knowledge-drafts';
function restoreDrafts():Drafts{
 try{const entries=JSON.parse(sessionStorage.getItem(draftStorageKey)||'[]');return new Map(entries.filter((e:any)=>Array.isArray(e)&&typeof e[0]==='string'&&typeof e[1]?.content==='string'&&typeof e[1]?.saved==='string'));}catch{return new Map();}
}
const recent=(items:Item[])=>[...items].sort((a,b)=>String(b.updated||b.created||'').localeCompare(String(a.updated||a.created||'')));
const inProject=(item:Item,id:string,repos:Item[])=>item.projectId===id||(!item.projectId&&repos.some(r=>r.id===item.repoId&&r.projectId===id));
const validPath=(path:string)=>Boolean(path)&&!path.startsWith('/')&&!path.includes('\\')&&!path.split('/').some(p=>!p||p==='.'||p==='..');

/** Project documentation first; repositories and task activity remain linked, not simulated. */
export function ProjectWorkspace({onNewRepo,onNewProject}:{onNewRepo?:()=>void;onNewProject?:()=>void}={}){
 const {state,project,setProject,go,canEdit,isAdmin}=useWorkspace();
 const [drafts]=useState<Drafts>(restoreDrafts);
 const projects:Item[]=state.projects||[],repos:Item[]=state.repos||[];
 const selected=projects.find(p=>p.id===project);
 const [query,setQuery]=useState('');
 const jobs:Item[]=state.jobs||[],changes:Item[]=state.changes||[],workflows:Item[]=state.workflows||[];
 if(project==='all')return <main className="page-body pw-workspace">
  <header className="pw-heading"><div><span className="pw-eyebrow">System scope · Project directory</span><h1>Your projects</h1><p>Start with what matters. Keep project knowledge together, then follow the work across repositories.</p></div>{isAdmin&&onNewProject?<button type="button" className="btn btn-primary" onClick={onNewProject}><Plus size={14}/>New project</button>:<BookOpen size={28}/>}</header>
  <div className="pw-overview-bar"><span>{projects.length} project{projects.length===1?'':'s'}</span><label className="pw-search"><Search size={14}/><input aria-label="Find a project" placeholder="Find a project…" value={query} onChange={e=>setQuery(e.target.value)}/></label></div>
  <div className="pw-project-grid">{projects.filter(p=>`${p.name} ${p.description||''}`.toLowerCase().includes(query.toLowerCase())).map(p=>{
   const projectJobs=jobs.filter(j=>inProject(j,p.id,repos)&&!j.archived);
   return <button type="button" className="pw-project-card" key={p.id} onClick={()=>setProject(p.id)}><span className="pw-eyebrow">Project scope</span><h2>{p.name}<ArrowRight size={17}/></h2><p>{p.description||'Capture goals, decisions and working agreements in project knowledge.'}</p><div className="pw-project-counts"><span>{repos.filter(r=>r.projectId===p.id).length} repositories</span><span>{projectJobs.length} sessions</span><span>{changes.filter(c=>inProject(c,p.id,repos)&&c.status==='open').length} open changes</span></div><span className="pw-card-cta">Open project knowledge <ArrowRight size={13}/></span></button>;
  })}</div>
  {!projects.length&&<div className="pw-empty"><BookOpen size={24}/><h2>A home for your project knowledge</h2><p>Collect goals, decisions and documentation. A repository is not required to begin.</p>{isAdmin&&onNewProject?<button className="btn btn-primary" onClick={onNewProject}><Plus size={14}/>Create project</button>:<button className="btn" onClick={()=>go('settings',null,{tab:'projects'})}>Open settings</button>}</div>}
  {projects.length>0&&!projects.some(p=>`${p.name} ${p.description||''}`.toLowerCase().includes(query.toLowerCase()))&&<p className="pw-empty">No projects match “{query}”.</p>}
  <ScopeNote/>
 </main>;
 if(!selected)return <main className="page-body pw-workspace"><div className="pw-empty"><h1>Project unavailable</h1><p>This project may have been removed or you may not have access.</p><button className="btn" onClick={()=>setProject('all')}>All projects</button></div></main>;
 const projectRepos=repos.filter(r=>r.projectId===project);
 const projectJobs=recent(jobs.filter(j=>inProject(j,project,repos)&&!j.archived));
 const projectChanges=recent(changes.filter(c=>inProject(c,project,repos)));
 const projectWorkflows=workflows.filter(w=>inProject(w,project,repos));
 const attention=projectJobs.filter(j=>attentionStatuses.includes(j.status));
 return <main className="page-body pw-workspace">
  <header className="pw-heading"><div><span className="pw-eyebrow">Project scope · Workspace</span><h1>{selected.name}</h1><p>{selected.description||'Define the goals, context and decisions that make this project yours.'}</p></div><div className="pw-editor-actions"><PlannedChangeButton projectId={project} repos={projectRepos}/><button className="btn btn-sm" onClick={()=>setProject('all')}>All projects <ArrowRight size={13}/></button></div></header>
  <div className="pw-stats"><span><strong>{projectRepos.length}</strong> repositories</span><button onClick={()=>go('changes')}><strong>{projectChanges.filter(c=>c.status==='open').length}</strong> open changes</button><button onClick={()=>go('sessions',null,{filter:'attention'})}><strong>{attention.length}</strong> sessions need attention</button><span><strong>{projectWorkflows.filter(w=>w.enabled).length}</strong> enabled automations</span></div>
  <KnowledgeEditor key={project} projectId={project} drafts={drafts}/>
  <section className="pw-panel pw-coordinator"><header className="pw-panel-heading"><div><h2><Sparkles size={16}/>Project coordinator</h2><p>Shared planning and delegation chat — not a task execution transcript. Follow delegated work in Task runs below.</p></div><span className="pw-scope-tag">Project scope</span></header><ProjectConversation projectId={project}/></section>
  <RepositoryExplorer key={project} repos={projectRepos} onNewRepo={canEdit?onNewRepo:undefined}/>
  <div className="pw-activity-grid">
   <Activity title="Changes" icon={<GitPullRequest size={16}/>} count={projectChanges.length} onAll={()=>go('changes')}>
    {projectChanges.slice(0,5).map(c=><ActivityRow key={c.id} item={c} subtitle={repos.find(r=>r.id===c.repoId)?.name||'Project change'} onClick={()=>go('changes',c.id)}/>)}
    {!projectChanges.length&&<p className="pw-empty-inline">No changes yet. Reviewable code changes will be linked here.</p>}
   </Activity>
   <Activity title="Task runs" icon={<Sparkles size={16}/>} count={projectJobs.length} onAll={()=>go('sessions')}>
    {projectJobs.slice(0,5).map(j=><ActivityRow key={j.id} item={j} subtitle={`Task scope · ${repos.find(r=>r.id===j.repoId)?.name||'Session'}`} onClick={()=>go('sessions',j.id)}/>)}
    {!projectJobs.length&&<p className="pw-empty-inline">No task sessions yet. Sessions track individual agent tasks and their results.</p>}
   </Activity>
   <Activity title="Automations" icon={<Zap size={16}/>} count={projectWorkflows.length} onAll={()=>go('automations')}>
    {projectWorkflows.slice(0,5).map(w=><ActivityRow key={w.id} item={{...w,title:w.name,status:w.enabled?'enabled':'paused'}} subtitle={`${triggerLabel(w.trigger)} · ${repos.find(r=>r.id===w.repoId)?.name||'Project'}`} onClick={()=>go('automations')}/>)}
    {!projectWorkflows.length&&<p className="pw-empty-inline">No automations configured. Configured workflows can run tasks on events or schedules.</p>}
   </Activity>
  </div><ScopeNote/>
 </main>;
}

function ScopeNote(){return <footer className="pw-scope-note"><span><b>System</b> · Shared administration and project directory</span><span><b>Project</b> · Knowledge, repositories and workflows</span><span><b>Task</b> · Individual agent sessions and changes</span><p>Project coordinator chat is shared planning and delegation. Task runs are separate execution sessions with their own logs and results.</p></footer>;}
function Activity({title,icon,count,onAll,children}:{title:string,icon:React.ReactNode,count:number,onAll:()=>void,children:React.ReactNode}){return <section className="pw-panel"><header className="pw-panel-heading"><h2>{icon}{title}<span>{count}</span></h2><button className="pw-text-button" onClick={onAll}>View all <ArrowRight size={12}/></button></header>{children}</section>;}
function ActivityRow({item,subtitle,onClick}:{item:Item,subtitle:string,onClick:()=>void}){return <button className="pw-activity-row" onClick={onClick}><div><strong>{item.title||'Untitled'}</strong><small>{subtitle}{(item.updated||item.created)&&` · ${ago(item.updated||item.created)}`}</small></div><Status value={item.status}/></button>;}

function RepositoryExplorer({repos,onNewRepo}:{repos:Item[],onNewRepo?:()=>void}){
 const [selection,setSelection]=useState('');
 const repo=repos.find(r=>r.id===selection)||repos[0];
 return <section className="pw-panel pw-repositories" aria-label="Project repository explorer">
  <header className="pw-panel-heading"><div><h2><FolderGit2 size={16}/>Repository explorer</h2><p>Read-only committed files. Choose a repository, then a branch, tag or commit.</p></div>{onNewRepo&&<button className="btn btn-sm" onClick={onNewRepo}><Plus size={13}/>Connect repository</button>}</header>
  {repo?<><label className="pw-repo-selector">Repository <select value={repo.id} onChange={e=>setSelection(e.target.value)}>{repos.map(r=><option key={r.id} value={r.id}>{r.name}</option>)}</select></label><RepositoryBrowser key={repo.id} repo={repo}/></>:<p className="pw-empty-inline">No repositories linked. Project knowledge and coordinator chat work without a repository.</p>}
 </section>;
}
function RepositoryBrowser({repo}:{repo:Item}){
 const [ref,setRef]=useState(repo.base||'main'),[inputRef,setInputRef]=useState(repo.base||'main'),[inputPath,setInputPath]=useState('');
 const [location,setLocation]=useState({path:'',file:false}),[entries,setEntries]=useState<Item[]>([]),[blob,setBlob]=useState<Item|null>(null);
 const [loading,setLoading]=useState(false),[error,setError]=useState(''),[revision,setRevision]=useState(0);
 useEffect(()=>{
  let disposed=false;setLoading(true);setError('');setBlob(null);setEntries([]);
  const query=new URLSearchParams({ref,path:location.path});
  void api(`/repos/${encodeURIComponent(repo.id)}/${location.file?'blob':'tree'}?${query}`).then(result=>{
   if(disposed)return;
   if(location.file){if(typeof result.content!=='string')throw Error('Invalid file response.');setBlob(result);}
   else{if(!Array.isArray(result.entries))throw Error('Invalid directory response.');setEntries(result.entries);}
  }).catch(e=>{if(!disposed)setError((e as Error).message);}).finally(()=>{if(!disposed)setLoading(false);});
  return()=>{disposed=true;};
 },[repo.id,ref,location,revision]);
 function navigate(path:string,file=false){setLocation({path,file});setInputPath(path);}
 function submit(e:React.FormEvent<HTMLFormElement>){
  e.preventDefault();const path=inputPath.trim().replace(/^\/+|\/+$/g,'');
  if(!inputRef.trim()||(path&&!validPath(path))){setError('Enter a ref and a relative path without . or .. segments.');return;}
  setRef(inputRef.trim());navigate(path,(e.nativeEvent as SubmitEvent).submitter?.getAttribute('value')==='file');
 }
 const parts=location.path.split('/').filter(Boolean),directories=location.file?parts.slice(0,-1):parts;
 return <div className="pw-browser">
  <form className="pw-browser-controls" onSubmit={submit}>
   <label>Ref<input aria-label="Repository ref" value={inputRef} onChange={e=>setInputRef(e.target.value)} placeholder="main, tag or commit"/></label>
   <label className="pw-path-input">Path<input aria-label="Repository path" value={inputPath} onChange={e=>setInputPath(e.target.value)} placeholder="Root directory"/></label>
   <button className="btn btn-sm" type="submit" value="directory">Open folder</button><button className="btn btn-sm" type="submit" value="file" disabled={!inputPath.trim()}>Read file</button>
  </form>
  <nav className="pw-breadcrumbs" aria-label="Repository path"><button onClick={()=>navigate('')}>Root</button>{directories.map((part,i)=><React.Fragment key={i}><span>/</span><button onClick={()=>navigate(directories.slice(0,i+1).join('/'))}>{part}</button></React.Fragment>)}{location.file&&<span>/ {parts.at(-1)}</span>}<span className="pw-scope-tag">{ref} · Read only</span></nav>
  {error?<div className="pw-error"><ErrorNote>{error}</ErrorNote><button className="btn btn-sm" onClick={()=>setRevision(n=>n+1)}>Retry</button></div>:loading?<p className="pw-empty-inline"><Spinner/> Loading {location.file?'file':'directory'}…</p>:location.file?<>
   {blob?.isTooLarge?<p className="pw-empty-inline">This file exceeds the 2 MB preview limit.</p>:blob?.isBinary?<p className="pw-empty-inline">Binary file — text preview unavailable.</p>:<pre className="pw-code" aria-label={`Read-only content of ${location.path}`} tabIndex={0}><code>{blob?.content||'(empty file)'}</code></pre>}
  </>:<div className="pw-tree">
   {location.path&&<button onClick={()=>navigate(directories.slice(0,-1).join('/'))}><ArrowRight size={14} className="pw-up-icon"/>Parent directory</button>}
   {entries.map(entry=><button key={entry.path} onClick={()=>navigate(entry.path,entry.type!=='tree')}><span>{entry.type==='tree'?<FolderGit2 size={15}/>:<FileText size={15}/>}</span><span>{entry.name}</span><small>{entry.type==='tree'?'Folder':entry.type==='commit'?'Submodule':entry.size==null?'File':`${entry.size.toLocaleString()} bytes`}</small></button>)}
   {!entries.length&&<p className="pw-empty-inline">No entries returned. This directory may be empty, or the ref/path may not exist. Check the ref and path above.</p>}
  </div>}
 </div>;
}

function KnowledgeEditor({projectId,drafts}:{projectId:string,drafts:Drafts}){
 const {canEdit,notify}=useWorkspace();
 const [files,setFiles]=useState<KnowledgeFile[]>([]),[path,setPath]=useState(''),[content,setContent]=useState(''),[saved,setSaved]=useState('');
 const [loading,setLoading]=useState(true),[reading,setReading]=useState(false),[saving,setSaving]=useState(false),[error,setError]=useState(''),[filter,setFilter]=useState(''),[newPath,setNewPath]=useState(''),[creating,setCreating]=useState(false),[preview,setPreview]=useState(false),[message,setMessage]=useState('');
 const [unavailable,setUnavailable]=useState(false);
 const alive=useRef(true),request=useRef(0),revision=useRef<string|undefined>(undefined);
 const [storageError,setStorageError]=useState('');
 function persistDrafts(){try{sessionStorage.setItem(draftStorageKey,JSON.stringify([...drafts]));setStorageError('');}catch{setStorageError('Browser draft storage is unavailable or full. Save your changes before leaving this dashboard; unsaved edits currently exist only in memory.');}}
 const base=`/projects/${encodeURIComponent(projectId)}/knowledge`;
 const dirty=content!==saved;
 useEffect(()=>{alive.current=true;void load();return()=>{alive.current=false;request.current++;};},[]);
 useEffect(()=>{if(!dirty)return;const warn=(e:BeforeUnloadEvent)=>{e.preventDefault();e.returnValue='';};window.addEventListener('beforeunload',warn);return()=>window.removeEventListener('beforeunload',warn);},[dirty]);
 const key=(p:string)=>`${projectId}:${p}`;
 async function open(file:KnowledgeFile){
  const ticket=++request.current;setPath(file.path);setError('');setUnavailable(false);setMessage('');setReading(true);setContent('');setSaved('');
  try{
   let text=file.content;
   const draft=drafts.get(key(file.path));
   if(draft){setContent(draft.content);setSaved(draft.saved);return;}
   if(typeof text!=='string'){
    const response=await api(`${base}?path=${encodeURIComponent(file.path)}`);
    text=response.path===file.path?response.content:response.files?.find((f:KnowledgeFile)=>f.path===file.path)?.content;
   }
   if(typeof text!=='string')throw Error('The server did not return file content. Retry before editing this document.');
   if(alive.current&&ticket===request.current){setContent(text);setSaved(text);}
  }catch(e){if(alive.current&&ticket===request.current){setError((e as Error).message);setUnavailable(true);}}
  finally{if(alive.current&&ticket===request.current)setReading(false);}
 }
 async function load(){
  setLoading(true);setError('');
  try{
   const result=await api(base);
   if(!Array.isArray(result.files)||result.files.some((f:KnowledgeFile)=>!f||typeof f.path!=='string'))throw Error('Invalid knowledge file list returned by server.');
   if(!alive.current)return;
   revision.current=result.revision;
   const list:KnowledgeFile[]=result.files;
   // Keep unsaved new documents discoverable when revisiting this project.
   for(const draftKey of drafts.keys())if(draftKey.startsWith(`${projectId}:`)){
    const p=draftKey.slice(projectId.length+1);if(!list.some(f=>f.path===p))list.push({path:p});
   }
   list.sort((a,b)=>a.path.localeCompare(b.path));setFiles(list);
   if(list.length)await open(list[0]);
  }catch(e){if(alive.current)setError((e as Error).message);}
  finally{if(alive.current)setLoading(false);}
 }
 function change(text:string){setContent(text);drafts.set(key(path),{content:text,saved,revision:drafts.get(key(path))?.revision||revision.current});persistDrafts();setMessage('');}
 function create(e:React.FormEvent){
  e.preventDefault();const p=newPath.trim();
  if(!validPath(p)){setError('Use a relative file path such as decisions/architecture.md, without empty, . or .. segments.');return;}
  const existing=files.find(f=>f.path===p);
  if(existing){void open(existing);}else{const file={path:p,content:''};setFiles(old=>[...old,file].sort((a,b)=>a.path.localeCompare(b.path)));drafts.set(key(p),{content:'',saved:'',revision:revision.current});persistDrafts();void open(file);}
  setCreating(false);setNewPath('');setPreview(false);
 }
 async function save(){
  if(!path||saving||reading||unavailable||!canEdit)return;
  const submitted=content,submittedPath=path;setSaving(true);setError('');setMessage('');
  try{
   const result=await api(base,'PUT',{path:submittedPath,content:submitted,revision:drafts.get(key(submittedPath))?.revision||revision.current});
   revision.current=result.revision;
   drafts.delete(key(submittedPath));persistDrafts();
   if(!alive.current)return;
   setSaved(submitted);setFiles(old=>old.map(f=>f.path===submittedPath?{...f,content:submitted}:f));setMessage('Saved to project knowledge.');notify('Project knowledge saved');
  }catch(e){if(alive.current)setError((e as Error).message);}
  finally{if(alive.current)setSaving(false);}
 }
 return <section className="pw-panel pw-knowledge" aria-label="Project knowledge">
  <header className="pw-panel-heading"><div><h2><BookOpen size={17}/>Project knowledge</h2><p>Goals, decisions and working context — independent of any repository.</p></div><span className="pw-scope-tag">Project scope</span></header>
  {storageError&&<div className="pw-error" role="alert"><ErrorNote>{storageError}</ErrorNote></div>}
  {error&&<div className="pw-error"><ErrorNote>{error}</ErrorNote>{!path&&<button className="btn btn-sm" disabled={loading} onClick={()=>void load()}><RefreshCw size={12}/>Retry</button>}{path&&<><button className="btn btn-sm" disabled={reading||saving} onClick={()=>void open(files.find(f=>f.path===path)||{path})}>Retry file</button><button className="btn btn-sm" disabled={reading||saving} onClick={()=>{if(!confirm('Discard this local draft and reload the server version? Copy any changes you want to keep first.'))return;drafts.delete(key(path));persistDrafts();void load();}}>Reload server version</button></>}</div>}
  <div className="pw-knowledge-layout">
   <aside className="pw-files" aria-label="Knowledge files"><div className="pw-file-tools"><label className="pw-search"><Search size={13}/><input aria-label="Filter knowledge files" placeholder="Find a file…" value={filter} onChange={e=>setFilter(e.target.value)}/></label>{canEdit&&<button className="btn btn-sm" aria-label="New knowledge file" disabled={loading||saving} onClick={()=>setCreating(!creating)}><Plus size={14}/></button>}</div>
    {creating&&<form className="pw-new-file" onSubmit={create}><label htmlFor="pw-new-path">New file path</label><input id="pw-new-path" autoFocus placeholder="decisions/architecture.md" value={newPath} onChange={e=>setNewPath(e.target.value)} disabled={saving}/><button className="btn btn-sm" disabled={!newPath.trim()||saving}>Create draft</button></form>}
    {loading?<div className="pw-empty-inline"><Spinner/> Loading knowledge…</div>:<nav className="pw-file-list">{files.filter(f=>f.path.toLowerCase().includes(filter.toLowerCase())).map(f=><button key={f.path} type="button" disabled={saving} aria-current={path===f.path?'page':undefined} title={f.path} onClick={()=>void open(f)}><FileText size={14}/><span>{f.path}</span>{drafts.has(key(f.path))&&<i aria-label="Local draft"/>}</button>)}{!files.length&&<p className="pw-empty-inline">No knowledge files yet.</p>}{files.length>0&&!files.some(f=>f.path.toLowerCase().includes(filter.toLowerCase()))&&<p className="pw-empty-inline">No matching files.</p>}</nav>}
   </aside>
   <div className="pw-document">
    {!path?<div className="pw-knowledge-welcome"><BookOpen size={30}/><h3>Give your project a shared reference</h3><p>Write down the purpose, constraints and decisions before starting tasks. No repository needed.</p>{canEdit&&!loading&&<button className="btn btn-primary" onClick={()=>{setNewPath('README.md');setCreating(true);}}>Create your first document</button>}{!canEdit&&<p>You have read-only access to project knowledge.</p>}</div>:<>
     <div className="pw-document-toolbar"><div><code>{path}</code><span className="pw-save-state">{reading?'Loading…':dirty?'Unsaved draft':drafts.has(key(path))?'New draft':'Saved'}{!canEdit?' · Read only':''}</span></div><div className="pw-editor-actions"><button className="btn btn-sm" disabled={reading||unavailable} aria-pressed={preview} onClick={()=>setPreview(!preview)}>{preview?'Source':'Preview'}</button>{canEdit&&<button className="btn btn-primary btn-sm" disabled={loading||reading||saving||unavailable||(!dirty&&!drafts.has(key(path)))} onClick={()=>void save()}>{saving?<Spinner/>:<Save size={13}/>}Save</button>}</div></div>
     {reading?<div className="pw-empty-inline"><Spinner/> Reading document…</div>:unavailable?<p className="pw-empty-inline">Document unavailable. Your local draft, if any, is kept in this browser tab.</p>:preview?<div className="pw-preview">{content.trim()?<Markdown>{content}</Markdown>:<p className="pw-empty-inline">This document is empty.</p>}</div>:<textarea className="pw-editor" aria-label={`Content of ${path}`} spellCheck={false} readOnly={!canEdit||saving} value={content} placeholder="# Project purpose\n\nWhat are we building, and why?\n\n## Decisions\n\n## Constraints\n" onChange={e=>change(e.target.value)} onKeyDown={e=>{if((e.metaKey||e.ctrlKey)&&e.key==='s'){e.preventDefault();if(!unavailable)void save();}}}/>}
     <footer className="pw-editor-footer"><span role="status">{message||`${content.length.toLocaleString()} characters · Markdown supported`}</span><span>Drafts restored in this browser tab · Ctrl/⌘ S to save</span></footer>
    </>}
   </div>
  </div>
 </section>;
}
