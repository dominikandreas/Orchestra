import React,{useEffect,useRef,useState,useMemo} from 'react';
import {
 ArrowLeft,ArrowRight,BookOpen,FileText,FileCode,FolderGit2,GitPullRequest,Plus,RefreshCw,
 Save,Search,Sparkles,Zap,Image,Video,Music,Download,ExternalLink,MessageSquare,Check,
 Copy,X,ZoomIn,ZoomOut,Eye,Code,Send,CheckCircle2,AlertCircle
} from 'lucide-react';
import {api,ago,attentionStatuses,triggerLabel,token,type Item} from './lib';
import {ErrorNote,Spinner,Status,useWorkspace} from './ui';
import {Markdown} from './markdown';
import {ProjectConversation} from './project-conversation';
import {PlannedChangeButton} from './planned-change';
import {NewSessionModal} from './pages';
import {buildModelChoices} from './composer';
import hljs from 'highlight.js';
import 'highlight.js/styles/atom-one-dark.css';
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
function formatBytes(bytes?: number): string {
 if (bytes == null || isNaN(bytes)) return '';
 if (bytes < 1024) return `${bytes} B`;
 if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
 return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const EXT_TO_LANG: Record<string, string> = {
 ts: 'typescript',
 tsx: 'typescript',
 js: 'javascript',
 jsx: 'javascript',
 mjs: 'javascript',
 cjs: 'javascript',
 json: 'json',
 md: 'markdown',
 markdown: 'markdown',
 py: 'python',
 rs: 'rust',
 go: 'go',
 java: 'java',
 c: 'c',
 h: 'c',
 cpp: 'cpp',
 cc: 'cpp',
 cxx: 'cpp',
 hpp: 'cpp',
 cs: 'csharp',
 rb: 'ruby',
 php: 'php',
 swift: 'swift',
 kt: 'kotlin',
 kts: 'kotlin',
 html: 'xml',
 htm: 'xml',
 xml: 'xml',
 svg: 'xml',
 css: 'css',
 scss: 'scss',
 less: 'less',
 yaml: 'yaml',
 yml: 'yaml',
 toml: 'ini',
 ini: 'ini',
 sh: 'bash',
 bash: 'bash',
 zsh: 'bash',
 sql: 'sql',
 dockerfile: 'dockerfile',
 diff: 'diff',
 patch: 'diff',
 graphql: 'graphql',
 gql: 'graphql',
 proto: 'protobuf',
 makefile: 'makefile',
 mk: 'makefile'
};

function getLanguage(path: string): string {
 const filename = path.split('/').pop()?.toLowerCase() || '';
 if (filename === 'dockerfile') return 'dockerfile';
 if (filename === 'makefile') return 'makefile';
 const ext = filename.split('.').pop() || '';
 return EXT_TO_LANG[ext] || '';
}

function getFileCategory(path: string): 'folder' | 'image' | 'video' | 'audio' | 'pdf' | 'markdown' | 'code' | 'file' {
 const ext = path.split('.').pop()?.toLowerCase() || '';
 if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'ico', 'avif'].includes(ext)) return 'image';
 if (['mp4', 'webm', 'ogv', 'ogg', 'mov'].includes(ext)) return 'video';
 if (['mp3', 'wav', 'oga', 'm4a', 'aac', 'flac'].includes(ext)) return 'audio';
 if (ext === 'pdf') return 'pdf';
 if (['md', 'markdown'].includes(ext)) return 'markdown';
 if (['ts', 'tsx', 'js', 'jsx', 'json', 'py', 'rs', 'go', 'html', 'css', 'scss', 'yml', 'yaml', 'sh', 'bash', 'sql', 'c', 'h', 'cpp', 'java', 'xml', 'toml', 'ini', 'dockerfile'].includes(ext)) return 'code';
 return 'file';
}

function escapeHtml(text: string): string {
 return text
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#39;');
}

