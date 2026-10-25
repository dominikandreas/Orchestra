import React,{useState,useEffect} from 'react';
import {
 Plus,Sparkles,GitPullRequest,GitBranch,GitFork,FolderGit2,Bot,Zap,Rocket,
 Settings2,Search,ArrowRight,ExternalLink,Terminal,RotateCw,Square,Play,
 Trash2,KeyRound,Shield,Check,CheckCircle2,Copy,FileCode2,Archive,Pencil,
 SlidersHorizontal,Clock,Layers,AlertCircle
} from 'lucide-react';
import {
 api,ago,short,label,cx,autonomyModes,autonomyLabel,jobKinds,kindLabel,
 triggers,triggerLabel,thinkingLevels,thinkingLabel,modelsFor,
 activeStatuses,attentionStatuses,lifetimeOptions,formatLifetime,type Item
} from './lib';
import {
 Status,Dot,Empty,PageHeader,Modal,Field,ErrorNote,Segmented,Switch,
 Tabs,Confirm,useWorkspace,useSubmit
} from './ui';
import {NewSessionComposer} from './composer';
import {ExternalDeployments} from './external-deployments';

/* ============================================================================
 * Modals
 * ========================================================================== */

export function NewSessionModal({
 defaultRepoId,
 defaultChangeId,
 defaultKind='implement',
 defaultAgentId='',
 onClose
}:{
 defaultRepoId?:string,
 defaultChangeId?:string,
 defaultKind?:string,
 defaultAgentId?:string,
 onClose:()=>void
}){
 const {go,refresh}=useWorkspace();
 return (
  <Modal title="New session" size="lg" onClose={onClose}>
   <NewSessionComposer
    defaultRepoId={defaultRepoId}
    defaultChangeId={defaultChangeId}
    defaultKind={defaultKind}
    defaultAgentId={defaultAgentId}
    autoFocus
    onCancel={onClose}
    onCreated={async jobId=>{
     await refresh();
     onClose();
     go('sessions',jobId);
    }}
   />
  </Modal>
 );
}

export function AgentModal({agent,onClose}:{agent?:Item,onClose:()=>void}){
 const {state,catalog,project,refresh,notify,isAdmin}=useWorkspace();
 const [name,setName]=useState(agent?.name||'');
 const [description,setDescription]=useState(agent?.description||'');
 const [instructions,setInstructions]=useState(agent?.instructions||'');
 const [projectId,setProjectId]=useState(agent?agent.projectId||'':(project!=='all'?project:(isAdmin?'':state.projects[0]?.id||'')));
 const [kind,setKind]=useState(agent?.kind||'implement');
 const [connectionId,setConnectionId]=useState(agent?.connectionId||'');
 const [model,setModel]=useState(agent?.model||'');
 const [thinkingLevel,setThinkingLevel]=useState(agent?.thinkingLevel||'off');
 const [autonomy,setAutonomy]=useState(agent?.autonomy||'prepare');
 const {busy,error,submit}=useSubmit();

 const connected=state.connections.filter((c:Item)=>c.status==='connected');
 const selectedConn=state.connections.find((c:Item)=>c.id===connectionId);
 const modelOptions=modelsFor(selectedConn,catalog);

 return (
  <Modal
   title={agent?`Edit agent: ${agent.name}`:'New agent definition'}
   size="lg"
   onClose={onClose}
   footer={
    <>
     <button type="button" className="btn" onClick={onClose} disabled={busy}>Cancel</button>
     <button
      type="button"
      className="btn btn-primary"
      disabled={busy||!name.trim()||!instructions.trim()}
      onClick={()=>void submit(async()=>{
       const payload:Item={
        name:name.trim(),
        description:description.trim(),
        instructions:instructions.trim(),
        projectId:projectId||undefined,
        kind,
        connectionId:connectionId||undefined,
        model:model||undefined,
        thinkingLevel,
        autonomy
       };
       if(agent){
        await api(`/agents/${agent.id}`,'PATCH',payload);
        notify(`Updated agent "${name.trim()}"`);
       }else{
        await api('/agents','POST',payload);
        notify(`Created agent "${name.trim()}"`);
       }
       await refresh();
       onClose();
      })}
     >
      {busy&&<RotateCw size={13} className="spin"/>}
      <span>{agent?'Save changes':'Create agent'}</span>
     </button>
    </>
   }
  >
   <ErrorNote>{error}</ErrorNote>
   <div className="form-grid-2">
    <Field label="Agent name">
     <input required value={name} onChange={e=>setName(e.target.value)} placeholder="e.g. Principal Reviewer, Security Auditor, UI Architect"/>
    </Field>
    <Field label="Scope">
     <select value={projectId} onChange={e=>setProjectId(e.target.value)}>
      {isAdmin&&<option value="">All projects (workspace-wide)</option>}
      {state.projects.map((p:Item)=><option key={p.id} value={p.id}>{p.name}</option>)}
     </select>
    </Field>
   </div>
   <Field label="Short description">
    <input value={description} onChange={e=>setDescription(e.target.value)} placeholder="Specialization and role in the workflow…"/>
   </Field>
   <Field label="System instructions" hint="Appended to the agent's system prompt whenever this agent is selected for a session or workflow.">
    <textarea rows={5} required value={instructions} onChange={e=>setInstructions(e.target.value)} placeholder="Specify coding standards, verification steps, architectural constraints, or subagent delegation rules…"/>
   </Field>
   <div className="form-grid-2">
    <Field label="Default mode">
     <select value={kind} onChange={e=>setKind(e.target.value)}>
      {jobKinds.map(k=><option key={k.value} value={k.value}>{k.label}</option>)}
     </select>
    </Field>
    <Field label="Default autonomy">
     <select value={autonomy} onChange={e=>setAutonomy(e.target.value)}>
      {autonomyModes.map(m=><option key={m.value} value={m.value}>{m.label} — {m.description}</option>)}
     </select>
    </Field>
   </div>
   <div className="form-grid-3">
    <Field label="Default connection">
     <select
      value={connectionId}
      onChange={e=>{
       const next=e.target.value;
       setConnectionId(next);
       const conn=state.connections.find((c:Item)=>c.id===next);
       const opts=modelsFor(conn,catalog);
       setModel(opts[0]?.id||'');
      }}
     >
      <option value="">Use repository default</option>
      {connected.map((c:Item)=><option key={c.id} value={c.id}>{c.name}</option>)}
     </select>
    </Field>
    <Field label="Default model">
     <select value={model} onChange={e=>setModel(e.target.value)}>
      <option value="">Use repository default</option>
      {modelOptions.map((m:Item)=><option key={m.id} value={m.id}>{m.name||m.id}</option>)}
     </select>
    </Field>
    <Field label="Thinking effort">
     <select value={thinkingLevel} onChange={e=>setThinkingLevel(e.target.value)}>
      {thinkingLevels.map(v=><option key={v} value={v}>{thinkingLabel[v]} ({v})</option>)}
     </select>
    </Field>
   </div>
  </Modal>
 );
}

export function WorkflowModal({workflow,onClose}:{workflow?:Item,onClose:()=>void}){
 const {state,project,refresh,notify}=useWorkspace();
 const readyRepos=state.repos.filter((r:Item)=>r.status==='ready'&&(project==='all'||r.projectId===project));
 const allReady=readyRepos.length?readyRepos:state.repos.filter((r:Item)=>r.status==='ready');
 const [name,setName]=useState(workflow?.name||'');
 const [repoId,setRepoId]=useState(workflow?.repoId||allReady[0]?.id||'');
 const repo=state.repos.find((r:Item)=>r.id===repoId);
 const visibleAgents=(state.agents||[]).filter((a:Item)=>!a.projectId||a.projectId===repo?.projectId);
 const [agentId,setAgentId]=useState(workflow?.agentId||'');
 const [trigger,setTrigger]=useState(workflow?.trigger||'change_created');
 const [kind,setKind]=useState(workflow?.kind||'review');
 const [prompt,setPrompt]=useState(workflow?.prompt||'');
 const [intervalMinutes,setIntervalMinutes]=useState(workflow?.intervalMinutes||60);
 const [thinkingLevel,setThinkingLevel]=useState(workflow?.thinkingLevel||'off');
 const [autonomy,setAutonomy]=useState(workflow?.autonomy||'prepare');
 const [enabled,setEnabled]=useState(workflow?.enabled??true);
 const {busy,error,submit}=useSubmit();

 return (
  <Modal
   title={workflow?`Configure automation: ${workflow.name}`:'New automation'}
   size="lg"
   onClose={onClose}
   footer={
    <>
     <button type="button" className="btn" onClick={onClose} disabled={busy}>Cancel</button>
     <button
      type="button"
      className="btn btn-primary"
      disabled={busy||!name.trim()||!prompt.trim()||!repoId}
      onClick={()=>void submit(async()=>{
       if(workflow){
        await api(`/workflows/${workflow.id}`,'PATCH',{
         name:name.trim(),
         agentId:agentId||undefined,
         kind,
         prompt:prompt.trim(),
         intervalMinutes:Number(intervalMinutes)||60,
         thinkingLevel,
         autonomy,
         enabled
        });
        notify(`Updated "${name.trim()}"`);
       }else{
        await api('/workflows','POST',{
         name:name.trim(),
         repoId,
         agentId:agentId||undefined,
         trigger,
         kind,
         prompt:prompt.trim(),
         intervalMinutes:Number(intervalMinutes)||60,
         thinkingLevel,
         autonomy
        });
        notify(`Created automation "${name.trim()}"`);
       }
       await refresh();
       onClose();
      })}
     >
      {busy&&<RotateCw size={13} className="spin"/>}
      <span>{workflow?'Save':'Create automation'}</span>
     </button>
    </>
   }
  >
   <ErrorNote>{error}</ErrorNote>
   <div className="form-grid-2">
    <Field label="Name">
     <input required value={name} onChange={e=>setName(e.target.value)} placeholder="e.g. Review every new CR"/>
    </Field>
    <Field label="Repository">
     <select value={repoId} disabled={Boolean(workflow)} onChange={e=>setRepoId(e.target.value)}>
      {allReady.map((r:Item)=><option key={r.id} value={r.id}>{r.name}</option>)}
     </select>
    </Field>
   </div>
   <div className="form-grid-3">
    <Field label="Trigger">
     <select value={trigger} disabled={Boolean(workflow)} onChange={e=>setTrigger(e.target.value)}>
      {triggers.map(t=><option key={t.value} value={t.value}>{t.label}</option>)}
     </select>
    </Field>
    <Field label="Agent definition">
     <select value={agentId} onChange={e=>setAgentId(e.target.value)}>
      <option value="">Default agent</option>
      {visibleAgents.map((a:Item)=><option key={a.id} value={a.id}>{a.name}</option>)}
     </select>
    </Field>
    <Field label="Mode">
     <select value={kind} onChange={e=>setKind(e.target.value)}>
      {jobKinds.map(k=><option key={k.value} value={k.value}>{k.label}</option>)}
     </select>
    </Field>
   </div>
   {trigger==='schedule'&&(
    <Field label="Interval (minutes)" hint="Minimum 5 minutes.">
     <input type="number" min={5} value={intervalMinutes} onChange={e=>setIntervalMinutes(Number(e.target.value))}/>
    </Field>
   )}
   <Field label="Instructions">
    <textarea rows={4} required value={prompt} onChange={e=>setPrompt(e.target.value)} placeholder="Instructions executed when this trigger fires…"/>
   </Field>
   <div className="form-grid-2">
    <Field label="Thinking effort">
     <select value={thinkingLevel} onChange={e=>setThinkingLevel(e.target.value)}>
      {thinkingLevels.map(v=><option key={v} value={v}>{thinkingLabel[v]} ({v})</option>)}
     </select>
    </Field>
    <Field label="Autonomy">
     <select value={autonomy} onChange={e=>setAutonomy(e.target.value)}>
      {autonomyModes.map(m=><option key={m.value} value={m.value}>{m.label}</option>)}
     </select>
    </Field>
   </div>
  </Modal>
 );
}

