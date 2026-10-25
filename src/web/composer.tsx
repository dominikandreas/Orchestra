import React,{useState,useEffect,useRef} from 'react';
import {Bot,Sparkles,Brain,Shield,GitBranch,ArrowUp,CornerDownLeft,Square,GitPullRequest,SlidersHorizontal,FolderGit2,Wrench} from 'lucide-react';
import {api,autonomyModes,autonomyLabel,jobKinds,kindLabel,thinkingLevels,thinkingLabel,modelsFor,imagePayload,cx,type Item} from './lib';
import {Picker,Popover,Field,Spinner,ErrorNote,useWorkspace} from './ui';
import {useAttachmentState,AttachmentInput} from './attachments';
import {VoiceButton} from './voice';

/** Flatten all available models across connected providers so the user can pick any model in 1 click, or fall back to repo default. */
export function buildModelChoices(connections:Item[],catalog:Item[],repo?:Item){
 const connected=connections.filter(c=>c.status==='connected');
 const list:{value:string,connectionId:string,model:string,label:string,hint:string,reasoning:boolean}[]=[];
 for(const conn of connected){
  const models=modelsFor(conn,catalog);
  for(const m of models){
   list.push({
    value:`${conn.id}::${m.id}`,
    connectionId:conn.id,
    model:m.id,
    label:m.reasoning?`${m.name||m.id} (reasoning)`:(m.name||m.id),
    hint:conn.name,
    reasoning:Boolean(m.reasoning)
   });
  }
 }
 return list;
}

