import {AdminConsole} from './admin-console';
import {requestOptions} from './request';
import React,{useState,useEffect,useCallback,useRef} from 'react';
import {createRoot} from 'react-dom/client';
import {Activity,ArrowDown,ArrowRight,ArrowUpRight,ArrowLeft,Check,CheckCircle2,ChevronDown,ChevronRight,Clock3,Code2,Command,ExternalLink,FolderGit2,GitBranch,GitMerge,GitPullRequest,LayoutDashboard,Loader2,MessageSquare,MoreHorizontal,Play,Plus,Search,Settings2,Shield,SlidersHorizontal,Sparkles,Square,Terminal,Trash2,Users,X,Zap,Sun,Moon,KeyRound,Copy,CheckCheck,AlertCircle,Box,FileCode2,Pause,RefreshCw,RotateCw} from 'lucide-react';
import '@fontsource-variable/dm-sans';
import '@fontsource-variable/manrope';
import './style.css';
import {useAttachmentState,AttachmentInput,MessageAttachments} from './attachments';
import {isSubagent,SubagentCard,getSubagentActivityText,parseSubagentInfo} from './subagent';
type Item=Record<string,any>;
const token=()=>localStorage.getItem('relay.device');
async function api(path:string,method='GET',data?:any){const r=await fetch('/api'+path,requestOptions(method,token()||undefined,data));const b=await r.json();if(!r.ok)throw Error(b.error||'Request failed');return b;}
const ago=(s:string)=>{const m=Math.floor((Date.now()-new Date(s).getTime())/60000);return m<1?'just now':m<60?`${m}m ago`:m<1440?`${Math.floor(m/60)}h ago`:`${Math.floor(m/1440)}d ago`;};
const label=(s:string)=>s?.replaceAll('_',' ').replace(/\b\w/g,x=>x.toUpperCase());
function Status({value}:{value:string}){return <span className={`status ${value}`}><i/>{label(value)}</span>}
function Empty({icon:Icon=FolderGit2,title,description,action}:{icon?:any,title:string,description:string,action?:React.ReactNode}){return <div className="empty"><div className="empty-icon"><Icon size={25}/></div><h3>{title}</h3><p>{description}</p>{action}</div>}
function Modal({title,children,onClose,wide=false}:{title:string,children:React.ReactNode,onClose:()=>void,wide?:boolean}){return <div className="overlay" onMouseDown={e=>{if(e.target===e.currentTarget)onClose()}}><section role="dialog" aria-modal="true" aria-label={title} className={`modal ${wide?'wide':''}`}><header><h2>{title}</h2><button className="icon-button" aria-label="Close" onClick={onClose}><X size={20}/></button></header>{children}</section></div>}
type Field={key:string,label:string,type?:string,options?:{value:string,label:string}[],optionsFor?:(values:any)=>{value:string,label:string}[],value?:any,placeholder?:string,help?:string,optional?:boolean};
function Form({fields,onSubmit,submit='Save',children}:{fields:Field[],onSubmit:(data:any)=>Promise<any>,submit?:string,children?:React.ReactNode}){const [values,set]=useState<any>(Object.fromEntries(fields.map(f=>[f.key,f.value??(f.type==='checkbox'?false:f.options?.[0]?.value??'')]))),[busy,B]=useState(false),[error,E]=useState('');return <form onSubmit={async e=>{e.preventDefault();B(true);E('');try{await onSubmit(values)}catch(e){E(String((e as Error).message))}finally{B(false)}}}>{fields.map(f=><label className="field" key={f.key}><span>{f.label}</span>{f.type==='textarea'?<textarea rows={4} required={!f.optional} value={values[f.key]} placeholder={f.placeholder} onChange={e=>set({...values,[f.key]:e.target.value})}/>:(f.optionsFor?f.optionsFor(values):f.options)?<select value={values[f.key]} onChange={e=>set({...values,[f.key]:e.target.value,...(f.key==='connectionId'?{model:''}:{})})}>{(f.optionsFor?f.optionsFor(values):f.options)!.map(o=><option key={o.value} value={o.value}>{o.label}</option>)}</select>:f.type==='checkbox'?<input type="checkbox" checked={values[f.key]} onChange={e=>set({...values,[f.key]:e.target.checked})}/>:<input type={f.type||'text'} required={!f.optional} value={values[f.key]} placeholder={f.placeholder} onChange={e=>set({...values,[f.key]:f.type==='number'?Number(e.target.value):e.target.value})}/>} {f.help&&<small>{f.help}</small>}</label>)}{children}{error&&<div role="alert" className="error"><AlertCircle size={16}/>{error}</div>}<div className="form-footer"><button className="primary" disabled={busy}>{busy?<Loader2 className="spin" size={16}/>:<ArrowRight size={16}/>} {busy?'Working…':submit}</button></div></form>}
const modes=[{value:'prepare',label:'Prepare automatically · approve merge'},{value:'approve',label:'Approve before editing'},{value:'auto',label:'Merge automatically when checks pass'}];
const kinds=['implement','review','address','conflict','test','coverage','improve','adapt'].map(value=>({value,label:label(value)}));
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
function CreateChangeRequestModal({state,catalog,close,onCreated,defaultRepoId}:any){
 const repoOptions=state.repos.filter((r:Item)=>r.status==='ready');
 const [repoId,setRepoId]=useState(defaultRepoId||repoOptions[0]?.id||'');
 const repo=state.repos.find((r:Item)=>r.id===repoId);
 const [connectionId,setConnectionId]=useState(repo?.connectionId||state.connections.find((c:Item)=>c.status==='connected')?.id||'');
 const [model,setModel]=useState(repo?.model||'');
 const [thinkingLevel,setThinkingLevel]=useState(repo?.thinkingLevel||'off');
 const [targetBranch,setTargetBranch]=useState('auto');
 const [sourceBranch,setSourceBranch]=useState('auto');
 const [branches,setBranches]=useState<string[]>([]);
 const [showBranches,setShowBranches]=useState(false);
 const [prompt,setPrompt]=useState('');
 const [submitting,setSubmitting]=useState(false);
 const [error,setError]=useState('');
 const attachments=useAttachmentState();

 useEffect(()=>{
  if(repo){
   if(repo.connectionId)setConnectionId(repo.connectionId);
   if(repo.model)setModel(repo.model);
   if(repo.thinkingLevel)setThinkingLevel(repo.thinkingLevel);
   api(`/repos/${repo.id}/inspect`).then(insp=>{if(insp?.branches)setBranches(insp.branches)}).catch(()=>{});
  }
 },[repoId]);

 const selectedConnection=state.connections.find((c:Item)=>c.id===connectionId);
 const modelOptions=(selectedConnection?.models||catalog.find((p:Item)=>p.id===selectedConnection?.provider)?.models||selectedConnection?.config?.models||[]).map((m:Item)=>({value:m.id,label:m.name||m.id}));

 const handleSubmit=async(e:React.FormEvent)=>{
  e.preventDefault();
  if(!repoId)return;
  const text=prompt.trim()||(attachments.images.length||attachments.attachments.length?'(See attachments)':'');
  if(!text)return;
  setSubmitting(true);
  setError('');
  try{
   const job=await api('/jobs','POST',{
    repoId,
    prompt:text,
    title:prompt.trim().slice(0,90)||'New change request',
    kind:'implement',
    connectionId:connectionId||undefined,
    model:model||undefined,
    thinkingLevel,
    targetBranch:targetBranch==='auto'?undefined:targetBranch,
    sourceBranch:sourceBranch==='auto'?undefined:sourceBranch,
    images:attachments.images.map(img=>({type:'image',data:img.data,mimeType:img.mimeType,name:img.name,url:img.url})),
    attachments:attachments.attachments
   });
   onCreated(job.id);
  }catch(err){
   setError((err as Error).message);
   setSubmitting(false);
  }
 };

 return (
  <Modal title="Open new change request" onClose={close}>
   <form onSubmit={handleSubmit} onPaste={attachments.handlePaste} onDrop={attachments.handleDrop} onDragOver={e=>e.preventDefault()}>
    <p className="muted">Write your instructions. Orchestra puts an agent to work in an isolated worktree and starts a chat conversation where you can steer and submit the change request.</p>
    {error&&<div className="error banner">{error}</div>}
    {repoOptions.length>1&&(
     <label className="field">
      <span>Repository</span>
      <select value={repoId} onChange={e=>setRepoId(e.target.value)}>
       {repoOptions.map((r:Item)=><option key={r.id} value={r.id}>{r.name}</option>)}
      </select>
     </label>
    )}
    <div style={{display:'flex',gap:10,marginTop:8}}>
     <label className="field" style={{flex:1}}>
      <span>AI connection</span>
      <select value={connectionId} onChange={e=>{const nextId=e.target.value;setConnectionId(nextId);const conn=state.connections.find((c:Item)=>c.id===nextId);const opts=(conn?.models||catalog.find((p:Item)=>p.id===conn?.provider)?.models||conn?.config?.models||[]);setModel(opts[0]?.id||'');}}>
       <option value="">{repo?.connectionId?'Repository connection':'Choose connection'}</option>
       {state.connections.filter((c:Item)=>c.status==='connected').map((c:Item)=><option key={c.id} value={c.id}>{c.name}</option>)}
      </select>
     </label>
     <label className="field" style={{flex:1}}>
      <span>Model</span>
      <select value={model} onChange={e=>setModel(e.target.value)}>
       <option value="">{repo?.model?`Repository default (${repo.model})`:'Choose model'}</option>
       {modelOptions.map((m:Item)=><option key={m.value} value={m.value}>{m.label}</option>)}
      </select>
     </label>
     <label className="field" style={{flex:1}}>
      <span>Thinking effort</span>
      <select value={thinkingLevel} onChange={e=>setThinkingLevel(e.target.value)}>
       {['off','minimal','low','medium','high','xhigh'].map(v=><option key={v} value={v}>{v}</option>)}
      </select>
     </label>
    </div>
    <div>
     <button type="button" className="cr-advanced-toggle" onClick={()=>setShowBranches(s=>!s)}>
      <ChevronDown size={14} style={{transform:showBranches?'rotate(180deg)':'none',transition:'transform .15s'}}/>
      <span>{showBranches?'Hide branch options':'Branch options (default: auto)'}</span>
     </button>
     {showBranches&&(
      <div style={{display:'flex',gap:10,marginTop:8,padding:10,background:'var(--bg)',borderRadius:8,border:'1px solid var(--line)'}}>
       <label className="field" style={{flex:1}}>
        <span>Target branch</span>
        <select value={targetBranch} onChange={e=>setTargetBranch(e.target.value)}>
         <option value="auto">auto ({repo?.base||'main'})</option>
         {branches.map(b=><option key={b} value={b}>{b}</option>)}
        </select>
       </label>
       <label className="field" style={{flex:1}}>
        <span>Source branch</span>
        <select value={sourceBranch} onChange={e=>setSourceBranch(e.target.value)}>
         <option value="auto">auto (model creates branch)</option>
         {branches.filter(b=>b!==repo?.base).map(b=><option key={b} value={b}>{b}</option>)}
        </select>
       </label>
      </div>
     )}
    </div>
    <label className="field" style={{marginTop:12}}>
     <span>Instructions</span>
     <textarea
      required={!attachments.images.length&&!attachments.attachments.length}
      rows={4}
      value={prompt}
      onChange={e=>setPrompt(e.target.value)}
      placeholder="Describe the change, feature, or fix you want…"
     />
    </label>
    <AttachmentInput
     images={attachments.images}
     attachments={attachments.attachments}
     onAdd={attachments.addFiles}
     onRemoveImage={attachments.removeImage}
     onRemoveAttachment={attachments.removeAttachment}
     disabled={submitting}
    />
    <div className="form-footer" style={{marginTop:16}}>
     <button type="button" className="secondary" onClick={close} disabled={submitting}>Cancel</button>
     <button type="submit" className="primary" disabled={submitting||(!prompt.trim()&&!attachments.images.length&&!attachments.attachments.length)}>
      {submitting?<Loader2 size={16} className="spin"/>:<Sparkles size={16}/>}
      <span>Start change request</span>
     </button>
    </div>
   </form>
  </Modal>
 );
}