export function NewDeploymentModal({defaultRepoId,defaultBranch,onClose}:{defaultRepoId?:string,defaultBranch?:string,onClose:()=>void}){
 const {state,project,refresh,notify}=useWorkspace();
 const readyRepos=state.repos.filter((r:Item)=>r.status==='ready'&&(project==='all'||r.projectId===project));
 const allReady=readyRepos.length?readyRepos:state.repos.filter((r:Item)=>r.status==='ready');
 const [repoId,setRepoId]=useState(defaultRepoId||allReady[0]?.id||'');
 const repo=state.repos.find((r:Item)=>r.id===repoId);
 const [branches,setBranches]=useState<string[]>([]);
 const [branch,setBranch]=useState(defaultBranch||repo?.base||'main');
 const [customName,setCustomName]=useState('');
 const [lifetimeMinutes,setLifetimeMinutes]=useState<number>(30);
 const [loadingBranches,setLoadingBranches]=useState(false);
 const {busy,error,submit}=useSubmit();

 useEffect(()=>{
  if(!repoId)return;
  setLoadingBranches(true);
  api(`/repos/${repoId}/inspect`).then(insp=>{
   const bList=insp?.branches||[];
   setBranches(bList);
   const r=state.repos.find((x:Item)=>x.id===repoId);
   if(!defaultBranch||repoId!==defaultRepoId){
    setBranch(r?.base||bList[0]||'main');
   }
  }).catch(()=>{
   const r=state.repos.find((x:Item)=>x.id===repoId);
   setBranch(r?.base||'main');
  }).finally(()=>setLoadingBranches(false));
 },[repoId]);

 return (
  <Modal
   title="New deployment"
   onClose={onClose}
   footer={
    <>
     <button type="button" className="btn" onClick={onClose} disabled={busy}>Cancel</button>
     <button
      type="button"
      className="btn btn-primary"
      disabled={busy||!repoId}
      onClick={()=>void submit(async()=>{
       await api('/deployments','POST',{
        repoId,
        branch:branch.trim()||undefined,
        customName:customName.trim()||undefined,
        lifetimeMinutes
       });
       await refresh();
       notify('Deployment starting');
       onClose();
      })}
     >
      {busy?<RotateCw size={13} className="spin"/>:<Rocket size={13}/>}
      <span>Start deployment</span>
     </button>
    </>
   }
  >
   <ErrorNote>{error}</ErrorNote>
   <Field label="Repository">
    <select value={repoId} onChange={e=>setRepoId(e.target.value)}>
     {allReady.map((r:Item)=><option key={r.id} value={r.id}>{r.name}</option>)}
    </select>
   </Field>
   <Field label="Custom label (optional)" hint="Give this deployment a recognizable name.">
    <input
     value={customName}
     onChange={e=>setCustomName(e.target.value)}
     placeholder={repo?.name?`e.g. ${repo.name}-staging`:'e.g. staging'}
    />
   </Field>
   <Field label="Branch" hint="Automatically redeploys when this branch receives new commits.">
    {loadingBranches?(
     <div className="muted-meta">Loading branches…</div>
    ):branches.length>0?(
     <select value={branch} onChange={e=>setBranch(e.target.value)}>
      {branches.map(b=><option key={b} value={b}>{b}{b===repo?.base?' (default)':''}</option>)}
     </select>
    ):(
     <input value={branch} onChange={e=>setBranch(e.target.value)} placeholder="main" required/>
    )}
   </Field>
   <Field label="Lifetime / auto-stop" hint="Container is automatically stopped when idle. Choose infinite to keep it running.">
    <select value={lifetimeMinutes} onChange={e=>setLifetimeMinutes(Number(e.target.value))}>
     {lifetimeOptions.map(opt=><option key={opt.value} value={opt.value}>{opt.label}</option>)}
    </select>
   </Field>
  </Modal>
 );
}

export function ConfigureDeploymentModal({deployment,onClose}:{deployment:Item,onClose:()=>void}){
 const {state,refresh,notify}=useWorkspace();
 const repo=state.repos.find((r:Item)=>r.id===deployment.repoId);
 const [customName,setCustomName]=useState(deployment.customName||'');
 const [branch,setBranch]=useState(deployment.branch||repo?.base||'main');
 const [lifetimeMinutes,setLifetimeMinutes]=useState<number>(deployment.lifetimeMinutes??30);
 const [branches,setBranches]=useState<string[]>([]);
 const [loadingBranches,setLoadingBranches]=useState(false);
 const {busy,error,submit}=useSubmit();

 useEffect(()=>{
  if(!deployment.repoId)return;
  setLoadingBranches(true);
  api(`/repos/${deployment.repoId}/inspect`).then(insp=>{
   setBranches(insp?.branches||[]);
  }).catch(()=>{}).finally(()=>setLoadingBranches(false));
 },[deployment.repoId]);

 return (
  <Modal
   title="Configure deployment"
   onClose={onClose}
   footer={
    <>
     <button type="button" className="btn" onClick={onClose} disabled={busy}>Cancel</button>
     <button
      type="button"
      className="btn btn-primary"
      disabled={busy}
      onClick={()=>void submit(async()=>{
       await api(`/deployments/${deployment.id}`,'PATCH',{
        customName:customName.trim()||null,
        branch:branch.trim()||undefined,
        lifetimeMinutes
       });
       await refresh();
       notify('Deployment updated');
       onClose();
      })}
     >
      {busy?<RotateCw size={13} className="spin"/>:<Check size={13}/>}
      <span>Save changes</span>
     </button>
    </>
   }
  >
   <ErrorNote>{error}</ErrorNote>
   <div className="card padded stack-xs" style={{marginBottom:'1rem'}}>
    <div className="section-bar">
     <strong>{repo?.name||'Deployment'}</strong>
     <Status value={deployment.status}/>
    </div>
    <div className="muted-meta">
     {deployment.port?`Port :${deployment.port} · `:''}
     {deployment.sha?`Commit ${short(deployment.sha)} · `:''}
     Started {ago(deployment.created)}
    </div>
   </div>
   <Field label="Custom label" hint="Optional friendly name for this deployment.">
    <input
     value={customName}
     onChange={e=>setCustomName(e.target.value)}
     placeholder={repo?.name||'Deployment name'}
    />
   </Field>
   <Field label="Tracked branch" hint="Switching branch updates the git worktree and restarts the container.">
    {loadingBranches?(
     <div className="muted-meta">Loading branches…</div>
    ):branches.length>0?(
     <select value={branch} onChange={e=>setBranch(e.target.value)}>
      {branches.map(b=><option key={b} value={b}>{b}{b===repo?.base?' (default)':''}</option>)}
     </select>
    ):(
     <input value={branch} onChange={e=>setBranch(e.target.value)} placeholder="main" required/>
    )}
   </Field>
   <Field label="Lifetime / auto-stop" hint="Container is automatically stopped when idle. Choose infinite to keep it running.">
    <select value={lifetimeMinutes} onChange={e=>setLifetimeMinutes(Number(e.target.value))}>
     {lifetimeOptions.map(opt=><option key={opt.value} value={opt.value}>{opt.label}</option>)}
    </select>
   </Field>
  </Modal>
 );
}

export function NewRepoModal({defaultProjectId,onNewProject,onDone,onClose}:{defaultProjectId?:string,onNewProject:()=>void,onDone:(repo:Item)=>Promise<void>,onClose:()=>void}){
 const {state}=useWorkspace();
 const [tab,setTab]=useState<'create'|'connect'>('create');
 const [projectId,setProjectId]=useState(defaultProjectId||state.projects[0]?.id||'');
 const [name,setName]=useState('');
 const [source,setSource]=useState('');
 const [customSource,setCustomSource]=useState(false);
 const [base,setBase]=useState('main');
 const {busy,error,submit}=useSubmit();

 const onNameChange=(val:string)=>{
  setName(val);
  if(!customSource&&tab==='create'){
   const slug=val.trim().toLowerCase().replace(/[^a-z0-9._-]/g,'-');
   setSource(slug?`~/dev/${slug}`:'');
  }
 };

 return (
  <Modal
   title={tab==='create'?'Create repository':'Connect repository'}
   onClose={onClose}
   footer={
    <>
     <button type="button" className="btn" onClick={onClose} disabled={busy}>Cancel</button>
     <button
      type="button"
      className="btn btn-primary"
      disabled={busy||!projectId||!name.trim()||!source.trim()}
      onClick={()=>void submit(async()=>{
       const r=await api('/repos','POST',{
        projectId,
        name:name.trim(),
        source:source.trim(),
        base:base.trim()||'main',
        createLocal:tab==='create'
       });
       await onDone(r);
      })}
     >
      {busy&&<RotateCw size={13} className="spin"/>}
      <span>{tab==='create'?'Create repository':'Import repository'}</span>
     </button>
    </>
   }
  >
   <div style={{marginBottom:12}}>
    <Segmented
     value={tab}
     onChange={next=>{
      setTab(next);
      if(next==='create'&&!customSource){
       const slug=name.trim().toLowerCase().replace(/[^a-z0-9._-]/g,'-');
       setSource(slug?`~/dev/${slug}`:'');
      }else if(next==='connect'&&source.startsWith('~/dev/')){
       setSource('');
       setCustomSource(false);
      }
     }}
     options={[
      {value:'create',label:'Create new local repository'},
      {value:'connect',label:'Connect existing path or URL'}
     ]}
    />
   </div>
   <ErrorNote>{error}</ErrorNote>
   <Field label="Project">
    <div style={{display:'flex',gap:8}}>
     <select style={{flex:1}} value={projectId} onChange={e=>setProjectId(e.target.value)} required>
      {state.projects.map((p:Item)=><option key={p.id} value={p.id}>{p.name}</option>)}
     </select>
     <button type="button" className="btn btn-sm" onClick={onNewProject}><Plus size={13}/><span>New project</span></button>
    </div>
   </Field>
   <Field label="Repository name">
    <input required value={name} onChange={e=>onNameChange(e.target.value)} placeholder="my-service"/>
   </Field>
   <Field label={tab==='create'?'Local directory':'Local path or Git URL'}>
    <input
     required
     value={source}
     onChange={e=>{setSource(e.target.value);setCustomSource(true);}}
     placeholder={tab==='create'?'~/dev/my-service':'/path/to/repo or https://...'}
    />
   </Field>
   <Field label="Default branch">
    <input value={base} onChange={e=>setBase(e.target.value)} placeholder="main"/>
   </Field>
  </Modal>
 );
}

