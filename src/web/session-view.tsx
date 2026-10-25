import React,{useState,useEffect,useCallback,useRef} from 'react';
import {
 ArrowLeft,ArrowRight,GitBranch,GitFork,GitPullRequest,Sparkles,Bot,
 Check,AlertCircle,Square,Play,Rocket,Archive,Pencil,Terminal,
 FileCode2,CheckCheck,SlidersHorizontal,Brain,Clock,Layers
} from 'lucide-react';
import {api,token,ago,short,kindLabel,thinkingLevels,thinkingLabel,modelsFor,cx,type Item} from './lib';
import {Status,Dot,Tabs,Modal,Field,Spinner,Empty,ErrorNote,useWorkspace} from './ui';
import {Markdown} from './markdown';
import {MessageAttachments} from './attachments';
import {isSubagent,SubagentCard,getSubagentActivityText,parseSubagentInfo,formatToolData} from './subagent';
import {SessionComposer} from './composer';

export function SwitchModelModal({item,onClose,onSaved}:{item:Item,onClose:()=>void,onSaved:(model:string,resumed:boolean)=>Promise<void>}){
 const {state,catalog}=useWorkspace();
 const repo=state.repos.find((r:Item)=>r.id===item.repoId);
 const connected=state.connections.filter((c:Item)=>c.status==='connected');
 const [connectionId,setConnectionId]=useState(item.connectionId||repo?.connectionId||connected[0]?.id||'');
 const [model,setModel]=useState(item.model||repo?.model||'');
 const [thinkingLevel,setThinkingLevel]=useState(item.thinkingLevel||repo?.thinkingLevel||'off');
 const [busy,setBusy]=useState(false);
 const [err,setErr]=useState('');

 const selectedConn=state.connections.find((c:Item)=>c.id===connectionId);
 const modelOptions=modelsFor(selectedConn,catalog);

 const save=async(andResume=false)=>{
  if(!model.trim()){setErr('Select a model.');return;}
  setBusy(true);setErr('');
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
   await onSaved(model.trim(),andResume);
   onClose();
  }catch(e){
   setErr((e as Error).message);
  }finally{
   setBusy(false);
  }
 };

 return (
  <Modal
   title="Model & thinking settings"
   onClose={onClose}
   footer={
    <>
     <button type="button" className="btn" onClick={onClose} disabled={busy}>Cancel</button>
     <button type="button" className={cx('btn',item.status==='running'&&'btn-primary')} disabled={busy||!model} onClick={()=>void save(false)}>
      {busy&&<Spinner/>}
      <span>{item.status==='running'?'Apply to running session':'Save'}</span>
     </button>
     {['failed','blocked','interrupted','awaiting_approval','cancelled','idle'].includes(item.status)&&(
      <button type="button" className="btn btn-primary" disabled={busy||!model} onClick={()=>void save(true)}>
       {busy?<Spinner/>:<Play size={13}/>}
       <span>Save & resume</span>
      </button>
     )}
    </>
   }
  >
   <ErrorNote>{err}</ErrorNote>
   <Field label="Provider connection">
    <select
     value={connectionId}
     onChange={e=>{
      const nextId=e.target.value;
      setConnectionId(nextId);
      const conn=state.connections.find((c:Item)=>c.id===nextId);
      const opts=modelsFor(conn,catalog);
      setModel(opts[0]?.id||'');
     }}
    >
     {connected.map((c:Item)=><option key={c.id} value={c.id}>{c.name}</option>)}
    </select>
   </Field>
   <Field label="Model">
    <select value={model} onChange={e=>{
     const nextModel=e.target.value;
     setModel(nextModel);
     const m=modelOptions.find((x:Item)=>x.id===nextModel);
     if(m?.reasoning && thinkingLevel==='off'){
      setThinkingLevel('medium');
     }
    }}>
     <option value="">Select model</option>
     {modelOptions.map((m:Item)=><option key={m.id} value={m.id}>{m.reasoning?`${m.name||m.id} (reasoning)`:(m.name||m.id)}</option>)}
    </select>
   </Field>
   <Field label="Thinking effort" hint="Applies to reasoning-capable models; can be adjusted while a session is running.">
    <select value={thinkingLevel} onChange={e=>setThinkingLevel(e.target.value)}>
     {thinkingLevels.map(v=><option key={v} value={v}>{thinkingLabel[v]} ({v})</option>)}
    </select>
   </Field>
  </Modal>
 );
}