function splitHighlightedLines(html: string): string[] {
 const lines = html.split('\n');
 const result: string[] = [];
 const openStack: string[] = [];
 const tagRegex = /<span class="([^"]+)">|<\/span>/g;

 for (let i = 0; i < lines.length; i++) {
  const line = lines[i];
  const prefix = openStack.map(cls => `<span class="${cls}">`).join('');
  let match: RegExpExecArray | null;
  tagRegex.lastIndex = 0;
  while ((match = tagRegex.exec(line)) !== null) {
   if (match[1]) {
    openStack.push(match[1]);
   } else {
    openStack.pop();
   }
  }
  const suffix = '</span>'.repeat(openStack.length);
  result.push(prefix + line + suffix);
 }
 return result;
}

function EntryIcon({ type, path }: { type: string; path: string }) {
 if (type === 'tree') return <FolderGit2 size={15} className="pw-icon-folder"/>;
 const cat = getFileCategory(path);
 switch (cat) {
  case 'image': return <Image size={15} className="pw-icon-image"/>;
  case 'video': return <Video size={15} className="pw-icon-video"/>;
  case 'audio': return <Music size={15} className="pw-icon-audio"/>;
  case 'markdown': return <BookOpen size={15} className="pw-icon-markdown"/>;
  case 'code': return <FileCode size={15} className="pw-icon-code"/>;
  default: return <FileText size={15} className="pw-icon-file"/>;
 }
}

function ImageViewer({ url, filename, size }: { url: string; filename: string; size?: number }) {
 const [zoom, setZoom] = useState(1);
 const [dimensions, setDimensions] = useState<{ width: number; height: number } | null>(null);

 return (
  <div className="pw-media-view">
   <div className="pw-media-toolbar">
    <button type="button" className="btn btn-xs" onClick={() => setZoom(z => Math.max(0.25, parseFloat((z - 0.25).toFixed(2))))} title="Zoom out">
     <ZoomOut size={13}/>
    </button>
    <span style={{ minWidth: 40, textAlign: 'center' }}>{Math.round(zoom * 100)}%</span>
    <button type="button" className="btn btn-xs" onClick={() => setZoom(z => Math.min(4, parseFloat((z + 0.25).toFixed(2))))} title="Zoom in">
     <ZoomIn size={13}/>
    </button>
    <button type="button" className="btn btn-xs" onClick={() => setZoom(1)} title="Fit image">
     Fit
    </button>
    {dimensions && <span>· {dimensions.width} × {dimensions.height} px</span>}
    {size ? <span>· {formatBytes(size)}</span> : null}
   </div>
   <div className="pw-checkerboard" style={{ maxHeight: 540, width: '100%', boxSizing: 'border-box' }}>
    <img
     className="pw-image-preview"
     src={url}
     alt={filename}
     style={{ transform: `scale(${zoom})`, transformOrigin: 'center center' }}
     onLoad={e => {
      const img = e.currentTarget;
      setDimensions({ width: img.naturalWidth, height: img.naturalHeight });
     }}
    />
   </div>
  </div>
 );
}

function VideoViewer({ url, filename, size }: { url: string; filename: string; size?: number }) {
 const [meta, setMeta] = useState<{ width: number; height: number; duration: number } | null>(null);

 return (
  <div className="pw-media-view">
   <div className="pw-media-toolbar">
    <Video size={14}/>
    <strong>{filename}</strong>
    {meta && <span>· {meta.width} × {meta.height}</span>}
    {meta && meta.duration ? <span>· {Math.round(meta.duration)}s</span> : null}
    {size ? <span>· {formatBytes(size)}</span> : null}
   </div>
   <video
    className="pw-video-player"
    controls
    preload="metadata"
    src={url}
    onLoadedMetadata={e => {
     const v = e.currentTarget;
     setMeta({ width: v.videoWidth, height: v.videoHeight, duration: v.duration });
    }}
   >
    Your browser does not support HTML5 video.
   </video>
  </div>
 );
}