export function ConfigureRepoModal({repo,onboarding=false,onClose}:{repo:Item,onboarding?:boolean,onClose:()=>void}){
 const {state,catalog,refresh,notify,isAdmin}=useWorkspace();
 const [branches,setBranches]=useState<string[]>([repo.base||'main']);
 const [base,setBase]=useState(repo.base||'main');
 const [connectionId,setConnectionId]=useState(repo.connectionId||'');
 const [model,setModel]=useState(repo.model||'');
 const [thinkingLevel,setThinkingLevel]=useState(repo.thinkingLevel||'off');
 const [autonomy,setAutonomy]=useState(repo.autonomy||'prepare');
 const [testCommand,setTestCommand]=useState(repo.testCommand||'');
 const [previewCommand,setPreviewCommand]=useState(repo.previewCommand||'');
 const [port,setPort]=useState(repo.port||5173);
 const [image,setImage]=useState(repo.image||'node:24-bookworm');
 const [requireReview,setRequireReview]=useState(repo.requireReview??true);
 const {busy,error,submit}=useSubmit();

 useEffect(()=>{
  api(`/repos/${repo.id}/inspect`).then(insp=>{
   if(Array.isArray(insp?.branches)&&insp.branches.length)setBranches(insp.branches);
   if(!repo.testCommand&&insp?.suggestions?.testCommand)setTestCommand(insp.suggestions.testCommand);
   if(!repo.previewCommand&&insp?.suggestions?.previewCommand)setPreviewCommand(insp.suggestions.previewCommand);
  }).catch(()=>{});
 },[repo.id]);

 const connected=state.connections.filter((c:Item)=>c.status==='connected');
 const selectedConn=state.connections.find((c:Item)=>c.id===connectionId);
 const modelOptions=modelsFor(selectedConn,catalog);

 return (
  <Modal
   title={onboarding?`Configure ${repo.name}`:`Repository settings: ${repo.name}`}
   size="lg"
   onClose={onClose}
   footer={
    <>
     {!onboarding&&isAdmin&&!repo.self&&(
      <button
       type="button"
       className="btn btn-danger"
       style={{marginRight:'auto'}}
       onClick={async()=>{
        if(!confirm(`Remove "${repo.name}" from Orchestra? Your source checkout on disk will not be modified.`))return;
        try{
         await api(`/repos/${repo.id}`,'DELETE');
         await refresh();
         notify(`Removed ${repo.name}`);
         onClose();
        }catch(e){
         notify((e as Error).message,'bad');
        }
       }}
      >
       <Trash2 size={13}/><span>Remove</span>
      </button>
     )}
     <button type="button" className="btn" onClick={onClose} disabled={busy}>Cancel</button>
     <button
      type="button"
      className="btn btn-primary"
      disabled={busy}
      onClick={()=>void submit(async()=>{
       await api(`/repos/${repo.id}`,'PATCH',{
        base,
        connectionId,
        model,
        thinkingLevel,
        autonomy,
        testCommand,
        previewCommand,
        port:Number(port)||5173,
        image,
        requireReview
       });
       await refresh();
       notify(`${repo.name} saved`);
       onClose();
      })}
     >
      {busy&&<RotateCw size={13} className="spin"/>}
      <span>Save settings</span>
     </button>
    </>
   }
  >
   <ErrorNote>{error}</ErrorNote>
   <div className="form-grid-2">
    <Field label="Default branch">
     <select value={base} onChange={e=>setBase(e.target.value)}>
      {branches.map(b=><option key={b} value={b}>{b}</option>)}
     </select>
    </Field>
    <Field label="Maximum autonomy">
     <select value={autonomy} onChange={e=>setAutonomy(e.target.value)}>
      {autonomyModes.map(m=><option key={m.value} value={m.value}>{m.label} — {m.description}</option>)}
     </select>
    </Field>
   </div>
   <div className="form-grid-3">
    <Field label="Default connection">
     <select
      value={connectionId}
      onChange={e=>{
       const next=e.target.value;
       setConnectionId(next);
       const conn=state.connections.find((c:Item)=>c.id===next);
       const opts=modelsFor(conn,catalog);
       setModel(opts[0]?.id||'');
      }}
     >
      <option value="">None</option>
      {connected.map((c:Item)=><option key={c.id} value={c.id}>{c.name}</option>)}
     </select>
    </Field>
    <Field label="Default model">
     <select value={model} onChange={e=>setModel(e.target.value)}>
      <option value="">Choose model</option>
      {modelOptions.map((m:Item)=><option key={m.id} value={m.id}>{m.name||m.id}</option>)}
     </select>
    </Field>
    <Field label="Default thinking effort">
     <select value={thinkingLevel} onChange={e=>setThinkingLevel(e.target.value)}>
      {thinkingLevels.map(v=><option key={v} value={v}>{thinkingLabel[v]} ({v})</option>)}
     </select>
    </Field>
   </div>
   <div className="form-grid-2">
    <Field label="Test command">
     <input value={testCommand} onChange={e=>setTestCommand(e.target.value)} placeholder="npm ci && npm test"/>
    </Field>
    <Field label="Deployment command">
     <input value={previewCommand} onChange={e=>setPreviewCommand(e.target.value)} placeholder="npm ci && npm run dev -- --host 0.0.0.0"/>
    </Field>
   </div>
   <div className="form-grid-2">
    <Field label="Container image">
     <input value={image} onChange={e=>setImage(e.target.value)} placeholder="node:24-bookworm"/>
    </Field>
    <Field label="Container port">
     <input type="number" value={port} onChange={e=>setPort(Number(e.target.value))}/>
    </Field>
   </div>
   <Field label="Require approved review before merge" inline>
    <Switch checked={requireReview} onChange={setRequireReview}/>
   </Field>
  </Modal>
 );
}

export function ProjectModal({project:existing,onClose}:{project?:Item,onClose:()=>void}){
 const {state,setProject,refresh,notify,go}=useWorkspace();
 const [name,setName]=useState(existing?.name||'');
 const [description,setDescription]=useState(existing?.description||'');
 const {busy,error,submit}=useSubmit();
 const projectRepos=existing?state.repos.filter((r:Item)=>r.projectId===existing.id):[];

 return (
  <Modal
   title={existing?`Project settings: ${existing.name}`:'New project'}
   onClose={onClose}
   footer={
    <>
     {existing&&(
      <button
       type="button"
       className="btn btn-danger"
       style={{marginRight:'auto'}}
       disabled={busy||projectRepos.length>0}
       title={projectRepos.length>0?'Remove repositories in this project first':'Delete project'}
       onClick={async()=>{
        if(!confirm(`Delete project "${existing.name}"?`))return;
        try{
         await api(`/projects/${existing.id}`,'DELETE');
         setProject('all');
         await refresh();
         notify(`Deleted project "${existing.name}"`);
         onClose();
        }catch(e){
         notify((e as Error).message,'bad');
        }
       }}
      >
       <Trash2 size={13}/><span>Delete</span>
      </button>
     )}
     <button type="button" className="btn" onClick={onClose} disabled={busy}>Cancel</button>
     <button
      type="button"
      className="btn btn-primary"
      disabled={busy||!name.trim()}
      onClick={()=>void submit(async()=>{
       if(existing){
        await api(`/projects/${existing.id}`,'PATCH',{name:name.trim(),description:description.trim()});
        await refresh();
        notify('Project updated');
        onClose();
       }else{
        const created=await api('/projects','POST',{name:name.trim(),description:description.trim()});
        await refresh();
        setProject(created.id);
        notify(`Created project "${created.name}"`);
        onClose();
        go('repositories');
       }
      })}
     >
      {busy&&<RotateCw size={13} className="spin"/>}
      <span>{existing?'Save':'Create project'}</span>
     </button>
    </>
   }
  >
   <ErrorNote>{error}</ErrorNote>
   <Field label="Project name">
    <input required value={name} onChange={e=>setName(e.target.value)} placeholder="Core Platform"/>
   </Field>
   <Field label="Description">
    <textarea rows={3} value={description} onChange={e=>setDescription(e.target.value)} placeholder="Optional project summary…"/>
   </Field>
   {existing&&projectRepos.length>0&&(
    <small className="field-hint">Contains {projectRepos.length} {projectRepos.length===1?'repository':'repositories'}. Remove them before deleting this project.</small>
   )}
  </Modal>
 );
}

/* ============================================================================
 * Command & Full-Text Search Palette (⌘K)
 * ========================================================================== */

