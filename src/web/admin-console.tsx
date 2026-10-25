import React, { useEffect, useState, useRef, useMemo, useCallback } from 'react';
import {
 MessageSquare, X, Plus, Send, Square, Sparkles, Shield, Package,
 ChevronRight, Loader2, ExternalLink, Terminal, Check, AlertCircle, Brain,
 Trash2, Search, SlidersHorizontal, ArrowLeft, RotateCw, CheckCircle2, Zap
} from 'lucide-react';
import { useAttachmentState, AttachmentInput, MessageAttachments } from './attachments.js';
import { isSubagent, SubagentCard, getSubagentActivityText, parseSubagentInfo, formatToolData } from './subagent.js';
import { Markdown } from './markdown.js';
import { VoiceButton } from './voice.js';
import { thinkingLevels, thinkingLabel, ago, short, type Item } from './lib.js';
import { ThinkingBlock } from './session-view.js';
import { Status, Dot, Modal, Confirm } from './ui.js';

type Api = (path: string, method?: string, data?: any) => Promise<any>;
const label = (v?: string) => v ? v.replaceAll('_', ' ').replace(/^\w/, x => x.toUpperCase()) : '';

export function groupThreadsByDate(threads: Item[], query = '') {
 const q = query.trim().toLowerCase();
 const filtered = query.trim()
  ? threads.filter(t => (t.title || '').toLowerCase().includes(q))
  : threads;

 const sorted = [...filtered].sort((a, b) => {
  const tb = new Date(b.updated || b.created || 0).getTime();
  const ta = new Date(a.updated || a.created || 0).getTime();
  return tb - ta;
 });

 const now = new Date();
 const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
 const startOfYesterday = startOfToday - 86400000;
 const startOf7Days = startOfToday - 6 * 86400000;

 const today: Item[] = [];
 const yesterday: Item[] = [];
 const past7Days: Item[] = [];
 const older: Item[] = [];

 for (const t of sorted) {
  const time = new Date(t.updated || t.created || 0).getTime();
  if (time >= startOfToday) today.push(t);
  else if (time >= startOfYesterday) yesterday.push(t);
  else if (time >= startOf7Days) past7Days.push(t);
  else older.push(t);
 }

 const groups: { title: string; items: Item[] }[] = [];
 if (today.length) groups.push({ title: 'Today', items: today });
 if (yesterday.length) groups.push({ title: 'Yesterday', items: yesterday });
 if (past7Days.length) groups.push({ title: 'Previous 7 days', items: past7Days });
 if (older.length) groups.push({ title: 'Older', items: older });
 return groups;
}