function AudioViewer({ url, filename, size }: { url: string; filename: string; size?: number }) {
 return (
  <div className="pw-media-view">
   <div className="pw-audio-card">
    <div className="pw-audio-icon">
     <Music size={28}/>
    </div>
    <div style={{ textAlign: 'center' }}>
     <strong style={{ display: 'block', fontSize: 13, marginBottom: 4 }}>{filename}</strong>
     <small className="muted">{formatBytes(size)}</small>
    </div>
    <audio className="pw-audio-player" controls preload="metadata" src={url}>
     Your browser does not support HTML5 audio.
    </audio>
   </div>
  </div>
 );
}

function PdfViewer({ url, filename }: { url: string; filename: string }) {
 return (
  <div style={{ padding: 16 }}>
   <iframe
    className="pw-pdf-frame"
    src={url}
    title={filename}
   />
  </div>
 );
}

function CodeViewer({
 code,
 path,
 lang,
 repo,
 selectedLine,
 onSelectLine
}: {
 code: string;
 path: string;
 lang: string;
 repo: Item;
 selectedLine: number | null;
 onSelectLine: (line: number | null) => void;
}) {
 const { state, catalog, me, notify, modal, close } = useWorkspace();
 const [chatPrompt, setChatPrompt] = useState('');
 const [chatSending, setChatSending] = useState(false);
 const [chatSent, setChatSent] = useState(false);
 const [chatError, setChatError] = useState('');

 const rawLines = useMemo(() => code.split('\n'), [code]);

 const highlightedLines = useMemo(() => {
  let highlighted = '';
  try {
   if (lang && hljs.getLanguage(lang)) {
    highlighted = hljs.highlight(code, { language: lang, ignoreIllegals: true }).value;
   } else {
    highlighted = hljs.highlightAuto(code).value;
   }
  } catch {
   highlighted = escapeHtml(code);
  }
  return splitHighlightedLines(highlighted);
 }, [code, lang]);

 const toggleLine = (lineNum: number) => {
  if (selectedLine === lineNum) {
   onSelectLine(null);
  } else {
   onSelectLine(lineNum);
   setChatSent(false);
   setChatError('');
   setChatPrompt('');
  }
 };

 const handleSendToCoordinator = async () => {
  if (!chatPrompt.trim() || !selectedLine || chatSending) return;
  setChatSending(true);
  setChatError('');
  try {
   const lineContent = rawLines[selectedLine - 1] || '';
   const messageText = `Regarding \`${path}\` (line ${selectedLine}):\n\`\`\`${lang || ''}\n${lineContent}\n\`\`\`\n\n${chatPrompt.trim()}`;

   const connections = (state.connections || []).filter(
    (c: Item) => c.status === 'connected' && (c.ownerId === me.id || (c.shared && c.projects?.includes(repo.projectId)))
   );
   const choices = buildModelChoices(connections, catalog);
   const connChoice = choices[0];
   if (!connChoice) {
    throw Error('No connected model provider available. Connect a provider in Settings first.');
   }

   await api(`/projects/${repo.projectId}/conversation`, 'POST', {
    message: messageText,
    connectionId: connChoice.connectionId,
    model: connChoice.model,
    thinkingLevel: 'off'
   });

   setChatSent(true);
   notify('Sent to Project Coordinator');
  } catch (err) {
   setChatError((err as Error).message);
  } finally {
   setChatSending(false);
  }
 };

 const handleStartTaskSession = () => {
  const lineContent = selectedLine ? rawLines[selectedLine - 1] || '' : '';
  const prompt = `In \`${path}\` (line ${selectedLine}):\n\`\`\`${lang || ''}\n${lineContent}\n\`\`\`\n\n${chatPrompt.trim() || 'Please inspect and improve this code.'}`;
  modal(
   <NewSessionModal
    defaultRepoId={repo.id}
    defaultTitle={`Task: ${path.split('/').pop()}:${selectedLine}`}
    defaultPrompt={prompt}
    onClose={close}
   />
  );
 };

 return (
  <div className="pw-code-container">
   <table className="pw-code-table">
    <colgroup>
     <col className="pw-code-col-num"/>
     <col className="pw-code-col-act"/>
     <col className="pw-code-col-text"/>
    </colgroup>
    <tbody>
     {highlightedLines.map((hlLine, idx) => {
      const lineNum = idx + 1;
      const isSelected = selectedLine === lineNum;
      return (
       <React.Fragment key={lineNum}>
        <tr className={`pw-code-line ${isSelected ? 'pw-line-selected' : ''}`}>
         <td
          className="pw-code-num"
          onClick={() => toggleLine(lineNum)}
          title={`Click to start chat on line ${lineNum}`}
         >
          {lineNum}
         </td>
         <td className="pw-code-act">
          <button
           type="button"
           className="pw-line-chat-btn"
           onClick={() => toggleLine(lineNum)}
           title={`Start chat on line ${lineNum}`}
           aria-label={`Start chat on line ${lineNum}`}
          >
           <MessageSquare size={12}/>
          </button>
         </td>
         <td
          className="pw-code-text"
          onClick={() => {
           if (window.getSelection()?.toString()) return;
           toggleLine(lineNum);
          }}
          dangerouslySetInnerHTML={{ __html: hlLine || '&nbsp;' }}
         />
        </tr>
        {isSelected && (
         <tr className="pw-line-chat-row">
          <td colSpan={3}>
           <div className="pw-line-chat-panel">
            <div className="pw-chat-panel-head">
             <strong><MessageSquare size={14}/> Line {lineNum}: {path.split('/').pop()}</strong>
             <button
              type="button"
              className="btn btn-xs"
              onClick={() => onSelectLine(null)}
              aria-label="Close line chat"
             >
              <X size={13}/>
             </button>
            </div>
            <pre className="pw-chat-panel-quote"><code>{lineNum}: {rawLines[idx]}</code></pre>
            <div className="pw-quick-pills">
             <button
              type="button"
              className="pw-quick-pill"
              onClick={() => { setChatPrompt('Please explain what this code does and its role.'); setChatSent(false); setChatError(''); }}
             >
              Explain line
             </button>
             <button
              type="button"
              className="pw-quick-pill"
              onClick={() => { setChatPrompt('Are there any potential bugs, null safety issues, or edge cases with this code?'); setChatSent(false); setChatError(''); }}
             >
              Find bugs / edge cases
             </button>
             <button
              type="button"
              className="pw-quick-pill"
              onClick={() => { setChatPrompt('How can this code be refactored or improved for clarity and performance?'); setChatSent(false); setChatError(''); }}
             >
              Suggest improvements
             </button>
             <button
              type="button"
              className="pw-quick-pill"
              onClick={() => { setChatPrompt('Write a unit test covering this line and its enclosing function.'); setChatSent(false); setChatError(''); }}
             >
              Write unit test
             </button>
            </div>
            <textarea
             className="pw-chat-panel-input"
             value={chatPrompt}
             onChange={e => { setChatPrompt(e.target.value); setChatSent(false); setChatError(''); }}
             placeholder="Ask project coordinator about this line or instruct an agent… (⌘Enter to send)"
             onKeyDown={e => {
              if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
               e.preventDefault();
               void handleSendToCoordinator();
              }
             }}
             autoFocus
            />
            <div className="pw-chat-panel-actions">
             <div>
              {chatSent && (
               <span className="pw-chat-success-msg">
                <CheckCircle2 size={13}/> Sent to Project Coordinator!
                <button
                 type="button"
                 className="pw-text-button"
                 style={{ marginLeft: 6 }}
                 onClick={() => document.querySelector('.pw-coordinator')?.scrollIntoView({ behavior: 'smooth' })}
                >
                 View conversation →
                </button>
               </span>
              )}
              {chatError && <span style={{ color: 'var(--bad)', fontSize: 11 }}><AlertCircle size={13}/> {chatError}</span>}
             </div>
             <div className="pw-chat-buttons">
              <button
               type="button"
               className="btn btn-sm btn-primary"
               onClick={() => void handleSendToCoordinator()}
               disabled={chatSending || !chatPrompt.trim()}
               title="Send question to Project Coordinator with line context"
              >
               {chatSending ? <Spinner size={12}/> : <Send size={12}/>} Ask Coordinator
              </button>
              <button
               type="button"
               className="btn btn-sm btn-secondary"
               onClick={handleStartTaskSession}
               title="Open new task session composer for this line"
              >
               <Sparkles size={12}/> Start Task Session
              </button>
              <button
               type="button"
               className="btn btn-sm"
               onClick={() => onSelectLine(null)}
              >
               Cancel
              </button>
             </div>
            </div>
           </div>
          </td>
         </tr>
        )}
       </React.Fragment>
      );
     })}
    </tbody>
   </table>
  </div>
 );
}