export function ThinkingBlock({
 text,
 isLive=false,
 defaultOpen
}:{
 text:string,
 isLive?:boolean,
 defaultOpen?:boolean
}){
 const [userOpen,setUserOpen]=useState<boolean|null>(null);
 const scrollRef=useRef<HTMLDivElement>(null);
 const isOpen = userOpen !== null ? userOpen : (defaultOpen !== undefined ? defaultOpen : isLive);

 useEffect(()=>{
  if(isLive && isOpen && scrollRef.current){
   scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }
 },[text,isLive,isOpen]);

 return (
  <details
   className={cx('trace-thinking',isLive&&'trace-thinking-live')}
   open={isOpen}
   onToggle={e=>setUserOpen((e.currentTarget as HTMLDetailsElement).open)}
  >
   <summary>
    <Brain size={13} className={isLive?'pulse-icon tone-warn-text':''}/>
    <span className="trace-thinking-title">{isLive?'Reasoning…':'Reasoning'}</span>
    <span className="trace-meta">
     {isLive&&<span className="live-dot-mini" title="Streaming reasoning deltas"/>}
     {text.length.toLocaleString()} chars
    </span>
   </summary>
   <div className="trace-thinking-body" ref={scrollRef}>
    <div className="trace-thinking-stream">
     {text}
     {isLive&&<span className="streaming-cursor"/>}
    </div>
   </div>
  </details>
 );
}

export function DiffBlock({diff}:{diff?:string}){
 if(!diff||!diff.trim())return <div className="diff-empty">No diff changes between these revisions.</div>;
 const lines=diff.split('\n');
 return (
  <pre className="diff-code">
   {lines.map((line,i)=>{
    const cls=
     line.startsWith('+++')||line.startsWith('---')||line.startsWith('diff --git')?'diff-meta':
     line.startsWith('@@')?'diff-hunk':
     line.startsWith('+')?'diff-add':
     line.startsWith('-')?'diff-del':'';
    return <div key={i} className={cls}>{line||' '}</div>;
   })}
  </pre>
 );
}