export function SearchCommandModal({
 onClose,
 onNewSession,
 onNewAgent,
 onNewWorkflow,
 onNewDeployment,
 onNewRepo
}:{
 onClose:()=>void,
 onNewSession:()=>void,
 onNewAgent:()=>void,
 onNewWorkflow:()=>void,
 onNewDeployment:()=>void,
 onNewRepo:()=>void
}){
 const {state,go,theme,setTheme,canEdit}=useWorkspace();
 const [q,setQ]=useState('');
 const [results,setResults]=useState<{sessions:Item[],changes:Item[]}|null>(null);
 const [loading,setLoading]=useState(false);

 useEffect(()=>{
  const trimmed=q.trim();
  if(trimmed.length<2){
   setResults(null);
   setLoading(false);
   return;
  }
  setLoading(true);
  const timer=setTimeout(()=>{
   api(`/search?q=${encodeURIComponent(trimmed)}&limit=25`)
    .then(r=>setResults(r))
    .catch(()=>setResults(null))
    .finally(()=>setLoading(false));
  },140);
  return ()=>clearTimeout(timer);
 },[q]);

 const findRepoName=(repoId:string)=>state.repos.find((r:Item)=>r.id===repoId)?.name||'';

 const quickSessions=results
  ?results.sessions
  :[...state.jobs].sort((a:Item,b:Item)=>(b.updated||b.created).localeCompare(a.updated||a.created)).slice(0,6);
 const quickChanges=results
  ?results.changes
  :[...state.changes].sort((a:Item,b:Item)=>(b.updated||b.created).localeCompare(a.updated||a.created)).slice(0,4);

 const commands=[
  ...(canEdit?[
   {id:'new-session',label:'New session',icon:Plus,action:()=>{onClose();onNewSession();}},
   {id:'new-agent',label:'New agent definition',icon:Bot,action:()=>{onClose();onNewAgent();}},
   {id:'new-workflow',label:'New automation',icon:Zap,action:()=>{onClose();onNewWorkflow();}},
   {id:'new-deployment',label:'Start deployment',icon:Rocket,action:()=>{onClose();onNewDeployment();}},
   {id:'new-repo',label:'Connect repository',icon:FolderGit2,action:()=>{onClose();onNewRepo();}}
  ]:[]),
  {id:'go-sessions',label:'Go to Sessions',icon:Sparkles,action:()=>{onClose();go('sessions');}},
  {id:'go-changes',label:'Go to Changes',icon:GitPullRequest,action:()=>{onClose();go('changes');}},
  {id:'go-agents',label:'Go to Agents',icon:Bot,action:()=>{onClose();go('agents');}},
  {id:'go-deployments',label:'Go to Deployments',icon:Rocket,action:()=>{onClose();go('deployments');}},
  {id:'toggle-theme',label:`Switch to ${theme==='light'?'dark':'light'} theme`,icon:SlidersHorizontal,action:()=>{setTheme(theme==='light'?'dark':'light');onClose();}}
 ].filter(c=>!q.trim()||c.label.toLowerCase().includes(q.trim().toLowerCase()));

 return (
  <Modal title="Search & commands" size="lg" onClose={onClose}>
   <div className="palette-input-wrap">
    <Search size={15}/>
    <input
     autoFocus
     className="palette-input"
     placeholder="Search sessions, transcripts, change requests, or run a command…"
     value={q}
     onChange={e=>setQ(e.target.value)}
    />
    {loading&&<RotateCw size={13} className="spin"/>}
   </div>

   <div className="palette-results">
    {commands.length>0&&(
     <div className="palette-group">
      <div className="palette-group-title">Commands</div>
      {commands.slice(0,5).map(cmd=>(
       <button key={cmd.id} type="button" className="palette-row" onClick={cmd.action}>
        <cmd.icon size={14}/>
        <span className="palette-row-main">{cmd.label}</span>
        <ArrowRight size={13}/>
       </button>
      ))}
     </div>
    )}

    {quickSessions.length>0&&(
     <div className="palette-group">
      <div className="palette-group-title">{results?'Matching Sessions':'Recent Sessions'}</div>
      {quickSessions.map((s:Item)=>(
       <button key={s.id} type="button" className="palette-row" onClick={()=>{onClose();go('sessions',s.id);}}>
        <Dot status={s.status}/>
        <div className="palette-row-main">
         <div className="palette-row-title">
          <strong>{s.title}</strong>
          <span className="muted-meta">{findRepoName(s.repoId)} · {ago(s.updated||s.created)}</span>
         </div>
         {s.snippet&&<div className="palette-snippet">{s.snippet}</div>}
        </div>
        <Status value={s.status}/>
       </button>
      ))}
     </div>
    )}

    {quickChanges.length>0&&(
     <div className="palette-group">
      <div className="palette-group-title">{results?'Matching Change Requests':'Recent Change Requests'}</div>
      {quickChanges.map((c:Item)=>(
       <button key={c.id} type="button" className="palette-row" onClick={()=>{onClose();go('changes',c.id);}}>
        <GitPullRequest size={14}/>
        <div className="palette-row-main">
         <div className="palette-row-title">
          <strong>{c.title}</strong>
          <span className="muted-meta">{findRepoName(c.repoId)}</span>
         </div>
         {c.snippet&&<div className="palette-snippet">{c.snippet}</div>}
        </div>
        <Status value={c.status}/>
       </button>
      ))}
     </div>
    )}

    {results&&!quickSessions.length&&!quickChanges.length&&!commands.length&&(
     <div className="empty-inline">No matching sessions or change requests for “{q}”.</div>
    )}
   </div>
  </Modal>
 );
}

/* ============================================================================
 * Pages
 * ========================================================================== */

export function SessionRow({job,repo,agent,onClick}:{job:Item,repo?:Item,agent?:Item,onClick:()=>void}){
 return (
  <button type="button" className="row-item" onClick={onClick}>
   <Dot status={job.status}/>
   <div className="row-main">
    <div className="row-title-line">
     <strong>{job.title}</strong>
     {job.forkedFrom&&<span className="tag"><GitFork size={10}/>Fork</span>}
     {agent&&<span className="tag tag-accent"><Bot size={10}/>{agent.name}</span>}
     {job.archived&&<span className="tag">Archived</span>}
    </div>
    <small>
     {repo?.name||'Repo'} · {kindLabel(job.kind)}
     {job.model?` · ${job.model}`:''}
     {job.thinkingLevel&&job.thinkingLevel!=='off'?` (${thinkingLabel[job.thinkingLevel]||job.thinkingLevel})`:''}
     {' · '}{ago(job.updated||job.created)}
    </small>
   </div>
   <Status value={job.status}/>
   <ArrowRight size={14} className="row-arrow"/>
  </button>
 );
}

export function HomePage({onNewRepo}:{onNewRepo:()=>void}){
 const {state,project,go,canEdit,run}=useWorkspace();
 const jobs=state.jobs.filter((j:Item)=>(project==='all'||j.projectId===project)&&!j.archived);
 const changes=state.changes.filter((c:Item)=>project==='all'||c.projectId===project);
 const findRepo=(id:string)=>state.repos.find((r:Item)=>r.id===id);
 const findAgent=(id?:string)=>(state.agents||[]).find((a:Item)=>a.id===id);

 const ongoing=jobs.filter((j:Item)=>activeStatuses.includes(j.status)||attentionStatuses.includes(j.status));
 const recentSessions=[...jobs].sort((a:Item,b:Item)=>(b.updated||b.created).localeCompare(a.updated||a.created)).slice(0,8);
 const openChanges=changes.filter((c:Item)=>c.status==='open').slice(0,6);

 return (
  <div className="page-body stack-lg">
   {canEdit&&state.repos.some((r:Item)=>r.status==='ready')&&(
    <section className="stack-xs">
     <div className="section-bar">
      <h2 className="section-title"><Sparkles size={14}/><span>Start Session</span></h2>
      <span className="muted-meta">Select repository, agent, model, thinking effort, and autonomy</span>
     </div>
     <NewSessionComposer onCreated={jobId=>go('sessions',jobId)}/>
    </section>
   )}

   {!state.repos.length&&(
    <section className="card padded setup-banner">
     <div>
      <h2>Connect a repository</h2>
      <p className="muted">Initialize a local Git repository or import an existing checkout to start agent sessions.</p>
     </div>
     <button type="button" className="btn btn-primary" onClick={onNewRepo}>
      <Plus size={14}/><span>Add repository</span>
     </button>
    </section>
   )}

   {ongoing.length>0&&(
    <section className="card padded stack-sm">
     <div className="section-bar">
      <h2 className="section-title"><Clock size={14}/><span>Ongoing & Needs Attention ({ongoing.length})</span></h2>
      <button type="button" className="btn btn-sm" onClick={()=>go('sessions',null,{filter:'ongoing'})}>View all</button>
     </div>
     <div className="stack-xs">
      {ongoing.map((j:Item)=>(
       <div key={j.id} className="row-item-with-actions">
        <SessionRow job={j} repo={findRepo(j.repoId)} agent={findAgent(j.agentId)} onClick={()=>go('sessions',j.id)}/>
        {canEdit&&j.status==='awaiting_approval'&&(
         <button
          type="button"
          className="btn btn-sm btn-primary"
          onClick={()=>void run(()=>api(`/jobs/${j.id}/action`,'POST',{action:'approve'}))}
         >
          <Play size={12}/><span>Approve</span>
         </button>
        )}
       </div>
      ))}
     </div>
    </section>
   )}

   <div className="grid-2">
    <section className="card padded stack-sm">
     <div className="section-bar">
      <h2 className="section-title"><Sparkles size={14}/><span>Recent Sessions</span></h2>
      <button type="button" className="btn btn-sm" onClick={()=>go('sessions')}>All sessions ({jobs.length})</button>
     </div>
     {recentSessions.length?(
      <div className="stack-xs">
       {recentSessions.map((j:Item)=>(
        <SessionRow key={j.id} job={j} repo={findRepo(j.repoId)} agent={findAgent(j.agentId)} onClick={()=>go('sessions',j.id)}/>
       ))}
      </div>
     ):(
      <Empty icon={Sparkles} title="No sessions yet">Use the composer above to start a session.</Empty>
     )}
    </section>

    <section className="card padded stack-sm">
     <div className="section-bar">
      <h2 className="section-title"><GitPullRequest size={14}/><span>Open Change Requests</span></h2>
      <button type="button" className="btn btn-sm" onClick={()=>go('changes')}>All changes ({changes.length})</button>
     </div>
     {openChanges.length?(
      <div className="stack-xs">
       {openChanges.map((c:Item)=>(
        <button key={c.id} type="button" className="row-item" onClick={()=>go('changes',c.id)}>
         <GitPullRequest size={14} className="tone-open-text"/>
         <div className="row-main">
          <strong>{c.title}</strong>
          <small>{findRepo(c.repoId)?.name} · <code>{c.source} → {c.target}</code> · {ago(c.created)}</small>
         </div>
         {c.conflict&&<span className="status tone-bad">Conflict</span>}
         <Status value={c.status}/>
         <ArrowRight size={14} className="row-arrow"/>
        </button>
       ))}
      </div>
     ):(
      <Empty icon={GitPullRequest} title="No open change requests">Sessions that commit changes open or update change requests here.</Empty>
     )}
    </section>
   </div>
  </div>
 );
}

