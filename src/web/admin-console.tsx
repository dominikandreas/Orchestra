import React, { useEffect, useState, useRef, useMemo, useCallback } from 'react';
import {
 MessageSquare, X, Plus, Send, Square, Sparkles, Shield, Package,
 ChevronRight, ChevronDown, Loader2, ExternalLink, Terminal, Check, AlertCircle, Brain,
 Trash2, Search, SlidersHorizontal, ArrowLeft, RotateCw, CheckCircle2, Zap,
 GitFork, Pencil, BookOpen, Copy, Minimize2, Hash
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

export type ThreadNode = Item & {
 children: ThreadNode[];
};

export function buildThreadTree(threads: Item[]): ThreadNode[] {
 const nodeMap = new Map<string, ThreadNode>();
 for (const t of threads) {
  nodeMap.set(t.id, { ...t, children: [] });
 }
 const roots: ThreadNode[] = [];
 for (const t of threads) {
  const node = nodeMap.get(t.id)!;
  if (t.parentThreadId && nodeMap.has(t.parentThreadId)) {
   nodeMap.get(t.parentThreadId)!.children.push(node);
  } else {
   roots.push(node);
  }
 }
 return roots;
}

export function groupThreadsByDate(threads: Item[], query = '') {
 const q = query.trim().toLowerCase();
 const roots = buildThreadTree(threads);

 const sortNodes = (nodes: ThreadNode[]) => {
  nodes.sort((a, b) => {
   const tb = new Date(b.updated || b.created || 0).getTime();
   const ta = new Date(a.updated || a.created || 0).getTime();
   return tb - ta;
  });
  for (const n of nodes) {
   if (n.children.length) sortNodes(n.children);
  }
 };
 sortNodes(roots);

 const filterNode = (node: ThreadNode): boolean => {
  if (!q) return true;
  if ((node.title || '').toLowerCase().includes(q)) return true;
  return node.children.some(child => filterNode(child));
 };

 const filteredRoots = roots.filter(filterNode);

 const now = new Date();
 const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
 const startOfYesterday = startOfToday - 86400000;
 const startOf7Days = startOfToday - 6 * 86400000;

 const today: ThreadNode[] = [];
 const yesterday: ThreadNode[] = [];
 const past7Days: ThreadNode[] = [];
 const older: ThreadNode[] = [];

 for (const t of filteredRoots) {
  const time = new Date(t.updated || t.created || 0).getTime();
  if (time >= startOfToday) today.push(t);
  else if (time >= startOfYesterday) yesterday.push(t);
  else if (time >= startOf7Days) past7Days.push(t);
  else older.push(t);
 }

 const groups: { title: string; items: ThreadNode[] }[] = [];
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
 const [tab, setTab] = useState<'chat' | 'skills' | 'approvals' | 'plugins' | 'work'>('chat');
 const [data, setData] = useState<Item>({ threads: [], runs: [], actions: [], plugins: [], selfJobs: [], deployments: [], skills: [] });
 const [thread, setThread] = useState(initialThreadId || '');
 const [chat, setChat] = useState<Item>({ messages: [], runs: [] });
 const [message, setMessage] = useState('');
 const [searchQuery, setSearchQuery] = useState('');
 const [approvalsFilter, setApprovalsFilter] = useState<'all' | 'pending' | 'completed'>('all');
 const [confirmDeleteThreadId, setConfirmDeleteThreadId] = useState<string | null>(null);
 const [confirmDeleteActionId, setConfirmDeleteActionId] = useState<string | null>(null);
 const [confirmDeleteMessageId, setConfirmDeleteMessageId] = useState<string | null>(null);
 const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
 const [editingText, setEditingText] = useState('');
 const [forkModal, setForkModal] = useState<{ threadId: string; messageId?: string; title: string } | null>(null);
 const [expandedThreads, setExpandedThreads] = useState<Record<string, boolean>>({});
 const [compactModal, setCompactModal] = useState(false);
 const [compactInstructions, setCompactInstructions] = useState('');
 const [compacting, setCompacting] = useState(false);
 const [successNotice, setSuccessNotice] = useState<string | null>(null);

 const [newSkillModal, setNewSkillModal] = useState(false);
 const [skillName, setSkillName] = useState('');
 const [skillDesc, setSkillDesc] = useState('');
 const [skillContent, setSkillContent] = useState('');
 const [skillProject, setSkillProject] = useState('');
 const [skillActive, setSkillActive] = useState(true);

 const [connection, setConnection] = useState(localStorage.getItem('orchestra.admin.connection') || '');
 const [model, setModel] = useState(localStorage.getItem('orchestra.admin.model') || '');
 const [thinkingLevel, setThinkingLevel] = useState(localStorage.getItem('orchestra.admin.thinkingLevel') || 'off');
 const [error, setError] = useState('');
 const [busy, setBusy] = useState(false);
 const [source, setSource] = useState('');
 const [pluginName, setPluginName] = useState('');
 const [content, setContent] = useState('');
 const [localCatalog, setLocalCatalog] = useState<Item[]>(catalog || []);
 const attachmentState = useAttachmentState();
 const end = useRef<HTMLDivElement>(null);
 const streamWrapRef = useRef<HTMLDivElement>(null);

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
   if (streamWrapRef.current) {
    streamWrapRef.current.scrollTop = streamWrapRef.current.scrollHeight;
   }
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

 const saveEditedMessage = async (messageId: string) => {
  if (!thread || !editingText.trim()) return;
  setBusy(true); setError('');
  try {
   await api(`/admin/threads/${thread}/messages/${messageId}`, 'PATCH', { text: editingText.trim() });
   setChat(prev => ({
    ...prev,
    messages: prev.messages.map((item: Item) => item.id === messageId ? { ...item, text: editingText.trim() } : item)
   }));
   setEditingMessageId(null);
   await load();
  } catch (e: any) {
   setError(e.message);
  } finally {
   setBusy(false);
  }
 };

 const deleteMessage = async (messageId: string) => {
  if (!thread) return;
  setBusy(true); setError('');
  try {
   await api(`/admin/threads/${thread}/messages/${messageId}`, 'DELETE');
   setChat(prev => ({
    ...prev,
    messages: prev.messages.filter((item: Item) => item.id !== messageId)
   }));
   setConfirmDeleteMessageId(null);
   await load();
  } catch (e: any) {
   setError(e.message);
  } finally {
   setBusy(false);
  }
 };

 const openForkModal = (targetThreadId: string, targetMessageId?: string) => {
  const t = data.threads.find((x: Item) => x.id === targetThreadId);
  const baseTitle = t?.title || 'Conversation';
  setForkModal({
   threadId: targetThreadId,
   messageId: targetMessageId,
   title: `Fork of ${baseTitle}`
  });
 };

 const handleForkSubmit = async () => {
  if (!forkModal) return;
  setBusy(true); setError('');
  try {
   const forked = await api(`/admin/threads/${forkModal.threadId}/fork`, 'POST', {
    title: forkModal.title.trim() || undefined,
    messageId: forkModal.messageId || undefined
   });
   setExpandedThreads(prev => ({ ...prev, [forkModal.threadId]: true }));
   setForkModal(null);
   await load();
   selectThread(forked.id);
  } catch (e: any) {
   setError(e.message);
  } finally {
   setBusy(false);
  }
 };

 const formatTokenCount = (num: number): string => {
  if (!num || num < 0) return '0';
  if (num < 1000) return String(num);
  if (num < 1000000) return (num / 1000).toFixed(num >= 10000 ? 1 : 1).replace(/\.0$/, '') + 'k';
  return (num / 1000000).toFixed(2).replace(/\.00$/, '') + 'M';
 };

 const handleCompact = async () => {
  if (!thread) return;
  setCompacting(true);
  try {
   const res = await api(`/admin/threads/${thread}/compact`, 'POST', {
    instructions: compactInstructions.trim() || undefined,
    connectionId: selected?.id || connection,
    model
   });
   setCompactModal(false);
   setCompactInstructions('');
   const beforeStr = res.tokensBefore ? `${formatTokenCount(res.tokensBefore)} tokens summarized` : 'history summarized';
   setSuccessNotice(`Context compacted: ${beforeStr}`);
   const refreshed = await api(`/admin/threads/${thread}`);
   setChat(refreshed);
   setTimeout(() => setSuccessNotice(null), 6000);
  } catch (err: any) {
   alert('Compaction failed: ' + (err?.message || err));
  } finally {
   setCompacting(false);
  }
 };

 const createSkill = async () => {
  setBusy(true); setError('');
  try {
   const res = await api('/resources', 'POST', {
    name: skillName.trim(),
    description: skillDesc.trim(),
    kind: 'skill',
    content: skillContent.trim(),
    projectId: skillProject || undefined
   });
   if (skillActive) {
    await api(`/resources/${res.id}/activate`, 'POST', {});
   }
   setNewSkillModal(false);
   setSkillName('');
   setSkillDesc('');
   setSkillContent('');
   setSkillProject('');
   setSkillActive(true);
   await load();
  } catch (e: any) {
   setError(e.message);
  } finally {
   setBusy(false);
  }
 };

 // Auto-expand ancestors of active thread
 useEffect(() => {
  if (!thread || !data.threads?.length) return;
  const threadMap = new Map<string, Item>(data.threads.map((t: Item) => [t.id, t]));
  let cur = threadMap.get(thread);
  const toExpand: Record<string, boolean> = {};
  while (cur && cur.parentThreadId) {
   toExpand[cur.parentThreadId] = true;
   cur = threadMap.get(cur.parentThreadId);
  }
  if (Object.keys(toExpand).length > 0) {
   setExpandedThreads(prev => ({ ...prev, ...toExpand }));
  }
 }, [thread, data.threads]);

 const isNodeExpanded = (nodeId: string, nodeChildren: ThreadNode[]) => {
  if (searchQuery.trim()) {
   const q = searchQuery.trim().toLowerCase();
   const hasMatchingDescendant = (n: ThreadNode): boolean => {
    if ((n.title || '').toLowerCase().includes(q)) return true;
    return n.children.some(hasMatchingDescendant);
   };
   if (nodeChildren.some(hasMatchingDescendant)) return true;
  }
  return expandedThreads[nodeId] ?? false;
 };

 const renderThreadNode = (node: ThreadNode, depth = 0): React.ReactNode => {
  const hasChildren = node.children.length > 0;
  const isExpanded = isNodeExpanded(node.id, node.children);
  const isActive = node.id === thread;

  return (
   <div key={node.id} className="assistant-thread-tree-node">
    <div
     role="button"
     tabIndex={0}
     className={`assistant-thread-btn ${isActive ? 'active' : ''}`}
     onClick={() => selectThread(node.id)}
     onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); selectThread(node.id); } }}
     style={{ paddingLeft: depth > 0 ? `${depth * 12 + 6}px` : undefined }}
    >
     {hasChildren ? (
      <button
       type="button"
       className="assistant-chevron-btn"
       title={isExpanded ? 'Collapse forked sessions' : 'Expand forked sessions'}
       onClick={e => {
        e.stopPropagation();
        setExpandedThreads(prev => ({ ...prev, [node.id]: !isExpanded }));
       }}
      >
       {isExpanded ? <ChevronDown size={13}/> : <ChevronRight size={13}/>}
      </button>
     ) : depth > 0 ? (
      <GitFork size={12} style={{ flexShrink: 0, marginTop: 2, color: 'var(--muted)', transform: 'rotate(90deg)' }}/>
     ) : (
      <MessageSquare size={13} style={{ flexShrink: 0, marginTop: 2 }}/>
     )}

     <div className="assistant-thread-info">
      <div style={{ display: 'flex', alignItems: 'center', gap: 4, minWidth: 0 }}>
       <span className="assistant-thread-title">{node.title || 'Conversation'}</span>
       {hasChildren && (
        <span className="assistant-fork-badge" title={`${node.children.length} forked session${node.children.length === 1 ? '' : 's'}`}>
         <GitFork size={9}/>
         <span>{node.children.length}</span>
        </span>
       )}
      </div>
      <span className="assistant-thread-date">{ago(node.updated || node.created)}</span>
     </div>

     <div className="assistant-thread-actions">
      <button
       type="button"
       className="assistant-thread-action-btn"
       title="Fork conversation"
       onClick={e => {
        e.stopPropagation();
        openForkModal(node.id);
       }}
      >
       <GitFork size={12}/>
      </button>
      <button
       type="button"
       className="assistant-thread-action-btn del"
       title="Delete conversation"
       onClick={e => {
        e.stopPropagation();
        setConfirmDeleteThreadId(node.id);
       }}
      >
       <Trash2 size={12}/>
      </button>
     </div>
    </div>

    {hasChildren && isExpanded && (
     <div className="assistant-thread-children">
      {node.children.map(child => renderThreadNode(child, depth + 1))}
     </div>
    )}
   </div>
  );
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

 type TimelineEntry =
  | { kind: 'message'; data: Item; created: string; role: string }
  | { kind: 'run'; data: Item; created: string; role: string }
  | { kind: 'compaction'; data: Item; created: string; role: string };

 const timelineEntries = useMemo(() => {
  const completedAssistantRunIds = new Set(
   (chat.messages || []).filter((m: Item) => m.role === 'assistant' && m.runId).map((m: Item) => m.runId)
  );

  const unfinalizedRuns = (chat.runs || []).filter((r: Item) =>
   !completedAssistantRunIds.has(r.id) &&
   (r.status === 'running' || r.status === 'failed' || r.status === 'interrupted' || r.status === 'cancelled' ||
    r.events?.some((e: Item) => e.type === 'text' || e.type === 'result'))
  );

  const items: TimelineEntry[] = [
   ...(chat.messages || []).map((m: Item) => ({
    kind: 'message' as const,
    data: m,
    created: m.created || '',
    role: m.role || 'user'
   })),
   ...unfinalizedRuns.map((r: Item) => ({
    kind: 'run' as const,
    data: r,
    created: r.created || '',
    role: 'assistant'
   })),
   ...(chat.compactions || []).map((c: Item) => ({
    kind: 'compaction' as const,
    data: c,
    created: c.timestamp || '',
    role: 'system'
   }))
  ];

  return items.sort((a, b) => {
   const ta = new Date(a.created || 0).getTime();
   const tb = new Date(b.created || 0).getTime();
   if (ta !== tb) return ta - tb;
   const diff = (a.created || '').localeCompare(b.created || '');
   if (diff !== 0) return diff;
   if (a.role === 'user' && b.role === 'assistant') return -1;
   if (a.role === 'assistant' && b.role === 'user') return 1;
   return 0;
  });
 }, [chat.messages, chat.runs, chat.compactions]);

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

 const renderMessageTurn = (m: Item) => {
  const linkedRun = m.runId ? chat.runs?.find((r: Item) => r.id === m.runId) : null;
  const runThinking = linkedRun?.events?.filter((e: Item) => e.type === 'thinking').map((e: Item) => e.data).join('');
  const associatedJobs = getJobsForRun(m.runId);
  const isEditing = editingMessageId === m.id;
  return (
   <article key={`msg-${m.id}`} className={`turn ${m.role === 'user' ? 'turn-user' : 'turn-agent'}`}>
    <header className="turn-meta">
     <span className="turn-author">{m.role === 'user' ? (me.name || 'Admin') : 'Assistant'}</span>
     {m.created && <span className="muted-meta">{ago(m.created)}</span>}
     <div className="turn-actions-bar">
      <button
       type="button"
       className="turn-action-btn"
       title="Fork conversation up to this message"
       onClick={() => openForkModal(thread, m.id)}
      >
       <GitFork size={11}/>
       <span>Fork</span>
      </button>
      <button
       type="button"
       className="turn-action-btn"
       title="Edit message"
       onClick={() => {
        setEditingMessageId(m.id);
        setEditingText(m.text || '');
       }}
      >
       <Pencil size={11}/>
       <span>Edit</span>
      </button>
      <button
       type="button"
       className="turn-action-btn turn-action-del"
       title="Delete message"
       onClick={() => setConfirmDeleteMessageId(m.id)}
      >
       <Trash2 size={11}/>
       <span>Delete</span>
      </button>
     </div>
    </header>
    {runThinking && <ThinkingBlock text={runThinking} isLive={false} defaultOpen={false}/>}
    {isEditing ? (
     <div className="message-edit-box">
      <textarea
       rows={4}
       value={editingText}
       onChange={e => setEditingText(e.target.value)}
       autoFocus
      />
      <div className="toolbar-actions" style={{ justifyContent: 'flex-end', gap: 6, marginTop: 4 }}>
       <button
        type="button"
        className="btn btn-xs btn-secondary"
        onClick={() => setEditingMessageId(null)}
       >
        Cancel
       </button>
       <button
        type="button"
        className="btn btn-xs btn-primary"
        disabled={busy || !editingText.trim()}
        onClick={() => void saveEditedMessage(m.id)}
       >
        Save
       </button>
      </div>
     </div>
    ) : (
     <>
      <Markdown>{m.text}</Markdown>
      <MessageAttachments images={m.images} attachments={m.attachments}/>
     </>
    )}
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
 };

 const renderRunTurn = (r: Item) => {
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

  const activeRunJobs = getJobsForRun(r.id);

  return (
   <article key={`run-${r.id}`} className="turn turn-agent">
    <header className="turn-meta">
     <span className="turn-author">Assistant</span>
     {r.created && <span className="muted-meta">{ago(r.created)}</span>}
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
    {activeRunJobs.length > 0 && (
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
    )}
   </article>
  );
 };

 const renderCompactionDivider = (c: Item) => {
  return (
   <div key={`compact-${c.id || c.timestamp}`} className="chat-compaction-divider">
    <div className="chat-compaction-divider-line"/>
    <div className="chat-compaction-badge" title={c.summary || 'Session history summarized to conserve context'}>
     <Minimize2 size={11}/>
     <span>Context compacted ({c.tokensBefore ? `${formatTokenCount(c.tokensBefore)} tokens summarized` : 'History summarized'})</span>
    </div>
    <div className="chat-compaction-divider-line"/>
   </div>
  );
 };

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
        {group.items.map(node => renderThreadNode(node))}
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
       <button
        type="button"
        className="btn btn-secondary btn-sm"
        disabled={busy || !thread}
        title="Fork this conversation into a new session"
        onClick={() => openForkModal(thread)}
        style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}
       >
        <GitFork size={12}/>
        <span>Fork</span>
       </button>

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
        { id: 'skills' as const, label: 'Skills', count: data.skills?.length || 0, icon: Sparkles },
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
        <span
         className="tag"
         title={`Session Tokens: ${(chat.tokens?.total || 0).toLocaleString()} (Input: ${(chat.tokens?.input || 0).toLocaleString()}, Output: ${(chat.tokens?.output || 0).toLocaleString()}${chat.tokens?.cacheRead ? `, Cache: ${(chat.tokens?.cacheRead || 0).toLocaleString()}` : ''})`}
         style={{ display: 'inline-flex', alignItems: 'center', gap: 4, cursor: 'default' }}
        >
         <Hash size={11} style={{ color: 'var(--accent)' }}/>
         <span>{formatTokenCount(chat.tokens?.total || 0)} tokens</span>
        </span>

        <button
         type="button"
         className="btn btn-secondary btn-sm"
         disabled={busy || compacting || !thread || (chat.messages?.length || 0) === 0 || chat.runs?.some((r: Item) => r.status === 'running')}
         title="Compact session context manually into a summary to reduce token usage"
         onClick={() => setCompactModal(true)}
         style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}
        >
         {compacting ? <Loader2 size={12} className="spin"/> : <Minimize2 size={12}/>}
         <span>Compact</span>
        </button>

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

        {data.skills?.filter((s: Item) => s.active).length > 0 && (
         <button
          type="button"
          className="tag"
          style={{ cursor: 'pointer', border: '1px solid var(--border)', background: 'var(--bg-elevated)', display: 'inline-flex', alignItems: 'center', gap: 4 }}
          onClick={() => setTab('skills')}
          title="Click to view and manage active skills"
         >
          <Sparkles size={11} style={{ color: 'var(--accent)' }}/>
          <span>{data.skills.filter((s: Item) => s.active).length} skills active</span>
         </button>
        )}

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

    {successNotice && (
     <div className="note note-ok" style={{ margin: '8px 24px 0', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }} role="status">
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
       <CheckCircle2 size={13}/>
       <span>{successNotice}</span>
      </span>
      <button type="button" className="icon-btn" onClick={() => setSuccessNotice(null)}><X size={13}/></button>
     </div>
    )}

    {/* Tab: Chat */}
    {tab === 'chat' && (
     <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, height: '100%', overflow: 'hidden' }}>
      <div ref={streamWrapRef} className="assistant-stream-wrap">
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
            'List available agent skills and show how to use them.',
            'Create a new agent skill for deployment verification and health checks.',
            'Propose an improvement to Orchestra in a tracked session.'
           ].map(p => (
            <button key={p} type="button" className="prompt-suggestion" onClick={() => setMessage(p)}>
             <span>{p}</span><ChevronRight size={13}/>
            </button>
           ))}
          </div>
         </div>
        )}

        {timelineEntries.map((entry) => {
         if (entry.kind === 'message') {
          return renderMessageTurn(entry.data);
         } else if (entry.kind === 'run') {
          return renderRunTurn(entry.data);
         } else if (entry.kind === 'compaction') {
          return renderCompactionDivider(entry.data);
         }
         return null;
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

    {/* Tab: Skills */}
    {tab === 'skills' && (
     <div className="admin-scroll-pane stack-md" style={{ padding: '20px 24px', maxWidth: 960, margin: '0 auto', width: '100%' }}>
      <div className="section-bar">
       <div>
        <h2 style={{ fontSize: '15px', fontWeight: 650, margin: 0 }}>Agent Skills & Guidelines</h2>
        <small className="muted">Active skills provide specialized instructions and domain workflows to System Assistant and project agents.</small>
       </div>
       <button
        type="button"
        className="btn btn-sm btn-primary"
        onClick={() => setNewSkillModal(true)}
       >
        <Plus size={13}/>
        <span>New skill</span>
       </button>
      </div>

      {(!data.skills || data.skills.length === 0) ? (
       <div className="card padded" style={{ textAlign: 'center', padding: '2rem 1rem' }}>
        <Sparkles size={24} style={{ margin: '0 auto', color: 'var(--accent)' }}/>
        <h3 style={{ fontSize: 14, fontWeight: 600, marginTop: 8 }}>No agent skills yet</h3>
        <p className="muted" style={{ maxWidth: 480, margin: '4px auto 16px', fontSize: 13 }}>
         Create reusable skills or instruct System Assistant in chat to create skills for you.
        </p>
        <button
         type="button"
         className="btn btn-sm btn-primary"
         onClick={() => setNewSkillModal(true)}
        >
         <Plus size={13}/>
         <span>Create first skill</span>
        </button>
       </div>
      ) : (
       <div className="stack-sm">
        {data.skills.map((s: Item) => (
         <article key={s.id} className="card padded stack-xs">
          <div className="section-bar">
           <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <strong><code>{s.name}</code></strong>
            <span className={`tag ${s.active ? 'tag-accent' : ''}`}>
             {s.active ? 'Active' : 'Draft'}
            </span>
            <span className="muted-meta" style={{ fontSize: 11 }}>v{s.version || 1}</span>
            {s.projectId ? (
             <span className="tag">
              {state.projects?.find((p: Item) => p.id === s.projectId)?.name || 'Project'}
             </span>
            ) : (
             <span className="tag">Workspace-wide</span>
            )}
           </div>
           <div className="toolbar-actions">
            <button
             type="button"
             className="btn btn-xs btn-secondary"
             onClick={() => {
              setTab('chat');
              setMessage(`Please review and apply the "${s.name}" skill.`);
             }}
             title="Ask assistant to use this skill"
            >
             <Sparkles size={11}/>
             <span>Use in chat</span>
            </button>
            <button
             type="button"
             className="btn btn-xs"
             onClick={() => void perform(async () => {
              if (s.active) {
               await api(`/resources/${s.id}`, 'PATCH', { active: false });
              } else {
               await api(`/resources/${s.id}/activate`, 'POST', {});
              }
             })}
            >
             {s.active ? 'Deactivate' : 'Activate'}
            </button>
            <button
             type="button"
             className="icon-btn"
             title="Delete skill"
             onClick={() => void perform(() => api(`/resources/${s.id}`, 'DELETE'))}
            >
             <Trash2 size={12}/>
            </button>
           </div>
          </div>

          {s.description && (
           <p style={{ margin: '2px 0', fontSize: 13, color: 'var(--text-secondary)' }}>
            {s.description}
           </p>
          )}

          <details style={{ marginTop: 4 }}>
           <summary className="muted-meta" style={{ cursor: 'pointer', fontSize: 12 }}>
            View skill instructions ({s.content?.length || 0} chars)
           </summary>
           <pre className="code-snippet" style={{ maxHeight: 240, overflowY: 'auto', marginTop: 6, fontSize: 12 }}>
            {s.content}
           </pre>
          </details>
         </article>
        ))}
       </div>
      )}
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

   {/* Confirm delete message modal */}
   {confirmDeleteMessageId && (
    <Confirm
     title="Delete message"
     body="Permanently remove this message from the conversation?"
     danger
     action="Delete"
     onConfirm={() => deleteMessage(confirmDeleteMessageId)}
     onClose={() => setConfirmDeleteMessageId(null)}
    />
   )}

   {/* Fork conversation modal */}
   {forkModal && (
    <Modal
     title="Fork into separate session"
     onClose={() => setForkModal(null)}
     footer={
      <>
       <button type="button" className="btn btn-secondary" onClick={() => setForkModal(null)}>
        Cancel
       </button>
       <button
        type="button"
        className="btn btn-primary"
        disabled={busy || !forkModal.title.trim()}
        onClick={() => void handleForkSubmit()}
       >
        <GitFork size={13}/>
        <span>Create Fork</span>
       </button>
      </>
     }
    >
     <div className="stack-sm">
      <p className="muted" style={{ fontSize: 13, margin: 0 }}>
       {forkModal.messageId
        ? 'Fork this conversation starting up to the selected message into a new branch.'
        : 'Fork the complete conversation into a new separate branch.'}
      </p>
      <div>
       <label className="field-label">Fork session title</label>
       <input
        type="text"
        value={forkModal.title}
        onChange={e => setForkModal({ ...forkModal, title: e.target.value })}
        autoFocus
        onKeyDown={e => {
         if (e.key === 'Enter') {
          e.preventDefault();
          void handleForkSubmit();
         }
        }}
       />
      </div>
     </div>
    </Modal>
   )}

   {/* Create new skill modal */}
   {newSkillModal && (
    <Modal
     title="Create Agent Skill"
     onClose={() => setNewSkillModal(false)}
     footer={
      <>
       <button type="button" className="btn btn-secondary" onClick={() => setNewSkillModal(false)}>
        Cancel
       </button>
       <button
        type="button"
        className="btn btn-primary"
        disabled={busy || !skillName.trim() || !skillContent.trim()}
        onClick={() => void createSkill()}
       >
        <Sparkles size={13}/>
        <span>Save Skill</span>
       </button>
      </>
     }
    >
     <div className="stack-sm">
      <div className="form-grid-2">
       <div>
        <label className="field-label">Skill Name (identifier)</label>
        <input
         required
         placeholder="e.g. deploy-verification"
         value={skillName}
         onChange={e => setSkillName(e.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, '-'))}
        />
       </div>
       <div>
        <label className="field-label">Scope</label>
        <select value={skillProject} onChange={e => setSkillProject(e.target.value)}>
         <option value="">Workspace-wide (All projects)</option>
         {state.projects?.map((p: Item) => (
          <option key={p.id} value={p.id}>{p.name}</option>
         ))}
        </select>
       </div>
      </div>
      <div>
       <label className="field-label">Description</label>
       <input
        placeholder="Brief summary of when and how this skill is used"
        value={skillDesc}
        onChange={e => setSkillDesc(e.target.value)}
       />
      </div>
      <div>
       <label className="field-label">Skill Instructions & Content</label>
       <textarea
        required
        rows={7}
        placeholder="Detailed instructions, checklist steps, guidelines, or domain rules..."
        value={skillContent}
        onChange={e => setSkillContent(e.target.value)}
       />
      </div>
      <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 13 }}>
       <input
        type="checkbox"
        checked={skillActive}
        onChange={e => setSkillActive(e.target.checked)}
       />
       <span>Activate skill immediately for assistant sessions</span>
      </label>
     </div>
    </Modal>
   )}

   {/* Compact session modal */}
   {compactModal && (
    <Modal
     title="Compact Session Context"
     onClose={() => setCompactModal(false)}
     footer={
      <>
       <button type="button" className="btn btn-secondary" onClick={() => setCompactModal(false)}>
        Cancel
       </button>
       <button
        type="button"
        className="btn btn-primary"
        disabled={compacting}
        onClick={() => void handleCompact()}
       >
        {compacting ? <Loader2 size={13} className="spin"/> : <Minimize2 size={13}/>}
        <span>Compact Context</span>
       </button>
      </>
     }
    >
     <div className="stack-sm">
      <p className="muted" style={{ fontSize: 13, margin: 0 }}>
       Compact earlier conversation messages into a concise summary to reduce context and token usage. Recent turns will be retained.
      </p>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
       <span className="muted">Current session tokens:</span>
       <strong>{(chat.tokens?.total || 0).toLocaleString()}</strong>
      </div>
      <div>
       <label className="field-label">Focus instructions (optional)</label>
       <input
        placeholder="e.g. Keep key decisions, job IDs, and deployment instructions"
        value={compactInstructions}
        onChange={e => setCompactInstructions(e.target.value)}
        autoFocus
        onKeyDown={e => {
         if (e.key === 'Enter') {
          e.preventDefault();
          void handleCompact();
         }
        }}
       />
      </div>
     </div>
    </Modal>
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