export function SessionView({id}:{id:string}){
 const {state,go,notify,refresh,run,canEdit}=useWorkspace();
 const [item,setItem]=useState<Item|null>(null);
 const [events,setEvents]=useState<any[]>([]);
 const [tab,setTab]=useState('conversation');
 const [error,setError]=useState('');
 const [editingTitle,setEditingTitle]=useState(false);
 const [titleDraft,setTitleDraft]=useState('');
 const [modelModal,setModelModal]=useState(false);
 const [forking,setForking]=useState(false);
 const [diffData,setDiffData]=useState<Item|null>(null);
 const [loadingDiff,setLoadingDiff]=useState(false);
 const endRef=useRef<HTMLDivElement>(null);

 const load=useCallback(async()=>{
  try{
   const x=await api(`/jobs/${id}`);
   setItem(x);
   if(x.events){
    setEvents(old=>{
     if(!old.length)return x.events;
     const known=new Set(old.map((e:any)=>e.seq));
     const added=x.events.filter((e:any)=>!known.has(e.seq));
     return added.length?[...old,...added].sort((a:any,b:any)=>a.seq-b.seq):old;
    });
   }
  }catch(e){
   setError((e as Error).message);
  }
 },[id]);

 const loadDiff=useCallback(async()=>{
  setLoadingDiff(true);
  try{
   const d=await api(`/jobs/${id}/diff`);
   setDiffData(d);
  }catch{
   setDiffData(null);
  }finally{
   setLoadingDiff(false);
  }
 },[id]);

 useEffect(()=>{
  setItem(null);
  setEvents([]);
  setDiffData(null);
  setTab('conversation');
  setEditingTitle(false);
  void load();
  const t=setInterval(load,3000);
  return ()=>clearInterval(t);
 },[load]);

 useEffect(()=>{
  if(tab==='changes')void loadDiff();
 },[tab,loadDiff,item?.status,item?.updated]);

 // Live SSE stream for active session events
 useEffect(()=>{
  const controller=new AbortController();
  let after=0;
  const connect=async()=>{
   while(!controller.signal.aborted){
    try{
     const res=await fetch(`/api/jobs/${id}/events?after=${after}`,{
      headers:{Authorization:`Bearer ${token()}`},
      signal:controller.signal
     });
     if(!res.ok)break;
     const reader=res.body!.getReader();
     const decoder=new TextDecoder();
     let buf='';
     while(true){
      const {value,done}=await reader.read();
      if(done)break;
      buf+=decoder.decode(value,{stream:true});
      let end;
      while((end=buf.indexOf('\n\n'))>=0){
       const block=buf.slice(0,end);
       buf=buf.slice(end+2);
       const dataLine=block.split('\n').find(s=>s.startsWith('data: '));
       if(dataLine){
        const e=JSON.parse(dataLine.slice(6));
        after=e.seq;
        setEvents(old=>old.some(x=>x.seq===e.seq)?old:[...old,e]);
       }
      }
     }
    }catch{}
    if(!controller.signal.aborted)await new Promise(r=>setTimeout(r,2000));
   }
  };
  void connect();
  return ()=>controller.abort();
 },[id]);

 useEffect(()=>{
  if(tab==='conversation'){
   endRef.current?.scrollIntoView({behavior:'smooth',block:'nearest'});
  }
 },[events.length,tab,item?.status]);

 if(error){
  return (
   <div className="page-body">
    <button type="button" className="btn btn-sm" onClick={()=>go('sessions')}><ArrowLeft size={14}/><span>Sessions</span></button>
    <ErrorNote>{error}</ErrorNote>
   </div>
  );
 }
 if(!item){
  return <div className="page-loading"><Spinner size={18}/><span>Loading session…</span></div>;
 }

 const repo=state.repos.find((r:Item)=>r.id===item.repoId);
 const agent=(state.agents||[]).find((a:Item)=>a.id===item.agentId);
 const parentFork=item.forkedFrom?state.jobs.find((j:Item)=>j.id===item.forkedFrom):null;
 const childForks=state.jobs.filter((j:Item)=>j.forkedFrom===item.id);
 const parentJob=item.parentJobId?state.jobs.find((j:Item)=>j.id===item.parentJobId):null;
 const childJobs=state.jobs.filter((j:Item)=>j.parentJobId===item.id);

 // Correlate event stream into structured conversation entries
 const transcript:any[]=[];
 for(const e of events){
  if(e.type==='text'){
   if(transcript.at(-1)?.type==='text')transcript.at(-1).data+=e.data;
   else transcript.push({...e});
  }else if(e.type==='thinking'){
   if(transcript.at(-1)?.type==='thinking')transcript.at(-1).data+=e.data;
   else transcript.push({...e});
  }else if(e.type==='tool'){
   transcript.push({
    ...e,
    toolId:e.data?.id||e.data?.callId||e.data?.toolCallId,
    name:e.data?.name||'tool',
    args:e.data?.args,
    partialUpdate:''
   });
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
   if(target){
    target.result=e.data?.result;
    target.isError=e.data?.isError;
    target.durationMs=e.data?.durationMs;
   }else{
    transcript.push({...e});
   }
  }else{
   transcript.push({...e});
  }
 }

 const subagentCalls=transcript.filter(e=>e.type==='tool'&&isSubagent(e.name,e.args));
 const hasFinalInStream=transcript.some(e=>e.type==='result'||(e.type==='text'&&item.result&&e.data.trim()===item.result.trim()));

 const lastEvent=transcript.at(-1);
 let currentActivity='Running…';
 if(lastEvent?.type==='thinking')currentActivity='Reasoning…';
 else if(lastEvent?.type==='tool'){
  if(isSubagent(lastEvent.name,lastEvent.args)){
   const sInfo=parseSubagentInfo(lastEvent,item.status==='running');
   currentActivity=sInfo?getSubagentActivityText(sInfo):'Subagent running…';
  }else{
   const tName=lastEvent.name;
   if(tName==='workspace'||tName==='run_command'||tName==='bash'){
    const cmd=lastEvent.args?.command||lastEvent.args?.cmd||'';
    currentActivity=cmd?`Running: ${cmd.slice(0,55)}`:'Running command…';
   }else{
    currentActivity=`Running ${tName}…`;
   }
  }
 }else if(lastEvent?.type==='text'){
  currentActivity='Streaming response…';
 }

 const saveTitle=async()=>{
  setEditingTitle(false);
  const trimmed=titleDraft.trim();
  if(!trimmed||trimmed===item.title)return;
  try{
   await api(`/jobs/${item.id}`,'PATCH',{title:trimmed});
   await load();
   await refresh();
  }catch(err){
   notify((err as Error).message,'bad');
  }
 };

 const handleFork=async(customTitle?:string)=>{
  if(forking)return;
  setForking(true);
  try{
   const forked=await api(`/jobs/${item.id}/fork`,'POST',customTitle?{title:customTitle}:{});
   await refresh();
   notify(`Forked session "${forked.title}"`);
   go('sessions',forked.id);
  }catch(err){
   notify((err as Error).message,'bad');
  }finally{
   setForking(false);
  }
 };

 const hierarchyCount=subagentCalls.length+childForks.length+childJobs.length+(parentFork?1:0)+(parentJob?1:0);

 return (
  <div className="session-page">
   <header className="session-header">
    <div className="session-header-top">
     <div className="session-breadcrumb">
      <button type="button" className="crumb-btn" onClick={()=>go('sessions')}>
       <ArrowLeft size={13}/>
       <span>Sessions</span>
      </button>
      <span className="crumb-sep">/</span>
      <span className="crumb-repo">{repo?.name||'Repository'}</span>
      <span className="tag">{kindLabel(item.kind)}</span>
      {agent&&<span className="tag tag-accent" title={agent.description||agent.instructions}><Bot size={11}/>{agent.name}</span>}
      <Status value={item.status}/>
      <span className="muted-meta">{ago(item.created)}</span>
     </div>

     <div className="session-actions">
      {item.changeId&&(
       <button type="button" className="btn btn-sm" onClick={()=>go('changes',item.changeId)} title="Open linked change request">
        <GitPullRequest size={13}/>
        <span>CR #{short(item.changeId)}</span>
       </button>
      )}
      {canEdit&&(
       <>
        <button
         type="button"
         className="btn btn-sm"
         disabled={forking}
         onClick={()=>void handleFork()}
         title="Fork session worktree and conversation history into a new independent branch"
        >
         {forking?<Spinner size={13}/>:<GitFork size={13}/>}
         <span>Fork</span>
        </button>
        <button
         type="button"
         className="btn btn-sm"
         onClick={()=>void run(async()=>{
          await api('/deployments','POST',{
           repoId:item.repoId,
           jobId:item.id,
           branch:(item.sourceBranch&&item.sourceBranch!=='auto')?item.sourceBranch:undefined
          });
         },'Deployment starting')}
         title="Deploy this session's branch in a live container"
        >
         <Rocket size={13}/>
         <span>Deploy</span>
        </button>
        <button
         type="button"
         className="btn btn-sm"
         onClick={()=>setModelModal(true)}
         title="Configure model and thinking effort"
        >
         <SlidersHorizontal size={13}/>
         <span>{item.model||repo?.model||'Model'}</span>
         {item.thinkingLevel&&item.thinkingLevel!=='off'&&<span className="pill-mini">{thinkingLabel[item.thinkingLevel]||item.thinkingLevel}</span>}
        </button>
        {canEdit&&(
         <select
          className="select-compact"
          aria-label="Thinking effort"
          value={item.thinkingLevel||repo?.thinkingLevel||'off'}
          title="Adjust thinking effort"
          onChange={e=>{
           const nextLevel=e.target.value;
           void run(async()=>{
            await api(`/jobs/${item.id}`,'PATCH',{thinkingLevel:nextLevel});
            await load();
           },`Thinking effort set to ${thinkingLabel[nextLevel]||nextLevel}`);
          }}
         >
          {thinkingLevels.map(v=><option key={v} value={v}>Thinking: {thinkingLabel[v]}</option>)}
         </select>
        )}
        <button
         type="button"
         className={cx('icon-btn',item.archived&&'active')}
         onClick={()=>void run(()=>api(`/jobs/${item.id}`,'PATCH',{archived:!item.archived}).then(load),item.archived?'Session restored':'Session archived')}
         title={item.archived?'Unarchive session':'Archive session'}
        >
         <Archive size={14}/>
        </button>
        {item.status==='running'?(
         <button type="button" className="btn btn-sm btn-danger" onClick={()=>void run(()=>api(`/jobs/${item.id}/action`,'POST',{action:'cancel'}).then(load))}>
          <Square size={12}/>
          <span>Stop</span>
         </button>
        ):['blocked','failed','interrupted','awaiting_approval'].includes(item.status)?(
         <button
          type="button"
          className="btn btn-sm btn-primary"
          onClick={()=>void run(()=>api(`/jobs/${item.id}/action`,'POST',{action:item.status==='awaiting_approval'?'approve':'resume'}).then(load))}
         >
          <Play size={13}/>
          <span>{item.status==='awaiting_approval'?'Approve':'Resume'}</span>
         </button>
        ):null}
       </>
      )}
     </div>
    </div>

    <div className="session-title-bar">
     {editingTitle?(
      <input
       autoFocus
       className="session-title-edit"
       value={titleDraft}
       onChange={e=>setTitleDraft(e.target.value)}
       onBlur={()=>void saveTitle()}
       onKeyDown={e=>{
        if(e.key==='Enter')void saveTitle();
        if(e.key==='Escape')setEditingTitle(false);
       }}
      />
     ):(
      <h1
       className="session-title"
       onClick={()=>{if(canEdit){setTitleDraft(item.title||'');setEditingTitle(true);}}}
       title={canEdit?'Click to rename session':undefined}
      >
       <span>{item.title}</span>
       {canEdit&&<Pencil size={13} className="edit-hint"/>}
      </h1>
     )}

     {(parentFork||childForks.length>0||parentJob||childJobs.length>0)&&(
      <div className="session-lineage">
       {parentFork&&(
        <button type="button" className="lineage-chip" onClick={()=>go('sessions',parentFork.id)} title="Open parent session">
         <GitFork size={11}/>
         <span>Forked from {parentFork.title}</span>
        </button>
       )}
       {childForks.map((f:Item)=>(
        <button key={f.id} type="button" className="lineage-chip" onClick={()=>go('sessions',f.id)} title="Open forked session">
         <GitFork size={11}/>
         <span>Fork: {f.title}</span>
         <Dot status={f.status}/>
        </button>
       ))}
       {parentJob&&(
        <button type="button" className="lineage-chip" onClick={()=>go('sessions',parentJob.id)}>
         <Layers size={11}/>
         <span>Parent: {parentJob.title}</span>
        </button>
       )}
       {childJobs.map((cj:Item)=>(
        <button key={cj.id} type="button" className="lineage-chip" onClick={()=>go('sessions',cj.id)}>
         <Layers size={11}/>
         <span>{kindLabel(cj.kind)}: {cj.title}</span>
         <Dot status={cj.status}/>
        </button>
       ))}
      </div>
     )}
    </div>

    {item.error&&(
     <div className="note note-bad session-error">
      <div className="session-error-text"><AlertCircle size={15}/><span>{item.error}</span></div>
      {canEdit&&<button type="button" className="btn btn-sm" onClick={()=>setModelModal(true)}><Sparkles size={12}/><span>Switch model</span></button>}
     </div>
    )}

    <Tabs
     value={tab}
     onChange={setTab}
     tabs={[
      {id:'conversation',label:'Conversation'},
      {id:'changes',label:'Working tree diff',count:diffData?.files?.length||undefined},
      ...(hierarchyCount>0?[{id:'hierarchy',label:'Hierarchy & Subagents',count:hierarchyCount}]:[]),
      {id:'checks',label:'Checks',count:item.checks?.length||undefined}
     ]}
    />
   </header>

   {tab==='conversation'&&(
    <div className="session-stream-wrap">
     <div className="session-stream">
      {/* Initial user prompt */}
      <article className="turn turn-user">
       <header className="turn-meta">
        <span className="turn-author">Prompt</span>
        <span className="turn-time">{ago(item.created)}</span>
       </header>
       <Markdown>{item.prompt?.split('\n\n--- Attachment:')[0]||item.prompt}</Markdown>
       <MessageAttachments images={item.images} attachments={item.attachments}/>
      </article>

      {/* Streamed events */}
      {transcript.filter((e,idx)=>{
       if(['usage','status','session','final_text'].includes(e.type))return false;
       // Avoid duplicating the initial prompt event logged at job creation
       if(e.type==='user'&&idx===0&&e.data?.mode==='prompt')return false;
       return true;
      }).map((e,i)=>{
       if(e.type==='user'){
        return (
         <article key={i} className="turn turn-user">
          <header className="turn-meta">
           <span className="turn-author">{e.data?.mode==='steer'?'Steer':e.data?.mode==='followup'?'Queued follow-up':'Follow-up'}</span>
           {e.created&&<span className="turn-time">{ago(e.created)}</span>}
          </header>
          {e.data?.text&&<Markdown>{e.data.text}</Markdown>}
          <MessageAttachments images={e.data?.images} attachments={e.data?.attachments}/>
         </article>
        );
       }
       if(e.type==='thinking'){
        const isLive = item.status==='running' && (lastEvent===e || lastEvent?.type==='thinking');
        return (
         <ThinkingBlock
          key={i}
          text={e.data}
          isLive={isLive}
          defaultOpen={true}
         />
        );
       }
       if(e.type==='tool'){
        if(isSubagent(e.name,e.args)){
         return <SubagentCard key={i} tool={e} isRunning={!e.result&&item.status==='running'} formatToolData={formatToolData}/>;
        }
        const summaryArg=e.args?.command||e.args?.cmd||e.args?.Path||e.args?.path||e.args?.name||'';
        return (
         <details key={i} className="trace-tool" open={!e.result&&item.status==='running'}>
          <summary>
           {e.result!==undefined?(
            e.isError?<AlertCircle size={13} className="tone-bad-text"/>:<Check size={13} className="tone-ok-text"/>
           ):(
            <Spinner size={13}/>
           )}
           <span className="trace-tool-name">{e.name}</span>
           {summaryArg&&<code className="trace-tool-arg">{String(summaryArg).slice(0,95)}</code>}
           {e.durationMs?<span className="trace-meta">{(e.durationMs/1000).toFixed(1)}s</span>:null}
          </summary>
          <div className="trace-tool-body">
           {e.args&&Object.keys(e.args).length>0&&(
            <div>
             <div className="trace-section-label">Input</div>
             <pre>{formatToolData(e.args)}</pre>
            </div>
           )}
           {e.partialUpdate&&!e.result&&(
            <div>
             <div className="trace-section-label">Live output</div>
             <pre>{e.partialUpdate}</pre>
            </div>
           )}
           {e.result!==undefined&&(
            <div>
             <div className={cx('trace-section-label',e.isError&&'tone-bad-text')}>{e.isError?'Error':'Output'}</div>
             <pre>{formatToolData(e.result)}</pre>
            </div>
           )}
          </div>
         </details>
        );
       }
       if(e.type==='tool_result'){
        return (
         <details key={i} className="trace-tool">
          <summary>
           {e.data?.isError?<AlertCircle size={13} className="tone-bad-text"/>:<Check size={13} className="tone-ok-text"/>}
           <span className="trace-tool-name">Tool output</span>
          </summary>
          <div className="trace-tool-body"><pre>{formatToolData(e.data?.result)}</pre></div>
         </details>
        );
       }
       if(e.type==='text'||e.type==='result'){
        return (
         <article key={i} className={cx('turn','turn-agent',e.type==='result'&&'turn-final')}>
          <header className="turn-meta">
           <span className="turn-author"><Sparkles size={12}/>{agent?.name||'Agent'}{e.type==='result'?' · Summary':''}</span>
           {canEdit&&(
            <button
             type="button"
             className="turn-action"
             onClick={()=>void handleFork(`${item.title} (fork)`)}
             title="Fork session from current state"
            >
             <GitFork size={11}/>
             <span>Fork</span>
            </button>
           )}
          </header>
          <Markdown>{e.data}</Markdown>
         </article>
        );
       }
       return (
        <div key={i} className={cx('trace-notice',e.type==='error'&&'note-bad')}>
         <span>{typeof e.data==='string'?e.data:JSON.stringify(e.data)}</span>
        </div>
       );
      })}

      {item.status==='completed'&&item.result&&!hasFinalInStream&&(
       <article className="turn turn-agent turn-final">
        <header className="turn-meta">
         <span className="turn-author"><Sparkles size={12}/>{agent?.name||'Agent'} · Summary</span>
        </header>
        <Markdown>{item.result}</Markdown>
       </article>
      )}

      {item.status==='running'&&(
       <div className="live-activity-bar">
        {lastEvent?.type==='thinking'?(
         <Brain size={14} className="pulse-icon tone-warn-text"/>
        ):(
         <Spinner size={14}/>
        )}
        <span>{lastEvent?.type==='thinking'?`Reasoning through solution… (${lastEvent.data?.length?.toLocaleString()||0} chars)`:currentActivity}</span>
       </div>
      )}

      {item.status==='idle'&&(
       <div className="trace-notice">
        <span>Forked session ready. Send an instruction below to continue from this worktree and conversation state.</span>
       </div>
      )}

      <div ref={endRef}/>
     </div>

     <SessionComposer
      job={item}
      repo={repo}
      canOperate={canEdit}
      onReload={load}
      onOpenChange={cId=>go('changes',cId)}
      onOpenModelModal={()=>setModelModal(true)}
     />
    </div>
   )}

   {tab==='changes'&&(
    <div className="page-body">
     <div className="toolbar-row">
      <div className="diff-summary-meta">
       <GitBranch size={14}/>
       <code>{short(diffData?.base||item.baseSha||item.sourceSha)||'base'}</code>
       <ArrowRight size={13}/>
       <code>{short(diffData?.head||item.sourceSha)||'worktree'}</code>
       {diffData?.files&&(
        <span className="muted-meta">
         {diffData.files.length} changed {diffData.files.length===1?'file':'files'}
         {diffData.untracked?.length?` · ${diffData.untracked.length} untracked`:''}
        </span>
       )}
      </div>
      <div className="toolbar-actions">
       <button type="button" className="btn btn-sm" onClick={()=>void loadDiff()} disabled={loadingDiff}>
        {loadingDiff&&<Spinner size={12}/>}
        <span>Refresh diff</span>
       </button>
       {canEdit&&item.path&&(
        <button
         type="button"
         className="btn btn-sm btn-primary"
         disabled={item.status==='running'}
         onClick={()=>void run(async()=>{
          const res=await api(`/jobs/${item.id}/submit-change`,'POST',{});
          await load();
          if(res.change?.id)go('changes',res.change.id);
         },'Change request updated')}
        >
         <GitPullRequest size={13}/>
         <span>{item.changeId?'Update change request':'Create change request'}</span>
        </button>
       )}
      </div>
     </div>

     {(diffData?.files?.length||diffData?.untracked?.length)?(
      <div className="diff-file-strip">
       {diffData?.files?.map((f:Item)=>(
        <span key={f.path} className="diff-file-chip">
         <FileCode2 size={12}/>
         <span>{f.path}</span>
         {(f.additions>0||f.deletions>0)&&(
          <small>
           {f.additions>0&&<span className="tone-ok-text">+{f.additions}</span>}
           {f.deletions>0&&<span className="tone-bad-text"> -{f.deletions}</span>}
          </small>
         )}
        </span>
       ))}
       {diffData?.untracked?.map((u:string)=>(
        <span key={u} className="diff-file-chip">
         <FileCode2 size={12}/>
         <span>{u}</span>
         <small className="muted-meta">untracked</small>
        </span>
       ))}
      </div>
     ):null}

     <div className="card">
      <DiffBlock diff={diffData?.diff}/>
     </div>
    </div>
   )}

   {tab==='hierarchy'&&(
    <div className="page-body">
     <div className="grid-2">
      <section className="card padded">
       <h3 className="section-title"><GitFork size={14}/><span>Session Lineage & Forks</span></h3>
       <div className="stack-sm">
        {parentFork&&(
         <button type="button" className="row-item" onClick={()=>go('sessions',parentFork.id)}>
          <Dot status={parentFork.status}/>
          <div className="row-main">
           <strong>{parentFork.title}</strong>
           <small>Parent session · {ago(parentFork.created)}</small>
          </div>
          <Status value={parentFork.status}/>
         </button>
        )}
        <div className="row-item active-row">
         <Dot status={item.status}/>
         <div className="row-main">
          <strong>{item.title} (current)</strong>
          <small>{kindLabel(item.kind)} · {item.model||repo?.model||'Default model'}</small>
         </div>
         <Status value={item.status}/>
        </div>
        {childForks.map((f:Item)=>(
         <button key={f.id} type="button" className="row-item" onClick={()=>go('sessions',f.id)}>
          <Dot status={f.status}/>
          <div className="row-main">
           <strong>{f.title}</strong>
           <small>Fork · {ago(f.created)}</small>
          </div>
          <Status value={f.status}/>
         </button>
        ))}
        {childJobs.map((cj:Item)=>(
         <button key={cj.id} type="button" className="row-item" onClick={()=>go('sessions',cj.id)}>
          <Dot status={cj.status}/>
          <div className="row-main">
           <strong>{cj.title}</strong>
           <small>Child {kindLabel(cj.kind)} · {ago(cj.created)}</small>
          </div>
          <Status value={cj.status}/>
         </button>
        ))}
       </div>
      </section>

      <section className="card padded">
       <h3 className="section-title"><Bot size={14}/><span>Delegated Subagents ({subagentCalls.length})</span></h3>
       {subagentCalls.length?(
        <div className="stack-sm">
         {subagentCalls.map((call,idx)=>(
          <SubagentCard key={idx} tool={call} isRunning={!call.result&&item.status==='running'} formatToolData={formatToolData}/>
         ))}
        </div>
       ):(
        <p className="muted">No subagents were invoked during this session.</p>
       )}
      </section>
     </div>
    </div>
   )}

   {tab==='checks'&&(
    <div className="page-body">
     {item.checks?.length?(
      <div className="stack-sm">
       {item.checks.map((c:Item)=>(
        <details key={c.id} className="card check-card" open={c.status==='failed'}>
         <summary>
          <Status value={c.status}/>
          <code>{short(c.sourceSha)}</code>
          <span className="muted-meta">{ago(c.created)}</span>
         </summary>
         <pre className="terminal">{c.log||'No test output recorded.'}</pre>
        </details>
       ))}
      </div>
     ):(
      <Empty icon={CheckCheck} title="No checks recorded">
       Configure a test command in repository settings to run automated verification.
      </Empty>
     )}
    </div>
   )}

   {modelModal&&(
    <SwitchModelModal
     item={item}
     onClose={()=>setModelModal(false)}
     onSaved={async(m,resumed)=>{
      await load();
      await refresh();
      notify(resumed?`Switched to ${m} and resumed`:`Model set to ${m}`);
     }}
    />
   )}
  </div>
 );
}