export function SessionsPage({initialFilter,onNewSession}:{initialFilter?:string,onNewSession:()=>void}){
 const {state,project,go,canEdit}=useWorkspace();
 const [filter,setFilter]=useState<'all'|'ongoing'|'attention'|'idle'|'completed'|'archived'>((initialFilter as any)||'all');
 const [agentFilter,setAgentFilter]=useState('');
 const [query,setQuery]=useState('');

 const allJobs=state.jobs.filter((j:Item)=>project==='all'||j.projectId===project);
 const findRepo=(id:string)=>state.repos.find((r:Item)=>r.id===id);
 const findAgent=(id?:string)=>(state.agents||[]).find((a:Item)=>a.id===id);

 const filtered=allJobs
  .filter((j:Item)=>{
   if(filter==='archived')return Boolean(j.archived);
   if(j.archived)return false;
   if(filter==='ongoing')return activeStatuses.includes(j.status);
   if(filter==='attention')return attentionStatuses.includes(j.status);
   if(filter==='idle')return j.status==='idle'||Boolean(j.forkedFrom);
   if(filter==='completed')return j.status==='completed';
   return true;
  })
  .filter((j:Item)=>!agentFilter||j.agentId===agentFilter)
  .filter((j:Item)=>!query.trim()||j.title?.toLowerCase().includes(query.toLowerCase())||j.prompt?.toLowerCase().includes(query.toLowerCase()))
  .sort((a:Item,b:Item)=>(b.updated||b.created).localeCompare(a.updated||a.created));

 return (
  <div className="page-body stack-md">
   <PageHeader
    title="Sessions"
    subtitle="Interactive agent sessions, subagent hierarchies, and branched worktree forks."
    actions={canEdit&&<button type="button" className="btn btn-primary btn-sm" onClick={onNewSession}><Plus size={14}/><span>New session</span></button>}
   >
    <div className="filter-bar">
     <Segmented
      value={filter}
      onChange={setFilter}
      options={[
       {value:'all',label:'All'},
       {value:'ongoing',label:`Ongoing (${allJobs.filter((j:Item)=>!j.archived&&activeStatuses.includes(j.status)).length})`},
       {value:'attention',label:`Attention (${allJobs.filter((j:Item)=>!j.archived&&attentionStatuses.includes(j.status)).length})`},
       {value:'idle',label:'Forks & Idle'},
       {value:'completed',label:'Done'},
       {value:'archived',label:'Archived'}
      ]}
     />
     {(state.agents||[]).length>0&&(
      <select className="filter-select" value={agentFilter} onChange={e=>setAgentFilter(e.target.value)}>
       <option value="">All agents</option>
       {(state.agents||[]).map((a:Item)=><option key={a.id} value={a.id}>{a.name}</option>)}
      </select>
     )}
     <div className="search-box">
      <Search size={14}/>
      <input placeholder="Filter sessions…" value={query} onChange={e=>setQuery(e.target.value)}/>
     </div>
    </div>
   </PageHeader>

   <section className="card">
    {filtered.length?(
     <div className="list-divide">
      {filtered.map((j:Item)=>(
       <SessionRow key={j.id} job={j} repo={findRepo(j.repoId)} agent={findAgent(j.agentId)} onClick={()=>go('sessions',j.id)}/>
      ))}
     </div>
    ):(
     <Empty icon={Sparkles} title="No matching sessions">
      {canEdit&&<button type="button" className="btn btn-primary btn-sm" onClick={onNewSession}><Plus size={14}/><span>Start session</span></button>}
     </Empty>
    )}
   </section>
  </div>
 );
}

export function ChangesPage({onNewSession}:{onNewSession:()=>void}){
 const {state,project,go,canEdit}=useWorkspace();
 const [filter,setFilter]=useState<'open'|'merged'|'closed'|'all'>('open');
 const [query,setQuery]=useState('');
 const allChanges=state.changes.filter((c:Item)=>project==='all'||c.projectId===project);
 const findRepo=(id:string)=>state.repos.find((r:Item)=>r.id===id);

 const filtered=allChanges
  .filter((c:Item)=>filter==='all'||c.status===filter)
  .filter((c:Item)=>!query.trim()||c.title?.toLowerCase().includes(query.toLowerCase())||c.source?.toLowerCase().includes(query.toLowerCase()))
  .sort((a:Item,b:Item)=>(b.updated||b.created).localeCompare(a.updated||a.created));

 return (
  <div className="page-body stack-md">
   <PageHeader
    title="Change Requests"
    subtitle="Pinned source and target branch diffs, automated checks, and reviews."
    actions={canEdit&&<button type="button" className="btn btn-primary btn-sm" onClick={onNewSession}><Plus size={14}/><span>New change request</span></button>}
   >
    <div className="filter-bar">
     <Segmented
      value={filter}
      onChange={setFilter}
      options={[
       {value:'open',label:`Open (${allChanges.filter((c:Item)=>c.status==='open').length})`},
       {value:'merged',label:`Merged (${allChanges.filter((c:Item)=>c.status==='merged').length})`},
       {value:'closed',label:'Closed'},
       {value:'all',label:'All'}
      ]}
     />
     <div className="search-box">
      <Search size={14}/>
      <input placeholder="Filter change requests…" value={query} onChange={e=>setQuery(e.target.value)}/>
     </div>
    </div>
   </PageHeader>

   <section className="card">
    {filtered.length?(
     <div className="list-divide">
      {filtered.map((c:Item)=>(
       <button key={c.id} type="button" className="row-item" onClick={()=>go('changes',c.id)}>
        <GitPullRequest size={15} className={c.status==='merged'?'tone-ok-text':c.status==='open'?'tone-open-text':'muted-meta'}/>
        <div className="row-main">
         <div className="row-title-line">
          <strong>{c.title}</strong>
          <code className="branch-pill">{c.source} → {c.target}</code>
         </div>
         <small>{findRepo(c.repoId)?.name} · {ago(c.updated||c.created)}</small>
        </div>
        {c.conflict&&<span className="status tone-bad">Conflict</span>}
        <Status value={c.status}/>
        <ArrowRight size={14} className="row-arrow"/>
       </button>
      ))}
     </div>
    ):(
     <Empty icon={GitPullRequest} title="No matching change requests"/>
    )}
   </section>
  </div>
 );
}

export function AgentsPage({onStartWithAgent}:{onStartWithAgent:(agentId:string)=>void}){
 const {state,project,modal,close,run,canEdit,isAdmin}=useWorkspace();
 const [resourceModal,setResourceModal]=useState(false);
 const [resProjectId,setResProjectId]=useState(project!=='all'?project:state.projects[0]?.id||'');
 const [resName,setResName]=useState('');
 const [resKind,setResKind]=useState('prompt');
 const [resContent,setResContent]=useState('');
 const {busy:resBusy,error:resErr,submit:submitRes}=useSubmit();

 const agents=(state.agents||[]).filter((a:Item)=>project==='all'||!a.projectId||a.projectId===project);
 const resources=(state.resources||[]).filter((r:Item)=>project==='all'||r.projectId===project);
 const findProjectName=(id?:string)=>id?state.projects.find((p:Item)=>p.id===id)?.name||'Project':'Workspace-wide';

 return (
  <div className="page-body stack-lg">
   <PageHeader
    title="Agents & Skills"
    subtitle="Reusable agent personas with specialized instructions, default models, thinking effort, and autonomy policies."
    actions={
     canEdit&&(
      <div className="toolbar-actions">
       <button type="button" className="btn btn-sm" onClick={()=>setResourceModal(true)}>
        <FileCode2 size={13}/><span>New skill / resource</span>
       </button>
       <button type="button" className="btn btn-primary btn-sm" onClick={()=>modal(<AgentModal onClose={close}/>)}>
        <Plus size={14}/><span>New agent</span>
       </button>
      </div>
     )
    }
   />

   <section className="stack-sm">
    <h2 className="section-title"><Bot size={14}/><span>Agent Definitions ({agents.length})</span></h2>
    {agents.length?(
     <div className="card-grid">
      {agents.map((a:Item)=>(
       <article key={a.id} className="card padded agent-card">
        <div className="agent-card-top">
         <div>
          <div className="row-title-line">
           <Bot size={15}/>
           <strong>{a.name}</strong>
           <span className="tag">{findProjectName(a.projectId)}</span>
          </div>
          {a.description&&<p className="muted" style={{marginTop:4}}>{a.description}</p>}
         </div>
         {canEdit&&(a.projectId||isAdmin)&&(
          <div className="toolbar-actions">
           <button type="button" className="icon-btn" title="Edit agent" onClick={()=>modal(<AgentModal agent={a} onClose={close}/>)}>
            <Pencil size={13}/>
           </button>
           <button
            type="button"
            className="icon-btn"
            title="Delete agent"
            onClick={()=>void run(()=>api(`/agents/${a.id}`,'DELETE'),'Agent deleted')}
           >
            <Trash2 size={13}/>
           </button>
          </div>
         )}
        </div>

        <pre className="code-snippet">{a.instructions}</pre>

        <div className="agent-card-foot">
         <div className="agent-badges">
          <span className="tag">{kindLabel(a.kind)}</span>
          <span className="tag">{autonomyLabel(a.autonomy)}</span>
          {a.model&&<span className="tag">{a.model}</span>}
          {a.thinkingLevel&&a.thinkingLevel!=='off'&&<span className="tag">Thinking: {thinkingLabel[a.thinkingLevel]||a.thinkingLevel}</span>}
         </div>
         {canEdit&&(
          <button type="button" className="btn btn-sm btn-primary" onClick={()=>onStartWithAgent(a.id)}>
           <Play size={12}/><span>Start session</span>
          </button>
         )}
        </div>
       </article>
      ))}
     </div>
    ):(
     <Empty icon={Bot} title="No custom agents defined">
      Define specialized agents (e.g., Planner, Reviewer, Security Auditor, Test Engineer) with preset models, instructions, and autonomy rules.
     </Empty>
    )}
   </section>

   <section className="stack-sm">
    <h2 className="section-title"><FileCode2 size={14}/><span>Project Prompts, Skills & Extensions ({resources.length})</span></h2>
    {resources.length?(
     <div className="card-grid">
      {resources.map((r:Item)=>(
       <article key={r.id} className="card padded agent-card">
        <div className="agent-card-top">
         <div className="row-title-line">
          <FileCode2 size={14}/>
          <strong>{r.name}</strong>
          <span className="tag">{label(r.kind)} · v{r.version}</span>
         </div>
         <Status value={r.active?'active':'draft'}/>
        </div>
        <pre className="code-snippet">{r.content.slice(0,260)}</pre>
        {!r.active&&canEdit&&(
         <div className="agent-card-foot">
          <span className="muted-meta">{findProjectName(r.projectId)}</span>
          <button type="button" className="btn btn-sm" onClick={()=>void run(()=>api(`/resources/${r.id}/activate`,'POST',{}),'Resource activated')}>
           <span>Activate v{r.version}</span>
          </button>
         </div>
        )}
       </article>
      ))}
     </div>
    ):(
     <Empty icon={FileCode2} title="No project resources yet">
      Save shared prompts, reusable skills, or Pi TypeScript extensions scoped to your projects.
     </Empty>
    )}
   </section>

   {resourceModal&&(
    <Modal
     title="New project resource"
     onClose={()=>setResourceModal(false)}
     footer={
      <>
       <button type="button" className="btn" onClick={()=>setResourceModal(false)}>Cancel</button>
       <button
        type="button"
        className="btn btn-primary"
        disabled={resBusy||!resName.trim()||!resContent.trim()||!resProjectId}
        onClick={()=>void submitRes(async()=>{
         await api('/resources','POST',{
          projectId:resProjectId,
          name:resName.trim(),
          kind:resKind,
          content:resContent
         });
         setResourceModal(false);
         setResName('');
         setResContent('');
        })}
       >
        {resBusy&&<RotateCw size={13} className="spin"/>}
        <span>Save draft</span>
       </button>
      </>
     }
    >
     <ErrorNote>{resErr}</ErrorNote>
     <div className="form-grid-2">
      <Field label="Project">
       <select value={resProjectId} onChange={e=>setResProjectId(e.target.value)}>
        {state.projects.map((p:Item)=><option key={p.id} value={p.id}>{p.name}</option>)}
       </select>
      </Field>
      <Field label="Type">
       <select value={resKind} onChange={e=>setResKind(e.target.value)}>
        <option value="prompt">Prompt</option>
        <option value="skill">Skill</option>
        <option value="extension">Pi TypeScript Extension</option>
       </select>
      </Field>
     </div>
     <Field label="Name">
      <input required value={resName} onChange={e=>setResName(e.target.value)} placeholder="review-checklist"/>
     </Field>
     <Field label="Content">
      <textarea rows={6} required value={resContent} onChange={e=>setResContent(e.target.value)} placeholder="Instructions or TypeScript source…"/>
     </Field>
    </Modal>
   )}
  </div>
 );
}