function TaskModal({repoId,changeId,jobKind='implement',state,catalog,close,done,openJob}:any){
 const repoOptions=state.repos.filter((r:Item)=>r.status==='ready').map((r:Item)=>({value:r.id,label:r.name}));
 const [selectedRepoId,setRepoId]=useState(repoId||repoOptions[0]?.value||'');
 const [kind,setKind]=useState(jobKind);
 const [title,setTitle]=useState('');
 const [prompt,setPrompt]=useState('');
 const repo=state.repos.find((r:Item)=>r.id===selectedRepoId);
 const [connectionId,setConnectionId]=useState(repo?.connectionId||'');
 const [model,setModel]=useState(repo?.model||'');
 const [thinkingLevel,setThinkingLevel]=useState(repo?.thinkingLevel||'off');
 const [autonomy,setAutonomy]=useState(repo?.autonomy||'prepare');
 const [busy,setBusy]=useState(false);
 const [err,setErr]=useState('');
 const attachments=useAttachmentState();

 const selectedConnection=state.connections.find((c:Item)=>c.id===connectionId);
 const modelOptions=(selectedConnection?.models||catalog.find((p:Item)=>p.id===selectedConnection?.provider)?.models||selectedConnection?.config?.models||[]).map((m:Item)=>({value:m.id,label:m.name||m.id}));

 const submit=async(e:React.FormEvent)=>{
  e.preventDefault();
  if(!prompt.trim()&&!attachments.images.length&&!attachments.attachments.length)return;
  setBusy(true);setErr('');
  try{
   const j=await api('/jobs','POST',{
    repoId:selectedRepoId,
    changeId,
    kind,
    title:title.trim()||prompt.trim().slice(0,90)||'Task',
    prompt:prompt.trim()||'(See attachments)',
    connectionId:connectionId||undefined,
    model:model||undefined,
    thinkingLevel,
    autonomy,
    images:attachments.images.map(img=>({type:'image',data:img.data,mimeType:img.mimeType,name:img.name,url:img.url})),
    attachments:attachments.attachments
   });
   await done();
   openJob(j.id);
  }catch(e){
   setErr((e as Error).message);
   setBusy(false);
  }
 };

 return <Modal title="Put an agent to work" onClose={close}>
  <form onSubmit={submit} onPaste={attachments.handlePaste} onDrop={attachments.handleDrop} onDragOver={e=>e.preventDefault()}>
   <p className="muted">Give it a clear outcome. Follow along, steer the work, and review the result.</p>
   {err&&<div className="error banner">{err}</div>}
   <div style={{display:'flex',gap:10}}>
    <label className="field" style={{flex:1}}><span>Repository</span><select value={selectedRepoId} onChange={e=>setRepoId(e.target.value)}>{repoOptions.map((o:any)=><option key={o.value} value={o.value}>{o.label}</option>)}</select></label>
    <label className="field" style={{flex:1}}><span>Type of work</span><select value={kind} onChange={e=>setKind(e.target.value)}>{kinds.map(k=><option key={k.value} value={k.value}>{k.label}</option>)}</select></label>
   </div>
   <label className="field"><span>Task name</span><input placeholder="What needs to happen?" value={title} onChange={e=>setTitle(e.target.value)}/></label>
   <label className="field"><span>Instructions</span><textarea rows={4} placeholder="Describe the goal, context, and how to verify the result…" value={prompt} onChange={e=>setPrompt(e.target.value)} required={!attachments.images.length&&!attachments.attachments.length}/></label>
   <AttachmentInput images={attachments.images} attachments={attachments.attachments} onAdd={attachments.addFiles} onRemoveImage={attachments.removeImage} onRemoveAttachment={attachments.removeAttachment} disabled={busy}/>
   <div style={{display:'flex',gap:10,marginTop:10}}>
    <label className="field" style={{flex:1}}><span>Model connection</span><select value={connectionId} onChange={e=>{const nextId=e.target.value;setConnectionId(nextId);const conn=state.connections.find((c:Item)=>c.id===nextId);const opts=(conn?.models||catalog.find((p:Item)=>p.id===conn?.provider)?.models||conn?.config?.models||[]);setModel(opts[0]?.id||'');}}><option value="">Use repository default</option>{state.connections.filter((c:Item)=>c.status==='connected').map((c:Item)=><option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
    <label className="field" style={{flex:1}}><span>Model</span><select value={model} onChange={e=>setModel(e.target.value)}><option value="">Use repository default</option>{modelOptions.map((m:Item)=><option key={m.value} value={m.value}>{m.label}</option>)}</select></label>
   </div>
   <div style={{display:'flex',gap:10,marginTop:8}}>
    <label className="field" style={{flex:1}}><span>Thinking effort</span><select value={thinkingLevel} onChange={e=>setThinkingLevel(e.target.value)}>{['off','minimal','low','medium','high','xhigh'].map(v=><option key={v} value={v}>{v}</option>)}</select></label>
    <label className="field" style={{flex:1}}><span>Autonomy</span><select value={autonomy} onChange={e=>setAutonomy(e.target.value)}>{modes.map(m=><option key={m.value} value={m.value}>{m.label}</option>)}</select></label>
   </div>
   <div className="form-footer" style={{marginTop:16}}>
    <button type="button" className="secondary" onClick={close} disabled={busy}>Cancel</button>
    <button type="submit" className="primary" disabled={busy||(!prompt.trim()&&!attachments.images.length&&!attachments.attachments.length)}>{busy?<Loader2 className="spin" size={16}/>:<ArrowRight size={16}/>} Start work</button>
   </div>
  </form>
 </Modal>;
}

function NewRepoModal({projects,defaultProjectId,onNewProject,close,onDone}:any){
 const [tab,setTab]=useState<'create'|'connect'>('create');
 const [projectId,setProjectId]=useState(defaultProjectId||projects[0]?.id||'');
 const [name,setName]=useState('');
 const [source,setSource]=useState('');
 const [customSource,setCustomSource]=useState(false);
 const [base,setBase]=useState('main');
 const [busy,setBusy]=useState(false);
 const [error,setError]=useState('');

 const onNameChange=(val:string)=>{
  setName(val);
  if(!customSource&&tab==='create'){
   const slug=val.trim().toLowerCase().replace(/[^a-z0-9._-]/g,'-');
   setSource(slug?`~/dev/${slug}`:'');
  }
 };

 const handleTabChange=(newTab:'create'|'connect')=>{
  setTab(newTab);
  setError('');
  if(newTab==='create'&&!customSource){
   const slug=name.trim().toLowerCase().replace(/[^a-z0-9._-]/g,'-');
   setSource(slug?`~/dev/${slug}`:'');
  }else if(newTab==='connect'&&source.startsWith('~/dev/')){
   setSource('');
   setCustomSource(false);
  }
 };

 const handleSubmit=async(e:React.FormEvent)=>{
  e.preventDefault();
  if(!projectId){
   setError('Please select or create a project first');
   return;
  }
  if(!name.trim()){
   setError('Repository name is required');
   return;
  }
  if(!source.trim()){
   setError(tab==='create'?'Local destination path is required':'Local path or Git URL is required');
   return;
  }
  setBusy(true);
  setError('');
  try{
   const r=await api('/repos','POST',{
    projectId,
    name:name.trim(),
    source:source.trim(),
    base:base.trim()||'main',
    createLocal:tab==='create'
   });
   await onDone(r);
  }catch(err){
   setError((err as Error).message);
  }finally{
   setBusy(false);
  }
 };

 return (
  <Modal title={tab==='create'?'Create a new repository':'Connect an existing repository'} onClose={close}>
   <div className="steps">
    <span className="current">1 Repository</span>
    <ChevronRight size={14}/>
    <span>2 Configuration</span>
    <ChevronRight size={14}/>
    <span>3 Ready</span>
   </div>
   <div className="tabs" style={{margin:'16px 0 20px',gap:'16px'}}>
    <button
     type="button"
     className={tab==='create'?'active':''}
     onClick={()=>handleTabChange('create')}
    >
     <Plus size={14}/> Create new local repository
    </button>
    <button
     type="button"
     className={tab==='connect'?'active':''}
     onClick={()=>handleTabChange('connect')}
    >
     <FolderGit2 size={14}/> Connect existing repository
    </button>
   </div>
   <p className="muted" style={{marginTop:'-10px',marginBottom:'16px'}}>
    {tab==='create'
     ?'Initialize a brand-new Git repository on this server and connect it to Orchestra.'
     :'Orchestra creates its own clone. Your existing checkout stays yours.'}
   </p>
   <form onSubmit={handleSubmit}>
    <label className="field">
     <span>Project</span>
     <div style={{display:'flex',gap:'8px'}}>
      <select
       style={{flex:1}}
       value={projectId}
       onChange={e=>setProjectId(e.target.value)}
       required
      >
       {projects.map((p:Item)=><option key={p.id} value={p.id}>{p.name}</option>)}
      </select>
      {onNewProject&&(
       <button
        type="button"
        className="secondary"
        title="Create new project"
        onClick={onNewProject}
        style={{whiteSpace:'nowrap',padding:'0 12px'}}
       >
        <Plus size={14}/> New
       </button>
      )}
     </div>
    </label>
    <label className="field">
     <span>Repository name</span>
     <input
      type="text"
      required
      value={name}
      placeholder={tab==='create'?'mars-sim':'my-app'}
      onChange={e=>onNameChange(e.target.value)}
     />
    </label>
    <label className="field">
     <span>{tab==='create'?'Local destination path':'Local path or Git URL'}</span>
     <input
      type="text"
      required
      value={source}
      placeholder={tab==='create'?'~/dev/mars-sim':'/home/you/code/my-app'}
      onChange={e=>{
       setSource(e.target.value);
       setCustomSource(true);
      }}
     />
     <small>
      {tab==='create'
       ?'Directory where git init will create your repository with an initial commit.'
       :'An absolute path on this server, an HTTPS URL, or an SSH Git URL.'}
     </small>
    </label>
    <label className="field">
     <span>Default branch</span>
     <input
      type="text"
      value={base}
      placeholder="main"
      onChange={e=>setBase(e.target.value)}
     />
    </label>
    {error&&<div role="alert" className="error"><AlertCircle size={16}/>{error}</div>}
    <div className="form-footer" style={{marginTop:'20px'}}>
     <button type="button" className="secondary" onClick={close} disabled={busy}>Cancel</button>
     <button type="submit" className="primary" disabled={busy}>
      {busy?<Loader2 className="spin" size={16}/>:<ArrowRight size={16}/>}
      {busy?'Setting up…':tab==='create'?'Create repository':'Import repository'}
     </button>
    </div>
   </form>
  </Modal>
 );
}

function ManageProjectModal({project,repos,close,onUpdated,onDeleted}:any){
 const [name,setName]=useState(project.name||'');
 const [description,setDescription]=useState(project.description||'');
 const [busy,setBusy]=useState(false);
 const [delBusy,setDelBusy]=useState(false);
 const [error,setError]=useState('');

 const projectRepos=repos.filter((r:Item)=>r.projectId===project.id);

 const handleSave=async(e:React.FormEvent)=>{
  e.preventDefault();
  if(!name.trim()){
   setError('Project name is required');
   return;
  }
  setBusy(true);
  setError('');
  try{
   const updated=await api(`/projects/${project.id}`,'PATCH',{
    name:name.trim(),
    description:description.trim()
   });
   await onUpdated(updated);
  }catch(err){
   setError((err as Error).message);
  }finally{
   setBusy(false);
  }
 };

 const handleDelete=async()=>{
  if(projectRepos.length>0){
   setError(`Cannot delete this project while it contains ${projectRepos.length} repository/repositories. Remove them first.`);
   return;
  }
  if(!confirm(`Are you sure you want to delete project "${project.name}"? This cannot be undone.`))return;
  setDelBusy(true);
  setError('');
  try{
   await api(`/projects/${project.id}`,'DELETE');
   await onDeleted(project.id);
  }catch(err){
   setError((err as Error).message);
  }finally{
   setDelBusy(false);
  }
 };

 return (
  <Modal title={`Manage project: ${project.name}`} onClose={close}>
   <p className="muted">Update project details, or remove this project if it is no longer needed.</p>
   <form onSubmit={handleSave}>
    <label className="field">
     <span>Project name</span>
     <input
      type="text"
      required
      value={name}
      onChange={e=>setName(e.target.value)}
     />
    </label>
    <label className="field">
     <span>Description</span>
     <textarea
      rows={3}
      value={description}
      placeholder="What is this project building?"
      onChange={e=>setDescription(e.target.value)}
     />
    </label>
    {error&&<div role="alert" className="error" style={{marginTop:'12px'}}><AlertCircle size={16}/>{error}</div>}
    <div className="form-footer" style={{marginTop:'16px'}}>
     <button type="button" className="secondary" onClick={close} disabled={busy||delBusy}>Cancel</button>
     <button type="submit" className="primary" disabled={busy||delBusy}>
      {busy?<Loader2 className="spin" size={16}/>:<Check size={16}/>}
      {busy?'Saving…':'Save changes'}
     </button>
    </div>
   </form>
   <div style={{marginTop:'24px',paddingTop:'18px',borderTop:'1px solid var(--line)'}}>
    <div style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}>
     <div>
      <strong style={{fontSize:'13px',display:'block'}}>Delete project</strong>
      <small style={{color:'var(--muted)'}}>
       {projectRepos.length>0
        ?`Contains ${projectRepos.length} repository/repositories. Repositories must be removed first.`
        :'Permanently delete this project and associated workflows.'}
      </small>
     </div>
     <button
      type="button"
      className="secondary"
      style={{color:'var(--danger,#ef4444)',borderColor:'rgba(239,68,68,0.3)'}}
      disabled={busy||delBusy||projectRepos.length>0}
      title={projectRepos.length>0?'Remove repositories first':`Delete ${project.name}`}
      onClick={handleDelete}
     >
      {delBusy?<Loader2 className="spin" size={14}/>:<Trash2 size={14}/>}
      {delBusy?'Deleting…':'Delete project'}
     </button>
    </div>
   </div>
  </Modal>
 );
}

function App(){
 const initialRoute=useRef(parseRoute(window.location.pathname,window.location.search)).current;
 const [me,M]=useState<Item|null>(null),[loading,L]=useState(true),[state,S]=useState<Item>({projects:[],repos:[],changes:[],jobs:[],workflows:[],connections:[],previews:[],resources:[]}),[page,setPageState]=useState(initialRoute.page),[project,setProjectState]=useState(initialRoute.project),[modal,MD]=useState<React.ReactNode>(null),[toast,T]=useState(''),[query,Q]=useState(''),[theme,TH]=useState(localStorage.getItem('relay.theme')||'light'),[detail,setDetailState]=useState<{type:string,id:string}|null>(initialRoute.detail),[catalog,CAT]=useState<Item[]>([]),[adminOpen,setAdminOpen]=useState(false),[adminPending,setAdminPending]=useState(0),[reloading,setReloading]=useState(false);
 const historyIdx=useRef(0);
 const pageRef=useRef(initialRoute.page);pageRef.current=page;
 const detailRef=useRef(initialRoute.detail);detailRef.current=detail;
 const projectRef=useRef(initialRoute.project);projectRef.current=project;
 const notify=(s:string)=>{T(s);setTimeout(()=>T(''),5000)};
 const refresh=useCallback(async()=>{try{const st=await api('/state');S(st);if(Array.isArray(st.providers)&&st.providers.length>0)CAT(st.providers)}catch{}},[]);
 useEffect(()=>{document.documentElement.dataset.theme=theme;localStorage.setItem('relay.theme',theme)},[theme]);
 useEffect(()=>{if(token())api('/me').then(x=>{M(x.user);void refresh()}).catch(()=>localStorage.removeItem('relay.device')).finally(()=>L(false));else L(false)},[]);
 useEffect(()=>{if(me){void api('/providers').then(CAT).catch(()=>{});const t=setInterval(refresh,4000);return()=>clearInterval(t)}},[me,refresh]);
 const navigate=useCallback((nextPage:string,nextDetail:{type:string,id:string}|null=null,nextProject:string=projectRef.current,replace=false)=>{
  setPageState(nextPage);
  setDetailState(nextDetail);
  setProjectState(nextProject);
  pageRef.current=nextPage;
  detailRef.current=nextDetail;
  projectRef.current=nextProject;
  const targetUrl=buildUrl(nextPage,nextDetail,nextProject);
  const currentUrl=window.location.pathname+window.location.search;
  if(targetUrl!==currentUrl){
   if(replace){
    window.history.replaceState({orchestra:true,idx:historyIdx.current,page:nextPage,detail:nextDetail,project:nextProject},'',targetUrl);
   }else{
    historyIdx.current++;
    window.history.pushState({orchestra:true,idx:historyIdx.current,page:nextPage,detail:nextDetail,project:nextProject},'',targetUrl);
   }
  }
 },[]);
 const P=(nextPage:string)=>navigate(nextPage,null,projectRef.current);
 const PR=(nextProject:string)=>navigate(pageRef.current,detailRef.current,nextProject);
 const D=(nextDetail:{type:string,id:string}|null)=>{if(nextDetail)navigate(nextDetail.type==='job'?'work':'changes',nextDetail,projectRef.current);else navigate(pageRef.current,null,projectRef.current);};
 const openJob=(id:string)=>navigate('work',{type:'job',id},projectRef.current);
 const openChange=(id:string)=>navigate('changes',{type:'change',id},projectRef.current);
 const goBack=()=>{if(historyIdx.current>0)window.history.back();else navigate(detailRef.current?.type==='job'?'work':'changes',null,projectRef.current);};
 useEffect(()=>{
  if(!window.history.state?.orchestra){
   window.history.replaceState({orchestra:true,idx:0,page:initialRoute.page,detail:initialRoute.detail,project:initialRoute.project},'',window.location.href);
  }else if(typeof window.history.state?.idx==='number'){
   historyIdx.current=window.history.state.idx;
  }
 },[]);
 useEffect(()=>{
  const onPopState=()=>{
   const route=parseRoute(window.location.pathname,window.location.search);
   setPageState(route.page);
   setDetailState(route.detail);
   setProjectState(route.project);
   pageRef.current=route.page;
   detailRef.current=route.detail;
   projectRef.current=route.project;
   if(typeof window.history.state?.idx==='number'){
    historyIdx.current=window.history.state.idx;
   }
   setAdminOpen(false);
   MD(null);
  };
  window.addEventListener('popstate',onPopState);
  return ()=>window.removeEventListener('popstate',onPopState);
 },[]);
 useEffect(()=>{
  const pageTitle=detail?(detail.type==='job'?'Task':'Change request'):label(page);
  document.title=page==='overview'&&!detail?'Orchestra — Software, in motion.':`${pageTitle} · Orchestra`;
 },[page,detail]);
 useEffect(()=>{const handler=(e:KeyboardEvent)=>{if((e.metaKey||e.ctrlKey)&&e.key==='k'){e.preventDefault();MD(<SearchModal state={state} close={()=>MD(null)} select={(type,id)=>{if(type==='job')openJob(id);else openChange(id);MD(null)}}/>)}if(e.key==='Escape')MD(null)};window.addEventListener('keydown',handler);return()=>window.removeEventListener('keydown',handler)},[state]);
 const close=()=>MD(null);const done=async()=>{close();await refresh()};const isAdmin=me&&['owner','admin'].includes(me.role),canEdit=me&&me.role!=='viewer';
 const triggerReload=async()=>{
  if(reloading)return;
  setReloading(true);
  notify('Restarting service and reloading Orchestra...');
  try{if(isAdmin)await api('/self/restart','POST',{}).catch(()=>{})}catch{}
  let attempts=0;
  const poll=setInterval(async()=>{
    attempts++;
    try{
      const res=await fetch('/api/health');
      if(res.ok&&attempts>1){clearInterval(poll);window.location.reload()}
    }catch{}
    if(attempts>30){clearInterval(poll);window.location.reload()}
  },800);
 };
 const repos=state.repos.filter((r:Item)=>project==='all'||r.projectId===project),jobs=state.jobs.filter((j:Item)=>project==='all'||j.projectId===project),changes=state.changes.filter((c:Item)=>project==='all'||c.projectId===project),workflows=state.workflows.filter((w:Item)=>project==='all'||w.projectId===project);
 const findRepo=(id:string)=>state.repos.find((r:Item)=>r.id===id);const repoOptions=state.repos.filter((r:Item)=>r.status==='ready').map((r:Item)=>({value:r.id,label:r.name}));
 const run=async(fn:()=>Promise<any>)=>{try{await fn();await refresh()}catch(e){notify((e as Error).message)}};
 function newProject(){MD(<Modal title="A home for your repositories" onClose={close}><p className="muted">Group related repositories, people, and automation in a project.</p><Form fields={[{key:'name',label:'Project name',placeholder:'Your next big thing'},{key:'description',label:'Description',optional:true,placeholder:'What are we building?'}]} submit="Create project" onSubmit={async b=>{const p=await api('/projects','POST',b);navigate('repositories',null,p.id);await done();newRepo(p.id)}}/></Modal>)}
 function manageProject(p:Item){MD(<ManageProjectModal project={p} repos={state.repos} close={close} onUpdated={async(updated:Item)=>{await done();notify(`Project "${updated.name}" updated`)}} onDeleted={async(deletedId:string)=>{if(project===deletedId)PR('all');await done();notify(`Project "${p.name}" deleted`)}}/>)}
 function newRepo(projectId?:string){if(!state.projects.length&&!projectId){newProject();return;}MD(<NewRepoModal projects={state.projects} defaultProjectId={projectId||(project!=='all'?project:undefined)} onNewProject={newProject} close={close} onDone={async(r:Item)=>{await refresh();configureRepo(r,true)}}/>)}
 async function configureRepo(r:Item,onboarding=false){try{const inspect=await api(`/repos/${r.id}/inspect`);MD(<Modal title={onboarding?'Make it work your way':`${r.name} settings`} onClose={close}><p className="muted">Choose the model, guardrails, and commands for this repository. Commands run in an isolated container.</p><Form fields={[{key:'base',label:'Base branch',value:r.base,options:inspect.branches.map((b:string)=>({value:b,label:b}))},{key:'connectionId',label:'AI connection',value:r.connectionId||'',options:[{value:'',label:'Connect later'},...state.connections.filter((c:Item)=>c.status==='connected').map((c:Item)=>({value:c.id,label:c.name}))]},{key:'model',label:'Model',value:r.model||'',optional:true,optionsFor:(v:any)=>{const conn=state.connections.find((c:Item)=>c.id===v.connectionId);const mList=conn?.models||catalog.find(p=>p.id===conn?.provider)?.models||conn?.config?.models||[];return [{value:'',label:'Choose a model'},...mList.map((m:Item)=>({value:m.id,label:m.name||m.id}))];}},{key:'testCommand',label:'Test command',value:r.testCommand||inspect.suggestions.testCommand,optional:true,placeholder:'npm ci && npm test'},{key:'previewCommand',label:'Preview command',value:r.previewCommand||inspect.suggestions.previewCommand,optional:true,placeholder:'npm ci && npm run dev -- --host 0.0.0.0'},{key:'port',label:'Container preview port',type:'number',value:r.port||5173},{key:'image',label:'Container image',value:r.image||'node:24-bookworm'},{key:'thinkingLevel',label:'Thinking effort',value:r.thinkingLevel||'off',help:'Applied only to models that support reasoning; unsupported models ignore it.',options:['off','minimal','low','medium','high','xhigh'].map(value=>({value,label:value}))},{key:'autonomy',label:'Maximum autonomy',options:modes,value:r.autonomy||'prepare'},{key:'requireReview',label:'Require an approved review before merging',type:'checkbox',value:r.requireReview??true}]} submit={onboarding?'Finish setup':'Save settings'} onSubmit={async b=>{await api(`/repos/${r.id}`,'PATCH',b);await done();notify(`${r.name} is ready. Add a provider connection to start AI work.`)}}/>{!onboarding&&isAdmin&&!r.self&&<div style={{marginTop:'22px',paddingTop:'16px',borderTop:'1px solid var(--line)',display:'flex',justifyContent:'space-between',alignItems:'center'}}><div><strong style={{fontSize:'13px',display:'block'}}>Remove repository</strong><small style={{color:'var(--muted)'}}>Remove from Orchestra. Your local repository directory will not be touched.</small></div><button type="button" className="secondary" style={{color:'var(--danger,#ef4444)',borderColor:'rgba(239,68,68,0.3)'}} onClick={async()=>{if(!confirm(`Remove repository "${r.name}" from Orchestra? Your source files on disk will NOT be touched.`))return;try{await api(`/repos/${r.id}`,'DELETE');await done();notify(`Removed repository "${r.name}" from Orchestra`);}catch(e){notify((e as Error).message);}}}><Trash2 size={14}/> Remove repository</button></div>}</Modal>)}catch(e){notify((e as Error).message)}}
 function newJob(repoId?:string,changeId?:string,jobKind='implement'){if(!repoOptions.length){newRepo();return;}MD(<TaskModal repoId={repoId} changeId={changeId} jobKind={jobKind} state={state} catalog={catalog} close={close} done={done} openJob={openJob}/>)}
 function newWorkflow(){if(!repoOptions.length){newRepo();return;}MD(<Modal title="Let the next step happen automatically" onClose={close}><Form fields={[{key:'name',label:'Workflow name',placeholder:'Review every new change'},{key:'repoId',label:'Repository',options:repoOptions},{key:'trigger',label:'When',options:[{value:'change_created',label:'A change request is created'},{value:'change_updated',label:'A change request is updated'},{value:'comment',label:'A comment is added'},{value:'conflict',label:'Merge conflicts are detected'},{value:'test_failed',label:'Tests fail'},{value:'schedule',label:'On a recurring schedule'}]},{key:'kind',label:'Do',options:kinds,value:'review'},{key:'prompt',label:'Agent instructions',type:'textarea',placeholder:'Review the changes for correctness, regressions, and missing tests.'},{key:'intervalMinutes',label:'Schedule interval (minutes)',type:'number',value:60,help:'Used only for recurring schedules. Minimum 5 minutes.'},{key:'thinkingLevel',label:'Thinking effort (reasoning-capable models only)',options:['off','minimal','low','medium','high','xhigh'].map(value=>({value,label:value})),value:'off'},{key:'autonomy',label:'Autonomy',options:modes}]} submit="Enable workflow" onSubmit={async b=>{await api('/workflows','POST',b);await done()}}/></Modal>)}
 function configureWorkflow(w:Item){MD(<Modal title={`Configure ${w.name}`} onClose={close}><p className="muted">Configure automation triggers, agent instructions, thinking effort, and autonomy.</p><Form fields={[{key:'name',label:'Workflow name',value:w.name},{key:'prompt',label:'Agent instructions',type:'textarea',value:w.prompt},...(w.trigger==='schedule'?[{key:'intervalMinutes',label:'Schedule interval (minutes)',type:'number',value:w.intervalMinutes||60,help:'Used only for recurring schedules. Minimum 5 minutes.'}]:[]),{key:'thinkingLevel',label:'Thinking effort (reasoning-capable models only)',options:['off','minimal','low','medium','high','xhigh'].map(value=>({value,label:value})),value:w.thinkingLevel||'off'},{key:'autonomy',label:'Autonomy',options:modes,value:w.autonomy||'prepare'},{key:'enabled',label:'Workflow active',type:'checkbox',value:w.enabled??true}]} submit="Save settings" onSubmit={async b=>{await api(`/workflows/${w.id}`,'PATCH',b);await done();notify(`Workflow "${w.name}" updated`);}}/>{canEdit&&<div style={{marginTop:'22px',paddingTop:'16px',borderTop:'1px solid var(--line)',display:'flex',justifyContent:'space-between',alignItems:'center'}}><div><strong style={{fontSize:'13px',display:'block'}}>Delete workflow</strong><small style={{color:'var(--muted)'}}>Remove this automation permanently.</small></div><button type="button" className="secondary" style={{color:'var(--danger,#ef4444)',borderColor:'rgba(239,68,68,0.3)'}} onClick={async()=>{if(!confirm(`Delete workflow "${w.name}"?`))return;try{await api(`/workflows/${w.id}`,'DELETE');await done();notify(`Deleted workflow "${w.name}"`);}catch(e){notify((e as Error).message);}}}><Trash2 size={14}/> Delete workflow</button></div>}</Modal>)}
 function createCR(){MD(<CreateChangeRequestModal state={state} catalog={catalog} close={close} onCreated={async(jobId:string)=>{await done();openJob(jobId)}} defaultRepoId={project!=='all'?state.repos.find((r:Item)=>r.projectId===project)?.id:undefined}/>)}
 async function invite(device=false){if(device){await run(async()=>{const v=await api('/invites','POST',{userId:me!.id});MD(<LinkModal title="Add another device" url={v.url} onClose={close}/>)});return;}MD(<Modal title="Invite someone to your workspace" onClose={close}><Form fields={[{key:'role',label:'Role',options:['viewer','operator','admin'].map(value=>({value,label:label(value)}))},{key:'projectId',label:'Project access',options:[{value:'',label:'No projects yet'},...state.projects.map((p:Item)=>({value:p.id,label:p.name}))]}]} submit="Create invitation" onSubmit={async b=>{const v=await api('/invites','POST',{role:b.role,projects:b.projectId?[b.projectId]:[]});MD(<LinkModal title="Your invitation is ready" url={v.url} onClose={close}/>);}}/></Modal>)}
 function addResource(){MD(<Modal title="Teach Orchestra a new way to work" onClose={close}><p className="muted">Versioned prompts and skills adapt your agents. Executable extensions require admin activation.</p><Form fields={[{key:'projectId',label:'Project',options:state.projects.map((p:Item)=>({value:p.id,label:p.name}))},{key:'name',label:'Name',placeholder:'Our review standards'},{key:'kind',label:'Resource type',options:['prompt','skill','extension'].map(value=>({value,label:label(value)}))},{key:'content',label:'Instructions or TypeScript extension',type:'textarea'}]} submit="Save draft" onSubmit={async b=>{await api('/resources','POST',b);await done()}}/></Modal>)}
 if(loading)return <div className="loading"><Loader2 className="spin"/>Opening Orchestra…</div>;
 if(!me)return <Welcome onLogin={async u=>{M(u);await refresh();navigate(pageRef.current,detailRef.current,projectRef.current,true);}}/>;
 const running=jobs.filter((j:Item)=>j.status==='running');const attention=jobs.filter((j:Item)=>['blocked','failed','awaiting_approval','interrupted'].includes(j.status));const open=changes.filter((c:Item)=>c.status==='open');
 return <div className="app"><aside className="sidebar"><a className="brand" onClick={()=>{P('overview');D(null);setAdminOpen(false)}}><span className="brandmark"><GitBranch size={23}/></span>orchestra</a><button className="workspace-switch" onClick={()=>{P('repositories');D(null);setAdminOpen(false)}}><div className="workspace-avatar">{me.name[0].toUpperCase()}</div><span>{me.name}'s workspace<small>Private · {label(me.role)}</small></span><ChevronDown size={14}/></button><div className="nav-label">WORKSPACE</div><nav>{[{id:'overview',name:'Overview',icon:LayoutDashboard},{id:'repositories',name:'Repositories',icon:FolderGit2},{id:'changes',name:'Change requests',icon:GitPullRequest,count:open.length},{id:'work',name:'Agent work',icon:Sparkles,count:running.length},{id:'automations',name:'Automations',icon:Zap},{id:'previews',name:'Previews',icon:Box}].map(n=><button key={n.id} className={page===n.id&&!detail&&!adminOpen?'active':''} onClick={()=>{P(n.id);D(null);setAdminOpen(false)}}><n.icon size={18}/>{n.name}{!!n.count&&<span className="nav-count">{n.count}</span>}</button>)}{isAdmin&&<button className={adminOpen?'active':''} onClick={()=>setAdminOpen(o=>!o)} aria-label="Admin AI"><MessageSquare size={18}/>Admin AI{adminPending>0&&<span className="nav-count">{adminPending}</span>}</button>}</nav><div className="nav-label project-label">PROJECTS{isAdmin&&<button className="icon-button" title="New project" onClick={newProject}><Plus size={14}/></button>}</div><div className="project-list"><button className={project==='all'?'selected':''} onClick={()=>PR('all')}><span className="project-dot all"/>All projects</button>{state.projects.map((p:Item,i:number)=><div key={p.id} className="project-item"><button className={project===p.id?'selected':''} onClick={()=>PR(p.id)}><span className={`project-dot c${i%4}`}/>{p.name}</button>{isAdmin&&<button className="icon-button project-settings-btn" title={`Project settings: ${p.name}`} onClick={e=>{e.stopPropagation();manageProject(p)}}><Settings2 size={13}/></button>}</div>)}{!state.projects.length&&<p className="sidebar-note">Your next idea starts here.</p>}</div><div className="sidebar-bottom"><div className="system-note"><span className="pulse-dot"/><span>Local engine online<small>Powered by Pi</small></span><button className="icon-button" title={isAdmin?'Restart service & reload':'Reload dashboard'} onClick={triggerReload} disabled={reloading}><RotateCw size={14} className={reloading?'spin':''}/></button></div><nav><button className={page==='settings'?'active':''} onClick={()=>{P('settings');D(null);setAdminOpen(false)}}><Settings2 size={18}/>Settings & connections</button></nav><div className="profile"><span className="avatar">{me.name[0].toUpperCase()}</span><span>{me.name}<small>{label(me.role)}</small></span><button className="icon-button" aria-label="Toggle theme" onClick={()=>TH(theme==='light'?'dark':'light')}>{theme==='light'?<Moon size={17}/>:<Sun size={17}/>}</button></div></div></aside>
 <div className="main"><header className="topbar"><div className="breadcrumb"><span>Workspace</span><ChevronRight size={13}/><strong>{detail?label(detail.type):label(page)}</strong>{project!=='all'&&(()=>{const curP=state.projects.find((p:Item)=>p.id===project);return curP?<><ChevronRight size={13}/>{isAdmin?<button className="breadcrumb-project-btn" title={`Project settings: ${curP.name}`} onClick={()=>manageProject(curP)}><span>{curP.name}</span><Settings2 size={12}/></button>:<span>{curP.name}</span>}</>:null;})()}</div><button className="search-trigger" onClick={()=>MD(<SearchModal state={state} close={close} select={(type,id)=>{if(type==='job')openJob(id);else openChange(id);close()}}/>)}><Search size={15}/><span>Jump to anything</span><kbd>⌘ K</kbd></button><div className="topbar-actions"><button className="reload-btn" title={isAdmin?'Rebuild, restart service, and reload dashboard':'Reload dashboard'} onClick={triggerReload} disabled={reloading}><RotateCw size={14} className={reloading?'spin':''}/><span>{reloading?'Reloading…':'Reload'}</span></button><span className="local-label"><span/>Local workspace</span></div></header>
 <main>{detail?<Detail type={detail.type} id={detail.id} state={state} me={me} back={goBack} newJob={newJob} refresh={refresh} notify={notify} run={run} triggerReload={triggerReload} reloading={reloading} openChange={openChange} openJob={openJob} catalog={catalog}/>:<>
 {page==='overview'&&<><div className="page-heading"><div><div className="eyebrow">YOUR ENGINEERING WORKSPACE</div><h1>A little less busywork.<br/><span>A lot more building.</span></h1><p>Your repositories, agents, and next steps. All in one place.</p></div>{canEdit&&<button className="primary" onClick={()=>newJob()}><Plus size={16}/>New task</button>}</div><div className="metrics">{[{name:'Open changes',n:open.length,icon:GitPullRequest,note:open.length?'Ready for your attention':'A clean slate',page:'changes'},{name:'Agents at work',n:running.length,icon:Sparkles,note:running.length?'Moving things forward':'Ready when you are',page:'work'},{name:'Needs attention',n:attention.length,icon:MessageSquare,note:attention.length?'Your input makes the difference':'Nothing blocking your flow',page:'work'},{name:'Active automations',n:workflows.filter((w:Item)=>w.enabled).length,icon:Zap,note:'The work behind the work',page:'automations'}].map(m=><button key={m.name} className="metric" onClick={()=>P(m.page)}><span className="metric-label">{m.name}<m.icon size={17}/></span><strong>{m.n.toString().padStart(2,'0')}</strong><small>{m.note}</small></button>)}</div>
 {!state.repos.length&&<div className="welcome-card"><div><span className="pill"><Sparkles size={13}/>LET'S GET YOU SET UP</span><h2>Your next collaborator is ready.</h2><p>Bring a repository, connect your favorite model,<br/>and give your first agent something worth doing.</p><button className="primary" onClick={()=>newRepo()}>Connect a repository<ArrowRight size={16}/></button></div><div className="orbit-art" aria-hidden="true"><div className="orbit o1"/><div className="orbit o2"/><div className="art-center"><GitBranch size={38}/></div><span className="art-node n1"><Code2 size={20}/></span><span className="art-node n2"><Sparkles size={20}/></span><span className="art-node n3"><Check size={20}/></span><span className="art-node n4"><GitPullRequest size={20}/></span></div></div>}
 <div className="overview-grid"><section className="panel"><div className="panel-title"><h2><Sparkles size={18}/>In motion</h2><button className="text-button" onClick={()=>P('work')}>All work<ArrowRight size={14}/></button></div>{jobs.length?<div>{[...jobs].sort((a,b)=>b.created.localeCompare(a.created)).slice(0,5).map(j=><JobRow key={j.id} job={j} repo={findRepo(j.repoId)} onClick={()=>openJob(j.id)}/>)}</div>:<Empty icon={Sparkles} title="Space to do your best work" description="Start a task and follow your agent's progress here." action={<button className="text-button" onClick={()=>newJob()}>Create your first task <ArrowRight size={14}/></button>}/>}</section><section className="panel"><div className="panel-title"><h2><Zap size={18}/>On autopilot</h2><span className="subtle">WORKFLOWS</span></div>{workflows.length?workflows.slice(0,4).map((w:Item)=><div className="workflow-mini" key={w.id}><span className="soft-icon"><Zap size={17}/></span><div><strong>{w.name}</strong><small>{label(w.trigger)}</small></div><span className={`dot ${w.enabled?'green':''}`}/></div>):<div className="automation-starter"><span className="soft-icon"><Zap size={22}/></span><h3>Make the routine automatic.</h3><p>Reviews when changes land.<br/>Fixes when tests fail. You set the rules.</p><button className="secondary" onClick={newWorkflow}>Create a workflow<Plus size={14}/></button></div>}<div className="panel-foot"><Shield size={14}/>Your guardrails. Your final say.</div></section></div><div className="bottom-note"><GitBranch size={14}/>Built for the way you ship.<span>Local Git · Isolated worktrees · Pi agents</span></div></>}
 {page==='repositories'&&<><PageHeading eyebrow="PROJECTS & CODE" title="A place for every idea." description="Connect repositories. Keep the whole picture in view." action={isAdmin&&<button className="primary" onClick={()=>newRepo()}><Plus size={16}/>Add repository</button>}/>{project!=='all'&&(()=>{const curP=state.projects.find((p:Item)=>p.id===project);if(!curP)return null;return <div className="project-banner"><div className="project-banner-info"><strong>{curP.name}</strong>{curP.description?<small>{curP.description}</small>:<small style={{color:'var(--muted)'}}>No description</small>}</div>{isAdmin&&<button className="secondary" onClick={()=>manageProject(curP)}><Settings2 size={14}/>Project settings</button>}</div>;})()}<div className="repo-grid">{repos.map((r:Item)=><section className="repo-card" key={r.id}><div className="repo-card-top"><span className="repo-icon"><FolderGit2 size={24}/></span><Status value={r.status}/></div><h2>{r.name}</h2><p>{state.projects.find((p:Item)=>p.id===r.projectId)?.name}</p><div className="repo-branch"><GitBranch size={14}/>{r.base||'Importing…'}<span>{state.changes.filter((c:Item)=>c.repoId===r.id&&c.status==='open').length} open changes</span></div><div className="repo-details"><span><Sparkles size={14}/>{r.model||'No model selected'}</span><span><Shield size={14}/>{modes.find(m=>m.value===r.autonomy)?.label}</span></div>{r.error&&<p className="error">{r.error}</p>}<footer><button className="text-button" onClick={()=>newJob(r.id)}>Start work<ArrowRight size={14}/></button>{isAdmin&&<button className="icon-button" title="Repository settings" onClick={()=>configureRepo(r)}><Settings2 size={17}/></button>}</footer></section>)}{isAdmin&&<button className="add-repo-card" onClick={()=>newRepo()}><Plus size={24}/><strong>Connect a repository</strong><span>Local path or remote Git URL</span></button>}</div></>}
 {page==='work'&&<><PageHeading eyebrow="YOUR AI TEAM" title="Good work, in progress." description="Every task has a conversation. Every result has evidence." action={canEdit&&<button className="primary" onClick={()=>newJob()}><Plus size={16}/>New task</button>}/><Filter value={query} change={Q} placeholder="Find a task…"/><section className="panel">{jobs.length?jobs.filter((j:Item)=>j.title.toLowerCase().includes(query.toLowerCase())).sort((a:Item,b:Item)=>b.created.localeCompare(a.created)).map((j:Item)=><JobRow key={j.id} job={j} repo={findRepo(j.repoId)} onClick={()=>openJob(j.id)}/>):<Empty icon={Sparkles} title="Your agents are ready" description="Start with a plan, a code review, a failing test, or an improvement." action={<button className="primary" onClick={()=>newJob()}>Start a task<ArrowRight size={15}/></button>}/>}</section></>}
 {page==='changes'&&<><PageHeading eyebrow="REVIEW & SHIP" title="Small changes. Real progress." description="Local change requests, with everything you need to make the call." action={canEdit&&repoOptions.length>0&&<button className="primary" onClick={createCR}><Plus size={16}/>New change request</button>}/><Filter value={query} change={Q} placeholder="Find a change request…"/><section className="panel">{changes.length?changes.filter((c:Item)=>c.title.toLowerCase().includes(query.toLowerCase())).map((c:Item)=><button className="list-row" key={c.id} onClick={()=>openChange(c.id)}><span className={`row-icon ${c.status==='merged'?'purple':c.status==='closed'?'':'green'}`}><GitPullRequest size={20}/></span><div className="row-main"><strong>{c.title}</strong><small>{findRepo(c.repoId)?.name} <span>·</span> {c.source} → {c.target}</small></div>{c.conflict&&<span className="status failed">Conflicts</span>}<Status value={c.status}/><ChevronRight size={16}/></button>):<Empty icon={GitPullRequest} title="Nothing waiting in the wings" description="Agent changes appear here for review. You can also compare existing branches."/>}</section></>}
 {page==='automations'&&<><PageHeading eyebrow="LET THE ROUTINE RUN" title="Your workflow, on repeat." description="Event-driven agents and schedules that keep your projects moving." action={canEdit&&<button className="primary" onClick={newWorkflow}><Plus size={16}/>New workflow</button>}/><section className="panel">{workflows.length?workflows.map((w:Item)=><div className="list-row" key={w.id}><span className="row-icon purple"><Zap size={20}/></span><div className="row-main"><strong>{w.name}</strong><small>{findRepo(w.repoId)?.name} <span>·</span> {label(w.trigger)} → {label(w.kind)}{w.thinkingLevel&&w.thinkingLevel!=='off'?` · ${w.thinkingLevel} thinking`:''}{w.trigger==='schedule'&&` · Every ${w.intervalMinutes} min · Next ${new Date(w.nextRun).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})}`}</small>{w.error&&<small className="error">{w.error}</small>}</div><Status value={w.enabled?'enabled':'paused'}/>{canEdit&&<button className="icon-button" title="Configure workflow" onClick={()=>configureWorkflow(w)}><Settings2 size={17}/></button>}{canEdit&&<button className="icon-button" title={w.enabled?'Pause':'Enable'} onClick={()=>run(()=>api(`/workflows/${w.id}`,'PATCH',{enabled:!w.enabled}))}>{w.enabled?<Pause size={17}/>:<Play size={17}/>}</button>}</div>):<Empty icon={Zap} title="Less checking. More creating." description="Set a trigger, give an agent instructions, and decide how much autonomy it gets." action={<button className="primary" onClick={newWorkflow}>Create a workflow<ArrowRight size={15}/></button>}/>}</section><div className="section-heading"><h2>Skills & instructions</h2>{canEdit&&<button className="secondary" onClick={addResource}><Plus size={15}/>New resource</button>}</div><p className="muted">Versioned knowledge that shapes how your agents work. Create improvements with an “Adapt” task, then activate the result here.</p><div className="repo-grid">{state.resources.filter((r:Item)=>project==='all'||r.projectId===project).map((r:Item)=><div className="repo-card" key={r.id}><div className="repo-card-top"><FileCode2 size={22}/><Status value={r.active?'active':'draft'}/></div><h3>{r.name}</h3><p>{label(r.kind)} · Version {r.version}</p><pre className="resource-preview">{r.content.slice(0,180)}</pre>{!r.active&&canEdit&&<button className="secondary" onClick={()=>run(()=>api(`/resources/${r.id}/activate`,'POST',{}))}>Activate this version</button>}</div>)}</div></>}
 {page==='previews'&&<><PageHeading eyebrow="SEE IT COME TO LIFE" title="From code to something real." description="On-demand Docker previews. Isolated, live, and easy to share with your devices." action={canEdit&&<button className="primary" onClick={()=>MD(<Modal title="Start a browser preview" onClose={close}><Form fields={[{key:'repoId',label:'Repository',options:repoOptions}]} submit="Start preview" onSubmit={async b=>{await api('/previews','POST',b);await done()}}/></Modal>)}><Plus size={16}/>Start preview</button>}/><section className="panel">{state.previews.length?state.previews.filter((p:Item)=>project==='all'||p.projectId===project).map((p:Item)=><div className="list-row" key={p.id}><span className="row-icon purple"><Box size={20}/></span><div className="row-main"><strong>{findRepo(p.repoId)?.name}</strong><small>{p.error||`Started ${ago(p.created)} · Stops after 30 minutes idle`}</small></div><Status value={p.status}/>{p.status==='running'&&<button className="secondary" onClick={()=>run(async()=>{const x=await api(`/previews/${p.id}/link`,'POST',{});MD(<Modal title="Your preview is ready" onClose={close}><p className="muted">Open the live app via Orchestra's preview ingress.</p><a className="primary" href={x.url} target="_blank" rel="noreferrer">Open preview<ExternalLink size={15}/></a></Modal>)})}>Open<ExternalLink size={14}/></button>}<button className="icon-button" title="Logs" onClick={()=>run(async()=>{const x=await api(`/previews/${p.id}/logs`);MD(<Modal title="Preview logs" onClose={close} wide><pre className="terminal">{x.log}</pre></Modal>)})}><Terminal size={17}/></button>{canEdit&&<button className="icon-button" title="Stop preview" onClick={()=>run(()=>api(`/previews/${p.id}/stop`,'POST',{}))}><Square size={16}/></button>}</div>):<Empty icon={Box} title="A preview when you need one" description="Configure a preview command in repository settings, then launch it here or from a task."/>}</section></>}
 {page==='settings'&&<Settings me={me} state={state} refresh={refresh} notify={notify} invite={invite} modal={MD} close={close} run={run} triggerReload={triggerReload} reloading={reloading}/>}
 </>}</main></div>{isAdmin&&<AdminConsole open={adminOpen} onClose={()=>setAdminOpen(false)} onPendingCount={setAdminPending} api={api} me={me} state={state} catalog={catalog} refresh={refresh} onJob={openJob} context={{page,projectId:project==='all'?undefined:project,changeId:detail?.type==='change'?detail.id:undefined,jobId:detail?.type==='job'?detail.id:undefined,repoId:detail?.type==='change'?state.changes.find((c:Item)=>c.id===detail.id)?.repoId:detail?.type==='job'?state.jobs.find((j:Item)=>j.id===detail.id)?.repoId:undefined}}/>}{modal}{toast&&<div className="toast" role="status"><CheckCircle2 size={17}/>{toast}<button className="icon-button" onClick={()=>T('')}><X size={14}/></button></div>}</div>
}
function PageHeading({eyebrow,title,description,action}:{eyebrow:string,title:string,description:string,action?:React.ReactNode}){return <div className="page-heading compact"><div><div className="eyebrow">{eyebrow}</div><h1>{title}</h1><p>{description}</p></div>{action}</div>}
function Filter({value,change,placeholder}:{value:string,change:(s:string)=>void,placeholder:string}){return <div className="filter"><Search size={16}/><input placeholder={placeholder} value={value} onChange={e=>change(e.target.value)}/></div>}
function JobRow({job:j,repo,onClick}:{job:Item,repo:Item,onClick:()=>void}){return <button className="list-row" onClick={onClick}><span className={`row-icon ${j.status==='running'?'purple':j.status==='completed'?'green':''}`}>{j.status==='running'?<Loader2 size={20} className="spin"/>:j.status==='completed'?<Check size={20}/>:<Sparkles size={20}/>}</span><div className="row-main"><strong>{j.title}</strong><small>{repo?.name} <span>·</span> {label(j.kind)} <span>·</span> {ago(j.created)}</small></div><Status value={j.status}/><ChevronRight size={16}/></button>}
function LinkModal({title,url,onClose}:{title:string,url:string,onClose:()=>void}){const [copied,C]=useState(false);return <Modal title={title} onClose={onClose}><p className="muted">This link can be used once and expires in 24 hours. Treat it like a key to your workspace.</p><textarea readOnly rows={3} value={url}/><div className="form-footer"><button className="primary" onClick={async()=>{try{await navigator.clipboard.writeText(url);C(true)}catch{}}}>{copied?<Check size={16}/>:<Copy size={16}/>} {copied?'Copied':'Copy invite link'}</button></div></Modal>}
function Welcome({onLogin}:{onLogin:(u:Item)=>void}){const [secret]=useState(()=>location.hash.slice(1)),[initialized,I]=useState(false);useEffect(()=>{api('/setup').then(x=>I(x.initialized));if(secret)history.replaceState(null,'',location.pathname)},[]);return <div className="welcome-screen"><div className="welcome-left"><a className="brand"><span className="brandmark"><GitBranch size={24}/></span>orchestra</a><div className="welcome-copy"><span className="pill">SOFTWARE, IN MOTION</span><h1>More ideas shipped.<br/><span>Less in your way.</span></h1><p>A calm home for your code and AI collaborators.<br/>Your tools. Your models. Your way of working.</p><div className="welcome-features"><span><FolderGit2 size={19}/>Every repository, connected.</span><span><Sparkles size={19}/>Agents that work alongside you.</span><span><Shield size={19}/>Always under your control.</span></div></div><small>Powered by Pi · Built to run on your machine</small></div><div className="welcome-right"><div className="onboarding-box"><div className="soft-icon"><ArrowUpRight size={25}/></div><h2>{secret?initialized?'Welcome to the workspace.':'Make yourself at home.':'Your workspace is waiting.'}</h2><p className="muted">{secret?'No passwords. This browser becomes your trusted device.':'Use a device invitation or your setup link to get started.'}</p><Form fields={[...(!secret?[{key:'token',label:'Invitation token',placeholder:'Paste the token from your invite URL'}]:[]),{key:'name',label:'What should we call you?',placeholder:'Your name'}]} submit="Enter your workspace" onSubmit={async b=>{const result=await api('/redeem','POST',{token:secret||b.token,name:b.name});localStorage.setItem('relay.device',result.token);onLogin(result.user)}}/><div className="onboarding-note"><Shield size={16}/>Access stays on this device. Add another one later with an invitation.</div></div></div></div>}
function SearchModal({state,close,select}:{state:Item,close:()=>void,select:(t:string,id:string)=>void}){const [q,Q]=useState('');return <Modal title="Jump to work" onClose={close}><Filter value={q} change={Q} placeholder="Search tasks and change requests…"/>{[...state.jobs.map((x:Item)=>({...x,type:'job'})),...state.changes.map((x:Item)=>({...x,type:'change'}))].filter(x=>x.title.toLowerCase().includes(q.toLowerCase())).slice(0,10).map(x=><button className="list-row" key={x.id} onClick={()=>select(x.type,x.id)}><span className="row-main"><strong>{x.title}</strong><small>{label(x.type)}</small></span><ArrowRight size={16}/></button>)}</Modal>}

function SwitchModelModal({item,state,catalog,close,onDone}:any){
 const repo=state.repos.find((r:Item)=>r.id===item.repoId);
 const connected=state.connections.filter((c:Item)=>c.status==='connected');
 const [connectionId,setConnectionId]=useState(item.connectionId||repo?.connectionId||connected[0]?.id||'');
 const [model,setModel]=useState(item.model||repo?.model||'');
 const [thinkingLevel,setThinkingLevel]=useState(item.thinkingLevel||repo?.thinkingLevel||'off');
 const [busy,setBusy]=useState(false);
 const [err,setErr]=useState('');

 const selectedConn=state.connections.find((c:Item)=>c.id===connectionId);
 const modelOptions=(selectedConn?.models||catalog?.find((p:Item)=>p.id===selectedConn?.provider)?.models||selectedConn?.config?.models||[]).map((m:Item)=>({value:m.id,label:m.name||m.id}));

 const handleSave=async(andResume=false)=>{
  if(!model.trim()){
   setErr('Please select a model');
   return;
  }
  setBusy(true);
  setErr('');
  try{
   await api(`/jobs/${item.id}`,'PATCH',{
    connectionId:connectionId||undefined,
    model:model.trim(),
    thinkingLevel
   });
   if(andResume){
    await api(`/jobs/${item.id}/action`,'POST',{
     action:'resume',
     connectionId:connectionId||undefined,
     model:model.trim(),
     thinkingLevel
    });
   }
   await onDone(model.trim(),andResume);
   close();
  }catch(e){
   setErr((e as Error).message);
  }finally{
   setBusy(false);
  }
 };

 return (
  <Modal title="Switch task model" onClose={close}>
   <p className="muted">Choose which AI provider and model to use for this task. You can switch models anytime if a model is unavailable or another model is better suited.</p>
   {err&&<div className="error banner" style={{marginBottom:'12px'}}><AlertCircle size={16}/>{err}</div>}
   <form onSubmit={e=>{e.preventDefault();void handleSave(false);}}>
    <label className="field">
     <span>AI connection</span>
     <select
      value={connectionId}
      onChange={e=>{
       const nextId=e.target.value;
       setConnectionId(nextId);
       const conn=state.connections.find((c:Item)=>c.id===nextId);
       const opts=(conn?.models||catalog?.find((p:Item)=>p.id===conn?.provider)?.models||conn?.config?.models||[]);
       setModel(opts[0]?.id||'');
      }}
     >
      {connected.map((c:Item)=><option key={c.id} value={c.id}>{c.name}</option>)}
     </select>
    </label>
    <label className="field">
     <span>Model</span>
     <select
      value={model}
      onChange={e=>setModel(e.target.value)}
      required
     >
      <option value="">Select a model</option>
      {modelOptions.map((m:Item)=><option key={m.value} value={m.value}>{m.label}</option>)}
     </select>
    </label>
    <label className="field">
     <span>Thinking effort</span>
     <select
      value={thinkingLevel}
      onChange={e=>setThinkingLevel(e.target.value)}
     >
      {['off','minimal','low','medium','high','xhigh'].map(v=><option key={v} value={v}>{v}</option>)}
     </select>
     <small>Applied to reasoning-capable models (e.g. Gemini 4 Argon, Claude 5.5, GPT-OSS).</small>
    </label>
    <div className="form-footer" style={{marginTop:'20px'}}>
     <button type="button" className="secondary" onClick={close} disabled={busy}>Cancel</button>
     <button type="submit" className="secondary" disabled={busy||!model}>
      {busy?<Loader2 className="spin" size={16}/>:<Check size={16}/>}
      {busy?'Saving…':'Apply model'}
     </button>
     {['failed','blocked','interrupted','awaiting_approval','cancelled'].includes(item.status)&&(
      <button
       type="button"
       className="primary"
       disabled={busy||!model}
       onClick={()=>void handleSave(true)}
      >
       {busy?<Loader2 className="spin" size={16}/>:<Play size={16}/>}
       Apply & Resume
      </button>
     )}
    </div>
   </form>
  </Modal>
 );
}
function formatToolData(data:any):string{
 if(data===undefined||data===null)return '';
 if(typeof data==='string')return data;
 if(typeof data==='object'){
  if(typeof data.content==='string')return data.content;
  if(typeof data.output==='string')return data.output;
  if(typeof data.result==='string')return data.result;
  return JSON.stringify(data,null,2);
 }
 return String(data);
}
function Detail({type,id,state,me,back,newJob,refresh,notify,run,triggerReload,reloading,openChange,openJob,catalog}:any){const [item,I]=useState<Item|null>(null),[tab,TB]=useState('conversation'),[text,T]=useState(''),[commentText,setCommentText]=useState(''),[err,E]=useState(''),[ev,EV]=useState<any[]>([]),[forceModal,FM]=useState(false),[deleteModal,DM]=useState(false),[submittingCr,setSubmittingCr]=useState(false),[modelModal,setModelModal]=useState(false);const composerAttachments=useAttachmentState();const commentAttachments=useAttachmentState();const messagesEndRef=useRef<HTMLDivElement>(null);const load=useCallback(async()=>{try{const x=await api(`/${type==='job'?'jobs':'changes'}/${id}`);I(x);if(type==='job'&&x.events){EV(old=>{if(!old.length)return x.events;const known=new Set(old.map((e:any)=>e.seq));const newItems=x.events.filter((e:any)=>!known.has(e.seq));return newItems.length?[...old,...newItems].sort((a:any,b:any)=>a.seq-b.seq):old;});}}catch(e){E((e as Error).message)}},[type,id]);useEffect(()=>{I(null);EV([]);TB(type==='job'?'conversation':'diff');void load();const t=setInterval(load,3000);return()=>clearInterval(t)},[load]);
 useEffect(()=>{if(type!=='job')return;const controller=new AbortController();let after=0;const connect=async()=>{while(!controller.signal.aborted){try{const res=await fetch(`/api/jobs/${id}/events?after=${after}`,{headers:{Authorization:`Bearer ${token()}`},signal:controller.signal});if(!res.ok)break;const reader=res.body!.getReader(),decoder=new TextDecoder();let buf='';while(true){const {value,done}=await reader.read();if(done)break;buf+=decoder.decode(value,{stream:true});let end;while((end=buf.indexOf('\n\n'))>=0){const block=buf.slice(0,end);buf=buf.slice(end+2);const data=block.split('\n').find(s=>s.startsWith('data: '));if(data){const e=JSON.parse(data.slice(6));after=e.seq;EV(old=>old.some(x=>x.seq===e.seq)?old:[...old,e]);}}}}catch{}if(!controller.signal.aborted)await new Promise(r=>setTimeout(r,2000));}};void connect();return()=>controller.abort()},[id,type]);
 useEffect(()=>{if(type==='job'&&tab==='conversation'){messagesEndRef.current?.scrollIntoView({behavior:'smooth'});}},[ev.length,tab,type,item?.status]);
 if(err)return <div><button className="text-button back" onClick={back}><ArrowLeft size={15}/>Back to workspace</button><div className="error banner"><AlertCircle size={17}/>{err}</div></div>;if(!item)return <div><button className="text-button back" onClick={back}><ArrowLeft size={15}/>Back to workspace</button><div className="loading"><Loader2 className="spin"/>Loading workspace…</div></div>;const repo=state.repos.find((r:Item)=>r.id===item.repoId);const operate=me.role!=='viewer';
 const transcript:any[]=[];
 for(const e of ev){
  if(e.type==='text'){
   if(transcript.at(-1)?.type==='text')transcript.at(-1).data+=e.data;
   else transcript.push({...e});
  }else if(e.type==='thinking'){
   if(transcript.at(-1)?.type==='thinking')transcript.at(-1).data+=e.data;
   else transcript.push({...e});
  }else if(e.type==='tool'){
   transcript.push({...e,toolId:e.data?.id||e.data?.callId||e.data?.toolCallId,name:e.data?.name||'tool',args:e.data?.args,partialUpdate:''});
  }else if(e.type==='tool_update'){
   const toolId=e.data?.id||e.data?.callId||e.data?.toolCallId;
   const target=transcript.slice().reverse().find(t=>t.type==='tool'&&(toolId?t.toolId===toolId:true));
   if(target){
    if(e.data?.args)target.args=e.data.args;
    target.partialUpdate=e.data?.partialResult||(target.partialUpdate||'')+(typeof e.data?.update==='string'?e.data.update:JSON.stringify(e.data?.update||''));
   }
  }else if(e.type==='tool_result'){
   const toolId=e.data?.id||e.data?.callId||e.data?.toolCallId;
   const target=transcript.slice().reverse().find(t=>t.type==='tool'&&(toolId?t.toolId===toolId:!t.result));
   if(target){target.result=e.data?.result;target.isError=e.data?.isError;target.durationMs=e.data?.durationMs;}
   else{transcript.push({...e});}
  }else{
   transcript.push({...e});
  }
 }
 const lastEvent=transcript.at(-1);
 let currentActivity='Working on task…';
 if(lastEvent?.type==='thinking'){currentActivity='Reasoning through solution…';}
 else if(lastEvent?.type==='tool'){
  if(isSubagent(lastEvent.name,lastEvent.args)){
   const sInfo=parseSubagentInfo(lastEvent,item.status==='running');
   currentActivity=sInfo?getSubagentActivityText(sInfo):'Subagent working…';
  }else{
   const tName=lastEvent.name;
   if(tName==='run_command'||tName==='bash'){const cmd=lastEvent.args?.command||lastEvent.args?.cmd||'';currentActivity=cmd?`Executing: ${cmd.slice(0,60)}…`:'Running command…';}
   else if(tName==='read_file'){currentActivity=`Reading ${lastEvent.args?.Path||lastEvent.args?.path||'file'}…`;}
   else if(tName==='write_file'||tName==='edit_file'){currentActivity=`Writing changes to ${lastEvent.args?.Path||lastEvent.args?.path||'file'}…`;}
   else{currentActivity=`Running ${tName}…`;}
  }
 }else if(lastEvent?.type==='text'){currentActivity='Writing response…';}
 const hasFinalResultInTranscript=transcript.some(e=>e.type==='result'||(e.type==='text'&&item?.result&&e.data.trim()===item.result.trim()));
 const linkedJobs=(state.jobs||[]).filter((j:Item)=>j.changeId===id);
 const runningJob=linkedJobs.find((j:Item)=>j.status==='running');
 return <><button className="text-button back" onClick={back}><ArrowLeft size={15}/>Back to workspace</button><div className="detail-heading"><div className="eyebrow">{repo?.name} / {type==='job'?label(item.kind):'CHANGE REQUEST'}</div><h1>{item.title}</h1><div className="detail-meta"><Status value={item.status}/><span>{ago(item.created)}</span>{type==='job'&&<button type="button" className="model-selector-btn" title="Click to switch model" disabled={!operate||item.status==='running'} onClick={()=>setModelModal(true)}><Sparkles size={12}/><span>{item.model||'Select model'}{item.thinkingLevel&&item.thinkingLevel!=='off'?` · ${item.thinkingLevel}`:''}</span><ChevronDown size={11}/></button>}{type==='change'&&<code>{item.source} → {item.target}</code>}</div></div>{item.error&&<div className="error banner" style={{display:'flex',alignItems:'center',justifyContent:'space-between',gap:'12px'}}><div style={{display:'flex',alignItems:'center',gap:'8px'}}><AlertCircle size={17}/><span>{item.error}</span></div>{type==='job'&&operate&&<button type="button" className="secondary" style={{padding:'4px 10px',fontSize:'12px',whiteSpace:'nowrap'}} onClick={()=>setModelModal(true)}><Sparkles size={13}/>Switch model</button>}</div>}{type==='change'&&runningJob&&<section className="panel padded note-box" style={{marginBottom:16,borderColor:'var(--purple)'}}><div style={{display:'flex',alignItems:'center',justifyContent:'space-between',gap:12}}><div style={{display:'flex',alignItems:'center',gap:10}}><Loader2 size={18} className="spin" style={{color:'var(--purple)'}}/><div><strong style={{fontSize:'13px'}}>Agent actively working on this change request</strong><p className="muted" style={{margin:'2px 0 0',fontSize:'12px'}}>{runningJob.title} ({label(runningJob.kind)}) · started {ago(runningJob.created)}</p></div></div><button className="primary" style={{padding:'6px 14px',fontSize:'12px'}} onClick={()=>openJob?.(runningJob.id)}><span>View live task</span><ArrowRight size={13}/></button></div></section>}{type==='change'&&item.status==='merged'&&repo?.self&&<section className="panel padded note-box" aria-label="Orchestra update ready"><div className="section-heading" style={{margin:0}}><div><strong>Changes merged into Orchestra</strong><p className="muted" style={{margin:'4px 0 0'}}>Restart the service to apply these updates to the running server and dashboard.</p></div><button className="primary" onClick={triggerReload} disabled={reloading}><RotateCw size={14} className={reloading?'spin':''}/>{reloading?'Reloading…':'Reload Orchestra now'}</button></div></section>}{type==='change'&&item.status==='open'&&(()=>{const currentReviews=(item.reviews||[]).filter((r:Item)=>r.sourceSha===item.sourceSha&&r.targetSha===item.targetSha);const currentChecks=(item.checks||[]).filter((c:Item)=>c.sourceSha===item.sourceSha&&c.targetSha===item.targetSha);const latestByReviewer=new Map<string,Item>();for(const r of currentReviews)latestByReviewer.set(r.ai?'ai':r.authorId,r);const allRev=[...latestByReviewer.values()];const humanRev=allRev.filter(r=>!r.ai);const humanApproved=humanRev.some(r=>r.verdict==='approved');const humanChangesRequested=humanRev.some(r=>r.verdict==='changes_requested');const approved=allRev.some(r=>r.verdict==='approved');const pendingChanges=humanApproved?humanChangesRequested:allRev.some(r=>r.verdict==='changes_requested');const latestCheck=currentChecks.sort((a:Item,b:Item)=>b.created.localeCompare(a.created))[0];const needsReview=!!repo?.requireReview&&(!approved||pendingChanges);const needsTests=!!repo?.testCommand&&latestCheck?.status!=='passed';return <section className="panel padded" aria-label="Merge readiness"><strong>Merge readiness</strong>{(item.reviews||[]).some((r:Item)=>r.sourceSha!==item.sourceSha||r.targetSha!==item.targetSha)&&<p className="muted">Reviews are stale for the current source/target revisions. Request an independent review or approve the current SHA.</p>}{item.sourceSha&&item.targetSha&&<p className="muted">Current revisions: source <code>{item.sourceSha.slice(0,8)}</code> · target <code>{item.targetSha.slice(0,8)}</code></p>}{needsReview&&<p className="muted">{pendingChanges?'Current review requests changes; address feedback and request a fresh review.':'An approved review of these exact revisions is outstanding.'}</p>}{needsTests&&<p className="muted">{latestCheck?'Latest current-revision test run did not pass.':'A passing test run for these exact revisions is outstanding.'}</p>}{item.conflict&&<p className="muted">Merge conflicts are detected. Resolve them, then refresh and rerun checks/review.</p>}</section>})()}<div className="detail-actions">{operate&&type==='job'&&<>{item.changeId&&<button className="change-linked-badge" onClick={()=>openChange?.(item.changeId)} title="View linked change request"><GitPullRequest size={14}/><span>Change request #{item.changeId.slice(0,8)}</span><ArrowRight size={13}/></button>}{item.status==='running'?<button className="secondary" onClick={()=>run(()=>api(`/jobs/${id}/action`,'POST',{action:'cancel'}))}><Square size={14}/>Stop</button>:['blocked','failed','interrupted','completed','cancelled','awaiting_approval'].includes(item.status)&&<button className="primary" onClick={()=>run(()=>api(`/jobs/${id}/action`,'POST',{action:item.status==='awaiting_approval'?'approve':'resume'}))}><Play size={14}/>{item.status==='awaiting_approval'?'Approve work':'Resume'}</button>}<button type="button" className="secondary" title="Switch task model" disabled={item.status==='running'} onClick={()=>setModelModal(true)}><SlidersHorizontal size={14}/><span>Switch model</span></button><button className="secondary" onClick={()=>run(async()=>{await api('/previews','POST',{repoId:item.repoId,jobId:id});notify('Preview is starting. Find it in Previews.')} )}><Box size={15}/>Preview</button></>}{operate&&type==='change'&&(()=>{const currentReviews=(item.reviews||[]).filter((r:Item)=>r.sourceSha===item.sourceSha&&r.targetSha===item.targetSha);const myReview=currentReviews.filter((r:Item)=>r.authorId===me.id).sort((a:Item,b:Item)=>b.created.localeCompare(a.created))[0];const myApproved=myReview?.verdict==='approved';const canDelete=['owner','admin'].includes(me.role)||item.authorId===me.id;return <>{item.status==='open'&&<><button className="secondary" onClick={()=>newJob(item.repoId,id,'review')}><Sparkles size={15}/>AI review</button><button className="secondary" onClick={()=>newJob(item.repoId,id,'test')}><Play size={15}/>Run tests</button><button className="secondary" onClick={()=>newJob(item.repoId,id,item.conflict?'conflict':'address')}><Code2 size={15}/>{item.conflict?'Resolve conflicts':'Address feedback'}</button><button className="secondary" onClick={()=>run(()=>api(`/changes/${id}/refresh`,'POST',{}))}><RefreshCw size={15}/>Refresh</button>{!myApproved&&<button className="secondary" onClick={()=>run(async()=>{await api(`/changes/${id}/review`,'POST',{verdict:'approved',body:`Approved by ${me.name}`});await load();notify('Change request approved.')})}><Check size={15}/>Approve</button>}<button className="primary" onClick={()=>run(async()=>{await api(`/changes/${id}/merge`,'POST',{});await load();notify('Change request merged')} )}><GitMerge size={15}/>Merge</button>{['owner','admin'].includes(me.role)&&<button className="secondary" onClick={()=>FM(true)}><Shield size={15}/>Force merge</button>}<button className="secondary" onClick={()=>run(async()=>{await api(`/changes/${id}/close`,'POST',{});await load();notify('Change request declined.')})}><X size={15}/>Decline</button></>}{item.status==='closed'&&<button className="secondary" onClick={()=>run(async()=>{await api(`/changes/${id}/reopen`,'POST',{});await load();notify('Change request reopened.')})}><RefreshCw size={15}/>Reopen</button>}{canDelete&&<button className="secondary" onClick={()=>DM(true)}><Trash2 size={15}/>Delete</button>}</>;})()}</div>{forceModal&&<Modal title="Admin force merge" onClose={()=>FM(false)}><p className="muted">Admin force merge bypasses review and test gates. Revision and conflict checks still apply. This action is permanently recorded in the audit log.</p><Form fields={[{key:'reason',label:'Reason for audit log',placeholder:'e.g. Critical operational fix approved out-of-band'}]} submit="Force merge now" onSubmit={async b=>{await api(`/changes/${id}/force-merge`,'POST',{sourceSha:item.sourceSha,targetSha:item.targetSha,reason:b.reason});FM(false);await load();await refresh();notify('Change request force-merged.')}}/></Modal>}{deleteModal&&<Modal title="Delete change request" onClose={()=>DM(false)}><p className="muted">Permanently delete this change request, including its comments, reviews, and test checks. This action cannot be undone.</p><div className="form-footer"><button className="secondary" onClick={()=>DM(false)}>Cancel</button><button className="primary" onClick={()=>run(async()=>{await api(`/changes/${id}`,'DELETE');DM(false);back();notify('Change request deleted.')})}><Trash2 size={15}/>Permanently delete</button></div></Modal>}
 <div className="tabs">{(type==='job'?['conversation','tests']:['diff','discussion','reviews','tests']).map(t=><button key={t} className={tab===t?'active':''} onClick={()=>TB(t)}>{label(t)}</button>)}</div>
 {type==='job'&&tab==='conversation'&&<div className="conversation"><div className="message user-message"><span className="message-label">THE TASK</span><p>{item.prompt}</p><MessageAttachments images={item.images} attachments={item.attachments}/></div>{transcript.filter(e=>!['usage','status','session'].includes(e.type)).map((e,i)=>{
  if(e.type==='text'){
   return <div key={i} className="message agent-message"><span className="message-label"><Sparkles size={13}/>RELAY</span><div className="prose">{e.data}</div></div>;
  }
  if(e.type==='thinking'){
   return <details key={i} className="thinking-event" open={item.status==='running'}><summary><Sparkles size={12} className={item.status==='running'?'spin':''}/><span>Reasoning</span></summary><div className="thinking-content">{e.data}</div></details>;
  }
  if(e.type==='tool'){
   if(isSubagent(e.name,e.args)){
    return <SubagentCard key={i} tool={e} isRunning={!e.result&&item.status==='running'} formatToolData={formatToolData}/>;
   }
   return <details key={i} className="tool-event" open={!e.result&&item.status==='running'}><summary>{e.result?(e.isError?<AlertCircle size={15} style={{color:'var(--danger,#ef4444)'}}/>:<Check size={15} style={{color:'var(--green,#22c55e)'}}/>):<Loader2 size={15} className="spin"/>}<span style={{fontWeight:600}}>{e.name}</span>{e.args?.command?<code>{e.args.command.slice(0,90)}</code>:e.args?.Path||e.args?.path?<code>{e.args.Path||e.args.path}</code>:null}{e.durationMs?<span style={{fontSize:'10px',color:'var(--muted)',marginLeft:'auto'}}>{(e.durationMs/1000).toFixed(1)}s</span>:null}</summary>{e.args&&Object.keys(e.args).length>0&&<div style={{marginBottom:8}}><small style={{color:'var(--muted)',fontWeight:600,display:'block',marginBottom:4}}>Arguments</small><pre>{formatToolData(e.args)}</pre></div>}{e.partialUpdate&&!e.result&&<div className="tool-partial"><small style={{color:'var(--muted)',fontWeight:600,display:'block',marginBottom:4}}>Live output</small><pre>{e.partialUpdate}</pre></div>}{e.result!==undefined&&<div style={{marginTop:8}}><small style={{color:e.isError?'var(--danger,#ef4444)':'var(--muted)',fontWeight:600,display:'block',marginBottom:4}}>{e.isError?'Error output':'Output'}</small><pre style={{maxHeight:'250px',overflow:'auto'}}>{formatToolData(e.result)}</pre></div>}</details>;
  }
  if(e.type==='tool_result'){
   return <details key={i} className="tool-event"><summary>{e.data?.isError?<AlertCircle size={15} style={{color:'var(--danger,#ef4444)'}}/>:<Check size={15} style={{color:'var(--green,#22c55e)'}}/>}<span>Tool result</span></summary><pre style={{maxHeight:'250px',overflow:'auto'}}>{formatToolData(e.data?.result)}</pre></details>;
  }
  if(e.type==='result'){
   return <div key={i} className="message agent-message final-result"><span className="message-label"><Sparkles size={13}/>FINAL RESPONSE</span><div className="prose">{e.data}</div></div>;
  }
  if(e.type==='user'){
   return <div key={i} className="event-note user-event">{e.data?.text&&<p style={{margin:0}}>{e.data.text}</p>}<MessageAttachments images={e.data?.images} attachments={e.data?.attachments}/></div>;
  }
  return <div key={i} className={`event-note ${e.type==='error'?'error':''}`}>{typeof e.data==='string'?e.data:JSON.stringify(e.data)}</div>;
 })}{item.status==='completed'&&item.result&&!hasFinalResultInTranscript&&<div className="message agent-message final-result"><span className="message-label"><Sparkles size={13}/>FINAL RESPONSE</span><div className="prose">{item.result}</div></div>}{item.status==='running'&&<div className="working-indicator"><div className="working-status-text"><Loader2 size={15} className="spin"/><span>{currentActivity}</span></div></div>}<div ref={messagesEndRef}/>{!ev.length&&item.status!=='running'&&<p className="muted">{item.status==='blocked'?'Connect a provider in Settings, select it for this repository, then resume.':'The activity stream will appear here as your agent works.'}</p>}{operate&&<form className="composer" onSubmit={e=>{e.preventDefault();void run(async()=>{const steerText=text.trim()||(composerAttachments.images.length||composerAttachments.attachments.length?'(See attachments)':'');await api(`/jobs/${id}/action`,'POST',{action:item.status==='running'?'steer':'resume',text:steerText,images:composerAttachments.images.map(img=>({type:'image',data:img.data,mimeType:img.mimeType,name:img.name,url:img.url})),attachments:composerAttachments.attachments});T('');composerAttachments.clear();await load()})}} onPaste={composerAttachments.handlePaste} onDrop={composerAttachments.handleDrop} onDragOver={e=>e.preventDefault()}><textarea value={text} onChange={e=>T(e.target.value)} placeholder={item.status==='running'?'Steer your agent. Add context or adjust the direction…':'Continue the conversation…'}/><AttachmentInput images={composerAttachments.images} attachments={composerAttachments.attachments} onAdd={composerAttachments.addFiles} onRemoveImage={composerAttachments.removeImage} onRemoveAttachment={composerAttachments.removeAttachment}/><div className="composer-actions"><button type="button" className="model-selector-btn" title={item.status==='running'?'Disabled while running':'Click to switch model'} disabled={item.status==='running'} onClick={()=>setModelModal(true)}><Sparkles size={14}/><span>{item.model||'Choose model'}{item.thinkingLevel&&item.thinkingLevel!=='off'?` · ${item.thinkingLevel}`:''}</span><SlidersHorizontal size={12}/></button><div className="composer-buttons"><button type="button" className="secondary submit-task-btn" disabled={item.status==='running'||submittingCr} title={item.status==='running'?'Disabled while the model is actively working. Wait for it to finish or stop/steer it.':'Submit task for change request'} onClick={async()=>{setSubmittingCr(true);try{const res=await api(`/jobs/${id}/submit-change`,'POST',{});notify('Task submitted for change request!');await load();await refresh();if(res.change?.id&&openChange)openChange(res.change.id);}catch(e){notify((e as Error).message)}finally{setSubmittingCr(false);}}}><GitPullRequest size={14}/>{submittingCr?'Submitting…':item.changeId?'Update change request':'Submit task for change request'}</button>{item.status==='running'&&<button type="button" className="secondary" disabled={!text.trim()&&!composerAttachments.images.length&&!composerAttachments.attachments.length} onClick={()=>run(async()=>{const fuText=text.trim()||'(See attachments)';await api(`/jobs/${id}/action`,'POST',{action:'followup',text:fuText,images:composerAttachments.images.map(img=>({type:'image',data:img.data,mimeType:img.mimeType,name:img.name,url:img.url})),attachments:composerAttachments.attachments});T('');composerAttachments.clear()})}>Queue follow-up</button>}<button className="primary" disabled={!text.trim()&&!composerAttachments.images.length&&!composerAttachments.attachments.length}><ArrowUpRight size={16}/>{item.status==='running'?'Steer':'Continue'}</button></div></div></form>}</div>}
 {tab==='diff'&&<div className="diff-view"><div className="diff-header"><GitBranch size={15}/>{item.sourceSha?.slice(0,8)}<ArrowRight size={14}/>{item.targetSha?.slice(0,8)}<span>{item.conflict?'Merge conflicts detected':'Pinned revision comparison'}</span></div><pre>{item.diff?item.diff.split('\n').map((line:string,i:number)=><div key={i} className={line.startsWith('+')?'added':line.startsWith('-')?'removed':line.startsWith('@@')?'hunk':''}>{line||' '}</div>):'No changes between these revisions.'}</pre></div>}
 {tab==='discussion'&&<section className="panel padded">{linkedJobs.length>0&&<div style={{marginBottom:20}}><h3 style={{fontSize:'13px',fontWeight:600,marginBottom:10,display:'flex',alignItems:'center',gap:6}}><Sparkles size={14}/><span>Linked agent tasks ({linkedJobs.length})</span></h3><div style={{display:'flex',flexDirection:'column',gap:8}}>{linkedJobs.map((j:Item)=><div key={j.id} className="list-row agent-task-card" onClick={()=>openJob?.(j.id)} style={{cursor:'pointer',borderRadius:8,padding:'10px 14px',background:'var(--bg)',border:'1px solid var(--line)'}}><span className={`row-icon ${j.status==='running'?'purple':j.status==='completed'?'green':''}`}>{j.status==='running'?<Loader2 size={16} className="spin"/>:j.status==='completed'?<Check size={16}/>:<Sparkles size={16}/>}</span><div className="row-main"><strong>{j.title}</strong><small>{label(j.kind)} · {ago(j.created)}{j.model?` · ${j.model}`:''}</small>{j.result&&<p style={{margin:'4px 0 0',fontSize:'11px',color:'var(--muted)',maxHeight:'36px',overflow:'hidden',textOverflow:'ellipsis'}}>{j.result}</p>}</div><Status value={j.status}/><ChevronRight size={15}/></div>)}</div></div>}{item.comments.map((c:Item)=><div className="message" key={c.id}><span className="message-label">{c.author} · {ago(c.created)}{c.sourceSha!==item.sourceSha?' · Earlier revision':''}</span><p>{c.text}</p><MessageAttachments images={c.images} attachments={c.attachments}/></div>)}{!item.comments.length&&<p className="muted">A good conversation makes a better change.</p>}{operate&&<form onSubmit={async e=>{e.preventDefault();const cText=commentText.trim()||(commentAttachments.images.length||commentAttachments.attachments.length?'(See attachments)':'');if(!cText)return;await api(`/changes/${id}/comment`,'POST',{text:cText,images:commentAttachments.images.map(img=>({type:'image',data:img.data,mimeType:img.mimeType,name:img.name,url:img.url})),attachments:commentAttachments.attachments});setCommentText('');commentAttachments.clear();await load()}} onPaste={commentAttachments.handlePaste} onDrop={commentAttachments.handleDrop} onDragOver={e=>e.preventDefault()}><label className="field"><span>Add a comment</span><textarea rows={3} value={commentText} onChange={e=>setCommentText(e.target.value)} placeholder="Write a comment or feedback…"/></label><AttachmentInput images={commentAttachments.images} attachments={commentAttachments.attachments} onAdd={commentAttachments.addFiles} onRemoveImage={commentAttachments.removeImage} onRemoveAttachment={commentAttachments.removeAttachment}/><div className="form-footer" style={{marginTop:8}}><button className="primary" disabled={!commentText.trim()&&!commentAttachments.images.length&&!commentAttachments.attachments.length}>Post comment</button></div></form>}</section>}
 {tab==='reviews'&&<section className="panel padded">{linkedJobs.some((j:Item)=>j.kind==='review'&&j.status==='running')&&<div className="working-indicator" style={{marginBottom:16}}><div className="working-status-text"><Loader2 size={15} className="spin"/><span>AI review in progress… Results will appear here once complete.</span></div></div>}{item.reviews.map((r:Item)=><div className="message" key={r.id}><span className="message-label">{r.ai?'AI REVIEW':'REVIEW'} · {label(r.verdict)} {r.sourceSha!==item.sourceSha||r.targetSha!==item.targetSha?'· Stale':''}</span><div className="prose">{r.body}</div></div>)}{!item.reviews.length&&<p className="muted">No reviews yet. Ask an agent to inspect the change or add your review.</p>}{operate&&<Form fields={[{key:'verdict',label:'Verdict',options:['commented','approved','changes_requested'].map(value=>({value,label:label(value)}))},{key:'body',label:'Review',type:'textarea'}]} submit="Submit review" onSubmit={async b=>{await api(`/changes/${id}/review`,'POST',b);await load()}}/>}</section>}
 {tab==='tests'&&<section className="panel">{linkedJobs.some((j:Item)=>j.kind==='test'&&j.status==='running')&&<div className="working-indicator" style={{margin:'16px'}}><div className="working-status-text"><Loader2 size={15} className="spin"/><span>Test execution in progress… Results will appear here once complete.</span></div></div>}{item.checks?.length?item.checks.map((c:Item)=><details className="check-result" key={c.id}><summary><Status value={c.status}/><code>{c.sourceSha?.slice(0,8)}</code>{type==='change'&&(c.sourceSha!==item.sourceSha||c.targetSha!==item.targetSha)&&<span className="status paused">Stale</span>}<span>{ago(c.created)}</span></summary><pre className="terminal">{c.log||'No test output recorded.'}</pre></details>):<Empty icon={CheckCheck} title="Tests haven't run yet" description="Configure a test command for the repository, then run a test task. Coverage is only shown when measured."/>}</section>}
 {modelModal&&<SwitchModelModal item={item} state={state} catalog={catalog} close={()=>setModelModal(false)} onDone={async(m:string,resumed:boolean)=>{await load();await refresh();notify(resumed?`Switched model to ${m} and resumed task.`:`Switched model to ${m}.`);}}/>}
 </>}
function Settings({me,state,refresh,notify,invite,modal,close,run,triggerReload,reloading}:any){const [tab,ST]=useState('connections'),[providers,PV]=useState<Item[]>([]),[access,A]=useState<Item|null>(null);useEffect(()=>{api('/providers').then(PV).catch(()=>{});api('/access').then(A).catch(()=>{})},[]);const admin=['owner','admin'].includes(me.role);
 const login=(c:Item,isNew=false)=>modal(<ProviderLogin isNew={isNew} connection={c} provider={providers.find(p=>p.id===c.provider)} close={close} onDone={refresh}/>);
 function addConnection(){modal(<Modal title="Connect your favorite model" onClose={close}><p className="muted">Provider authentication is handled by Pi. Credentials are encrypted on this server for unattended work.</p><Form fields={[{key:'name',label:'Connection name',placeholder:'My coding models'},{key:'provider',label:'Provider',options:providers.map(p=>({value:p.id,label:p.name}))},...(admin?[{key:'shared',label:'Share with a project',type:'checkbox'},{key:'projectId',label:'Project',options:[{value:'',label:'Personal only'},...state.projects.map((p:Item)=>({value:p.id,label:p.name}))]}]:[])]} submit="Continue" onSubmit={async b=>{const c=await api('/connections','POST',{name:b.name,provider:b.provider,shared:b.shared||false,projects:b.shared&&b.projectId?[b.projectId]:[]});await refresh();if(c.status==='connected'){notify(`${b.name} connected.`);close();}else{login(c,true);}}}/></Modal>)}
 return <><PageHeading eyebrow="MAKE IT YOURS" title="The right tools. The right people." description="Manage provider connections, access, and trusted devices."/><div className="tabs">{['connections','people','devices',...(admin?['maintenance']:[])].map(t=><button key={t} className={tab===t?'active':''} onClick={()=>ST(t)}>{label(t)}</button>)}</div>{tab==='connections'&&<><div className="section-heading"><h2>Model connections</h2><div className="button-group">{admin&&<button className="secondary" onClick={()=>modal(<Modal title="Custom provider" onClose={close}><Form fields={[{key:'name',label:'Name',placeholder:'Local models'},{key:'provider',label:'Provider ID',placeholder:'my-ollama'},{key:'baseUrl',label:'API base URL',placeholder:'http://localhost:11434/v1'},{key:'api',label:'API format',options:['openai-completions','openai-responses','anthropic-messages','google-generative-ai'].map(value=>({value,label:value}))},{key:'model',label:'Model ID',placeholder:'qwen3-coder'}]} submit="Connect provider" onSubmit={async b=>{const c=await api('/connections','POST',{name:b.name,provider:b.provider,config:{name:b.name,baseUrl:b.baseUrl,api:b.api,models:[{id:b.model,name:b.model}]}});await refresh();login(c,true)}}/></Modal>)}>Custom provider</button>}<button className="primary" disabled={!providers.length} onClick={addConnection}><Plus size={15}/>Add connection</button></div></div><section className="panel">{state.connections.length?state.connections.map((c:Item)=><div className="list-row" key={c.id}><span className="row-icon purple"><KeyRound size={20}/></span><div className="row-main"><strong>{c.name}</strong><small>{c.provider} · {c.shared?'Shared':'Personal'}</small></div><Status value={c.status}/>{(admin||c.ownerId===me.id)&&<><button className="secondary" onClick={()=>login(c)}>Authenticate</button><button className="icon-button" title="Remove connection" onClick={()=>run(()=>api(`/connections/${c.id}`,'DELETE'))}><X size={16}/></button></>}</div>):<Empty icon={KeyRound} title="Bring your own intelligence" description="Sign in with a supported subscription or API key. Pi handles models and authentication."/>}</section><div className="section-heading"><h2>Provider catalog</h2><span className="muted">Live from the Pi SDK</span></div><div className="provider-grid">{providers.map(p=><details className="provider-card" key={p.id}><summary><span className="provider-initial">{p.name[0]}</span><strong>{p.name}</strong><ChevronDown size={15}/></summary><small>{p.methods.map(label).join(' · ')||'Ambient credentials'} · {p.models.length} models · reasoning effort available only on models marked reasoning-capable</small><div className="model-list">{p.models.map((m:Item)=><div key={m.id}><strong>{m.name}</strong><code>{m.id}</code></div>)}</div></details>)}</div></>}
 {tab==='people'&&<><div className="section-heading"><h2>Workspace members</h2>{admin&&<button className="primary" onClick={()=>invite()}><Plus size={15}/>Invite someone</button>}</div><section className="panel">{access?.users.map((u:Item)=><div className="list-row" key={u.id}><span className="avatar">{u.name[0]}</span><div className="row-main"><strong>{u.name}{u.id===me.id?' (you)':''}</strong><small>{u.disabled?'Disabled':u.projects?.map((id:string)=>state.projects.find((p:Item)=>p.id===id)?.name).filter(Boolean).join(', ')||'Workspace access'}</small></div><span className="pill">{label(u.role)}</span>{admin&&<button className="icon-button" title="Manage access" onClick={()=>modal(<Modal title={`Manage ${u.name}`} onClose={close}><Form fields={[{key:'role',label:'Role',value:u.role,options:['viewer','operator','admin',...(me.role==='owner'?['owner']:[])].map(value=>({value,label:label(value)}))},{key:'projects',label:'Project IDs (comma separated)',value:u.projects?.join(', ')||'',optional:true,help:state.projects.map((p:Item)=>`${p.name}: ${p.id}`).join(' · ')},{key:'disabled',label:'Disable account',type:'checkbox',value:u.disabled||false}]} onSubmit={async b=>{await api(`/users/${u.id}`,'PATCH',{...b,projects:b.projects.split(',').map((s:string)=>s.trim()).filter(Boolean)});A(await api('/access'));close()}}/></Modal>)}><Settings2 size={17}/></button>}</div>)}</section>{admin&&!!access?.invites.length&&<><h3>Pending invitations</h3>{access.invites.map((i:Item)=><div className="list-row" key={i.id}><div className="row-main">{label(i.role)} invitation<small>Expires {new Date(i.expires).toLocaleString()}</small></div><button className="secondary" onClick={()=>run(async()=>{await api(`/invites/${i.id}`,'DELETE');A(await api('/access'))})}>Revoke</button></div>)}</>}</>}
 {tab==='maintenance'&&<Maintenance state={state} refresh={refresh} run={run} notify={notify} triggerReload={triggerReload} reloading={reloading}/>}
 {tab==='devices'&&<><div className="section-heading"><h2>Trusted devices</h2><button className="primary" onClick={()=>invite(true)}><Plus size={15}/>Add a device</button></div><section className="panel">{access?.devices.map((d:Item)=><div className="list-row" key={d.id}><span className="row-icon"><Shield size={20}/></span><div className="row-main"><strong>{d.name}</strong><small>Added {new Date(d.created).toLocaleString()}</small></div><button className="secondary" onClick={()=>run(async()=>{await api(`/devices/${d.id}`,'DELETE');A(await api('/access'))})}>Revoke</button></div>)}</section><p className="muted">Device access is stored in your browser. Clearing local storage requires a new invitation.</p></>}
 </>}
function ProviderLogin({connection,provider,close,onDone,isNew=false}:any){const [state,S]=useState<Item>({status:'idle'}),[busy,B]=useState(false),[error,E]=useState('');useEffect(()=>{const t=setInterval(()=>api(`/connections/${connection.id}/login`).then(s=>{S(s);if(s.status==='connected')void onDone()}).catch(()=>{}),1000);return()=>clearInterval(t)},[]);const methods=provider?.methods||[];const isAmbient=methods.length===0;const dismiss=async()=>{if(busy)return;B(true);E('');try{await api(`/connections/${connection.id}/cancel-login`,'POST',{discard:isNew});await onDone();close()}catch(e){E((e as Error).message)}finally{B(false)}};return <Modal title={`Connect ${provider?.name||connection.provider}`} onClose={()=>void dismiss()}><p className="muted">Complete the provider's authentication flow. Orchestra keeps the resulting credential encrypted.</p>{(state.status==='idle'||state.status==='error')&&<div className="auth-methods">{isAmbient?<button className="primary" disabled={busy} onClick={async()=>{B(true);E('');try{await api(`/connections/${connection.id}/login`,'POST',{method:'ambient'});await onDone();close()}catch(e){E((e as Error).message)}finally{B(false)}}}>Connect with host CLI / ambient credentials</button>:methods.map((method:string)=><button className="primary" disabled={busy} key={method} onClick={async()=>{B(true);E('');try{await api(`/connections/${connection.id}/login`,'POST',{method});S({status:'pending'})}catch(e){E((e as Error).message)}finally{B(false)}}}>{method==='oauth'?<ExternalLink size={16}/>:<KeyRound size={16}/>} {method==='oauth'?'Sign in with provider':'Use API key'}</button>)}</div>}{state.events?.map((e:any,i:number)=><AuthEvent key={i} event={e}/>)}{state.prompt&&<Form key={JSON.stringify(state.prompt)} fields={[{key:'answer',label:state.prompt.message||state.prompt.label||'Provider response',type:state.prompt.type==='secret'?'password':'text',options:state.prompt.options?.map((o:any)=>({value:o.id||o.value,label:o.label||o.name||o.id}))}]} submit="Continue" onSubmit={async b=>{await api(`/connections/${connection.id}/answer`,'POST',b);S({...state,prompt:null})}}/>}{state.status==='pending'&&!state.prompt&&<p className="waiting"><Loader2 size={16} className="spin"/>Waiting for provider…</p>}{state.status==='connected'&&<div className="success"><CheckCircle2 size={22}/><h3>You're connected.</h3><p>Choose this connection and a model in your repository settings.</p><button className="primary" onClick={close}>Done<Check size={15}/></button></div>}{(state.error||error)&&<div className="error">{error||state.error}</div>}{state.status!=='connected'&&<button className="secondary" disabled={busy} onClick={()=>void dismiss()}>Cancel setup</button>}</Modal>}
function AuthEvent({event:e}:{event:Item}){const url=e.url||e.verificationUri||e.verificationUrl;return <div className="auth-event">{e.message&&<p>{e.message}</p>}{e.instructions&&<p>{e.instructions}</p>}{e.userCode&&<code>{e.userCode}</code>}{url&&/^https?:\/\//.test(url)&&<a className="secondary" href={url} target="_blank" rel="noreferrer">Open provider authorization<ExternalLink size={15}/></a>}</div>}
function Maintenance({state,refresh,run,notify,triggerReload,reloading}:any){const [data,D]=useState<any>({deployments:[]}),[change,C]=useState('');useEffect(()=>{const load=()=>api('/self').then(D).catch(()=>{});void load();const t=setInterval(load,3000);return()=>clearInterval(t)},[]);return <><div className="section-heading"><h2>Improve Orchestra with Orchestra</h2><div className="button-group"><button className="secondary" onClick={triggerReload} disabled={reloading}><RotateCw size={14} className={reloading?'spin':''}/>{reloading?'Restarting…':'Restart & reload service'}</button>{!data.repo&&<button className="primary" onClick={()=>run(async()=>{await api('/self/register','POST',{});await refresh();D(await api('/self'))})}>Register app repository</button>}</div></div><p className="muted">Agents propose code changes through normal change requests. Build and verify a merged change, then activate it when you're ready. Only administrators can deploy updates.</p>{data.repo&&<div className="panel padded"><label className="field"><span>Merged app change request</span><select value={change} onChange={e=>C(e.target.value)}><option value="">Choose a merged change</option>{state.changes.filter((c:Item)=>c.repoId===data.repo.id&&c.status==='merged').map((c:Item)=><option value={c.id} key={c.id}>{c.title}</option>)}</select></label><div className="form-footer"><button className="primary" disabled={!change} onClick={()=>run(async()=>{await api('/self/build','POST',{changeId:change});notify('Release build started in Docker.')})}>Build release</button></div></div>}<div className="section-heading"><h2>Releases</h2>{data.deployments.some((d:Item)=>d.status==='active')&&<button className="secondary" onClick={()=>run(async()=>{await api('/self/rollback','POST',{});notify('Restoring the previous version. Reconnect in a few seconds.')})}>Roll back</button>}</div>{data.deployments.map((d:Item)=><details className="panel check-result" key={d.id}><summary><Status value={d.status}/><code>{d.sha?.slice(0,8)}</code><span>{ago(d.created)}</span></summary><div className="padded">{d.error&&<p className="error">{d.error}</p>}{d.status==='ready'&&<button className="primary" onClick={()=>run(async()=>{await api('/self/activate','POST',{id:d.id});notify('Activating release. Reconnect in a few seconds.')})}>Activate and restart</button>}<pre className="terminal">{d.log||'Waiting for build output…'}</pre></div></details>)}</>}
createRoot(document.getElementById('root')!).render(<App/>);