export function NewSessionComposer({
 defaultRepoId,
 defaultChangeId,
 defaultKind='implement',
 defaultAgentId='',
 defaultTitle='',
 defaultPrompt='',
 compact=false,
 autoFocus=false,
 onCreated,
 onCancel
}:{
 defaultRepoId?:string,
 defaultChangeId?:string,
 defaultKind?:string,
 defaultAgentId?:string,
 defaultTitle?:string,
 defaultPrompt?:string,
 compact?:boolean,
 autoFocus?:boolean,
 onCreated:(jobId:string)=>void,
 onCancel?:()=>void
}){
 const {state,catalog,project}=useWorkspace();
 const readyRepos=state.repos.filter((r:Item)=>r.status==='ready'&&(project==='all'||r.projectId===project));
 const allReadyRepos=readyRepos.length?readyRepos:state.repos.filter((r:Item)=>r.status==='ready');

 const [repoId,setRepoId]=useState(defaultRepoId||allReadyRepos[0]?.id||'');
 const repo=state.repos.find((r:Item)=>r.id===repoId)||allReadyRepos[0];

 const visibleAgents=(state.agents||[]).filter((a:Item)=>!a.projectId||a.projectId===repo?.projectId);
 const [agentId,setAgentId]=useState(defaultAgentId);
 const [kind,setKind]=useState(defaultKind);
 const [title,setTitle]=useState(defaultTitle);
 const [showTitle,setShowTitle]=useState(Boolean(defaultTitle));
 const [prompt,setPrompt]=useState(defaultPrompt);
 const [connectionId,setConnectionId]=useState(repo?.connectionId||state.connections.find((c:Item)=>c.status==='connected')?.id||'');
 const [model,setModel]=useState(repo?.model||'');
 const [thinkingLevel,setThinkingLevel]=useState(repo?.thinkingLevel||'off');
 const [autonomy,setAutonomy]=useState(repo?.autonomy||'prepare');
 const [targetBranch,setTargetBranch]=useState('auto');
 const [sourceBranch,setSourceBranch]=useState('auto');
 const [branches,setBranches]=useState<string[]>([]);
 const [busy,setBusy]=useState(false);
 const [error,setError]=useState('');
 const attachments=useAttachmentState();
 const textareaRef=useRef<HTMLTextAreaElement>(null);

 useEffect(()=>{
  if(!repoId&&allReadyRepos[0]?.id)setRepoId(allReadyRepos[0].id);
 },[allReadyRepos.length]);

 useEffect(()=>{
  if(!repo)return;
  if(!agentId){
   if(repo.connectionId)setConnectionId(repo.connectionId);
   if(repo.model)setModel(repo.model);
   if(repo.thinkingLevel)setThinkingLevel(repo.thinkingLevel);
   if(repo.autonomy)setAutonomy(repo.autonomy);
  }
  api(`/repos/${repo.id}/inspect`).then(x=>{if(Array.isArray(x?.branches))setBranches(x.branches);}).catch(()=>{});
 },[repo?.id]);

 const applyAgent=(nextAgentId:string)=>{
  setAgentId(nextAgentId);
  const ag=visibleAgents.find((a:Item)=>a.id===nextAgentId);
  if(ag){
   if(ag.kind)setKind(ag.kind);
   if(ag.connectionId)setConnectionId(ag.connectionId);
   if(ag.model)setModel(ag.model);
   if(ag.thinkingLevel)setThinkingLevel(ag.thinkingLevel);
   if(ag.autonomy)setAutonomy(ag.autonomy);
  }else if(repo){
   if(repo.connectionId)setConnectionId(repo.connectionId);
   if(repo.model)setModel(repo.model);
   if(repo.thinkingLevel)setThinkingLevel(repo.thinkingLevel);
   if(repo.autonomy)setAutonomy(repo.autonomy);
  }
 };

 const modelChoices=buildModelChoices(state.connections,catalog,repo);
 const currentModelKey=connectionId&&model?`${connectionId}::${model}`:'';
 const selectedModelLabel=model||(repo?.model?`${repo.model}`:'Default model');

 const handleSubmit=async(e?:React.FormEvent)=>{
  e?.preventDefault();
  if(!repo?.id){setError('Connect a repository first.');return;}
  const text=prompt.trim()||(attachments.images.length||attachments.attachments.length?'(See attachments)':'');
  if(!text||busy)return;
  setBusy(true);setError('');
  try{
   const job=await api('/jobs','POST',{
    repoId:repo.id,
    changeId:defaultChangeId||undefined,
    agentId:agentId||undefined,
    kind,
    title:title.trim()||prompt.trim().split('\n')[0].slice(0,90)||'Session',
    prompt:text,
    connectionId:connectionId||undefined,
    model:model||undefined,
    thinkingLevel,
    autonomy,
    targetBranch:targetBranch==='auto'?undefined:targetBranch,
    sourceBranch:sourceBranch==='auto'?undefined:sourceBranch,
    images:imagePayload(attachments.images),
    attachments:attachments.attachments
   });
   setPrompt('');
   setTitle('');
   attachments.clear();
   onCreated(job.id);
  }catch(err){
   setError((err as Error).message);
  }finally{
   setBusy(false);
  }
 };

 return (
  <form
   className={cx('composer-card',compact&&'composer-compact')}
   onSubmit={handleSubmit}
   onPaste={attachments.handlePaste}
   onDrop={attachments.handleDrop}
   onDragOver={e=>e.preventDefault()}
  >
   {showTitle?(
    <div className="composer-title-row">
     <input
      type="text"
      className="composer-title-input"
      placeholder="Session name (optional)…"
      value={title}
      onChange={e=>setTitle(e.target.value)}
     />
    </div>
   ):null}
   <textarea
    ref={textareaRef}
    autoFocus={autoFocus}
    rows={compact?3:4}
    className="composer-textarea"
    placeholder={repo?`Instruct an agent in ${repo.name}… (Markdown & LaTeX supported, ⌘Enter to send)`:'Connect a repository to start a session…'}
    value={prompt}
    onChange={e=>setPrompt(e.target.value)}
    onKeyDown={e=>{
     if((e.metaKey||e.ctrlKey)&&e.key==='Enter'){
      e.preventDefault();
      void handleSubmit();
     }
    }}
   />
   <ErrorNote>{error}</ErrorNote>
   <div className="composer-toolbar">
    <div className="composer-chips">
     {allReadyRepos.length>0&&(
      <Picker
       icon={<FolderGit2 size={12}/>}
       title="Repository"
       value={repo?.id||''}
       options={allReadyRepos.map((r:Item)=>({value:r.id,label:r.name,hint:r.base}))}
       onChange={setRepoId}
      />
     )}
     <Picker
      icon={<Bot size={12}/>}
      title="Agent definition"
      value={agentId}
      placeholder="Default agent"
      options={[
       {value:'',label:'Default agent',hint:'Standard engineer'},
       ...visibleAgents.map((a:Item)=>({value:a.id,label:a.name,hint:kindLabel(a.kind)}))
      ]}
      onChange={applyAgent}
     />
     <Picker
      icon={<Wrench size={12}/>}
      title="Session mode"
      value={kind}
      options={jobKinds.map(k=>({value:k.value,label:k.label}))}
      onChange={setKind}
     />
     <Picker
      icon={<Sparkles size={12}/>}
      title="Model"
      value={currentModelKey}
      placeholder={selectedModelLabel}
      options={[
       {value:'',label:repo?.model?`Repo default (${repo.model})`:'Repo default',hint:'Auto'},
       ...modelChoices.map(m=>({value:m.value,label:m.label,hint:m.hint}))
      ]}
      onChange={val=>{
       if(!val){
        setConnectionId(repo?.connectionId||'');
        setModel(repo?.model||'');
        if(repo?.thinkingLevel)setThinkingLevel(repo.thinkingLevel);
        return;
       }
       const [cId,mId]=val.split('::');
       setConnectionId(cId);
       setModel(mId);
       const choice=modelChoices.find(c=>c.value===val);
       if(choice?.reasoning && thinkingLevel==='off'){
        setThinkingLevel('medium');
       }
      }}
     />
     <Picker
      icon={<Brain size={12}/>}
      title="Thinking effort"
      value={thinkingLevel}
      options={thinkingLevels.map(v=>({value:v,label:`Thinking: ${thinkingLabel[v]}`}))}
      onChange={setThinkingLevel}
     />
     <Picker
      icon={<Shield size={12}/>}
      title="Autonomy level"
      value={autonomy}
      options={autonomyModes.map(m=>({value:m.value,label:m.label,hint:m.description}))}
      onChange={setAutonomy}
     />
     {!defaultChangeId&&(
      <Popover
       trigger={(open,toggle)=>(
        <button type="button" className={cx('chip',open&&'active')} onClick={toggle} title="Branch options">
         <GitBranch size={12}/>
         <span className="chip-text">{targetBranch==='auto'?(repo?.base||'main'):targetBranch}</span>
        </button>
       )}
      >
       {()=>(
        <div className="popover-form">
         <Field label="Target branch">
          <select value={targetBranch} onChange={e=>setTargetBranch(e.target.value)}>
           <option value="auto">Default ({repo?.base||'main'})</option>
           {branches.map(b=><option key={b} value={b}>{b}</option>)}
          </select>
         </Field>
         <Field label="Source branch">
          <select value={sourceBranch} onChange={e=>setSourceBranch(e.target.value)}>
           <option value="auto">New isolated branch</option>
           {branches.filter(b=>b!==repo?.base).map(b=><option key={b} value={b}>{b}</option>)}
          </select>
         </Field>
        </div>
       )}
      </Popover>
     )}
     {!showTitle&&(
      <button type="button" className="chip" onClick={()=>setShowTitle(true)} title="Set custom session name">
       <span>Name</span>
      </button>
     )}
    </div>
    <div className="composer-right">
     <AttachmentInput
      images={attachments.images}
      attachments={attachments.attachments}
      onAdd={attachments.addFiles}
      onRemoveImage={attachments.removeImage}
      onRemoveAttachment={attachments.removeAttachment}
      disabled={busy}
     />
     <VoiceButton
      disabled={busy}
      onTranscript={chunk=>setPrompt(p=>p?`${p.trimEnd()} ${chunk}`:chunk)}
     />
     {onCancel&&<button type="button" className="btn btn-sm" onClick={onCancel} disabled={busy}>Cancel</button>}
     <button
      type="submit"
      className="btn btn-primary btn-sm"
      disabled={busy||!repo||(!prompt.trim()&&!attachments.images.length&&!attachments.attachments.length)}
     >
      {busy?<Spinner size={13}/>:<ArrowUp size={14}/>}
      <span>Start session</span>
     </button>
    </div>
   </div>
  </form>
 );
}