export function AutomationsPage(){
 const {state,project,modal,close,run,canEdit}=useWorkspace();
 const workflows=state.workflows.filter((w:Item)=>project==='all'||w.projectId===project);
 const findRepo=(id:string)=>state.repos.find((r:Item)=>r.id===id);
 const findAgent=(id?:string)=>(state.agents||[]).find((a:Item)=>a.id===id);

 return (
  <div className="page-body stack-md">
   <PageHeader
    title="Automations"
    subtitle="Event-driven triggers and scheduled agent runs."
    actions={
     canEdit&&(
      <button type="button" className="btn btn-primary btn-sm" onClick={()=>modal(<WorkflowModal onClose={close}/>)}>
       <Plus size={14}/><span>New automation</span>
      </button>
     )
    }
   />

   <section className="card">
    {workflows.length?(
     <div className="list-divide">
      {workflows.map((w:Item)=>{
       const ag=findAgent(w.agentId);
       return (
        <div key={w.id} className="row-item-static">
         <Zap size={15} className={w.enabled?'tone-live-text':'muted-meta'}/>
         <div className="row-main">
          <div className="row-title-line">
           <strong>{w.name}</strong>
           <span className="tag">{triggerLabel(w.trigger)} → {kindLabel(w.kind)}</span>
           {ag&&<span className="tag tag-accent"><Bot size={10}/>{ag.name}</span>}
           <span className="tag">{autonomyLabel(w.autonomy)}</span>
          </div>
          <small>
           {findRepo(w.repoId)?.name}
           {w.thinkingLevel&&w.thinkingLevel!=='off'?` · Thinking: ${thinkingLabel[w.thinkingLevel]||w.thinkingLevel}`:''}
           {w.trigger==='schedule'?` · Every ${w.intervalMinutes}m · Next ${new Date(w.nextRun).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})}`:''}
          </small>
          {w.error&&<div className="tone-bad-text" style={{fontSize:12,marginTop:2}}>{w.error}</div>}
         </div>
         <Status value={w.enabled?'enabled':'paused'}/>
         {canEdit&&(
          <div className="toolbar-actions">
           <Switch
            checked={Boolean(w.enabled)}
            onChange={next=>void run(()=>api(`/workflows/${w.id}`,'PATCH',{enabled:next}))}
           />
           <button type="button" className="icon-btn" title="Configure" onClick={()=>modal(<WorkflowModal workflow={w} onClose={close}/>)}>
            <Settings2 size={14}/>
           </button>
           <button
            type="button"
            className="icon-btn"
            title="Delete"
            onClick={()=>void run(()=>api(`/workflows/${w.id}`,'DELETE'),'Automation deleted')}
           >
            <Trash2 size={14}/>
           </button>
          </div>
         )}
        </div>
       );
      })}
     </div>
    ):(
     <Empty icon={Zap} title="No automations configured">
      Run agents automatically when change requests are opened, tests fail, comments arrive, or on a recurring schedule.
     </Empty>
    )}
   </section>
  </div>
 );
}

export function DeploymentsPage(){
 const {state,project,modal,close,run,refresh,notify,canEdit,isAdmin,go}=useWorkspace();
 const [category,setCategory]=useState<'containers'|'external'>('containers');
 const [tab,setTab]=useState<'all'|'active'|'stopped'>('all');
 const [query,setQuery]=useState('');

 const deployments=(state.deployments||state.previews||[]).filter((d:Item)=>project==='all'||d.projectId===project);
 const externalDeployments=(state.externalDeployments||[]).filter((d:Item)=>project==='all'||d.projectId===project);
 const repos=(state.repos||[]).filter((r:Item)=>project==='all'||r.projectId===project);
 const findRepo=(id:string)=>state.repos.find((r:Item)=>r.id===id);

 const isActive=(d:Item)=>['running','starting'].includes(d.status);

 const filtered=deployments.filter((d:Item)=>{
  if(tab==='active'&&!isActive(d))return false;
  if(tab==='stopped'&&isActive(d))return false;
  if(query.trim()){
   const q=query.toLowerCase().trim();
   const repo=findRepo(d.repoId);
   const match=(repo?.name||'').toLowerCase().includes(q)
    ||(d.customName||'').toLowerCase().includes(q)
    ||(d.branch||'').toLowerCase().includes(q)
    ||(d.sha||'').toLowerCase().includes(q)
    ||(d.status||'').toLowerCase().includes(q)
    ||(d.error||'').toLowerCase().includes(q);
   if(!match)return false;
  }
  return true;
 });

 const allActive=deployments.filter(isActive);
 const allStopped=deployments.filter((d:Item)=>!isActive(d));

 const activeFiltered=filtered.filter(isActive);
 const stoppedFiltered=filtered.filter((d:Item)=>!isActive(d));

 function renderDeploymentRow(d:Item){
  const repo=findRepo(d.repoId);
  const branch=d.branch||repo?.base||'main';
  const running=d.status==='running';
  const active=isActive(d);

  return (
   <div key={d.id} className="row-item-static">
    <Rocket size={15} className={active?'tone-ok-text':'muted-meta'}/>
    <div className="row-main">
     <div className="row-title-line">
      <strong>{d.customName||repo?.name||'Deployment'}</strong>
      {d.customName&&repo?.name&&<span className="muted-meta">({repo.name})</span>}
      <code className="branch-pill"><GitBranch size={11}/>{branch}</code>
      {d.sha&&<code className="muted-meta">{short(d.sha)}</code>}
      <span className="tag" title="Auto-stop idle lifetime">
       <Clock size={11}/>
       {formatLifetime(d.lifetimeMinutes)}
      </span>
      {d.port&&<span className="tag">:{d.port}</span>}
     </div>
     <small>
      {d.error?(
       <span style={{color:'var(--bad)'}}>{d.error}</span>
      ):active?(
       `Started ${ago(d.created)} · Last activity ${ago(d.lastActivity||d.created)}`
      ):(
       `Stopped · Created ${ago(d.created)}`
      )}
     </small>
    </div>
    <Status value={d.status} live={active}/>
    <div className="toolbar-actions">
     {running&&(
      <button
       type="button"
       className="btn btn-sm btn-primary"
       onClick={()=>void run(async()=>{
        const x=await api(`/deployments/${d.id}/link`,'POST',{});
        window.open(x.url,'_blank','noopener,noreferrer');
       })}
      >
       <span>Open</span><ExternalLink size={12}/>
      </button>
     )}
     <button
      type="button"
      className="icon-btn"
      title="Container logs"
      onClick={()=>void run(async()=>{
       const x=await api(`/deployments/${d.id}/logs`);
       modal(
        <Modal title={`Logs: ${d.customName||repo?.name||'Deployment'} (${branch})`} size="xl" onClose={close}>
         <pre className="terminal">{x.log||'No output.'}</pre>
        </Modal>
       );
      })}
     >
      <Terminal size={14}/>
     </button>
     {canEdit&&(
      <button
       type="button"
       className="icon-btn"
       title="Configure deployment"
       onClick={()=>modal(<ConfigureDeploymentModal deployment={d} onClose={close}/>)}
      >
       <SlidersHorizontal size={14}/>
      </button>
     )}
     {canEdit&&['running','failed','stopped'].includes(d.status)&&(
      <button
       type="button"
       className="icon-btn"
       title="Restart deployment"
       onClick={()=>void run(()=>api(`/deployments/${d.id}/restart`,'POST',{}),'Restarting deployment')}
      >
       <RotateCw size={14}/>
      </button>
     )}
     {canEdit&&running&&(
      <button
       type="button"
       className="icon-btn"
       title="Stop deployment"
       onClick={()=>void run(()=>api(`/deployments/${d.id}/stop`,'POST',{}),'Deployment stopped')}
      >
       <Square size={14}/>
      </button>
     )}
     {canEdit&&(
      <button
       type="button"
       className="icon-btn"
       title="Remove deployment"
       onClick={()=>modal(
        <Confirm
         title="Remove deployment"
         body={`Permanently delete deployment "${d.customName||repo?.name||'Deployment'}" (${branch}) and remove its container?`}
         danger
         action="Delete"
         onConfirm={async()=>{
          await api(`/deployments/${d.id}`,'DELETE');
          await refresh();
          notify('Deployment removed');
         }}
         onClose={close}
        />
       )}
      >
       <Trash2 size={14}/>
      </button>
     )}
    </div>
   </div>
  );
 }

 return (
  <div className="page-body stack-md">
   <div style={{display:'flex',gap:8,alignItems:'center',marginBottom:4}}>
    <Tabs
     value={category}
     onChange={v=>setCategory(v as any)}
     tabs={[
      {id:'containers',label:'Preview Containers',count:deployments.length},
      {id:'external',label:'External Deployments',count:externalDeployments.length}
     ]}
    />
   </div>

   {category==='external'?(
    <ExternalDeployments
     api={api}
     deployments={externalDeployments}
     repos={repos}
     jobs={state.jobs||[]}
     admin={isAdmin}
     refresh={refresh}
     openJob={(id:string)=>go('sessions',id)}
    />
   ):(
    <>
     <PageHeader
      title="Deployments"
      subtitle="Isolated application containers that automatically update when their tracked branch advances."
      actions={
       <div className="toolbar-row" style={{gap:'0.5rem'}}>
        {canEdit&&allStopped.length>0&&(
         <button
          type="button"
          className="btn btn-sm"
          onClick={()=>modal(
           <Confirm
            title="Clear stopped deployments"
            body={`Permanently remove ${allStopped.length} stopped or failed deployment container${allStopped.length>1?'s':''} and associated worktree branches?`}
            danger
            action="Clear all stopped"
            onConfirm={async()=>{
             await api('/deployments/cleanup','POST',{projectId:project==='all'?undefined:project});
             await refresh();
             notify('Stopped deployments cleared');
            }}
            onClose={close}
           />
          )}
         >
          <Trash2 size={13}/>
          <span>Clear stopped ({allStopped.length})</span>
         </button>
        )}
        {canEdit&&state.repos.some((r:Item)=>r.status==='ready')&&(
         <button type="button" className="btn btn-primary btn-sm" onClick={()=>modal(<NewDeploymentModal onClose={close}/>)}>
          <Plus size={14}/><span>New deployment</span>
         </button>
        )}
       </div>
      }
     >
      <div className="section-bar" style={{flexWrap:'wrap',gap:'0.75rem',marginTop:'0.5rem'}}>
       <Tabs
        value={tab}
        onChange={v=>setTab(v as any)}
        tabs={[
         {id:'all',label:'All',count:deployments.length},
         {id:'active',label:'Active',count:allActive.length},
         {id:'stopped',label:'Stopped',count:allStopped.length}
        ]}
       />
       <div className="search-box">
        <Search size={14}/>
        <input placeholder="Filter deployments…" value={query} onChange={e=>setQuery(e.target.value)}/>
       </div>
      </div>
     </PageHeader>

     {!deployments.length?(
      <section className="card">
       <Empty icon={Rocket} title="No deployments">
        Configure a deployment command in repository settings, then launch a branch deployment here or from any session.
       </Empty>
      </section>
     ):!filtered.length?(
      <section className="card">
       <Empty icon={Search} title="No matching deployments">
        No deployments match your filter. Try adjusting your search query or tab.
       </Empty>
      </section>
     ):tab==='all'?(
      <div className="stack-md">
       {activeFiltered.length>0&&(
        <section className="card">
         <div className="section-bar" style={{padding:'0.75rem 1rem 0.25rem'}}>
          <span className="section-title">
           <Dot status="running"/>
           Active deployments ({activeFiltered.length})
          </span>
         </div>
         <div className="list-divide">
          {activeFiltered.map(renderDeploymentRow)}
         </div>
        </section>
       )}
       {stoppedFiltered.length>0&&(
        <section className="card">
         <div className="section-bar" style={{padding:'0.75rem 1rem 0.25rem'}}>
          <span className="section-title">
           Stopped deployments ({stoppedFiltered.length})
          </span>
         </div>
         <div className="list-divide">
          {stoppedFiltered.map(renderDeploymentRow)}
         </div>
        </section>
       )}
      </div>
     ):(
      <section className="card">
       <div className="list-divide">
        {filtered.map(renderDeploymentRow)}
       </div>
      </section>
     )}
    </>
   )}
  </div>
 );
}