function RepositoryBrowser({ repo }: { repo: Item }) {
 const { notify } = useWorkspace();
 const [ref, setRef] = useState(repo.base || 'main');
 const [inputRef, setInputRef] = useState(repo.base || 'main');
 const [inputPath, setInputPath] = useState('');
 const [availableBranches, setAvailableBranches] = useState<string[]>([]);
 const [filterQuery, setFilterQuery] = useState('');
 const [copied, setCopied] = useState(false);
 const [showSource, setShowSource] = useState(false);
 const [selectedLine, setSelectedLine] = useState<number | null>(null);

 const [location, setLocation] = useState({ path: '', file: false });
 const [entries, setEntries] = useState<Item[]>([]);
 const [blob, setBlob] = useState<Item | null>(null);
 const [loading, setLoading] = useState(false);
 const [error, setError] = useState('');
 const [revision, setRevision] = useState(0);

 // Load available branches
 useEffect(() => {
  api(`/repos/${encodeURIComponent(repo.id)}/inspect`)
   .then(res => {
    if (Array.isArray(res?.branches) && res.branches.length) {
     setAvailableBranches(res.branches);
    }
   })
   .catch(() => {});
 }, [repo.id]);

 useEffect(() => {
  let disposed = false;
  setLoading(true);
  setError('');
  setBlob(null);
  setEntries([]);
  setSelectedLine(null);
  setShowSource(false);

  const query = new URLSearchParams({ ref, path: location.path });
  void api(`/repos/${encodeURIComponent(repo.id)}/${location.file ? 'blob' : 'tree'}?${query}`)
   .then(result => {
    if (disposed) return;
    if (location.file) {
     if (typeof result.content !== 'string' && !result.isBinary) throw Error('Invalid file response.');
     setBlob(result);
    } else {
     if (!Array.isArray(result.entries)) throw Error('Invalid directory response.');
     setEntries(result.entries);
    }
   })
   .catch(e => {
    if (!disposed) setError((e as Error).message);
   })
   .finally(() => {
    if (!disposed) setLoading(false);
   });
  return () => {
   disposed = true;
  };
 }, [repo.id, ref, location, revision]);

 function navigate(path: string, file = false) {
  setLocation({ path, file });
  setInputPath(path);
  setSelectedLine(null);
 }

 function submit(e: React.FormEvent<HTMLFormElement>) {
  e.preventDefault();
  const path = inputPath.trim().replace(/^\/+|\/+$/g, '');
  if (!inputRef.trim() || (path && !validPath(path))) {
   setError('Enter a ref and a relative path without . or .. segments.');
   return;
  }
  setRef(inputRef.trim());
  navigate(path, (e.nativeEvent as SubmitEvent).submitter?.getAttribute('value') === 'file');
 }

 const parts = location.path.split('/').filter(Boolean);
 const directories = location.file ? parts.slice(0, -1) : parts;
 const filename = parts.at(-1) || '';
 const lang = getLanguage(location.path);
 const cat = getFileCategory(location.path);
 const mediaType = blob?.mediaType || cat;
 const authToken = token();
 const rawUrl = `/api/repos/${encodeURIComponent(repo.id)}/raw?ref=${encodeURIComponent(ref)}&path=${encodeURIComponent(location.path)}${authToken ? `&token=${encodeURIComponent(authToken)}` : ''}`;

 const handleCopy = async () => {
  if (!blob?.content) return;
  try {
   await navigator.clipboard.writeText(blob.content);
   setCopied(true);
   setTimeout(() => setCopied(false), 2000);
   notify('File content copied to clipboard');
  } catch {}
 };

 const filteredEntries = useMemo(() => {
  if (!filterQuery.trim()) return entries;
  const q = filterQuery.toLowerCase();
  return entries.filter(e => (e.name || '').toLowerCase().includes(q) || (e.path || '').toLowerCase().includes(q));
 }, [entries, filterQuery]);

 return (
  <div className="pw-browser">
   <form className="pw-browser-controls" onSubmit={submit}>
    <label>
     Ref
     {availableBranches.length > 0 ? (
      <select
       aria-label="Repository branch"
       value={inputRef}
       onChange={e => {
        setInputRef(e.target.value);
        setRef(e.target.value);
       }}
      >
       {availableBranches.map(b => (
        <option key={b} value={b}>{b}</option>
       ))}
       {!availableBranches.includes(inputRef) && (
        <option value={inputRef}>{inputRef}</option>
       )}
      </select>
     ) : (
      <input
       aria-label="Repository ref"
       value={inputRef}
       onChange={e => setInputRef(e.target.value)}
       placeholder="main, tag or commit"
      />
     )}
    </label>
    <label className="pw-path-input">
     Path
     <input
      aria-label="Repository path"
      value={inputPath}
      onChange={e => setInputPath(e.target.value)}
      placeholder="Root directory"
     />
    </label>
    <button className="btn btn-sm" type="submit" value="directory">Open folder</button>
    <button className="btn btn-sm" type="submit" value="file" disabled={!inputPath.trim()}>Read file</button>
   </form>

   <nav className="pw-breadcrumbs" aria-label="Repository path">
    <button type="button" onClick={() => navigate('')}>Root</button>
    {directories.map((part, i) => (
     <React.Fragment key={i}>
      <span>/</span>
      <button type="button" onClick={() => navigate(directories.slice(0, i + 1).join('/'))}>{part}</button>
     </React.Fragment>
    ))}
    {location.file && <span>/ {filename}</span>}
    <span className="pw-scope-tag">{ref} · Read only</span>
   </nav>

   {error ? (
    <div className="pw-error">
     <ErrorNote>{error}</ErrorNote>
     <button type="button" className="btn btn-sm" onClick={() => setRevision(n => n + 1)}>Retry</button>
    </div>
   ) : loading ? (
    <p className="pw-empty-inline"><Spinner/> Loading {location.file ? 'file' : 'directory'}…</p>
   ) : location.file ? (
    <div className="pw-file-view">
     <div className="pw-file-bar">
      <div className="pw-file-info">
       <button
        type="button"
        className="btn btn-xs"
        onClick={() => navigate(directories.join('/'), false)}
        title="Back to folder"
       >
        <ArrowLeft size={13}/>
        <span>Back</span>
       </button>
       <EntryIcon type="blob" path={location.path}/>
       <strong>{filename}</strong>
       {blob?.size != null && <span className="pw-file-badge">{formatBytes(blob.size)}</span>}
       {blob?.content && (
        <span className="pw-file-badge">
         {blob.content.split('\n').length} line{blob.content.split('\n').length === 1 ? '' : 's'}
        </span>
       )}
       {lang && <span className="pw-file-badge">{lang}</span>}
       {mediaType && mediaType !== 'code' && (
        <span className="pw-file-badge">{mediaType.toUpperCase()}</span>
       )}
      </div>

      <div className="pw-file-actions">
       {(cat === 'markdown' || location.path.endsWith('.svg')) && (
        <button
         type="button"
         className="btn btn-xs"
         onClick={() => setShowSource(s => !s)}
         title={showSource ? 'Show formatted preview' : 'Show source code'}
        >
         {showSource ? <><Eye size={12}/><span>Preview</span></> : <><Code size={12}/><span>Source</span></>}
        </button>
       )}
       {blob?.content && !blob.isBinary && (
        <button
         type="button"
         className="btn btn-xs"
         onClick={handleCopy}
         title="Copy entire file"
        >
         {copied ? <><Check size={12}/><span>Copied</span></> : <><Copy size={12}/><span>Copy</span></>}
        </button>
       )}
       {blob?.content && !blob.isBinary && (
        <button
         type="button"
         className="btn btn-xs"
         onClick={() => setSelectedLine(s => (s === 1 ? null : 1))}
         title="Start chat on line 1"
        >
         <MessageSquare size={12}/>
         <span>Chat on line</span>
        </button>
       )}
       <a
        className="btn btn-xs"
        href={rawUrl}
        target="_blank"
        rel="noopener noreferrer"
        title="Open raw content in new tab"
       >
        <ExternalLink size={12}/>
        <span>Raw</span>
       </a>
       <a
        className="btn btn-xs"
        href={rawUrl}
        download={filename}
        title="Download file"
       >
        <Download size={12}/>
        <span>Download</span>
       </a>
      </div>
     </div>

     {blob?.isTooLarge ? (
      <div className="pw-media-view">
       <p className="pw-empty-inline">This file exceeds the 2 MB preview limit ({formatBytes(blob.size)}).</p>
       <a className="btn btn-sm btn-primary" href={rawUrl} download={filename}>
        <Download size={13}/> Download file
       </a>
      </div>
     ) : mediaType === 'image' && !showSource ? (
      <ImageViewer url={rawUrl} filename={filename} size={blob?.size}/>
     ) : mediaType === 'video' ? (
      <VideoViewer url={rawUrl} filename={filename} size={blob?.size}/>
     ) : mediaType === 'audio' ? (
      <AudioViewer url={rawUrl} filename={filename} size={blob?.size}/>
     ) : mediaType === 'pdf' ? (
      <PdfViewer url={rawUrl} filename={filename}/>
     ) : mediaType === 'markdown' && !showSource ? (
      <div className="pw-preview">
       <Markdown>{blob?.content || '(empty file)'}</Markdown>
      </div>
     ) : blob?.content != null && (!blob.isBinary || showSource) ? (
      <CodeViewer
       code={blob.content}
       path={location.path}
       lang={lang}
       repo={repo}
       selectedLine={selectedLine}
       onSelectLine={setSelectedLine}
      />
     ) : (
      <div className="pw-media-view">
       <FileText size={32} className="pw-icon-file"/>
       <p className="pw-empty-inline">Binary file — preview unavailable.</p>
       <a className="btn btn-sm btn-primary" href={rawUrl} download={filename}>
        <Download size={13}/> Download file
       </a>
      </div>
     )}
    </div>
   ) : (
    <div className="pw-tree">
     <div className="pw-tree-header">
      <span>
       Showing {filteredEntries.length} {filteredEntries.length === 1 ? 'item' : 'items'}
       {filterQuery && ` (filtered from ${entries.length})`}
      </span>
      <input
       className="pw-search"
       placeholder="Filter files in directory…"
       value={filterQuery}
       onChange={e => setFilterQuery(e.target.value)}
      />
     </div>
     {location.path && (
      <button
       type="button"
       className="pw-tree-row"
       onClick={() => navigate(directories.slice(0, -1).join('/'))}
      >
       <span className="pw-tree-icon"><ArrowLeft size={14}/></span>
       <span className="pw-tree-name">.. (Parent directory)</span>
      </button>
     )}
     {filteredEntries.map(entry => (
      <button
       type="button"
       key={entry.path}
       className="pw-tree-row"
       onClick={() => navigate(entry.path, entry.type !== 'tree')}
      >
       <span className="pw-tree-icon">
        <EntryIcon type={entry.type} path={entry.path}/>
       </span>
       <span className="pw-tree-name">{entry.name}</span>
       <small>
        {entry.type === 'tree' ? 'Folder' : entry.type === 'commit' ? 'Submodule' : entry.size == null ? 'File' : formatBytes(entry.size)}
       </small>
      </button>
     ))}
     {!filteredEntries.length && (
      <p className="pw-empty-inline">
       {filterQuery ? `No files match “${filterQuery}”.` : 'No entries returned. This directory may be empty.'}
      </p>
     )}
    </div>
   )}
  </div>
 );
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
