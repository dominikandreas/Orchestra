import { createAgentSession,createExtensionRuntime,SessionManager,SettingsManager,DefaultResourceLoader,createBashToolDefinition,type ResourceLoader } from '@earendil-works/pi-coding-agent';
import { connectionContract } from './external-contract.js';
import { saveConnectionDraft,requireExternalAdmin } from './external.js';
import { join,resolve } from 'node:path';
import { Type } from 'typebox';
import { mkdir } from 'node:fs/promises';
import { get,all,put,dataDir,event,canOperate } from './store.js';
import { runtime } from './providers.js';
import { startSandbox,stopSandbox,dockerExec } from './docker.js';
import { proposeAction } from './admin-control.js';
import { connectMcpServers,selectMcpServers,type ActiveMcpSession } from './mcp.js';
const id=process.argv[2],job=get('jobs',id)!,repo=get('repos',job.repoId)!;
if(job?.path){try{process.chdir(job.path);}catch{}}
let session:any;let mcpSession:ActiveMcpSession|undefined;const container=`relay-job-${id}`;
process.on('disconnect',()=>{void stopSandbox(container).finally(()=>process.exit(0))});
const send=(type:string,data:any)=>process.send?.({type,data});
process.on('message',async(m:any)=>{try{if(m.type==='cancel'){await session?.abort();await stopSandbox(container);process.exit(0);}else if(m.type==='update_settings'){if(m.thinkingLevel&&session?.setThinkingLevel)session.setThinkingLevel(m.thinkingLevel);}else if(m.type==='steer')await session?.steer(m.text,m.images);else if(m.type==='followup')await session?.followUp(m.text,m.images);}catch(e){send('notice',String(e))}});
try {
 await startSandbox(container,job.path,repo.image,job.kind==='review'||!!job.deploymentId);send('notice','Isolated workspace ready');
 const mr=await runtime(job.connectionId);
 let model=mr.getModel(job.provider,job.model);
 if(!model&&job.model){
  const clean=job.model.trim().toLowerCase().replace(/\s+/g,'-');
  const base=clean.replace(/-(high|medium|low)$/,'');
  model=mr.getModel(job.provider,clean)||mr.getModel(job.provider,base)||mr.getModel(job.provider,`${base}-medium`)||mr.getModel(job.provider,`${base}-high`)||mr.getModel(job.provider,`${base}-low`);
  if(!model){
   const allModels=mr.getModels(job.provider);
   model=allModels.find((m:any)=>m.id.toLowerCase()===clean||m.name.toLowerCase()===job.model.toLowerCase());
  }
 }
 if(!model)throw Error('Selected model is not available. Choose a model in repository settings.');
 const resources=job.deploymentId?[]:all('resources').filter(x=>(!x.projectId||x.projectId===repo.projectId)&&x.active);
 const agent=job.agentId?get('agents',job.agentId):undefined;
 const agentTools:string[]=job.tools||agent?.tools||['workspace','propose_resource','propose_workflow'];
 const enableWorkspace=agentTools.includes('workspace');
 const enableHostTerminal=job.kind==='system'||agent?.kind==='system'||agentTools.includes('host_terminal');
 const activeMcpServerIds:string[]|undefined=job.mcpServers||agent?.mcpServers;
 const selectedMcpServers=job.deploymentId?[]:selectMcpServers(all('mcpServers'),repo.projectId,activeMcpServerIds);
 mcpSession=await connectMcpServers(selectedMcpServers,server=>{
  const user=get('users',job.authorId),current=get('mcpServers',server.id);
  if(!user||user.disabled||!canOperate(user,repo.projectId)||get('jobs',job.id)?.status==='cancelled')throw Error('Job owner access was revoked');
  if(!current?.enabled||current.updated!==server.updated||(current.projectId&&current.projectId!==repo.projectId))throw Error('MCP configuration changed or was disabled; start a new task');
 });

 const systemModeText=enableHostTerminal?'\nYou are operating in system mode. You have access to the host_terminal tool to propose bash terminal commands on the host machine. Every host command is paused and requires administrator approval in Orchestra before execution.':'';
 const mcpText=mcpSession.tools?.length?`\nYou have access to external tools from enabled MCP servers: ${mcpSession.tools.map((t:any)=>t.name).join(', ')}.`:'' ;
 const prompt=`You are Orchestra, an autonomous software engineering collaborator. ${enableWorkspace?'Work only in /workspace using the workspace tool. Describe evidence, remaining issues and tests honestly.':''} You cannot merge, change app permissions, or activate extensions. Do not modify .git. ${job.kind==='review'?'Review without edits. Report findings with file paths, lines, severity and rationale.':'Implement the requested work carefully and run relevant tests.'}\n${job.deploymentId?connectionContract:''}\n${resources.filter(x=>x.kind!=='extension').map(x=>x.content).join('\n\n')}${agent?`\n\nAgent "${agent.name}" instructions:\n${agent.instructions}`:''}${systemModeText}${mcpText}`;
 let loader:ResourceLoader={getExtensions:()=>({extensions:[],errors:[],runtime:createExtensionRuntime()}),getSkills:()=>({skills:[],diagnostics:[]}),getPrompts:()=>({prompts:[],diagnostics:[]}),getThemes:()=>({themes:[],diagnostics:[]}),getAgentsFiles:()=>({agentsFiles:[]}),getSystemPrompt:()=>prompt,getSystemPromptSource:()=>undefined,getAppendSystemPrompt:()=>[],getAppendSystemPromptSources:()=>[],extendResources:()=>{},reload:async()=>{}};
 const ext=resources.filter(x=>x.kind==='extension').map(x=>x.path).filter(Boolean);
 if(ext.length){const l=new DefaultResourceLoader({cwd:job.path,agentDir:join(dataDir,'pi'),noExtensions:true,noSkills:true,noPromptTemplates:true,noThemes:true,additionalExtensionPaths:ext,systemPromptOverride:()=>prompt});await l.reload();loader=l;}
 await mkdir(join(dataDir,'sessions',id),{recursive:true});
 const manager=job.sessionFile?SessionManager.open(job.sessionFile):SessionManager.create(job.path,join(dataDir,'sessions',id));
 const additionalTools:any[]=[];
 if(agentTools.includes('propose_resource')){
  additionalTools.push({
   name:'propose_resource',label:'Propose resource',description:'Save a versioned draft prompt, skill, or Pi TypeScript extension for this project. Activation is controlled by the dashboard.',parameters:Type.Object({name:Type.String(),kind:Type.Union([Type.Literal('prompt'),Type.Literal('skill'),Type.Literal('extension')]),content:Type.String()}),
   execute:async(_id:string,args:any)=>{const r=put('resources',{...args,projectId:repo.projectId,authorId:job.authorId,active:false,version:all('resources').filter(r=>r.projectId===repo.projectId&&r.name===args.name).length+1,jobId:id});return {content:[{type:'text',text:`Draft ${r.id} saved. An authorized user must activate it.`}],details:{id:r.id}};}
  });
 }
 if(agentTools.includes('propose_workflow')){
  additionalTools.push({
   name:'propose_workflow',label:'Propose workflow',description:'Save a disabled workflow draft. A user must enable it in the dashboard.',parameters:Type.Object({name:Type.String(),prompt:Type.String(),kind:Type.Union(['implement','review','address','conflict','test','coverage','improve','adapt','system'].map(x=>Type.Literal(x))),trigger:Type.Union(['schedule','change_created','change_updated','comment','conflict','test_failed'].map(x=>Type.Literal(x))),intervalMinutes:Type.Optional(Type.Number({minimum:5}))}),
   execute:async(_id:string,args:any)=>{const r=put('workflows',{...args,projectId:repo.projectId,repoId:repo.id,authorId:job.authorId,enabled:false,autonomy:'prepare',intervalMinutes:args.intervalMinutes||60,nextRun:Date.now()+(args.intervalMinutes||60)*60000,jobId:id});return {content:[{type:'text',text:`Workflow draft ${r.id} saved for review.`}],details:{id:r.id}};}
  });
 }
 if(enableHostTerminal){
  additionalTools.push({
   name:'host_terminal',label:'Host terminal (requires approval)',description:'Run a bash terminal command directly on the host system. Every command is proposed as an administrative action and pauses execution until approved by an administrator.',
   parameters:Type.Object({command:Type.String({description:'Bash command line to execute on host'}),reason:Type.String({description:'Clear reason why this host command is required'}),cwd:Type.Optional(Type.String({description:'Host directory (defaults to repository workspace)'})),timeout:Type.Optional(Type.Number({description:'Timeout in seconds (max 1800)'}))}),
   execute:async(_callId:string,args:any)=>{
    const user=get('users',job.authorId);if(!user||user.disabled)throw Error('Job author unavailable');
    const cwd=args.cwd||job.path||resolve('.');
    const timeout=Math.min(Math.max(1,Number(args.timeout)||120),1800);
    const action=proposeAction(job.authorId,args.reason,{kind:'host',command:args.command,cwd,timeout});
    put('adminActions',{id:action.id,jobId:job.id});
    send('notice',`Host command proposed (Action ${action.id}): "${args.command}". Awaiting administrator approval in Approvals dashboard...`);
    event(job.id,'action_proposed',{actionId:action.id,command:args.command,reason:args.reason});
    while(true){
     const cur=get('adminActions',action.id);
     if(!cur)throw Error('Action proposal was removed');
     if(cur.status==='completed'){
      return {content:[{type:'text',text:cur.result||cur.log||'Command completed successfully.'}],details:{actionId:action.id,output:cur.result||cur.log}};
     }
     if(cur.status==='rejected'){
      return {isError:true,content:[{type:'text',text:'Host command was rejected by administrator.'}],details:{actionId:action.id}};
     }
     if(cur.status==='failed'||cur.status==='interrupted'){
      return {isError:true,content:[{type:'text',text:`Host command failed: ${cur.error||cur.log||'Unknown error'}`}],details:{actionId:action.id,error:cur.error}};
     }
     if(get('jobs',job.id)?.status==='cancelled'){
      throw Error('Job was cancelled');
     }
     await new Promise(r=>setTimeout(r,500));
    }
   }
  });
 }
 if(mcpSession.tools?.length){
  additionalTools.push(...mcpSession.tools);
 }
 if(job.deploymentId){additionalTools.length=0;additionalTools.push({name:'propose_deployment_connection',label:'Propose deployment connection',description:'Save an unapproved, immutable host connection draft. This never executes the connection or authorizes operations.',parameters:Type.Object({content:Type.String(),notes:Type.String(),checkoutPaths:Type.Array(Type.String())}),execute:async(_id:string,args:any)=>{const user=get('users',job.authorId);if(!user)throw Error('Job owner unavailable');requireExternalAdmin(user);const c=saveConnectionDraft(job.deploymentId,args,user,id);return {content:[{type:'text',text:`Draft ${c.id} saved, digest ${c.digest}. Administrator review is required before any host execution.`}],details:{id:c.id,digest:c.digest}};}});}
 if(job.kind==='review')additionalTools.push({name:'submit_review',label:'Submit review',description:'Record your final review against these exact revisions. Approve only when there are no unresolved correctness concerns.',parameters:Type.Object({body:Type.String(),verdict:Type.Union([Type.Literal('approved'),Type.Literal('changes_requested'),Type.Literal('commented')])}),execute:async(_id:string,args:any)=>{send('review',args);return {content:[{type:'text',text:'Review recorded.'}],details:{}};}});
 const shell=createBashToolDefinition('/workspace',{exposeSessionEnvironment:false,operations:{exec:async(cmd,_cwd,options)=>{const user=get('users',job.authorId);if(!user||user.disabled||!canOperate(user,repo.projectId))throw Error('Job owner access was revoked');if(job.deploymentId)requireExternalAdmin(user);return dockerExec(container,cmd,options.onData,options.signal,options.timeout)}}});shell.name='workspace';shell.description='Run bash inside the isolated repository container. Use shell commands to read, edit, and test files in /workspace.';
 const activeToolNames=[...(enableWorkspace?['workspace']:[]),...additionalTools.map(t=>t.name),...loader.getExtensions().extensions.flatMap(e=>[...e.tools.keys()])];
 const activeCustomTools=[...(enableWorkspace?[shell as any]:[]),...additionalTools];
 ({session}=await createAgentSession({cwd:job.path,agentDir:join(dataDir,'pi'),modelRuntime:mr,model,resourceLoader:loader,tools:activeToolNames,customTools:activeCustomTools,sessionManager:manager,settingsManager:SettingsManager.inMemory({retry:{enabled:true,maxRetries:2}})}));
 send('session',manager.getSessionFile());
 let streamedThinking = '';
 session.subscribe((e:any)=>{
  if(e.type==='message_update'){
   if(e.assistantMessageEvent.type==='text_delta')send('text',e.assistantMessageEvent.delta);
   else if(e.assistantMessageEvent.type==='thinking_delta'){
    streamedThinking += e.assistantMessageEvent.delta;
    send('thinking',e.assistantMessageEvent.delta);
   }
   else if(e.assistantMessageEvent.type==='thinking_end'){
    if(!streamedThinking && e.assistantMessageEvent.content){
     streamedThinking = e.assistantMessageEvent.content;
     send('thinking',e.assistantMessageEvent.content);
    }
   }
  }
  else if(e.type==='tool_execution_start')send('tool',{toolCallId:e.toolCallId,name:e.toolName,args:e.args});
  else if(e.type==='tool_execution_update')send('tool_update',{toolCallId:e.toolCallId,name:e.toolName,args:e.args,partialResult:e.partialResult});
  else if(e.type==='tool_execution_end')send('tool_result',{toolCallId:e.toolCallId,name:e.toolName,result:e.result,isError:e.isError,durationMs:e.durationMs});
  else if(e.type==='message_end'&&e.message.role==='assistant'){
   send('usage',{usage:e.message.usage,stopReason:e.message.stopReason});
   const fullText=e.message.content?.filter((c:any)=>c.type==='text').map((c:any)=>c.text).join('')||'';
   if(fullText)send('final_text',fullText);
   const thinkingBlocks=e.message.content?.filter((c:any)=>c.type==='thinking').map((c:any)=>c.thinking).join('')||'';
   if(thinkingBlocks && !streamedThinking){
    send('thinking',thinkingBlocks);
   }
   streamedThinking = '';
  }
 });
 if(model.reasoning) {
  const effectiveThinking = job.thinkingLevel && job.thinkingLevel !== 'off'
   ? job.thinkingLevel
   : (repo.thinkingLevel && repo.thinkingLevel !== 'off'
      ? repo.thinkingLevel
      : (job.thinkingLevel === 'off' ? 'off' : 'medium'));
  session.setThinkingLevel(effectiveThinking);
 }
 const promptImages=job.images?.map((img:any)=>({type:'image' as const,data:img.data,mimeType:img.mimeType||'image/png'}));
 await session.prompt(`${job.context||''}\n\n${job.resumePrompt||job.prompt}\n${job.kind==='review'?'Use submit_review to record your final verdict.':job.kind==='adapt'?'Use propose_resource and propose_workflow to save changes as drafts. For modifications to Orchestra itself, edit source code as an ordinary change request.':''}`,promptImages?.length?{images:promptImages}:undefined);const last=session.messages.filter((m:any)=>m.role==='assistant').at(-1);if(last?.stopReason==='error'||last?.stopReason==='aborted')throw Error(last.errorMessage||'Provider request did not complete');const finalRes=session.getLastAssistantText();if(finalRes)send('result',finalRes);
}catch(e){send('failure',String(e));process.exitCode=1;}finally{await mcpSession?.close().catch(()=>{});session?.dispose();await stopSandbox(container);process.disconnect?.();}