export function RepositoriesPage({
 onNewRepo,
 onConfigureRepo,
 onStartJob
}:{
 onNewRepo:()=>void,
 onConfigureRepo:(repo:Item)=>void,
 onStartJob:(repoId:string)=>void
}){
 const {state,project,modal,close,isAdmin,canEdit}=useWorkspace();
 const repos=state.repos.filter((r:Item)=>project==='all'||r.projectId===project);
 const currentProject=project!=='all'?state.projects.find((p:Item)=>p.id===project):null;

 return (
  <div className="page-body stack-md">
   <PageHeader
    title={currentProject?currentProject.name:'Repositories'}
    subtitle={currentProject?.description||'Connected Git repositories, container environments, and autonomy limits.'}
    actions={
     isAdmin&&(
      <div className="toolbar-actions">
       {currentProject&&(
        <button type="button" className="btn btn-sm" onClick={()=>modal(<ProjectModal project={currentProject} onClose={close}/>)}>
         <Settings2 size={13}/><span>Project settings</span>
        </button>
       )}
       <button type="button" className="btn btn-primary btn-sm" onClick={onNewRepo}>
        <Plus size={14}/><span>Add repository</span>
       </button>
      </div>
     )
    }
   />

   {repos.length?(
    <div className="card-grid">
     {repos.map((r:Item)=>{
      const proj=state.projects.find((p:Item)=>p.id===r.projectId);
      const openCrCount=state.changes.filter((c:Item)=>c.repoId===r.id&&c.status==='open').length;
      return (
       <article key={r.id} className="card padded repo-card-clean">
        <div className="agent-card-top">
         <div className="row-title-line">
          <FolderGit2 size={16}/>
          <strong>{r.name}</strong>
          {proj&&<span className="tag">{proj.name}</span>}
         </div>
         <Status value={r.status}/>
        </div>
        <div className="repo-meta-list">
         <span><GitBranch size={12}/><code>{r.base||'main'}</code> · {openCrCount} open {openCrCount===1?'CR':'CRs'}</span>
         <span><Sparkles size={12}/>{r.model||'No default model'}{r.thinkingLevel&&r.thinkingLevel!=='off'?` (${thinkingLabel[r.thinkingLevel]||r.thinkingLevel})`:''}</span>
         <span><Shield size={12}/>Autonomy: {autonomyLabel(r.autonomy)}</span>
        </div>
        {r.error&&<div className="tone-bad-text" style={{fontSize:12}}>{r.error}</div>}
        <div className="agent-card-foot">
         {canEdit&&(
          <button type="button" className="btn btn-sm btn-primary" onClick={()=>onStartJob(r.id)}>
           <Play size={12}/><span>New session</span>
          </button>
         )}
         {isAdmin&&(
          <button type="button" className="btn btn-sm" onClick={()=>onConfigureRepo(r)}>
           <Settings2 size={13}/><span>Configure</span>
          </button>
         )}
        </div>
       </article>
      );
     })}
    </div>
   ):(
    <Empty icon={FolderGit2} title="No repositories in this view">
     {isAdmin&&<button type="button" className="btn btn-primary btn-sm" onClick={onNewRepo}><Plus size={14}/><span>Add repository</span></button>}
    </Empty>
   )}
  </div>
 );
}

/* ============================================================================
 * Settings Page
 * ========================================================================== */

function ProviderLoginModal({connection,provider,isNew=false,onClose}:{connection:Item,provider?:Item,isNew?:boolean,onClose:()=>void}){
 const {refresh}=useWorkspace();
 const [loginState,setLoginState]=useState<Item>({status:'idle'});
 const [answer,setAnswer]=useState('');
 const [busy,setBusy]=useState(false);
 const [error,setError]=useState('');

 useEffect(()=>{
  const t=setInterval(()=>{
   api(`/connections/${connection.id}/login`).then(s=>{
    setLoginState(s);
    if(s.status==='connected')void refresh();
   }).catch(()=>{});
  },1000);
  return ()=>clearInterval(t);
 },[connection.id]);

 const methods=provider?.methods||[];
 const isAmbient=methods.length===0;

 const dismiss=async()=>{
  if(busy)return;
  setBusy(true);
  try{
   await api(`/connections/${connection.id}/cancel-login`,'POST',{discard:isNew});
   await refresh();
   onClose();
  }catch(e){
   setError((e as Error).message);
  }finally{
   setBusy(false);
  }
 };

 return (
  <Modal title={`Authenticate ${provider?.name||connection.provider}`} onClose={()=>void dismiss()}>
   <ErrorNote>{error||loginState.error}</ErrorNote>
   {(loginState.status==='idle'||loginState.status==='error')&&(
    <div className="stack-sm">
     {isAmbient?(
      <button
       type="button"
       className="btn btn-primary"
       disabled={busy}
       onClick={async()=>{
        setBusy(true);setError('');
        try{
         await api(`/connections/${connection.id}/login`,'POST',{method:'ambient'});
         await refresh();
         onClose();
        }catch(e){
         setError((e as Error).message);
        }finally{
         setBusy(false);
        }
       }}
      >
       <span>Connect with host CLI / ambient credentials</span>
      </button>
     ):(
      methods.map((m:string)=>(
       <button
        key={m}
        type="button"
        className="btn btn-primary"
        disabled={busy}
        onClick={async()=>{
         setBusy(true);setError('');
         try{
          await api(`/connections/${connection.id}/login`,'POST',{method:m});
          setLoginState({status:'pending'});
         }catch(e){
          setError((e as Error).message);
         }finally{
          setBusy(false);
         }
        }}
       >
        {m==='oauth'?<ExternalLink size={14}/>:<KeyRound size={14}/>}
        <span>{m==='oauth'?'Sign in with provider':'Enter API key'}</span>
       </button>
      ))
     )}
    </div>
   )}

   {loginState.events?.map((e:Item,i:number)=>{
    const url=e.url||e.verificationUri||e.verificationUrl;
    return (
     <div key={i} className="card padded stack-xs" style={{marginTop:10}}>
      {e.message&&<p>{e.message}</p>}
      {e.instructions&&<p className="muted">{e.instructions}</p>}
      {e.userCode&&<code>{e.userCode}</code>}
      {url&&/^https?:\/\//.test(url)&&(
       <a className="btn btn-sm btn-primary" href={url} target="_blank" rel="noreferrer">
        <span>Open authorization page</span><ExternalLink size={13}/>
       </a>
      )}
     </div>
    );
   })}

   {loginState.prompt&&(
    <form
     className="stack-sm"
     style={{marginTop:12}}
     onSubmit={async e=>{
      e.preventDefault();
      if(!answer.trim())return;
      await api(`/connections/${connection.id}/answer`,'POST',{answer:answer.trim()});
      setAnswer('');
      setLoginState({...loginState,prompt:null});
     }}
    >
     <Field label={loginState.prompt.message||loginState.prompt.label||'Credential'}>
      {loginState.prompt.options?(
       <select value={answer} onChange={e=>setAnswer(e.target.value)} required>
        <option value="">Select…</option>
        {loginState.prompt.options.map((o:Item)=><option key={o.id||o.value} value={o.id||o.value}>{o.label||o.name||o.id}</option>)}
       </select>
      ):(
       <input
        type={loginState.prompt.type==='secret'?'password':'text'}
        required
        value={answer}
        onChange={e=>setAnswer(e.target.value)}
       />
      )}
     </Field>
     <button type="submit" className="btn btn-primary btn-sm">Continue</button>
    </form>
   )}

   {loginState.status==='pending'&&!loginState.prompt&&(
    <div className="live-activity-bar" style={{marginTop:12}}>
     <RotateCw size={14} className="spin"/><span>Waiting for provider authentication…</span>
    </div>
   )}

   {loginState.status==='connected'&&(
    <div className="stack-sm" style={{marginTop:12}}>
     <div className="tone-ok-text" style={{display:'flex',alignItems:'center',gap:6}}>
      <CheckCircle2 size={16}/><strong>Connected</strong>
     </div>
     <button type="button" className="btn btn-primary btn-sm" onClick={onClose}>Done</button>
    </div>
   )}
  </Modal>
 );
}

