import React,{useEffect,useState} from 'react';
import {api,thinkingLevels,type Item} from './lib';
import {ErrorNote,Spinner,Status,useWorkspace} from './ui';
import {Markdown} from './markdown';
import {buildModelChoices} from './composer';
import './project-conversation.css';

/** A shared, persistent coordinator conversation, separate from Docker task transcripts. */
export function ProjectConversation({projectId,changeId}:{projectId:string,changeId?:string}){
 return <Conversation key={`${projectId}:${changeId||''}`} projectId={projectId} changeId={changeId}/>;
}
function Conversation({projectId,changeId}:{projectId:string,changeId?:string}){
 const {state,catalog,canEdit,go,me}=useWorkspace();
 const endpoint=changeId?`/changes/${changeId}/conversation`:`/projects/${projectId}/conversation`;
 const connections=(state.connections||[]).filter((c:Item)=>c.status==='connected'&&(c.ownerId===me.id||c.shared&&c.projects?.includes(projectId)));
 const choices=buildModelChoices(connections,catalog);
 const [data,setData]=useState<Item|null>(null),[draft,setDraft]=useState(''),[error,setError]=useState('');
 const [selection,setSelection]=useState(''),[thinkingLevel,setThinkingLevel]=useState('off'),[busy,setBusy]=useState(false);
 const running=data?.runs?.some((r:Item)=>r.status==='running');
 const remembered=choices.find(c=>c.connectionId===data?.thread?.connectionId&&c.model===data?.thread?.model)?.value;
 const modelKey=selection||remembered||choices[0]?.value||'';
 const selected=choices.find(c=>c.value===modelKey);
 useEffect(()=>{
  let disposed=false,poll:ReturnType<typeof setTimeout>;
  const load=async()=>{
   try{const result=await api(endpoint);if(!disposed){setData(result);setError('');}}catch(e){if(!disposed)setError((e as Error).message);}
   finally{if(!disposed)poll=setTimeout(()=>void load(),1500);}
  };
  void load();return ()=>{disposed=true;clearTimeout(poll);};
 },[endpoint]);
 const send=async(e:React.FormEvent)=>{
  e.preventDefault();if(!draft.trim()||!selected||busy||running)return;
  setBusy(true);setError('');
  try{
   await api(endpoint,'POST',{message:draft,connectionId:selected.connectionId,model:selected.model,thinkingLevel});
   setDraft('');setData(await api(endpoint));
  }catch(e){setError((e as Error).message);}finally{setBusy(false);}
 };
 const stop=async()=>{
  setBusy(true);setError('');try{await api(endpoint+'/stop','POST',{});setData(await api(endpoint));}catch(e){setError((e as Error).message);}finally{setBusy(false);}
 };
 const jobs=(state.jobs||[]).filter((j:Item)=>j.projectId===projectId&&(j.projectThreadId===data?.thread?.id||j.parentProjectThreadId===data?.thread?.id));
 return <section className="project-conversation" aria-label={changeId?'Change coordinator conversation':'Project coordinator conversation'}>
  <header className="section-head"><div><h3>{changeId?'Change conversation':'Project conversation'}</h3><p className="muted">Plan here. Repository work runs in linked Docker tasks.</p></div>{running?<span><Spinner/> Coordinating…</span>:null}</header>
  <ErrorNote>{error}</ErrorNote>
  {!data&&!error?<Spinner/>:null}
  <div className="conversation-messages" aria-live="polite" aria-relevant="additions text">
   {data?.messages?.length===0?<p className="muted">Discuss requirements, ask about the project, or delegate a task. This conversation is shared with project members.</p>:null}
   {[...(data?.messages||[]).filter((m:Item)=>!m.runId).map((m:Item)=>({...m,entryType:'message'})),...(data?.runs||[]).map((r:Item)=>({...r,entryType:'run'}))].sort((a:Item,b:Item)=>a.created.localeCompare(b.created)).map((entry:Item)=>{
    if(entry.entryType==='message')return <article key={entry.id} className={`conversation-message message-${entry.role}`}><strong>{entry.role==='user'?'Operator':'Coordinator'}</strong><Markdown>{entry.text}</Markdown></article>;
    const run=entry;
    const answer=data?.messages?.find((m:Item)=>m.runId===run.id);
    const text=answer?.text||(run.events||[]).filter((e:Item)=>e.type==='text').map((e:Item)=>e.data).join('');
    return <article key={run.id} className="conversation-message message-assistant">
     <strong>Coordinator</strong>
     {text?<Markdown>{text}</Markdown>:run.status==='running'?<p className="muted"><Spinner/> Working…</p>:null}
     {run.error?<ErrorNote>{run.error}</ErrorNote>:null}
     <details className="conversation-run"><summary>Coordinator activity · <Status value={run.status}/></summary>
      {(run.events||[]).filter((e:Item)=>!['text','result'].includes(e.type)).map((e:Item)=><details key={e.seq}><summary>{e.type==='tool'?e.data?.name:e.type==='tool_result'?`${e.data?.name} result`:e.type}</summary><pre>{typeof e.data==='string'?e.data:JSON.stringify(e.data,null,2)}</pre></details>)}
     </details>
    </article>;
   })}
  </div>
  {jobs.length?<div className="conversation-jobs"><h4>Delegated tasks</h4>{jobs.map((j:Item)=><button key={j.id} type="button" className="btn btn-sm" onClick={()=>go('sessions',j.id)}>{j.title} · <Status value={j.status}/></button>)}</div>:null}
  {canEdit?<form className="composer-card" onSubmit={send}>
   <textarea aria-label="Message project coordinator" className="composer-textarea" rows={3} value={draft} onChange={e=>setDraft(e.target.value)} placeholder="Discuss or delegate project work…" onKeyDown={e=>{if((e.ctrlKey||e.metaKey)&&e.key==='Enter'){e.preventDefault();e.currentTarget.form?.requestSubmit();}}}/>
   <div className="composer-toolbar">
    <label>Model <select aria-label="Coordinator model" value={modelKey} disabled={busy||running} onChange={e=>setSelection(e.target.value)}>{choices.length===0?<option value="">Connect a model provider</option>:choices.map(c=><option key={c.value} value={c.value}>{c.label} · {c.hint}</option>)}</select></label>
    <label>Thinking <select aria-label="Coordinator thinking level" value={thinkingLevel} disabled={busy||running} onChange={e=>setThinkingLevel(e.target.value)}>{thinkingLevels.map(level=><option key={level} value={level}>{level}</option>)}</select></label>
    {running?<button className="btn" type="button" disabled={busy} onClick={()=>void stop()}>Stop coordinator</button>:<button className="btn btn-primary" type="submit" disabled={busy||!selected||!draft.trim()||!data}>{busy?<Spinner/>:'Send'}</button>}
   </div>
  </form>:<p className="muted">Read-only conversation. Project operator permission is required to send messages.</p>}
 </section>;
}