export function SystemAssistantPage({
 api,
 me,
 state,
 catalog,
 context = {},
 onJob,
 refresh,
 initialThreadId,
 onSelectThread
}: {
 api: Api;
 me: Item;
 state: Item;
 catalog: Item[];
 context?: Item;
 onJob: (id: string) => void;
 refresh: () => Promise<void>;
 initialThreadId?: string;
 onSelectThread?: (id: string | null) => void;
}) {
 const [tab, setTab] = useState<'chat' | 'approvals' | 'plugins' | 'work'>('chat');
 const [data, setData] = useState<Item>({ threads: [], runs: [], actions: [], plugins: [], selfJobs: [], deployments: [] });
 const [thread, setThread] = useState(initialThreadId || '');
 const [chat, setChat] = useState<Item>({ messages: [], runs: [] });
 const [message, setMessage] = useState('');
 const [searchQuery, setSearchQuery] = useState('');
 const [approvalsFilter, setApprovalsFilter] = useState<'all' | 'pending' | 'completed'>('all');
 const [confirmDeleteThreadId, setConfirmDeleteThreadId] = useState<string | null>(null);
 const [confirmDeleteActionId, setConfirmDeleteActionId] = useState<string | null>(null);

 const [connection, setConnection] = useState(localStorage.getItem('orchestra.admin.connection') || '');
 const [model, setModel] = useState(localStorage.getItem('orchestra.admin.model') || '');
 const [thinkingLevel, setThinkingLevel] = useState(localStorage.getItem('orchestra.admin.thinkingLevel') || 'off');
 const [error, setError] = useState('');
 const [busy, setBusy] = useState(false);
 const [source, setSource] = useState('');
 const [pluginName, setPluginName] = useState('');
 const [content, setContent] = useState('');
 const attachmentState = useAttachmentState();
 const end = useRef<HTMLDivElement>(null);

 // Sync thread when initialThreadId changes
 useEffect(() => {
  if (initialThreadId !== undefined && initialThreadId !== thread) {
   setThread(initialThreadId);
  }
 }, [initialThreadId]);

 const load = useCallback(async () => {
  try {
   const d = await api('/admin');
   setData(d);
   if (thread) {
    const c = await api(`/admin/threads/${thread}`);
    setChat(c);
   }
  } catch (e: any) {
   setError(e.message);
  }
 }, [api, thread]);

 useEffect(() => {
  let live = true;
  const poll = async () => {
   try {
    const d = await api('/admin');
    if (live) setData(d);
    if (thread) {
     const c = await api(`/admin/threads/${thread}`);
     if (live) setChat(c);
    }
   } catch (e: any) {
    if (live) setError(e.message);
   }
  };
  void poll();
  const timer = setInterval(poll, 2500);
  return () => { live = false; clearInterval(timer); };
 }, [api, thread]);

 useEffect(() => {
  if (chat.messages.length) {
   end.current?.scrollIntoView({ block: 'nearest' });
  }
 }, [chat.messages.length, chat.runs.at(-1)?.events?.length, tab]);

 const connections = state.connections.filter((c: Item) => c.status === 'connected' && (c.ownerId === me.id || c.shared));
 const selected = connections.find((c: Item) => c.id === connection) || connections[0];

 const getJobsForRun = (runId?: string) => {
  if (!runId) return [];
  const found: Item[] = [];
  const seen = new Set<string>();
  for (const j of (state.jobs || [])) {
   if (j.adminRunId === runId && !seen.has(j.id)) {
    seen.add(j.id);
    found.push(j);
   }
  }
  for (const j of (data.selfJobs || [])) {
   if (j.adminRunId === runId && !seen.has(j.id)) {
    seen.add(j.id);
    found.push(j);
   }
  }
  return found;
 };

 useEffect(() => {
  if (!connection && connections[0]?.id) {
   setConnection(connections[0].id);
  }
 }, [connections.length]);

 const [localCatalog, setLocalCatalog] = useState<Item[]>(catalog || []);
 useEffect(() => { if (catalog?.length) setLocalCatalog(catalog); }, [catalog]);
 useEffect(() => {
  if (selected?.provider && (!localCatalog.length || !localCatalog.some(p => p.id === selected.provider))) {
   void api('/providers').then(p => { if (Array.isArray(p) && p.length) setLocalCatalog(p); }).catch(() => {});
  }
 }, [api, selected?.provider]);

 const activeCatalog = localCatalog.length ? localCatalog : catalog;
 const models: Item[] = selected?.models || selected?.config?.models || activeCatalog.find(p => p.id === selected?.provider)?.models || [];

 useEffect(() => {
  if (selected && models.length > 0 && (!model || !models.some(m => m.id === model))) {
   const first = models[0]?.id || '';
   if (first) {
    setModel(first);
    localStorage.setItem('orchestra.admin.model', first);
   }
  }
 }, [selected?.id, models.length]);

 const running = chat.runs.some((r: Item) => r.status === 'running');
 const pending = data.actions.filter((a: Item) => a.status === 'awaiting_approval');

 const perform = async (fn: () => Promise<any>) => {
  setBusy(true); setError('');
  try {
   await fn();
   await load();
   await refresh();
  } catch (e: any) {
   setError(e.message);
  } finally {
   setBusy(false);
  }
 };

 const selectThread = (id: string) => {
  setThread(id);
  onSelectThread?.(id || null);
  const found = data.threads.find((t: Item) => t.id === id);
  if (found?.thinkingLevel) {
   setThinkingLevel(found.thinkingLevel);
   localStorage.setItem('orchestra.admin.thinkingLevel', found.thinkingLevel);
  }
  if (found?.connectionId) {
   setConnection(found.connectionId);
   localStorage.setItem('orchestra.admin.connection', found.connectionId);
  }
  if (found?.model) {
   setModel(found.model);
   localStorage.setItem('orchestra.admin.model', found.model);
  }
  setChat({ messages: [], runs: [] });
 };

 const createThread = async () => {
  setBusy(true); setError('');
  try {
   const t = await api('/admin/threads', 'POST', {});
   await load();
   selectThread(t.id);
  } catch (e: any) {
   setError(e.message);
  } finally {
   setBusy(false);
  }
 };

 const deleteThread = async (id: string) => {
  setBusy(true); setError('');
  try {
   await api(`/admin/threads/${id}`, 'DELETE');
   if (thread === id) {
    const remaining = data.threads.filter((t: Item) => t.id !== id);
    if (remaining.length) {
     selectThread(remaining[0].id);
    } else {
     setThread('');
     onSelectThread?.(null);
     setChat({ messages: [], runs: [] });
    }
   }
   await load();
  } catch (e: any) {
   setError(e.message);
  } finally {
   setBusy(false);
   setConfirmDeleteThreadId(null);
  }
 };

 const deleteAction = async (id: string) => {
  setBusy(true); setError('');
  try {
   await api(`/admin/actions/${id}`, 'DELETE');
   await load();
  } catch (e: any) {
   setError(e.message);
  } finally {
   setBusy(false);
   setConfirmDeleteActionId(null);
  }
 };

 const requestAction = (action: Item, reason: string) => perform(async () => {
  await api('/admin/actions', 'POST', { action, reason });
  setTab('approvals');
 });

 const contextName = context.changeId
  ? state.changes.find((c: Item) => c.id === context.changeId)?.title
  : context.jobId
  ? state.jobs.find((j: Item) => j.id === context.jobId)?.title
  : context.projectId
  ? state.projects.find((p: Item) => p.id === context.projectId)?.name
  : label(context.page);

 const send = () => perform(async () => {
  let id = thread;
  if (!id) {
   const t = await api('/admin/threads', 'POST', {});
   id = t.id;
   setThread(id);
   onSelectThread?.(id);
  }
  const textMsg = message.trim() || (attachmentState.images.length || attachmentState.attachments.length ? '(Attached files)' : '');
  await api(`/admin/threads/${id}/messages`, 'POST', {
   message: textMsg,
   connectionId: selected?.id || connection,
   model,
   thinkingLevel,
   context,
   images: attachmentState.images.map(img => ({ type: 'image', data: img.data, mimeType: img.mimeType, name: img.name, url: img.url })),
   attachments: attachmentState.attachments
  });
  localStorage.setItem('orchestra.admin.connection', selected?.id || connection);
  localStorage.setItem('orchestra.admin.model', model);
  localStorage.setItem('orchestra.admin.thinkingLevel', thinkingLevel);
  setMessage('');
  attachmentState.clear();
  setChat(await api(`/admin/threads/${id}`));
 });

 const threadGroups = useMemo(() => groupThreadsByDate(data.threads, searchQuery), [data.threads, searchQuery]);

 const currentThread = data.threads.find((t: Item) => t.id === thread);

 const filteredActions = useMemo(() => {
  if (approvalsFilter === 'pending') {
   return data.actions.filter((a: Item) => a.status === 'awaiting_approval');
  }
  if (approvalsFilter === 'completed') {
   return data.actions.filter((a: Item) => a.status !== 'awaiting_approval');
  }
  return data.actions;
 }, [data.actions, approvalsFilter]);

 return (
  <div className="assistant-page">
   {/* Left Sidebar: Past Chats ordered by date */}
   <aside className="assistant-sidebar">
    <div className="assistant-sidebar-top">
     <div className="row-title-line">
      <Sparkles size={16} className="tone-live-text"/>
      <strong>System Assistant</strong>
     </div>
     <button
      type="button"
      className="btn btn-primary btn-sm"
      onClick={() => void createThread()}
      disabled={busy}
      title="Start a new conversation"
     >
      <Plus size={13}/>
      <span>New chat</span>
     </button>
    </div>

    <div className="assistant-sidebar-search">
     <div className="search-box" style={{ width: '100%' }}>
      <Search size={13}/>
      <input
       placeholder="Search past chats…"
       value={searchQuery}
       onChange={e => setSearchQuery(e.target.value)}
      />
     </div>
    </div>

    <div className="assistant-threads-scroll">
     {threadGroups.length === 0 ? (
      <div style={{ padding: '1.5rem 1rem', textAlign: 'center' }} className="muted-meta">
       {searchQuery ? 'No matching conversations.' : 'No past conversations.'}
      </div>
     ) : (
      threadGroups.map(group => (
       <div key={group.title} className="assistant-group">
        <span className="assistant-group-title">{group.title}</span>
        {group.items.map((t: Item) => (
         <button
          key={t.id}
          type="button"
          className={`assistant-thread-btn ${t.id === thread ? 'active' : ''}`}
          onClick={() => selectThread(t.id)}
         >
          <MessageSquare size={13} style={{ flexShrink: 0, marginTop: 2 }}/>
          <div className="assistant-thread-info">
           <span className="assistant-thread-title">{t.title || 'Conversation'}</span>
           <span className="assistant-thread-date">{ago(t.updated || t.created)}</span>
          </div>
          <button
           type="button"
           className="icon-btn assistant-thread-del"
           title="Delete conversation"
           onClick={e => {
            e.stopPropagation();
            setConfirmDeleteThreadId(t.id);
           }}
          >
           <Trash2 size={12}/>
          </button>
         </button>
        ))}
       </div>
      ))
     )}
    </div>
   </aside>

   {/* Right Main Pane */}
   <main className="assistant-main-pane">
    <header className="assistant-header">
     <div className="assistant-header-row">
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', minWidth: 0 }}>
       <h1 style={{ fontSize: '15px', fontWeight: 650, margin: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
        {currentThread?.title || 'System Assistant'}
       </h1>
       {currentThread?.updated && (
        <span className="muted-meta" style={{ whiteSpace: 'nowrap' }}>
         Updated {ago(currentThread.updated)}
        </span>
       )}
      </div>

      <div className="assistant-controls-row">
       <select
        aria-label="Execution mode"
        className="select-compact"
        value={chat.permissionMode || 'manual'}
        disabled={busy}
        onChange={e => {
         const permissionMode = e.target.value;
         void perform(async () => {
          let id = thread;
          if (!id) {
           const t = await api('/admin/threads', 'POST', {});
           id = t.id;
           setThread(id);
           onSelectThread?.(id);
          }
          await api(`/admin/threads/${id}`, 'PATCH', { permissionMode });
          setChat(await api(`/admin/threads/${id}`));
         });
        }}
       >
        <option value="manual">Manual approval mode</option>
        <option value="yolo">⚡ Auto-execute (YOLO mode)</option>
       </select>

       {chat.permissionMode === 'yolo' && (
        <span className="tag tag-accent" style={{ color: 'var(--live)', borderColor: 'var(--live)' }}>
         <Zap size={11}/> YOLO Active
        </span>
       )}
      </div>
     </div>

     <div className="assistant-header-row" style={{ marginTop: '0.25rem' }}>
      <nav className="tabs" style={{ border: 'none', padding: 0 }}>
       {[
        { id: 'chat' as const, label: 'Chat', icon: MessageSquare },
        { id: 'approvals' as const, label: 'Approvals', count: pending.length, icon: Shield },
        { id: 'plugins' as const, label: 'Plugins', icon: Package },
        { id: 'work' as const, label: 'Runs', icon: Terminal }
       ].map(t => (
        <button
         key={t.id}
         type="button"
         className={tab === t.id ? 'on' : ''}
         onClick={() => setTab(t.id)}
        >
         <t.icon size={13}/>
         <span>{t.label}</span>
         {t.count !== undefined && t.count > 0 && <span className="count">{t.count}</span>}
        </button>
       ))}
      </nav>

      {tab === 'chat' && (
       <div className="assistant-controls-row">
        <select
         aria-label="Connection"
         className="select-compact"
         value={selected?.id || connection}
         onChange={e => {
          const nextConn = e.target.value;
          setConnection(nextConn);
          localStorage.setItem('orchestra.admin.connection', nextConn);
          const connObj = connections.find((c: Item) => c.id === nextConn);
          const connModels: Item[] = connObj?.models || connObj?.config?.models || activeCatalog.find(p => p.id === connObj?.provider)?.models || [];
          const firstModel = connModels[0]?.id || '';
          setModel(firstModel);
          localStorage.setItem('orchestra.admin.model', firstModel);
         }}
        >
         <option value="">Connection</option>
         {connections.map((c: Item) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>

        <select
         aria-label="Model"
         className="select-compact"
         value={model}
         onChange={e => {
          const nextModel = e.target.value;
          setModel(nextModel);
          localStorage.setItem('orchestra.admin.model', nextModel);
         }}
        >
         <option value="">Model</option>
         {models.map((m: Item) => <option key={m.id} value={m.id}>{m.name || m.id}</option>)}
        </select>

        <select
         aria-label="Thinking effort"
         className="select-compact"
         value={thinkingLevel}
         onChange={e => {
          const next = e.target.value;
          setThinkingLevel(next);
          localStorage.setItem('orchestra.admin.thinkingLevel', next);
         }}
        >
         {thinkingLevels.map(v => <option key={v} value={v}>Thinking: {thinkingLabel[v]}</option>)}
        </select>

        {contextName && (
         <span className="tag" title="Dashboard context provided to assistant">
          Context: {contextName}
         </span>
        )}
       </div>
      )}
     </div>
    </header>

    {error && (
     <div className="note note-bad" style={{ margin: '8px 24px 0' }} role="alert">
      <AlertCircle size={14}/>
      <span style={{ flex: 1 }}>{error}</span>
      <button type="button" className="icon-btn" onClick={() => setError('')}><X size={13}/></button>
     </div>
    )}

    {/* Tab: Chat */}
    {tab === 'chat' && (
     <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      <div className="assistant-stream-wrap">
       <div className="assistant-stream-inner">
        {!chat.messages.length && (
         <div className="card padded stack-sm" style={{ padding: '2rem 1.5rem', textAlign: 'center' }}>
          <Sparkles size={24} style={{ margin: '0 auto', color: 'var(--accent)' }}/>
          <h2 style={{ fontSize: '16px', fontWeight: 650, margin: '4px 0' }}>How can System Assistant help you today?</h2>
          <p className="muted" style={{ maxWidth: '580px', margin: '0 auto 1rem' }}>
           Orchestrate sessions across repositories, inspect host environment, adapt and update Orchestra itself, or manage Pi extensions.
          </p>
          <div className="admin-empty-prompts" style={{ maxWidth: '640px', margin: '0 auto', width: '100%' }}>
           {[
            'Inspect active sessions and summarize current progress across projects.',
            'Review open change requests and check test evidence.',
            'Propose an improvement to Orchestra in a tracked session.',
            'Inspect deployment health and running containers.'
           ].map(p => (
            <button key={p} type="button" className="prompt-suggestion" onClick={() => setMessage(p)}>
             <span>{p}</span><ChevronRight size={13}/>
            </button>
           ))}
          </div>
         </div>
        )}

        {chat.messages.map((m: Item) => {
         const linkedRun = m.runId ? chat.runs.find((r: Item) => r.id === m.runId) : null;
         const runThinking = linkedRun?.events?.filter((e: Item) => e.type === 'thinking').map((e: Item) => e.data).join('');
         const associatedJobs = getJobsForRun(m.runId);
         return (
          <article key={m.id} className={`turn ${m.role === 'user' ? 'turn-user' : 'turn-agent'}`}>
           <header className="turn-meta">
            <span className="turn-author">{m.role === 'user' ? (me.name || 'Admin') : 'Assistant'}</span>
           </header>
           {runThinking && <ThinkingBlock text={runThinking} isLive={false} defaultOpen={false}/>}
           <Markdown>{m.text}</Markdown>
           <MessageAttachments images={m.images} attachments={m.attachments}/>
           {associatedJobs.length > 0 && (
            <div className="admin-session-cards stack-xs" style={{ marginTop: '0.75rem' }}>
             {associatedJobs.map((j: Item) => {
              const proj = state.projects?.find((p: Item) => p.id === j.projectId);
              const repo = state.repos?.find((r: Item) => r.id === j.repoId);
              return (
               <div key={j.id} className="admin-session-card">
                <div className="admin-session-card-left">
                 <div className="admin-session-card-title-row">
                  <Sparkles size={14} style={{ color: 'var(--accent)' }}/>
                  <strong style={{ fontSize: '13px' }}>{j.title}</strong>
                  <span className="tag tag-sm" style={{ textTransform: 'capitalize' }}>{j.status}</span>
                 </div>
                 <div className="admin-session-card-meta muted" style={{ fontSize: '12px' }}>
                  <Dot status={j.status}/>
                  <span>Project: <strong>{proj?.name || 'Orchestra'}</strong></span>
                  {repo && <span>· Repo: <strong>{repo.name}</strong></span>}
                  <span>· Kind: {j.kind}</span>
                 </div>
                </div>
                <button
                 type="button"
                 className="btn btn-sm btn-primary"
                 onClick={() => onJob(j.id)}
                 style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}
                >
                 <span>Open Session</span>
                 <ExternalLink size={12}/>
                </button>
               </div>
              );
             })}
            </div>
           )}
          </article>
         );
        })}

        {chat.runs.filter((r: Item) =>
         r.status === 'running' || r.status === 'failed' || r.status === 'interrupted' || r.status === 'cancelled' ||
         (!chat.messages.some((m: Item) => m.runId === r.id) && r.events?.some((e: Item) => e.type === 'text' || e.type === 'result'))
        ).map((r: Item) => {
         const thinkingText = r.events?.filter((e: Item) => e.type === 'thinking').map((e: Item) => e.data).join('');
         const textOutput = r.events?.filter((e: Item) => e.type === 'text').map((e: Item) => e.data).join('') || r.events?.find((e: Item) => e.type === 'result')?.data;
         const correlatedTools: Item[] = [];
         for (const e of r.events || []) {
          if (e.type === 'tool') {
           correlatedTools.push({ toolCallId: e.data?.toolCallId, name: e.data?.name || 'tool', args: e.data?.args, partialUpdate: '' });
          } else if (e.type === 'tool_update') {
           const id = e.data?.toolCallId;
           const target = correlatedTools.slice().reverse().find(t => id ? t.toolCallId === id : true);
           if (target) {
            if (e.data?.args) target.args = e.data.args;
            target.partialUpdate = e.data?.partialResult || (target.partialUpdate || '') + (typeof e.data?.update === 'string' ? e.data.update : JSON.stringify(e.data?.update || ''));
           }
          } else if (e.type === 'tool_result') {
           const id = e.data?.toolCallId;
           const target = correlatedTools.slice().reverse().find(t => id ? t.toolCallId === id : !t.result);
           if (target) {
            target.result = e.data?.result;
            target.isError = e.data?.isError;
            target.durationMs = e.data?.durationMs;
           } else {
            correlatedTools.push({ toolCallId: id, name: e.data?.name || 'tool', result: e.data?.result, isError: e.data?.isError, durationMs: e.data?.durationMs });
           }
          }
         }
         const lastEv = r.events?.at(-1);
         let activityLabel = 'Running…';
         if (lastEv?.type === 'thinking') activityLabel = 'Reasoning…';
         else if (correlatedTools.length > 0 && r.status === 'running') {
          const lastTool = correlatedTools[correlatedTools.length - 1];
          if (isSubagent(lastTool.name, lastTool.args)) {
           const subData = parseSubagentInfo(lastTool, true);
           if (subData) activityLabel = getSubagentActivityText(subData);
           else activityLabel = 'Subagent active…';
          } else {
           activityLabel = `Executing ${lastTool.name}…`;
          }
         }

         return (
          <article key={r.id} className="turn turn-agent">
           <header className="turn-meta">
            <span className="turn-author">Assistant</span>
            <span className="muted-meta">
             {r.status === 'running' ? (
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
               <Loader2 size={12} className="spin tone-live-text"/>
               <span>{activityLabel}</span>
              </span>
             ) : (
              <Status value={r.status}/>
             )}
            </span>
           </header>

           {thinkingText && <ThinkingBlock text={thinkingText} isLive={r.status === 'running'} defaultOpen={r.status === 'running'}/>}

           {correlatedTools.map((tool, idx) => {
            if (isSubagent(tool.name, tool.args)) {
             return (
              <SubagentCard
               key={tool.toolCallId || idx}
               tool={tool}
               isRunning={!tool.result && r.status === 'running'}
               formatToolData={formatToolData}
              />
             );
            }
            return (
             <div key={tool.toolCallId || idx} className="admin-tool-pill">
              <Terminal size={12}/>
              <code>{tool.name}</code>
              {tool.args?.command && <small className="muted-meta">{tool.args.command}</small>}
              {tool.result && <Check size={11} className="tone-ok-text"/>}
             </div>
            );
           })}

           {textOutput && <Markdown>{textOutput}</Markdown>}
           {r.error && <div className="note note-bad">{r.error}</div>}
           {(() => {
            const activeRunJobs = getJobsForRun(r.id);
            if (!activeRunJobs.length) return null;
            return (
             <div className="admin-session-cards stack-xs" style={{ marginTop: '0.75rem' }}>
              {activeRunJobs.map((j: Item) => {
               const proj = state.projects?.find((p: Item) => p.id === j.projectId);
               const repo = state.repos?.find((r: Item) => r.id === j.repoId);
               return (
                <div key={j.id} className="admin-session-card">
                 <div className="admin-session-card-left">
                  <div className="admin-session-card-title-row">
                   <Sparkles size={14} style={{ color: 'var(--accent)' }}/>
                   <strong style={{ fontSize: '13px' }}>{j.title}</strong>
                   <span className="tag tag-sm" style={{ textTransform: 'capitalize' }}>{j.status}</span>
                  </div>
                  <div className="admin-session-card-meta muted" style={{ fontSize: '12px' }}>
                   <Dot status={j.status}/>
                   <span>Project: <strong>{proj?.name || 'Orchestra'}</strong></span>
                   {repo && <span>· Repo: <strong>{repo.name}</strong></span>}
                   <span>· Kind: {j.kind}</span>
                  </div>
                 </div>
                 <button
                  type="button"
                  className="btn btn-sm btn-primary"
                  onClick={() => onJob(j.id)}
                  style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}
                 >
                  <span>Open Session</span>
                  <ExternalLink size={12}/>
                 </button>
                </div>
               );
              })}
             </div>
            );
           })()}
          </article>
         );
        })}
        <div ref={end}/>
       </div>
      </div>

      <div className="assistant-composer-wrap">
       <form
        className="assistant-composer-inner"
        onSubmit={e => { e.preventDefault(); void send(); }}
        onDrop={attachmentState.handleDrop}
        onDragOver={e => e.preventDefault()}
       >
        <textarea
         rows={3}
         placeholder="Instruct System Assistant… (⌘Enter to send)"
         value={message}
         onChange={e => setMessage(e.target.value)}
         onKeyDown={e => {
          if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
           e.preventDefault();
           void send();
          }
         }}
        />

        <div className="admin-composer-foot">
         <div className="toolbar-actions">
          <AttachmentInput
           images={attachmentState.images}
           attachments={attachmentState.attachments}
           onAdd={attachmentState.addFiles}
           onRemoveImage={attachmentState.removeImage}
           onRemoveAttachment={attachmentState.removeAttachment}
           disabled={busy}
          />
          <VoiceButton
           disabled={busy}
           onTranscript={chunk => setMessage(m => m ? `${m.trimEnd()} ${chunk}` : chunk)}
          />
         </div>
         {running ? (
          <button
           type="button"
           className="btn btn-sm btn-danger"
           disabled={busy}
           onClick={() => void perform(() => api(`/admin/threads/${thread}/stop`, 'POST', {}))}
          >
           <Square size={12}/><span>Stop</span>
          </button>
         ) : (
          <button
           type="submit"
           className="btn btn-sm btn-primary"
           disabled={busy || (!message.trim() && !attachmentState.images.length && !attachmentState.attachments.length) || !selected || !model}
          >
           <Send size={12}/><span>Send</span>
          </button>
         )}
        </div>
       </form>
      </div>
     </div>
    )}

    {/* Tab: Approvals */}
    {tab === 'approvals' && (
     <div className="admin-scroll-pane stack-md" style={{ padding: '20px 24px', maxWidth: 960, margin: '0 auto', width: '100%' }}>
      <div className="section-bar">
       <div>
        <h2 style={{ fontSize: '15px', fontWeight: 650, margin: 0 }}>Privileged Actions & Approvals</h2>
        <small className="muted">Review, approve, or reject host commands and administrative actions proposed by assistants.</small>
       </div>
       <div className="toolbar-actions">
        <button
         type="button"
         className={`btn btn-sm ${approvalsFilter === 'all' ? 'btn-primary' : ''}`}
         onClick={() => setApprovalsFilter('all')}
        >
         All ({data.actions.length})
        </button>
        <button
         type="button"
         className={`btn btn-sm ${approvalsFilter === 'pending' ? 'btn-primary' : ''}`}
         onClick={() => setApprovalsFilter('pending')}
        >
         Pending ({pending.length})
        </button>
        <button
         type="button"
         className={`btn btn-sm ${approvalsFilter === 'completed' ? 'btn-primary' : ''}`}
         onClick={() => setApprovalsFilter('completed')}
        >
         Resolved ({data.actions.length - pending.length})
        </button>
       </div>
      </div>

      {!filteredActions.length ? (
       <div className="card padded" style={{ textAlign: 'center', padding: '2rem 1rem' }}>
        <Shield size={24} style={{ margin: '0 auto', color: 'var(--muted)' }}/>
        <p className="muted" style={{ marginTop: '0.5rem' }}>No actions found matching filter.</p>
       </div>
      ) : (
       filteredActions.map((a: Item) => {
        const isPending = a.status === 'awaiting_approval';
        return (
         <article key={a.id} className="card padded stack-sm">
          <div className="section-bar">
           <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <strong>{label(a.action?.kind || a.kind || 'Action')}</strong>
            <span className="tag">{label(a.status || 'unknown')}</span>
            {a.approvalMode === 'yolo' && <span className="tag">YOLO</span>}
           </div>
           <div className="toolbar-actions">
            <span className="muted-meta">{ago(a.created)}</span>
            <button
             type="button"
             className="icon-btn"
             title="Dismiss / delete action"
             onClick={() => setConfirmDeleteActionId(a.id)}
            >
             <Trash2 size={13}/>
            </button>
           </div>
          </div>

          {a.reason && <p style={{ fontSize: '13px', margin: 0 }}>{a.reason}</p>}

          {a.action && (
           <pre className="code-snippet" style={{ maxHeight: '180px', overflowY: 'auto' }}>
            {JSON.stringify(a.action, null, 2)}
           </pre>
          )}

          {isPending && (
           <div className="toolbar-actions" style={{ gap: '8px', paddingTop: '4px' }}>
            <button
             type="button"
             className="btn btn-sm btn-primary"
             disabled={busy}
             onClick={() => void perform(() => api(`/admin/actions/${a.id}/decision`, 'POST', { decision: 'approve' }))}
            >
             <Check size={13}/>
             <span>Approve</span>
            </button>
            <button
             type="button"
             className="btn btn-sm"
             disabled={busy}
             onClick={() => void perform(() => api(`/admin/actions/${a.id}/decision`, 'POST', { decision: 'reject' }))}
            >
             <X size={13}/>
             <span>Reject</span>
            </button>
           </div>
          )}

          {a.log && (
           <details>
            <summary className="muted-meta" style={{ cursor: 'pointer', padding: '2px 0' }}>Show execution output</summary>
            <pre className="terminal" style={{ maxHeight: '200px', marginTop: '4px' }}>{a.log}</pre>
           </details>
          )}

          {a.error && (
           <div className="note note-bad" style={{ fontSize: '12px' }}>
            <AlertCircle size={13}/>
            <span>{a.error}</span>
           </div>
          )}
         </article>
        );
       })
      )}
     </div>
    )}

    {/* Tab: Plugins */}
    {tab === 'plugins' && (
     <div className="admin-scroll-pane stack-md" style={{ padding: '20px 24px', maxWidth: 960, margin: '0 auto', width: '100%' }}>
      <form className="card padded stack-xs" onSubmit={e => { e.preventDefault(); void requestAction({ kind: 'plugin_install', source }, `Install Pi package ${source}`); }}>
       <span className="field-label">Install Pi package</span>
       <input required placeholder="npm:@scope/pi-package@1.0.0" value={source} onChange={e => setSource(e.target.value)}/>
       <button type="submit" className="btn btn-sm btn-primary" disabled={busy} style={{ alignSelf: 'flex-start' }}>Request install</button>
      </form>

      <details className="card padded">
       <summary style={{ cursor: 'pointer', fontWeight: 600, fontSize: 13 }}>Draft custom TypeScript extension</summary>
       <form className="stack-xs" style={{ marginTop: 8 }} onSubmit={e => { e.preventDefault(); void perform(async () => { await api('/admin/plugins', 'POST', { name: pluginName, content }); setPluginName(''); setContent(''); }); }}>
        <input required placeholder="Extension name" value={pluginName} onChange={e => setPluginName(e.target.value)}/>
        <textarea required rows={5} value={content} onChange={e => setContent(e.target.value)} placeholder="export default function (pi) { … }"/>
        <button type="submit" className="btn btn-sm btn-primary" disabled={busy} style={{ alignSelf: 'flex-start' }}>Save draft</button>
       </form>
      </details>

      <div className="stack-sm">
       <span className="field-label">Installed Pi Extensions & Packages</span>
       {!data.plugins.length && <p className="muted">No packages or extensions installed.</p>}
       {data.plugins.map((p: Item) => (
        <article key={p.id} className="card padded stack-xs">
         <div className="section-bar">
          <strong>{p.name}</strong>
          <span className="tag">{p.status}</span>
         </div>
         <div className="toolbar-actions">
          {p.name === 'npm:agy-pi' && p.status === 'enabled' && !connections.some((c: Item) => c.provider === 'agy') && (
           <button type="button" className="btn btn-sm btn-primary" disabled={busy} onClick={async () => { await api('/connections', 'POST', { name: 'Agy CLI', provider: 'agy', shared: true }); await refresh(); setData(await api('/admin')); }}>Connect Agy</button>
          )}
          {p.kind === 'extension' ? (
           <button type="button" className="btn btn-sm" disabled={busy} onClick={() => void requestAction({ kind: p.status === 'enabled' ? 'extension_disable' : 'extension_enable', pluginId: p.id, digest: p.digest }, `${p.status === 'enabled' ? 'Disable' : 'Enable'} ${p.name}`)}>
            {p.status === 'enabled' ? 'Disable' : 'Enable'}
           </button>
          ) : p.status !== 'removed' && (
           <>
            <button type="button" className="btn btn-sm" disabled={busy} onClick={() => void requestAction({ kind: 'plugin_update', source: p.source }, `Update ${p.name}`)}>Update</button>
            <button type="button" className="btn btn-sm" disabled={busy} onClick={() => void requestAction({ kind: 'plugin_remove', source: p.source }, `Remove ${p.name}`)}>Remove</button>
           </>
          )}
         </div>
        </article>
       ))}
      </div>
     </div>
    )}

    {/* Tab: Runs */}
    {tab === 'work' && (
     <div className="admin-scroll-pane stack-md" style={{ padding: '20px 24px', maxWidth: 960, margin: '0 auto', width: '100%' }}>
      <div className="section-bar">
       <div>
        <h2 style={{ fontSize: '15px', fontWeight: 650, margin: 0 }}>Self-Modification Sessions</h2>
        <small className="muted">Jobs initiated by System Assistant to adapt or improve Orchestra.</small>
       </div>
      </div>
      {data.selfJobs.length === 0 && <p className="muted">No self-modification sessions yet.</p>}
      {[...data.selfJobs].reverse().map((j: Item) => (
       <button key={j.id} type="button" className="row-item" onClick={() => onJob(j.id)}>
        <div className="row-main"><strong>{j.title}</strong></div>
        <span className="tag">{label(j.status)}</span>
        <ExternalLink size={12}/>
       </button>
      ))}
     </div>
    )}
   </main>

   {/* Confirm delete thread modal */}
   {confirmDeleteThreadId && (
    <Confirm
     title="Delete conversation"
     body="Permanently delete this conversation and all associated message turns?"
     danger
     action="Delete"
     onConfirm={() => deleteThread(confirmDeleteThreadId)}
     onClose={() => setConfirmDeleteThreadId(null)}
    />
   )}

   {/* Confirm delete action modal */}
   {confirmDeleteActionId && (
    <Confirm
     title="Dismiss action"
     body="Permanently remove this action from the approvals log?"
     danger
     action="Dismiss"
     onConfirm={() => deleteAction(confirmDeleteActionId)}
     onClose={() => setConfirmDeleteActionId(null)}
    />
   )}
  </div>
 );
}

/** Backwards-compatible drawer wrapper */
export function AdminConsole({
 api,
 me,
 state,
 catalog,
 context,
 onJob,
 refresh,
 open,
 onClose,
 onPendingCount
}: {
 api: Api;
 me: Item;
 state: Item;
 catalog: Item[];
 context: Item;
 onJob: (id: string) => void;
 refresh: () => Promise<void>;
 open?: boolean;
 onClose?: () => void;
 onPendingCount?: (count: number) => void;
}) {
 useEffect(() => {
  if (onPendingCount) {
   api('/admin').then(d => {
    const pending = d.actions?.filter((a: Item) => a.status === 'awaiting_approval')?.length || 0;
    onPendingCount(pending);
   }).catch(() => {});
  }
 }, [api, onPendingCount]);

 if (!open) return null;

 return (
  <aside className="admin-drawer" aria-label="System Assistant">
   <header className="admin-drawer-header">
    <div className="row-title-line">
     <Sparkles size={15}/>
     <strong>System Assistant</strong>
     <span className="tag">Admin</span>
    </div>
    {onClose && (
     <button type="button" className="icon-btn" aria-label="Close" onClick={onClose}>
      <X size={16}/>
     </button>
    )}
   </header>
   <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
    <SystemAssistantPage
     api={api}
     me={me}
     state={state}
     catalog={catalog}
     context={context}
     onJob={onJob}
     refresh={refresh}
    />
   </div>
  </aside>
 );
}