export function SettingsPage({onTriggerReload,reloading}:{onTriggerReload:()=>void,reloading:boolean}){
 const {me,state,catalog,modal,close,refresh,notify,run,isAdmin}=useWorkspace();
 const [tab,setTab]=useState('connections');
 const [providers,setProviders]=useState<Item[]>(catalog||[]);
 const [access,setAccess]=useState<Item|null>(null);
 const [selfData,setSelfData]=useState<Item>({deployments:[]});
 const [selectedMerge,setSelectedMerge]=useState('');

 useEffect(()=>{
  api('/providers').then(setProviders).catch(()=>{});
  api('/access').then(setAccess).catch(()=>{});
  if(isAdmin)api('/self').then(setSelfData).catch(()=>{});
 },[isAdmin]);

 const openLogin=(c:Item,isNew=false)=>{
  modal(<ProviderLoginModal connection={c} provider={providers.find(p=>p.id===c.provider)} isNew={isNew} onClose={close}/>);
 };

 const openAddConnection=()=>{
  let name='';
  let provider=providers[0]?.id||'';
  let shared=false;
  let projectId='';
  modal(
   <Modal title="Add model connection" onClose={close}>
    <form
     className="stack-sm"
     onSubmit={async e=>{
      e.preventDefault();
      try{
       const c=await api('/connections','POST',{
        name:name.trim()||provider,
        provider,
        shared,
        projects:shared&&projectId?[projectId]:[]
       });
       await refresh();
       if(c.status==='connected'){
        notify(`${c.name} connected`);
        close();
       }else{
        openLogin(c,true);
       }
      }catch(err){
       notify((err as Error).message,'bad');
      }
     }}
    >
     <Field label="Connection name">
      <input required placeholder="Anthropic / OpenAI / Agy" onChange={e=>{name=e.target.value;}}/>
     </Field>
     <Field label="Provider">
      <select defaultValue={provider} onChange={e=>{provider=e.target.value;}}>
       {providers.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}
      </select>
     </Field>
     {isAdmin&&(
      <>
       <Field label="Share with project">
        <select defaultValue="" onChange={e=>{projectId=e.target.value;shared=Boolean(projectId);}}>
         <option value="">Personal only</option>
         {state.projects.map((p:Item)=><option key={p.id} value={p.id}>Share with {p.name}</option>)}
        </select>
       </Field>
      </>
     )}
     <div className="form-actions">
      <button type="button" className="btn" onClick={close}>Cancel</button>
      <button type="submit" className="btn btn-primary">Continue</button>
     </div>
    </form>
   </Modal>
  );
 };

 const createInvite=async(forSelfDevice=false)=>{
  if(forSelfDevice){
   await run(async()=>{
    const v=await api('/invites','POST',{userId:me.id});
    modal(<InviteLinkModal title="Add device" url={v.url} onClose={close}/>);
   });
   return;
  }
  let role='operator';
  let projectId=state.projects[0]?.id||'';
  modal(
   <Modal title="Invite member" onClose={close}>
    <form
     className="stack-sm"
     onSubmit={async e=>{
      e.preventDefault();
      const v=await api('/invites','POST',{role,projects:projectId?[projectId]:[]});
      modal(<InviteLinkModal title="Invitation link" url={v.url} onClose={close}/>);
     }}
    >
     <Field label="Role">
      <select defaultValue={role} onChange={e=>{role=e.target.value;}}>
       <option value="viewer">Viewer</option>
       <option value="operator">Operator</option>
       <option value="admin">Admin</option>
      </select>
     </Field>
     <Field label="Project access">
      <select defaultValue={projectId} onChange={e=>{projectId=e.target.value;}}>
       <option value="">None</option>
       {state.projects.map((p:Item)=><option key={p.id} value={p.id}>{p.name}</option>)}
      </select>
     </Field>
     <div className="form-actions">
      <button type="button" className="btn" onClick={close}>Cancel</button>
      <button type="submit" className="btn btn-primary">Generate link</button>
     </div>
    </form>
   </Modal>
  );
 };

 return (
  <div className="page-body stack-md">
   <PageHeader
    title="Settings"
    subtitle="Model connections, workspace members, trusted devices, and system releases."
   >
    <Tabs
     value={tab}
     onChange={setTab}
     tabs={[
      {id:'connections',label:'Connections',count:state.connections.length},
      {id:'access',label:'Members'},
      {id:'devices',label:'Devices'},
      ...(isAdmin?[{id:'system',label:'System'}]:[])
     ]}
    />
   </PageHeader>

   {tab==='connections'&&(
    <div className="stack-md">
     <div className="section-bar">
      <h2 className="section-title">Configured Connections</h2>
      <button type="button" className="btn btn-primary btn-sm" onClick={openAddConnection}>
       <Plus size={14}/><span>Add connection</span>
      </button>
     </div>
     <section className="card">
      {state.connections.length?(
       <div className="list-divide">
        {state.connections.map((c:Item)=>(
         <div key={c.id} className="row-item-static">
          <KeyRound size={15}/>
          <div className="row-main">
           <strong>{c.name}</strong>
           <small>{c.provider} · {c.shared?'Shared':'Personal'}</small>
          </div>
          <Status value={c.status}/>
          {(isAdmin||c.ownerId===me.id)&&(
           <div className="toolbar-actions">
            <button type="button" className="btn btn-sm" onClick={()=>openLogin(c)}>Authenticate</button>
            <button type="button" className="icon-btn" title="Remove" onClick={()=>void run(()=>api(`/connections/${c.id}`,'DELETE'))}>
             <Trash2 size={14}/>
            </button>
           </div>
          )}
         </div>
        ))}
       </div>
      ):(
       <Empty icon={KeyRound} title="No provider connections">Add a provider connection to run AI sessions.</Empty>
      )}
     </section>

     <div className="section-bar">
      <h2 className="section-title">Available Providers ({providers.length})</h2>
     </div>
     <div className="card-grid">
      {providers.map((p:Item)=>(
       <details key={p.id} className="card padded">
        <summary style={{cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'space-between',fontWeight:600}}>
         <span>{p.name} <span className="muted-meta">({p.models?.length||0} models)</span></span>
        </summary>
        <div className="stack-xs" style={{marginTop:10,maxHeight:200,overflow:'auto'}}>
         {p.models?.map((m:Item)=>(
          <div key={m.id} style={{display:'flex',justifyContent:'space-between',fontSize:12}}>
           <span>{m.name}</span>
           <code className="muted-meta">{m.id}</code>
          </div>
         ))}
        </div>
       </details>
      ))}
     </div>
    </div>
   )}

   {tab==='access'&&(
    <div className="stack-md">
     <div className="section-bar">
      <h2 className="section-title">Workspace Members</h2>
      {isAdmin&&<button type="button" className="btn btn-primary btn-sm" onClick={()=>void createInvite(false)}><Plus size={14}/><span>Invite member</span></button>}
     </div>
     <section className="card">
      <div className="list-divide">
       {access?.users?.map((u:Item)=>(
        <div key={u.id} className="row-item-static">
         <div className="row-main">
          <strong>{u.name}{u.id===me.id?' (you)':''}</strong>
          <small>{label(u.role)}</small>
         </div>
         <span className="tag">{label(u.role)}</span>
        </div>
       ))}
      </div>
     </section>
    </div>
   )}

   {tab==='devices'&&(
    <div className="stack-md">
     <div className="section-bar">
      <h2 className="section-title">Trusted Devices</h2>
      <button type="button" className="btn btn-primary btn-sm" onClick={()=>void createInvite(true)}><Plus size={14}/><span>Add device</span></button>
     </div>
     <section className="card">
      <div className="list-divide">
       {access?.devices?.map((d:Item)=>(
        <div key={d.id} className="row-item-static">
         <Shield size={15}/>
         <div className="row-main">
          <strong>{d.name}</strong>
          <small>Added {new Date(d.created).toLocaleString()}</small>
         </div>
         <button
          type="button"
          className="btn btn-sm"
          onClick={()=>void run(async()=>{
           await api(`/devices/${d.id}`,'DELETE');
           setAccess(await api('/access'));
          })}
         >
          Revoke
         </button>
        </div>
       ))}
      </div>
     </section>
    </div>
   )}

   {tab==='system'&&isAdmin&&(
    <div className="stack-md">
     <div className="section-bar">
      <h2 className="section-title">Self-Hosting & Releases</h2>
      <div className="toolbar-actions">
       <button type="button" className="btn btn-sm" onClick={onTriggerReload} disabled={reloading}>
        <RotateCw size={13} className={reloading?'spin':''}/>
        <span>{reloading?'Restarting…':'Restart service'}</span>
       </button>
       {!selfData.repo&&(
        <button
         type="button"
         className="btn btn-primary btn-sm"
         onClick={()=>void run(async()=>{
          await api('/self/register','POST',{});
          await refresh();
          setSelfData(await api('/self'));
         },'Registered Orchestra repository')}
        >
         <span>Register Orchestra repo</span>
        </button>
       )}
      </div>
     </div>

     {selfData.repo&&(
      <section className="card padded stack-sm">
       <Field label="Build release from merged change request">
        <div style={{display:'flex',gap:8}}>
         <select style={{flex:1}} value={selectedMerge} onChange={e=>setSelectedMerge(e.target.value)}>
          <option value="">Select merged change request…</option>
          {state.changes.filter((c:Item)=>c.repoId===selfData.repo.id&&c.status==='merged').map((c:Item)=>(
           <option key={c.id} value={c.id}>{c.title}</option>
          ))}
         </select>
         <button
          type="button"
          className="btn btn-primary btn-sm"
          disabled={!selectedMerge}
          onClick={()=>void run(async()=>{
           await api('/self/build','POST',{changeId:selectedMerge});
           setSelfData(await api('/self'));
          },'Release build started')}
         >
          <span>Build release</span>
         </button>
        </div>
       </Field>
      </section>
     )}
    </div>
   )}
  </div>
 );
}

function InviteLinkModal({title,url,onClose}:{title:string,url:string,onClose:()=>void}){
 const [copied,setCopied]=useState(false);
 return (
  <Modal title={title} onClose={onClose}>
   <p className="muted">Single-use invitation link (expires in 24 hours):</p>
   <textarea readOnly rows={3} value={url} style={{marginTop:8}}/>
   <div className="form-actions" style={{marginTop:12}}>
    <button
     type="button"
     className="btn btn-primary"
     onClick={async()=>{
      try{await navigator.clipboard.writeText(url);setCopied(true);}catch{}
     }}
    >
     {copied?<Check size={14}/>:<Copy size={14}/>}
     <span>{copied?'Copied':'Copy link'}</span>
    </button>
   </div>
  </Modal>
 );
}

export function WelcomeScreen({onLogin}:{onLogin:(u:Item)=>void}){
 const [secret]=useState(()=>location.hash.slice(1));
 const [tokenVal,setTokenVal]=useState('');
 const [name,setName]=useState('');
 const {busy,error,submit}=useSubmit();

 useEffect(()=>{
  if(secret)history.replaceState(null,'',location.pathname);
 },[secret]);

 return (
  <div className="auth-screen">
   <form
    className="card padded auth-card stack-md"
    onSubmit={e=>{
     e.preventDefault();
     void submit(async()=>{
      const res=await api('/redeem','POST',{token:secret||tokenVal.trim(),name:name.trim()});
      localStorage.setItem('relay.device',res.token);
      onLogin(res.user);
     });
    }}
   >
    <div className="auth-brand">
     <span className="brand-mark"><GitBranch size={18}/></span>
     <div>
      <h1>Orchestra</h1>
      <p className="muted">Sign in with a device invitation token.</p>
     </div>
    </div>
    <ErrorNote>{error}</ErrorNote>
    {!secret&&(
     <Field label="Invitation token">
      <input required value={tokenVal} onChange={e=>setTokenVal(e.target.value)} placeholder="Paste invitation token…"/>
     </Field>
    )}
    <Field label="Display name">
     <input required value={name} onChange={e=>setName(e.target.value)} placeholder="Your name"/>
    </Field>
    <button type="submit" className="btn btn-primary" disabled={busy}>
     {busy&&<RotateCw size={13} className="spin"/>}
     <span>Continue</span>
    </button>
   </form>
  </div>
 );
}
