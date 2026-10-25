import React,{useState} from 'react';
import {Plus} from 'lucide-react';
import {api,type Item} from './lib';
import {Field,Modal,ErrorNote,Spinner,useSubmit,useWorkspace} from './ui';
import {buildModelChoices} from './composer';

/** A reviewable change exists before code is written, so planning is not a retroactive stage. */
export function PlannedChangeButton({projectId,repos}:{projectId:string;repos:Item[]}){
 const {state,catalog,me,canEdit,go,refresh}=useWorkspace();
 const [open,setOpen]=useState(false),[repoId,setRepoId]=useState(''),[title,setTitle]=useState(''),[description,setDescription]=useState(''),[model,setModel]=useState(''),[start,setStart]=useState(true),[error,setError]=useState('');
 const {busy,submit}=useSubmit();
 const ready=repos.filter(r=>r.status==='ready');
 const choices=buildModelChoices((state.connections||[]).filter((c:Item)=>c.status==='connected'&&(c.ownerId===me.id||c.shared&&c.projects?.includes(projectId))),catalog);
 const selected=choices.find(c=>c.value===(model||choices[0]?.value));
 if(!canEdit||!ready.length)return null;
 return <><button type="button" className="btn btn-primary btn-sm" onClick={()=>{setError('');setOpen(true);}}><Plus size={13}/>New change</button>{open&&<Modal title="Start a change" onClose={()=>{if(!busy)setOpen(false);}} footer={<><button type="button" className="btn" disabled={busy} onClick={()=>setOpen(false)}>Cancel</button><button type="button" className="btn btn-primary" disabled={busy||!title.trim()} onClick={()=>void submit(async()=>{
  setError('');try{const change=await api(`/projects/${projectId}/changes`,'POST',{repoId:repoId||ready[0].id,title:title.trim(),description:description.trim(),startPipeline:start&&Boolean(selected),connectionId:selected?.connectionId,model:selected?.model});await refresh();setOpen(false);setTitle('');setDescription('');go('changes',change.id);}catch(e){setError((e as Error).message);}
 })}>{busy&&<Spinner/>}Create change</button></>}>
  <div className="stack-md"><p className="muted">Start with the goal, not a patch. This creates a named branch and one shared change conversation before any code is written.</p><ErrorNote>{error}</ErrorNote>
   <Field label="Repository"><select value={repoId||ready[0].id} disabled={busy} onChange={e=>setRepoId(e.target.value)}>{ready.map(r=><option key={r.id} value={r.id}>{r.name}</option>)}</select></Field>
   <Field label="Title"><input autoFocus value={title} disabled={busy} maxLength={200} onChange={e=>setTitle(e.target.value)} placeholder="What should change?"/></Field>
   <Field label="Goal and acceptance criteria"><textarea rows={5} value={description} disabled={busy} onChange={e=>setDescription(e.target.value)} placeholder="Describe the outcome, constraints, and how we will know it works."/></Field>
   {choices.length?<><Field label="Model"><select value={model||choices[0].value} disabled={busy} onChange={e=>setModel(e.target.value)}>{choices.map(c=><option key={c.value} value={c.value}>{c.label} · {c.hint}</option>)}</select></Field><label className="check-field"><input type="checkbox" checked={start} disabled={busy} onChange={e=>setStart(e.target.checked)}/> Run design → research → implementation → review → test</label><small className="muted">Repository approvals still apply. The workflow never merges automatically.</small></>:<p className="muted">No model provider connected. You can create the change now and start its workflow later.</p>}
  </div>
 </Modal>}</>;
}
