import React,{useState,useEffect,useCallback} from 'react';
import {
 ArrowLeft,ArrowRight,GitBranch,GitMerge,GitPullRequest,Sparkles,
 Play,Code2,RefreshCw,Check,Shield,X,Trash2,Rocket,RotateCw,CheckCheck,AlertCircle
} from 'lucide-react';
import {api,ago,short,label,kindLabel,imagePayload,type Item} from './lib';
import {Status,Dot,Tabs,Modal,Field,Spinner,Empty,ErrorNote,Confirm,useWorkspace,useSubmit} from './ui';
import {Markdown} from './markdown';
import {useAttachmentState,AttachmentInput,MessageAttachments} from './attachments';
import {VoiceButton} from './voice';
import {DiffBlock} from './session-view';

export function ChangeView({
 id,
 onStartJob,
 onTriggerReload,
 reloading
}:{
 id:string,
 onStartJob:(repoId:string,changeId:string,kind:string)=>void,
 onTriggerReload:()=>void,
 reloading:boolean
}){
 const {me,state,go,notify,refresh,run,canEdit,isAdmin}=useWorkspace();
 const [item,setItem]=useState<Item|null>(null);
 const [tab,setTab]=useState('diff');
 const [error,setError]=useState('');
 const [commentText,setCommentText]=useState('');
 const [reviewVerdict,setReviewVerdict]=useState('commented');
 const [reviewBody,setReviewBody]=useState('');
 const [forceModal,setForceModal]=useState(false);
 const [forceReason,setForceReason]=useState('');
 const [deleteModal,setDeleteModal]=useState(false);
 const commentAttachments=useAttachmentState();
 const {busy:commentBusy,submit:submitComment}=useSubmit();
 const {busy:reviewBusy,submit:submitReview}=useSubmit();

 const load=useCallback(async()=>{
  try{
   const x=await api(`/changes/${id}`);
   setItem(x);
  }catch(e){
   setError((e as Error).message);
  }
 },[id]);

 useEffect(()=>{
  setItem(null);
  setTab('diff');
  void load();
  const t=setInterval(load,3000);
  return ()=>clearInterval(t);
 },[load]);

 if(error){
  return (
   <div className="page-body">
    <button type="button" className="btn btn-sm" onClick={()=>go('changes')}><ArrowLeft size={14}/><span>Changes</span></button>
    <ErrorNote>{error}</ErrorNote>
   </div>
  );
 }
 if(!item){
  return <div className="page-loading"><Spinner size={18}/><span>Loading change request…</span></div>;
 }

 const repo=state.repos.find((r:Item)=>r.id===item.repoId);
 const linkedJobs=(state.jobs||[]).filter((j:Item)=>j.changeId===id);
 const runningJob=linkedJobs.find((j:Item)=>j.status==='running');

 const currentReviews=(item.reviews||[]).filter((r:Item)=>r.sourceSha===item.sourceSha&&r.targetSha===item.targetSha);
 const currentChecks=(item.checks||[]).filter((c:Item)=>c.sourceSha===item.sourceSha&&c.targetSha===item.targetSha);
 const myReview=currentReviews.filter((r:Item)=>r.authorId===me.id).sort((a:Item,b:Item)=>b.created.localeCompare(a.created))[0];
 const myApproved=myReview?.verdict==='approved';
 const canDelete=isAdmin||item.authorId===me.id;

 const latestByReviewer=new Map<string,Item>();
 for(const r of currentReviews)latestByReviewer.set(r.ai?'ai':r.authorId,r);
 const allRev=[...latestByReviewer.values()];
 const humanRev=allRev.filter(r=>!r.ai);
 const humanApproved=humanRev.some(r=>r.verdict==='approved');
 const humanChangesRequested=humanRev.some(r=>r.verdict==='changes_requested');
 const approved=allRev.some(r=>r.verdict==='approved');
 const pendingChanges=humanApproved?humanChangesRequested:allRev.some(r=>r.verdict==='changes_requested');
 const latestCheck=[...currentChecks].sort((a:Item,b:Item)=>b.created.localeCompare(a.created))[0];
 const needsReview=Boolean(repo?.requireReview&&(!approved||pendingChanges));
 const needsTests=Boolean(repo?.testCommand&&latestCheck?.status!=='passed');

 return (
  <div className="session-page">
   <header className="session-header">
    <div className="session-header-top">
     <div className="session-breadcrumb">
      <button type="button" className="crumb-btn" onClick={()=>go('changes')}>
       <ArrowLeft size={13}/>
       <span>Changes</span>
      </button>
      <span className="crumb-sep">/</span>
      <span className="crumb-repo">{repo?.name||'Repository'}</span>
      <code className="branch-pill"><GitBranch size={11}/>{item.source} → {item.target}</code>
      <Status value={item.status}/>
      {item.conflict&&<span className="status tone-bad">Conflicts</span>}
      <span className="muted-meta">{ago(item.created)}</span>
     </div>

     <div className="session-actions">
      {canEdit&&item.status==='open'&&(
       <>
        <button type="button" className="btn btn-sm" onClick={()=>onStartJob(item.repoId,id,'review')}>
         <Sparkles size={13}/><span>Review</span>
        </button>
        <button type="button" className="btn btn-sm" onClick={()=>onStartJob(item.repoId,id,'test')}>
         <Play size={13}/><span>Test</span>
        </button>
        <button type="button" className="btn btn-sm" onClick={()=>onStartJob(item.repoId,id,item.conflict?'conflict':'address')}>
         <Code2 size={13}/><span>{item.conflict?'Resolve conflicts':'Address feedback'}</span>
        </button>
        <button
         type="button"
         className="btn btn-sm"
         onClick={()=>void run(()=>api('/deployments','POST',{repoId:item.repoId,branch:item.source}),'Deployment starting')}
        >
         <Rocket size={13}/><span>Deploy</span>
        </button>
        <button type="button" className="btn btn-sm" onClick={()=>void run(()=>api(`/changes/${id}/refresh`,'POST',{}).then(load))}>
         <RefreshCw size={13}/><span>Refresh</span>
        </button>
        {!myApproved&&(
         <button
          type="button"
          className="btn btn-sm"
          onClick={()=>void run(async()=>{
           await api(`/changes/${id}/review`,'POST',{verdict:'approved',body:`Approved by ${me.name}`});
           await load();
          },'Approved')}
         >
          <Check size={13}/><span>Approve</span>
         </button>
        )}
        <button
         type="button"
         className="btn btn-sm btn-primary"
         onClick={()=>void run(async()=>{
          await api(`/changes/${id}/merge`,'POST',{});
          await load();
         },'Merged')}
        >
         <GitMerge size={13}/><span>Merge</span>
        </button>
        {isAdmin&&(
         <button type="button" className="btn btn-sm" onClick={()=>setForceModal(true)}>
          <Shield size={13}/><span>Force merge</span>
         </button>
        )}
        <button
         type="button"
         className="btn btn-sm"
         onClick={()=>void run(async()=>{
          await api(`/changes/${id}/close`,'POST',{});
          await load();
         },'Closed')}
        >
         <X size={13}/><span>Close</span>
        </button>
       </>
      )}
      {canEdit&&item.status==='closed'&&(
       <button
        type="button"
        className="btn btn-sm"
        onClick={()=>void run(async()=>{
         await api(`/changes/${id}/reopen`,'POST',{});
         await load();
        },'Reopened')}
       >
        <RefreshCw size={13}/><span>Reopen</span>
       </button>
      )}
      {canDelete&&(
       <button type="button" className="icon-btn" title="Delete change request" onClick={()=>setDeleteModal(true)}>
        <Trash2 size={14}/>
       </button>
      )}
     </div>
    </div>

    <div className="session-title-bar">
     <h1 className="session-title">{item.title}</h1>
    </div>

    {runningJob&&(
     <div className="note note-live">
      <div className="note-live-left">
       <Spinner size={14}/>
       <span><strong>{runningJob.title}</strong> ({kindLabel(runningJob.kind)}) is running on this change request</span>
      </div>
      <button type="button" className="btn btn-sm btn-primary" onClick={()=>go('sessions',runningJob.id)}>
       <span>Open session</span><ArrowRight size={13}/>
      </button>
     </div>
    )}

    {item.status==='merged'&&repo?.self&&(
     <div className="note note-live">
      <div><strong>Merged into Orchestra</strong> — restart the service to apply changes.</div>
      <button type="button" className="btn btn-sm btn-primary" onClick={onTriggerReload} disabled={reloading}>
       <RotateCw size={13} className={reloading?'spin':''}/>
       <span>{reloading?'Reloading…':'Reload service'}</span>
      </button>
     </div>
    )}

    {item.status==='open'&&(
     <div className="gate-strip">
      <span>Revisions: <code>{short(item.sourceSha)}</code> → <code>{short(item.targetSha)}</code></span>
      <span className={needsReview?'tone-warn-text':'tone-ok-text'}>
       {needsReview?(pendingChanges?'Review: changes requested':'Review: awaiting approval'):'Review: ready'}
      </span>
      {repo?.testCommand&&(
       <span className={needsTests?'tone-warn-text':'tone-ok-text'}>
        {needsTests?`Checks: ${latestCheck?.status||'not run'}`:'Checks: passed'}
       </span>
      )}
      {item.conflict&&<span className="tone-bad-text"><AlertCircle size={12}/> Merge conflict</span>}
     </div>
    )}

    <Tabs
     value={tab}
     onChange={setTab}
     tabs={[
      {id:'diff',label:'Diff'},
      {id:'discussion',label:'Discussion',count:(item.comments?.length||0)+linkedJobs.length},
      {id:'reviews',label:'Reviews',count:item.reviews?.length||0},
      {id:'checks',label:'Checks',count:item.checks?.length||0}
     ]}
    />
   </header>

   <div className="page-body">
    {tab==='diff'&&(
     <div className="card">
      <DiffBlock diff={item.diff}/>
     </div>
    )}

    {tab==='discussion'&&(
     <div className="stack-md">
      {linkedJobs.length>0&&(
       <section className="card padded">
        <h3 className="section-title"><Sparkles size={14}/><span>Linked Sessions ({linkedJobs.length})</span></h3>
        <div className="stack-sm">
         {linkedJobs.map((j:Item)=>(
          <button key={j.id} type="button" className="row-item" onClick={()=>go('sessions',j.id)}>
           <Dot status={j.status}/>
           <div className="row-main">
            <strong>{j.title}</strong>
            <small>{kindLabel(j.kind)} · {ago(j.created)}{j.model?` · ${j.model}`:''}</small>
           </div>
           <Status value={j.status}/>
           <ArrowRight size={13}/>
          </button>
         ))}
        </div>
       </section>
      )}

      <section className="card padded stack-md">
       <h3 className="section-title">Comments ({item.comments?.length||0})</h3>
       {item.comments?.length?(
        <div className="stack-sm">
         {item.comments.map((c:Item)=>(
          <article key={c.id} className="turn turn-user">
           <header className="turn-meta">
            <span className="turn-author">{c.author}</span>
            <span className="turn-time">{ago(c.created)}{c.sourceSha!==item.sourceSha?' · earlier revision':''}</span>
           </header>
           <Markdown>{c.text}</Markdown>
           <MessageAttachments images={c.images} attachments={c.attachments}/>
          </article>
         ))}
        </div>
       ):(
        <p className="muted">No comments yet.</p>
       )}

       {canEdit&&(
        <form
         className="composer-card composer-compact"
         onSubmit={e=>{
          e.preventDefault();
          void submitComment(async()=>{
           const cText=commentText.trim()||(commentAttachments.images.length||commentAttachments.attachments.length?'(See attachments)':'');
           if(!cText)return;
           await api(`/changes/${id}/comment`,'POST',{
            text:cText,
            images:imagePayload(commentAttachments.images),
            attachments:commentAttachments.attachments
           });
           setCommentText('');
           commentAttachments.clear();
           await load();
          });
         }}
         onPaste={commentAttachments.handlePaste}
         onDrop={commentAttachments.handleDrop}
         onDragOver={e=>e.preventDefault()}
        >
         <textarea
          rows={3}
          className="composer-textarea"
          placeholder="Add a comment…"
          value={commentText}
          onChange={e=>setCommentText(e.target.value)}
         />
         <div className="composer-toolbar">
          <div className="composer-chips"/>
          <div className="composer-right">
           <AttachmentInput
            images={commentAttachments.images}
            attachments={commentAttachments.attachments}
            onAdd={commentAttachments.addFiles}
            onRemoveImage={commentAttachments.removeImage}
            onRemoveAttachment={commentAttachments.removeAttachment}
            disabled={commentBusy}
           />
           <VoiceButton
            disabled={commentBusy}
            onTranscript={chunk=>setCommentText(t=>t?`${t.trimEnd()} ${chunk}`:chunk)}
           />
           <button
            type="submit"
            className="btn btn-primary btn-sm"
            disabled={commentBusy||(!commentText.trim()&&!commentAttachments.images.length&&!commentAttachments.attachments.length)}
           >
            {commentBusy&&<Spinner/>}
            <span>Comment</span>
           </button>
          </div>
         </div>
        </form>
       )}
      </section>
     </div>
    )}

    {tab==='reviews'&&(
     <div className="stack-md">
      <section className="card padded stack-md">
       <h3 className="section-title">Submitted Reviews ({item.reviews?.length||0})</h3>
       {item.reviews?.length?(
        <div className="stack-sm">
         {item.reviews.map((r:Item)=>(
          <article key={r.id} className="turn turn-agent">
           <header className="turn-meta">
            <span className="turn-author">{r.ai?'AI Review':'Human Review'} · {label(r.verdict)}</span>
            <span className="turn-time">{ago(r.created)}{r.sourceSha!==item.sourceSha||r.targetSha!==item.targetSha?' · stale':''}</span>
           </header>
           <Markdown>{r.body}</Markdown>
          </article>
         ))}
        </div>
       ):(
        <p className="muted">No reviews recorded yet.</p>
       )}
      </section>

      {canEdit&&(
       <section className="card padded">
        <h3 className="section-title">Submit Review</h3>
        <form
         className="stack-sm"
         onSubmit={e=>{
          e.preventDefault();
          void submitReview(async()=>{
           if(!reviewBody.trim())return;
           await api(`/changes/${id}/review`,'POST',{verdict:reviewVerdict,body:reviewBody.trim()});
           setReviewBody('');
           await load();
           notify('Review submitted');
          });
         }}
        >
         <Field label="Verdict">
          <select value={reviewVerdict} onChange={e=>setReviewVerdict(e.target.value)}>
           <option value="commented">Comment</option>
           <option value="approved">Approve</option>
           <option value="changes_requested">Request changes</option>
          </select>
         </Field>
         <Field label="Summary">
          <textarea rows={4} required value={reviewBody} onChange={e=>setReviewBody(e.target.value)} placeholder="Review notes and findings…"/>
         </Field>
         <div className="form-actions">
          <button type="submit" className="btn btn-primary btn-sm" disabled={reviewBusy||!reviewBody.trim()}>
           {reviewBusy&&<Spinner/>}
           <span>Submit review</span>
          </button>
         </div>
        </form>
       </section>
      )}
     </div>
    )}

    {tab==='checks'&&(
     <div>
      {item.checks?.length?(
       <div className="stack-sm">
        {item.checks.map((c:Item)=>(
         <details key={c.id} className="card check-card" open={c.status==='failed'}>
          <summary>
           <Status value={c.status}/>
           <code>{short(c.sourceSha)}</code>
           {(c.sourceSha!==item.sourceSha||c.targetSha!==item.targetSha)&&<span className="tag">stale</span>}
           <span className="muted-meta">{ago(c.created)}</span>
          </summary>
          <pre className="terminal">{c.log||'No output.'}</pre>
         </details>
        ))}
       </div>
      ):(
       <Empty icon={CheckCheck} title="No checks run">
        Run a test session or configure a test command in repository settings.
       </Empty>
      )}
     </div>
    )}
   </div>

   {forceModal&&(
    <Modal
     title="Force merge change request"
     onClose={()=>setForceModal(false)}
     footer={
      <>
       <button type="button" className="btn" onClick={()=>setForceModal(false)}>Cancel</button>
       <button
        type="button"
        className="btn btn-danger"
        disabled={!forceReason.trim()}
        onClick={()=>void run(async()=>{
         await api(`/changes/${id}/force-merge`,'POST',{
          sourceSha:item.sourceSha,
          targetSha:item.targetSha,
          reason:forceReason.trim()
         });
         setForceModal(false);
         await load();
        },'Force-merged')}
       >
        <span>Force merge</span>
       </button>
      </>
     }
    >
     <p className="muted">Bypasses review and test requirements. Recorded in the audit log.</p>
     <Field label="Audit reason">
      <input required value={forceReason} onChange={e=>setForceReason(e.target.value)} placeholder="Reason for bypassing gates…"/>
     </Field>
    </Modal>
   )}

   {deleteModal&&(
    <Confirm
     title="Delete change request"
     body="Permanently delete this change request, including all comments, reviews, and check logs?"
     action="Delete"
     danger
     onClose={()=>setDeleteModal(false)}
     onConfirm={async()=>{
      await api(`/changes/${id}`,'DELETE');
      await refresh();
      go('changes');
      notify('Change request deleted');
     }}
    />
   )}
  </div>
 );
}
