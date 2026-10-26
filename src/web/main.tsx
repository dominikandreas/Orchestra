import React,{useState,useEffect,useCallback,useRef} from 'react';
import {createRoot} from 'react-dom/client';
import {
 LayoutDashboard,Sparkles,GitPullRequest,Bot,Zap,Rocket,FolderGit2,
 Settings2,MessageSquare,Search,Plus,GitBranch,GitFork,Sun,Moon,
 RotateCw,CheckCircle2,AlertCircle,X,PanelLeftClose,PanelLeftOpen
} from 'lucide-react';
import '@fontsource-variable/inter';
import '@fontsource-variable/jetbrains-mono';
import './style.css';
import {parseRoute,buildUrl} from './routes';
import {api,token,label,cx,activeStatuses,attentionStatuses,type Item} from './lib';
import {WorkspaceContext,Dot,Spinner} from './ui';
import {SessionView} from './session-view';
import {ChangeView} from './change-view';
import {ProjectWorkspace} from './project-workspace';
import {
 SessionsPage,ChangesPage,AgentsPage,AutomationsPage,
 DeploymentsPage,RepositoriesPage,SettingsPage,WelcomeScreen,
 NewSessionModal,AgentModal,WorkflowModal,NewDeploymentModal,
 NewRepoModal,ConfigureRepoModal,ProjectModal,SearchCommandModal
} from './pages';
import {AdminConsole, SystemAssistantPage} from './admin-console';