export function SessionComposer({
 job,
 repo,
 canOperate,
 onReload,
 onOpenChange,
 onOpenModelModal
}:{
 job:Item,
 repo?:Item,
 canOperate:boolean,
 onReload:()=>Promise<void>,
 onOpenChange:(id:string)=>void,
 onOpenModelModal:()=>void
}){
 const {notify,refresh}=useWorkspace();
 const [text,setText]=useState('');
 const [busy,setBusy]=useState(false);
 const [submittingCr,setSubmittingCr]=useState(false);
 const attachments=useAttachmentState();
 const isRunning=job.status==='running';

 const sendAction=async(action:'steer'|'followup'|'resume'|'approve')=>{
  const bodyText=text.trim()||(attachments.images.length||attachments.attachments.length?'(See attachments)':'');
  if(!bodyText&&action!=='approve'&&action!=='resume')return;
  setBusy(true);
  try{
   await api(`/jobs/${job.id}/action`,'POST',{
    action,
    text:bodyText||undefined,
    images:attachments.images.length?imagePayload(attachments.images):undefined,
    attachments:attachments.attachments.length?attachments.attachments:undefined
   });
   setText('');
   attachments.clear();
   await onReload();
   await refresh();
  }catch(err){
   notify((err as Error).message,'bad');
  }finally{
   setBusy(false);
  }
 };

 const handleThinkingChange=async(nextThinking:string)=>{
  try{
   await api(`/jobs/${job.id}`,'PATCH',{thinkingLevel:nextThinking});
   await onReload();
   notify(`Thinking effort set to ${thinkingLabel[nextThinking]||nextThinking}`);
  }catch(err){
   notify((err as Error).message,'bad');
  }
 };

 const handleSubmitChange=async()=>{
  setSubmittingCr(true);
  try{
   const res=await api(`/jobs/${job.id}/submit-change`,'POST',{});
   await onReload();
   await refresh();
   notify(job.changeId?'Change request updated':'Change request created');
   if(res.change?.id)onOpenChange(res.change.id);
  }catch(err){
   notify((err as Error).message,'bad');
  }finally{
   setSubmittingCr(false);
  }
 };

 if(!canOperate)return null;

 return (
  <form
   className="composer-card session-composer"
   onSubmit={e=>{
    e.preventDefault();
    void sendAction(isRunning?'steer':job.status==='awaiting_approval'?'approve':'resume');
   }}
   onPaste={attachments.handlePaste}
   onDrop={attachments.handleDrop}
   onDragOver={e=>e.preventDefault()}
  >
   <textarea
    rows={2}
    className="composer-textarea"
    placeholder={isRunning?'Steer the running session or queue a follow-up… (⌘Enter to steer)':'Send a follow-up instruction to continue this session… (⌘Enter to send)'}
    value={text}
    onChange={e=>setText(e.target.value)}
    onKeyDown={e=>{
     if((e.metaKey||e.ctrlKey)&&e.key==='Enter'){
      e.preventDefault();
      void sendAction(isRunning?'steer':job.status==='awaiting_approval'?'approve':'resume');
     }
    }}
   />
   <div className="composer-toolbar">
    <div className="composer-chips">
     <button type="button" className="chip" onClick={onOpenModelModal} title="Switch model or connection">
      <Sparkles size={12}/>
      <span className="chip-text">{job.model||repo?.model||'Select model'}</span>
      <SlidersHorizontal size={11}/>
     </button>
     <Picker
      placement="top"
      icon={<Brain size={12}/>}
      title="Thinking effort (live adjustable)"
      value={job.thinkingLevel||'off'}
      options={thinkingLevels.map(v=>({value:v,label:`Thinking: ${thinkingLabel[v]}`}))}
      onChange={handleThinkingChange}
     />
     <button
      type="button"
      className="chip"
      disabled={isRunning||submittingCr||!job.path}
      onClick={handleSubmitChange}
      title={isRunning?'Wait for the current turn to complete before submitting a change request':'Commit worktree changes and open/update a change request'}
     >
      <GitPullRequest size={12}/>
      <span>{submittingCr?'Submitting…':job.changeId?'Update CR':'Create CR'}</span>
     </button>
    </div>
    <div className="composer-right">
     <AttachmentInput
      images={attachments.images}
      attachments={attachments.attachments}
      onAdd={attachments.addFiles}
      onRemoveImage={attachments.removeImage}
      onRemoveAttachment={attachments.removeAttachment}
      disabled={busy}
     />
     <VoiceButton
      disabled={busy}
      onTranscript={chunk=>setText(t=>t?`${t.trimEnd()} ${chunk}`:chunk)}
     />
     {isRunning&&(
      <>
       <button
        type="button"
        className="btn btn-sm"
        disabled={busy||(!text.trim()&&!attachments.images.length&&!attachments.attachments.length)}
        onClick={()=>void sendAction('followup')}
        title="Queue message after the current turn completes"
       >
        <CornerDownLeft size={13}/>
        <span>Queue</span>
       </button>
       <button
        type="button"
        className="btn btn-sm btn-danger"
        onClick={()=>void api(`/jobs/${job.id}/action`,'POST',{action:'cancel'}).then(onReload)}
        title="Stop current execution"
       >
        <Square size={12}/>
        <span>Stop</span>
       </button>
      </>
     )}
     <button
      type="submit"
      className="btn btn-primary btn-sm"
      disabled={busy||(isRunning&&!text.trim()&&!attachments.images.length&&!attachments.attachments.length)}
     >
      {busy?<Spinner size={13}/>:<ArrowUp size={14}/>}
      <span>{isRunning?'Steer':job.status==='awaiting_approval'?'Approve':'Send'}</span>
     </button>
    </div>
   </div>
  </form>
 );
}