function App(){
 const initialRoute=useRef(parseRoute(window.location.pathname,window.location.search)).current;
 const [me,setMe]=useState<Item|null>(null);
 const [loading,setLoading]=useState(true);
 const [state,setState]=useState<Item>({
  projects:[],repos:[],changes:[],jobs:[],workflows:[],
  connections:[],deployments:[],previews:[],resources:[],agents:[],threads:[],mcpServers:[]
 });
 const [catalog,setCatalog]=useState<Item[]>([]);
 const [page,setPageState]=useState(initialRoute.page);
 const [entityId,setEntityIdState]=useState<string|null>(initialRoute.id);
 const [project,setProjectState]=useState(initialRoute.project);
 const [routeQuery,setRouteQueryState]=useState<Record<string,string>>(initialRoute.query);
 const [modalNode,setModalNode]=useState<React.ReactNode>(null);
 const [toast,setToast]=useState<{text:string,tone:'ok'|'bad'}|null>(null);
 const [theme,setTheme]=useState(localStorage.getItem('relay.theme')||'dark');
 const [sidebarOpen,setSidebarOpen]=useState(()=>typeof window!=='undefined'?window.innerWidth>820:true);
 const [adminOpen,setAdminOpen]=useState(false);
 const [adminPending,setAdminPending]=useState(0);
 const [reloading,setReloading]=useState(false);

 const historyIdx=useRef(0);
 const pageRef=useRef(initialRoute.page);pageRef.current=page;
 const idRef=useRef(initialRoute.id);idRef.current=entityId;
 const projectRef=useRef(initialRoute.project);projectRef.current=project;

 const notify=useCallback((text:string,tone:'ok'|'bad'='ok')=>{
  setToast({text,tone});
  setTimeout(()=>setToast(prev=>prev?.text===text?null:prev),4500);
 },[]);

 const refresh=useCallback(async()=>{
  try{
   const st=await api('/state');
   setState(st);
   if(Array.isArray(st.providers)&&st.providers.length>0)setCatalog(st.providers);
  }catch{}
 },[]);

 useEffect(()=>{
  document.documentElement.dataset.theme=theme;
  localStorage.setItem('relay.theme',theme);
 },[theme]);

 useEffect(()=>{
  if(token()){
   api('/me')
    .then(x=>{setMe(x.user);void refresh();})
    .catch(()=>localStorage.removeItem('relay.device'))
    .finally(()=>setLoading(false));
  }else{
   setLoading(false);
  }
 },[]);

 useEffect(()=>{
  if(!me)return;
  void api('/providers').then(setCatalog).catch(()=>{});
  const t=setInterval(refresh,3500);
  return ()=>clearInterval(t);
 },[me,refresh]);

 const navigate=useCallback((
  nextPage:string,
  nextId:string|null=null,
  nextProject:string=projectRef.current,
  nextQuery:Record<string,string>={},
  replace=false
 )=>{
  setPageState(nextPage);
  setEntityIdState(nextId);
  setProjectState(nextProject);
  setRouteQueryState(nextQuery);
  if(typeof window!=='undefined'&&window.innerWidth<=820)setSidebarOpen(false);
  pageRef.current=nextPage;
  idRef.current=nextId;
  projectRef.current=nextProject;
  const targetUrl=buildUrl(nextPage,nextId,nextProject,nextQuery);
  const currentUrl=window.location.pathname+window.location.search;
  if(targetUrl!==currentUrl){
   if(replace){
    window.history.replaceState({orchestra:true,idx:historyIdx.current},'',targetUrl);
   }else{
    historyIdx.current++;
    window.history.pushState({orchestra:true,idx:historyIdx.current},'',targetUrl);
   }
  }
 },[]);

 const go=useCallback((nextPage:string,nextId:string|null=null,nextQuery:Record<string,string>={})=>{
  if((nextPage==='sessions'||nextPage==='changes')&&nextId){
   const target=(nextPage==='sessions'?state.jobs:state.changes)?.find((j:Item)=>j.id===nextId);
   if(target&&target.projectId&&projectRef.current!=='all'&&target.projectId!==projectRef.current){
    navigate(nextPage,nextId,target.projectId,nextQuery);
    return;
   }
  }
  navigate(nextPage,nextId,projectRef.current,nextQuery);
 },[navigate,state.jobs,state.changes]);

 const setProject=useCallback((nextProject:string)=>{
  navigate(pageRef.current,idRef.current,nextProject);
 },[navigate]);

 useEffect(()=>{
  if(!window.history.state?.orchestra){
   window.history.replaceState({orchestra:true,idx:0},'',window.location.href);
  }else if(typeof window.history.state?.idx==='number'){
   historyIdx.current=window.history.state.idx;
  }
 },[]);

 useEffect(()=>{
  const onPopState=()=>{
   const r=parseRoute(window.location.pathname,window.location.search);
   setPageState(r.page);
   setEntityIdState(r.id);
   setProjectState(r.project);
   setRouteQueryState(r.query);
   pageRef.current=r.page;
   idRef.current=r.id;
   projectRef.current=r.project;
   if(typeof window.history.state?.idx==='number'){
    historyIdx.current=window.history.state.idx;
   }
   setModalNode(null);
  };
  window.addEventListener('popstate',onPopState);
  return ()=>window.removeEventListener('popstate',onPopState);
 },[]);

 useEffect(()=>{
  const title=entityId
   ?(page==='sessions'?'Session':page==='changes'?'Change Request':label(page))
   :page==='home'?'Orchestra':`${label(page)} · Orchestra`;
  document.title=title;
 },[page,entityId]);

 const close=useCallback(()=>setModalNode(null),[]);
 const isAdmin=Boolean(me&&['owner','admin'].includes(me.role));
 const canEdit=Boolean(me&&me.role!=='viewer');

 const run=useCallback(async(fn:()=>Promise<any>,okMsg?:string)=>{
  try{
   await fn();
   await refresh();
   if(okMsg)notify(okMsg,'ok');
   return true;
  }catch(e){
   notify((e as Error).message,'bad');
   return false;
  }
 },[refresh,notify]);

 const openNewProject=useCallback(()=>{
  setModalNode(<ProjectModal onClose={close}/>);
 },[close]);

 const openConfigureRepo=useCallback((r:Item,onboarding=false)=>{
  setModalNode(<ConfigureRepoModal repo={r} onboarding={onboarding} onClose={close}/>);
 },[close]);

 const openNewRepo=useCallback((defaultProjectId?:string)=>{
  if(!state.projects.length&&!defaultProjectId){
   openNewProject();
   return;
  }
  setModalNode(
   <NewRepoModal
    defaultProjectId={defaultProjectId||(project!=='all'?project:undefined)}
    onNewProject={openNewProject}
    onClose={close}
    onDone={async(r:Item)=>{
     await refresh();
     openConfigureRepo(r,true);
    }}
   />
  );
 },[state.projects.length,project,openNewProject,close,refresh,openConfigureRepo]);

 const openNewSession=useCallback((repoId?:string,changeId?:string,kind='implement',agentId='')=>{
  if(!state.repos.some((r:Item)=>r.status==='ready')){
   openNewRepo();
   return;
  }
  setModalNode(
   <NewSessionModal
    defaultRepoId={repoId}
    defaultChangeId={changeId}
    defaultKind={kind}
    defaultAgentId={agentId}
    onClose={close}
   />
  );
 },[state.repos,openNewRepo,close]);

 const openSearchPalette=useCallback(()=>{
  setModalNode(
   <SearchCommandModal
    onClose={close}
    onNewSession={()=>openNewSession()}
    onNewAgent={()=>setModalNode(<AgentModal onClose={close}/>)}
    onNewWorkflow={()=>setModalNode(<WorkflowModal onClose={close}/>)}
    onNewDeployment={()=>setModalNode(<NewDeploymentModal onClose={close}/>)}
    onNewRepo={()=>openNewRepo()}
   />
  );
 },[close,openNewSession,openNewRepo]);

 useEffect(()=>{
  const handler=(e:KeyboardEvent)=>{
   if((e.metaKey||e.ctrlKey)&&e.key.toLowerCase()==='k'){
    e.preventDefault();
    openSearchPalette();
   }else if((e.metaKey||e.ctrlKey)&&e.key.toLowerCase()==='b'){
    e.preventDefault();
    setSidebarOpen(o=>!o);
   }
  };
  window.addEventListener('keydown',handler);
  return ()=>window.removeEventListener('keydown',handler);
 },[openSearchPalette]);

 const triggerReload=useCallback(async()=>{
  if(reloading)return;
  setReloading(true);
  notify('Restarting service…');
  try{if(isAdmin)await api('/self/restart','POST',{}).catch(()=>{});}catch{}
  let attempts=0;
  const poll=setInterval(async()=>{
   attempts++;
   try{
    const res=await fetch('/api/health');
    if(res.ok&&attempts>1){clearInterval(poll);window.location.reload();}
   }catch{}
   if(attempts>30){clearInterval(poll);window.location.reload();}
  },800);
 },[reloading,isAdmin,notify]);

 const handleOpenJob=useCallback((jobId:string)=>{
  const target=state.jobs.find((j:Item)=>j.id===jobId);
  if(target&&target.projectId&&project!=='all'&&target.projectId!==project){
   setProject(target.projectId);
  }
  go('sessions',jobId);
 },[state.jobs,project,setProject,go]);

 if(loading){
  return <div className="auth-screen"><Spinner size={20}/><span>Loading Orchestra…</span></div>;
 }
 if(!me){
  return (
   <WelcomeScreen
    onLogin={async u=>{
     setMe(u);
     await refresh();
     navigate(pageRef.current,idRef.current,projectRef.current,{},true);
    }}
   />
  );
 }

 const visibleJobs=state.jobs.filter((j:Item)=>(project==='all'||j.projectId===project)&&!j.archived);
 const visibleChanges=state.changes.filter((c:Item)=>project==='all'||c.projectId===project);
 const visibleWorkflows=state.workflows.filter((w:Item)=>project==='all'||w.projectId===project);
 const visibleDeployments=(state.deployments||state.previews||[]).filter((d:Item)=>project==='all'||d.projectId===project);
 const visibleAgents=(state.agents||[]).filter((a:Item)=>project==='all'||!a.projectId||a.projectId===project);

 const ongoingSessions=visibleJobs.filter((j:Item)=>activeStatuses.includes(j.status)||attentionStatuses.includes(j.status));
 const allOngoingJobs=state.jobs.filter((j:Item)=>(activeStatuses.includes(j.status)||attentionStatuses.includes(j.status))&&!j.archived);
 const otherOngoingJobs=project==='all'?[]:allOngoingJobs.filter((j:Item)=>j.projectId!==project);
 const recentSidebarSessions=[...visibleJobs]
  .sort((a:Item,b:Item)=>(b.updated||b.created).localeCompare(a.updated||a.created))
  .slice(0,10);
 const openChangesCount=visibleChanges.filter((c:Item)=>c.status==='open').length;
 const runningDeploymentsCount=visibleDeployments.filter((d:Item)=>d.status==='running').length;

 const workspaceValue={
  me,state,catalog,refresh,
  project,setProject,
  go,notify,
  modal:setModalNode,close,
  run,isAdmin,canEdit,
  theme,setTheme
 };

 return (
  <WorkspaceContext.Provider value={workspaceValue}>
   <div className={cx('shell',!sidebarOpen&&'sidebar-collapsed')}>
    {sidebarOpen&&(
     <div
      className="sidebar-backdrop"
      aria-hidden="true"
      onClick={()=>setSidebarOpen(false)}
     />
    )}
    <aside className="sidebar" aria-hidden={!sidebarOpen}>
     <div className="sidebar-top">
      <button type="button" className="brand-btn" onClick={()=>{go('home');setAdminOpen(false);}}>
       <span className="brand-mark"><GitBranch size={15}/></span>
       <span className="brand-name">Orchestra</span>
      </button>
      <div className="toolbar-actions">
       {canEdit&&(
        <button type="button" className="icon-btn" title="New session" onClick={()=>openNewSession()}>
         <Plus size={15}/>
        </button>
       )}
       <button
        type="button"
        className="icon-btn"
        aria-label="Hide sidebar"
        title="Hide sidebar (⌘B)"
        onClick={()=>setSidebarOpen(false)}
       >
        <PanelLeftClose size={15}/>
       </button>
      </div>
     </div>

     <button type="button" className="sidebar-search" onClick={openSearchPalette}>
      <Search size={13}/>
      <span>Search & commands</span>
      <kbd>⌘K</kbd>
     </button>

     <div className="sidebar-project-row">
      <select
       aria-label="Project filter"
       className="project-select"
       value={project}
       onChange={e=>setProject(e.target.value)}
      >
       <option value="all">All projects ({state.projects.length})</option>
       {state.projects.map((p:Item)=><option key={p.id} value={p.id}>{p.name}</option>)}
      </select>
      {isAdmin&&(
       <button type="button" className="icon-btn" title="New project" onClick={openNewProject}>
        <Plus size={13}/>
       </button>
      )}
     </div>

     <nav className="sidebar-nav">
      {[
       {id:'home',name:project==='all'?'Projects':'Project',icon:LayoutDashboard},
       {id:'sessions',name:'Sessions',icon:Sparkles,count:ongoingSessions.length||(otherOngoingJobs.length?otherOngoingJobs.length:undefined)},
       {id:'changes',name:'Changes',icon:GitPullRequest,count:openChangesCount||undefined},
       {id:'agents',name:'Agents',icon:Bot,count:visibleAgents.length||undefined},
       {id:'automations',name:'Automations',icon:Zap,count:visibleWorkflows.filter((w:Item)=>w.enabled).length||undefined},
       {id:'deployments',name:'Deployments',icon:Rocket,count:runningDeploymentsCount||undefined},
       {id:'repositories',name:'Repositories',icon:FolderGit2},
       {id:'settings',name:'Settings',icon:Settings2}
      ].map(n=>(
       <button
        key={n.id}
        type="button"
        className={cx('nav-item',page===n.id&&!entityId&&!adminOpen&&'active')}
        onClick={()=>{go(n.id);setAdminOpen(false);}}
       >
        <n.icon size={15}/>
        <span>{n.name}</span>
        {n.count!==undefined&&n.count>0&&<span className="nav-badge">{n.count}</span>}
       </button>
      ))}
      {isAdmin&&(
       <button
        type="button"
        className={cx('nav-item',page==='assistant'&&'active')}
        onClick={()=>{go('assistant');setAdminOpen(false);if(typeof window!=='undefined'&&window.innerWidth<=820)setSidebarOpen(false);}}
       >
        <Sparkles size={15}/>
        <span>System Assistant</span>
        {adminPending>0&&<span className="nav-badge tone-warn">{adminPending}</span>}
       </button>
      )}
     </nav>

     {ongoingSessions.length>0?(
      <div className="sidebar-section">
       <div className="sidebar-section-header">
        <span>Ongoing ({ongoingSessions.length})</span>
       </div>
       <div className="sidebar-session-list">
        {ongoingSessions.slice(0,6).map((j:Item)=>(
         <button
          key={j.id}
          type="button"
          className={cx('sidebar-session-item',page==='sessions'&&entityId===j.id&&'active')}
          onClick={()=>{handleOpenJob(j.id);setAdminOpen(false);}}
         >
          <Dot status={j.status}/>
          <span className="sidebar-session-title">{j.title}</span>
         </button>
        ))}
       </div>
      </div>
     ):otherOngoingJobs.length>0&&(
      <div className="sidebar-section">
       <div className="sidebar-section-header" style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}>
        <span>Ongoing (other projects)</span>
        <button type="button" className="btn btn-xs" style={{fontSize:'10px',padding:'1px 5px'}} onClick={()=>setProject('all')}>All ({otherOngoingJobs.length})</button>
       </div>
       <div className="sidebar-session-list">
        {otherOngoingJobs.slice(0,3).map((j:Item)=>(
         <button
          key={j.id}
          type="button"
          className={cx('sidebar-session-item',page==='sessions'&&entityId===j.id&&'active')}
          onClick={()=>{handleOpenJob(j.id);setAdminOpen(false);}}
          title={`${j.title} (in ${state.projects?.find((p:Item)=>p.id===j.projectId)?.name||'Orchestra'})`}
         >
          <Dot status={j.status}/>
          <span className="sidebar-session-title">{j.title}</span>
         </button>
        ))}
       </div>
      </div>
     )}

     <div className="sidebar-section sidebar-section-grow">
      <div className="sidebar-section-header">
       <span>Sessions</span>
       {canEdit&&(
        <button type="button" className="icon-btn" title="New session" onClick={()=>openNewSession()}>
         <Plus size={12}/>
        </button>
       )}
      </div>
      <div className="sidebar-session-list">
       {recentSidebarSessions.map((j:Item)=>(
        <button
         key={j.id}
         type="button"
         className={cx('sidebar-session-item',page==='sessions'&&entityId===j.id&&'active')}
         onClick={()=>{go('sessions',j.id);setAdminOpen(false);}}
         title={j.title}
        >
         <Dot status={j.status}/>
         {j.forkedFrom&&<GitFork size={11} className="muted-meta"/>}
         <span className="sidebar-session-title">{j.title}</span>
        </button>
       ))}
       {!recentSidebarSessions.length&&<div className="sidebar-empty">No sessions</div>}
      </div>
     </div>

     <footer className="sidebar-footer">
      <div className="user-pill">
       <span className="user-avatar">{me.name?.[0]?.toUpperCase()||'U'}</span>
       <div className="user-meta">
        <strong>{me.name}</strong>
        <small>{label(me.role)}</small>
       </div>
      </div>
      <div className="toolbar-actions">
       <button
        type="button"
        className="icon-btn"
        title={isAdmin?'Restart service & reload':'Reload'}
        onClick={triggerReload}
        disabled={reloading}
       >
        <RotateCw size={14} className={reloading?'spin':''}/>
       </button>
       <button
        type="button"
        className="icon-btn"
        aria-label="Toggle theme"
        title={`Switch to ${theme==='light'?'dark':'light'} theme`}
        onClick={()=>setTheme(theme==='light'?'dark':'light')}
       >
        {theme==='light'?<Moon size={14}/>:<Sun size={14}/>}
       </button>
      </div>
     </footer>
    </aside>

    <main className={cx('workspace-main',page==='assistant'&&'workspace-main-assistant')}>
     <header className="topbar-compact">
      <div className="topbar-compact-left">
       <button
        type="button"
        className="icon-btn"
        aria-label="Toggle sidebar"
        title="Toggle sidebar (⌘B)"
        onClick={()=>setSidebarOpen(o=>!o)}
       >
        <PanelLeftOpen size={16}/>
       </button>
       <button type="button" className="topbar-brand" onClick={()=>go('home')}>
        <span className="brand-mark" style={{width:20,height:20}}><GitBranch size={13}/></span>
        <strong>Orchestra</strong>
       </button>
       <span className="crumb-sep">/</span>
       <span className="topbar-section">{label(page)}</span>
       {ongoingSessions.length>0?(
        <button
         type="button"
         className="tag"
         onClick={()=>go('sessions',null,{filter:'ongoing'})}
         title="Ongoing sessions"
        >
         <Dot status="running"/>
         <span>{ongoingSessions.length} active</span>
        </button>
       ):otherOngoingJobs.length>0&&(
        <button
         type="button"
         className="tag tone-warn"
         onClick={()=>setProject('all')}
         title="Ongoing sessions in other projects"
        >
         <Dot status="running"/>
         <span>{otherOngoingJobs.length} active in other projects</span>
        </button>
       )}
      </div>
      <div className="toolbar-actions">
       <button type="button" className="icon-btn" title="Search & commands (⌘K)" onClick={openSearchPalette}>
        <Search size={15}/>
       </button>
       {canEdit&&(
        <button type="button" className="icon-btn" title="New session" onClick={()=>openNewSession()}>
         <Plus size={15}/>
        </button>
       )}
      </div>
     </header>
     {page==='sessions'&&entityId?(
      <SessionView id={entityId}/>
     ):page==='changes'&&entityId?(
      <ChangeView
       id={entityId}
       onStartJob={(repoId,changeId,kind)=>openNewSession(repoId,changeId,kind)}
       onTriggerReload={triggerReload}
       reloading={reloading}
      />
     ):page==='home'?(
      <ProjectWorkspace onNewRepo={()=>openNewRepo()} onNewProject={openNewProject}/>
     ):page==='sessions'?(
      <SessionsPage initialFilter={routeQuery.filter} onNewSession={()=>openNewSession()}/>
     ):page==='changes'?(
      <ChangesPage onNewSession={()=>openNewSession()}/>
     ):page==='agents'?(
      <AgentsPage onStartWithAgent={agentId=>openNewSession(undefined,undefined,'implement',agentId)}/>
     ):page==='automations'?(
      <AutomationsPage/>
     ):page==='deployments'?(
      <DeploymentsPage/>
     ):page==='repositories'?(
      <RepositoriesPage
       onNewRepo={()=>openNewRepo()}
       onConfigureRepo={r=>openConfigureRepo(r,false)}
       onStartJob={rId=>openNewSession(rId)}
      />
     ):page==='assistant'&&isAdmin?(
      <SystemAssistantPage
       api={api}
       me={me}
       state={state}
       catalog={catalog}
       refresh={refresh}
       onJob={handleOpenJob}
       initialThreadId={entityId||undefined}
       onSelectThread={tId=>go('assistant',tId)}
       context={{
        page: 'assistant',
        projectId: project==='all'?undefined:project
       }}
      />
     ):page==='settings'?(
      <SettingsPage onTriggerReload={triggerReload} reloading={reloading}/>
     ):(
      <ProjectWorkspace onNewRepo={()=>openNewRepo()} onNewProject={openNewProject}/>
     )}
    </main>

    {isAdmin&&(
     <AdminConsole
      open={adminOpen}
      onClose={()=>setAdminOpen(false)}
      onPendingCount={setAdminPending}
      api={api}
      me={me}
      state={state}
      catalog={catalog}
      refresh={refresh}
      onJob={handleOpenJob}
      context={{
       page,
       projectId:project==='all'?undefined:project,
       changeId:page==='changes'&&entityId?entityId:undefined,
       jobId:page==='sessions'&&entityId?entityId:undefined,
       repoId:
        page==='changes'&&entityId
         ?state.changes.find((c:Item)=>c.id===entityId)?.repoId
         :page==='sessions'&&entityId
         ?state.jobs.find((j:Item)=>j.id===entityId)?.repoId
         :undefined
      }}
     />
    )}

    {modalNode}

    {toast&&(
     <div className={cx('toast',toast.tone==='bad'&&'toast-bad')} role="status">
      {toast.tone==='bad'?<AlertCircle size={15}/>:<CheckCircle2 size={15}/>}
      <span>{toast.text}</span>
      <button type="button" className="icon-btn" onClick={()=>setToast(null)}><X size={13}/></button>
     </div>
    )}
   </div>
  </WorkspaceContext.Provider>
 );
}

createRoot(document.getElementById('root')!).render(<App/>);
