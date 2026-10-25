// Opt-in real Chrome MCP smoke; not included in npm test. No external app URL accepted.
import {spawn} from 'node:child_process';
import {createInterface} from 'node:readline';
import {mkdir,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {resolve} from 'node:path';
const bin=process.env.CHROME_MCP_BIN;
if(!bin)throw Error('Set CHROME_MCP_BIN to chrome-devtools-mcp.js (see browser-redesign.md)');
const out=resolve(process.env.BROWSER_SMOKE_OUTPUT||'/tmp/orchestra-redesign/browser-smoke');
await mkdir(out,{recursive:true});
const fixture=spawn(process.execPath,['--import','tsx','tests/browser-redesign-fixture.ts'],{stdio:['ignore','pipe','pipe']});
let mcp;
try{
 const info=await new Promise((resolve,reject)=>{
  const timer=setTimeout(()=>reject(Error('Fixture startup timeout')),60000);
  fixture.stderr.on('data',d=>process.stderr.write(d));
  fixture.once('exit',code=>{clearTimeout(timer);reject(Error(`Fixture exited ${code}`));});
  createInterface({input:fixture.stdout}).on('line',line=>{if(line.startsWith('BROWSER_FIXTURE ')){clearTimeout(timer);resolve(JSON.parse(line.slice(16)));}});
 });
 assert.match(info.url,/^http:\/\/127\.0\.0\.1:\d+$/);
 mcp=spawn(process.execPath,[bin,'--headless','--isolated','--no-page-id-routing','--no-usage-statistics','--no-performance-crux','--executablePath',process.env.CHROME_BIN||'/usr/bin/google-chrome'],{stdio:['pipe','pipe','pipe'],env:{...process.env,CHROME_DEVTOOLS_MCP_NO_USAGE_STATISTICS:'1'}});
 mcp.stderr.on('data',d=>process.stderr.write(d));
 let next=0;const pending=new Map();
 createInterface({input:mcp.stdout}).on('line',line=>{try{const x=JSON.parse(line);if(pending.has(x.id)){const p=pending.get(x.id);pending.delete(x.id);clearTimeout(p.timer);x.error?p.reject(Error(JSON.stringify(x.error))):p.resolve(x.result);}}catch{}});
 const rpc=(method,params={})=>new Promise((resolve,reject)=>{const id=++next;const timer=setTimeout(()=>{pending.delete(id);reject(Error(`MCP timeout: ${method}`));},60000);pending.set(id,{resolve,reject,timer});mcp.stdin.write(JSON.stringify({jsonrpc:'2.0',id,method,params})+'\n');});
 await rpc('initialize',{protocolVersion:'2024-11-05',capabilities:{},clientInfo:{name:'orchestra-isolated-smoke',version:'1'}});
 mcp.stdin.write(JSON.stringify({jsonrpc:'2.0',method:'notifications/initialized'})+'\n');
 const tools=await rpc('tools/list');
 await writeFile(out+'/tools.json',JSON.stringify(tools,null,2));
 async function call(name,args={}){if(name!=='evaluate_script')console.log('MCP '+name);const r=await rpc('tools/call',{name,arguments:args});if(r.isError)throw Error(JSON.stringify(r));return r;}
 async function evaluate(fn){const r=await call('evaluate_script',{function:fn});const text=r.content.filter(c=>c.type==='text').map(c=>c.text).join('\n');const match=text.match(/```json\s*([\s\S]*?)```/);if(!match)throw Error('Unexpected evaluate result: '+text);return match[1].trim()==='undefined'?null:JSON.parse(match[1]);}
 async function until(fn){let result;for(let i=0;i<100;i++){try{result=await evaluate(fn);if(result)return result;}catch(e){if(!/Execution context was destroyed|Cannot find context|frame was detached/i.test(String(e)))throw e;}await new Promise(r=>setTimeout(r,150));}throw Error('Browser assertion timeout: '+fn+'; last='+JSON.stringify(result));}
 await call('new_page',{url:info.url});
 await evaluate(`()=>{localStorage.setItem('relay.device',${JSON.stringify(info.token)});return true}`);
 await call('navigate_page',{type:'reload'});
 await until('()=>document.body.innerText.includes("Browser fixture")');
 await call('take_screenshot',{filePath:out+'/01-home.png',fullPage:true});
 if(process.env.BROWSER_SMOKE_PROBE){console.log(JSON.stringify(await evaluate('()=>({text:document.body.innerText,buttons:[...document.querySelectorAll("button")].map(b=>({text:b.innerText,title:b.title,aria:b.getAttribute("aria-label")}))})'),null,2));}
 else{
  await evaluate(`()=>{const b=[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='New project'||b.title==='New project');if(!b)throw Error('New project action missing');b.click();return true}`);
  await until('()=>!!document.querySelector(".modal input")');
  await evaluate(`()=>{const input=document.querySelector('.modal input');const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;setter.call(input,'Browser created project');input.dispatchEvent(new Event('input',{bubbles:true}));return true}`);
  await evaluate(`()=>{const b=[...document.querySelectorAll('.modal button')].find(b=>b.textContent.trim()==='Create project');if(!b||b.disabled)throw Error('Create project not enabled');b.click();return true}`);
  await until('()=>!document.querySelector(".modal")&&document.body.innerText.includes("Browser created project")');
  const created=await evaluate(`async()=>{const r=await fetch('/api/state',{headers:{authorization:'Bearer '+localStorage.getItem('relay.device')}});return (await r.json()).projects.find(p=>p.name==='Browser created project')}`);
  assert.ok(created?.id,'project persisted through UI');
  await call('navigate_page',{type:'url',url:`${info.url}/?project=${created.id}`});
  await until('()=>!!document.querySelector(".pw-knowledge textarea.pw-editor")');
  await until(`()=>!!document.querySelector('[aria-label="Project coordinator conversation"] textarea[aria-label="Message project coordinator"]')`);
  assert.ok(await evaluate('()=>document.querySelector(".pw-coordinator")?.innerText.includes("Project coordinator")'),'project coordinator visible');
  assert.equal(await evaluate('()=>[...document.querySelectorAll(".project-conversation button")].find(b=>b.textContent.trim()==="Send")?.disabled'),true,'no configured provider must disable sending');
  const knowledgeText='# Browser project knowledge\n\nSaved without a repository. café <literal>.\n';
  await evaluate(`()=>{const t=document.querySelector('.pw-editor');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(t,${JSON.stringify(knowledgeText)});t.dispatchEvent(new Event('input',{bubbles:true}));return true}`);
  const knowledgePath=await evaluate('()=>document.querySelector(".pw-document-toolbar code").textContent');
  await evaluate(`()=>{const b=[...document.querySelectorAll('.pw-document-toolbar button')].find(b=>b.textContent.trim()==='Save');if(!b||b.disabled)throw Error('Knowledge save disabled');b.click();return true}`);
  await until('()=>document.querySelector(".pw-editor-footer")?.textContent.includes("Saved to project knowledge")');
  const knowledge=await evaluate(`async()=>{const headers={authorization:'Bearer '+localStorage.getItem('relay.device')};const k=await(await fetch('/api/projects/${created.id}/knowledge',{headers})).json();const state=await(await fetch('/api/state',{headers})).json();return {knowledge:k,repos:state.repos.filter(r=>r.projectId==='${created.id}')}}`);
  assert.equal(knowledge.repos.length,0,'knowledge must not require a repository');
  assert.equal(knowledge.knowledge.files.find(f=>f.path===knowledgePath)?.content,knowledgeText);assert.ok(knowledge.knowledge.revision);
  await call('navigate_page',{type:'reload'});
  await until(`()=>document.querySelector('.pw-editor')?.value===${JSON.stringify(knowledgeText)}`);
  await until(`()=>!!document.querySelector('[aria-label="Project coordinator conversation"] textarea')`);
  await writeFile(out+'/project-knowledge-result.json',JSON.stringify(knowledge,null,2));
  await call('take_screenshot',{filePath:out+'/02-project.png',fullPage:true});
 }
 // Select the existing fixture through the project filter; sidebar labels may change.
 await call('navigate_page',{type:'url',url:`${info.url}/?project=all`});
 await until('()=>!!document.querySelector(\'select[aria-label="Project filter"]\')');
 await evaluate(`()=>{const s=document.querySelector('select[aria-label="Project filter"]');const option=[...s.options].find(o=>o.textContent==='Browser fixture');if(!option)throw Error('Fixture project option missing');Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(s,option.value);s.dispatchEvent(new Event('change',{bubbles:true}));return true}`);
 await until('()=>document.querySelector(".pw-heading h1")?.textContent==="Browser fixture"');
 await evaluate(`()=>{const b=[...document.querySelectorAll('.pw-heading button')].find(b=>b.textContent.trim()==='New change');if(!b)throw Error('New change action missing');b.click();return true}`);
 await until('()=>!!document.querySelector(\'.modal input[placeholder="What should change?"]\')');
 const plannedTitle='Browser planned change';
 const plannedGoal='Add a clear greeting with acceptance criteria: preserve existing behavior until implementation.';
 await evaluate(`()=>{const modal=document.querySelector('.modal');const select=modal.querySelector('select');Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(select,${JSON.stringify(info.repoId)});select.dispatchEvent(new Event('change',{bubbles:true}));const input=modal.querySelector('input[placeholder="What should change?"]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,${JSON.stringify(plannedTitle)});input.dispatchEvent(new Event('input',{bubbles:true}));const goal=modal.querySelector('textarea');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(goal,${JSON.stringify(plannedGoal)});goal.dispatchEvent(new Event('input',{bubbles:true}));return true}`);
 assert.ok(await evaluate('()=>document.querySelector(".modal")?.textContent.includes("No model provider connected")'),'provider-free creation is explained');
 await evaluate(`()=>{const b=[...document.querySelectorAll('.modal button')].find(b=>b.textContent.trim()==='Create change');if(!b||b.disabled)throw Error('Create change disabled');b.click();return true}`);
 await until('()=>!document.querySelector(".modal")&&!!document.querySelector(\'[aria-label="Change coordinator conversation"]\')&&!!document.querySelector(".change-workspace .tabs")');
 const planned=await evaluate(`async()=>{const headers={authorization:'Bearer '+localStorage.getItem('relay.device')};const read=async path=>{const r=await fetch(path,{headers});if(!r.ok)throw Error(path+': '+r.status);return r.json()};const state=await read('/api/state');const change=state.changes.find(c=>c.title===${JSON.stringify(plannedTitle)});if(!change)throw Error('Planned change not persisted');return {url:location.href,change:await read('/api/changes/'+change.id),conversation:await read('/api/changes/'+change.id+'/conversation'),pipeline:await read('/api/changes/'+change.id+'/pipeline'),files:await read('/api/changes/'+change.id+'/files'),branches:await read('/api/repos/${info.repoId}/branches'),connections:state.connections,jobs:state.jobs}}`);
 assert.equal(new URL(planned.url).pathname,`/changes/${planned.change.id}`,'creation navigates to canonical change URL');
 assert.equal(planned.change.projectId,info.projectId);assert.equal(planned.change.repoId,info.repoId);
 assert.equal(planned.change.title,plannedTitle);assert.equal(planned.change.description,plannedGoal);
 assert.match(planned.change.source,/^relay\/browser-planned-change-[a-zA-Z0-9_-]+$/,'meaningful title-based branch');
 assert.equal(planned.change.target,'main');assert.equal(planned.change.sourceSha,planned.change.targetSha);
 assert.ok(planned.branches.branches.some(b=>b.name===planned.change.source&&b.sha===planned.change.sourceSha),'real named branch exists');
 assert.equal(planned.change.diff.trim(),'');assert.deepEqual(planned.files.files,[]);assert.equal(planned.files.counts.total,0);
 assert.equal(planned.change.pipeline,null);assert.equal(planned.pipeline.pipeline,null);
 assert.equal(planned.connections.length,0);assert.equal(planned.jobs.length,0,'creation must not queue provider work');
 assert.equal(planned.conversation.thread.changeId,planned.change.id);assert.equal(planned.conversation.thread.projectId,info.projectId);
 assert.deepEqual(planned.conversation.messages,[]);assert.deepEqual(planned.conversation.runs,[]);
 await call('take_screenshot',{filePath:out+'/06-planned-conversation.png',fullPage:true});
 await evaluate(`()=>{[...document.querySelectorAll('.change-workspace .tabs button')].find(b=>b.textContent.trim()==='Changes').click();return true}`);
 await until('()=>document.querySelector(".change-diff-toolbar")?.textContent.includes("0 changed files")');
 assert.equal(await evaluate('()=>document.querySelectorAll(".change-file-list button").length'),0);
 await writeFile(out+'/planned-change-result.json',JSON.stringify(planned,null,2));
 await call('take_screenshot',{filePath:out+'/07-planned-empty-diff.png',fullPage:true});
 // Return to the original non-empty fixture for inline-comment regressions.
 await call('navigate_page',{type:'url',url:`${info.url}/changes/${info.changeId}?project=${info.projectId}`});
 await until('()=>!!document.querySelector(".change-workspace .tabs")');
 await evaluate(`()=>{[...document.querySelectorAll('.change-workspace .tabs button')].find(b=>b.textContent.trim()==='Changes').click();return true}`);
 await until('()=>document.body.innerText.includes("greeting")');
 await call('take_screenshot',{filePath:out+'/03-change.png',fullPage:true});
 await writeFile(out+'/change-dom.json',JSON.stringify(await evaluate('()=>({text:document.body.innerText,buttons:[...document.querySelectorAll("button")].map(b=>({text:b.innerText,title:b.title,aria:b.getAttribute("aria-label")}))})'),null,2));
 await until(`()=>{const b=[...document.querySelectorAll('.change-file-list button')].find(b=>b.textContent.includes('notes with spaces.md'));if(!b)return false;b.click();return true}`);
 await until('()=>document.querySelector(".change-file-heading")?.textContent.includes("notes with spaces.md")');
 await until(`()=>{const b=[...document.querySelectorAll('.change-file-list button')].find(b=>b.textContent.includes('hello.ts'));if(!b)return false;b.click();return true}`);
 await until(`()=>!!document.querySelector('[aria-label="Comment on new line 3"]')`);
 await evaluate(`()=>{document.querySelector('[aria-label="Comment on new line 3"]').click();return true}`);
 await until('()=>!!document.querySelector(".change-inline-thread textarea")');
 await evaluate(`()=>{const t=document.querySelector('.change-inline-thread textarea');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(t,'Inline browser smoke comment');t.dispatchEvent(new Event('input',{bubbles:true}));return true}`);
 // Polling must not destroy a draft.
 await new Promise(r=>setTimeout(r,3400));
 assert.equal(await evaluate('()=>document.querySelector(".change-inline-thread textarea")?.value'),'Inline browser smoke comment');
 await evaluate(`()=>{const b=[...document.querySelectorAll('.change-inline-thread button')].find(b=>b.textContent.trim()==='Add comment');if(b.disabled)throw Error('Comment submit disabled');b.click();return true}`);
 await until('()=>!document.querySelector(".change-inline-thread textarea")&&document.querySelector(".change-inline-thread")?.textContent.includes("Inline browser smoke comment")');
 const saved=await evaluate(`async()=>{const r=await fetch('/api/changes/${info.changeId}',{headers:{authorization:'Bearer '+localStorage.getItem('relay.device')}});const c=await r.json();return {comment:c.comments.find(c=>c.text==='Inline browser smoke comment'),sha:c.sourceSha,targetSha:c.targetSha}}`);
 assert.equal(saved.comment.file||saved.comment.path,'hello.ts');assert.equal(saved.comment.line,3);assert.equal(saved.comment.sourceSha,saved.sha);assert.equal(saved.comment.targetSha,saved.targetSha);assert.equal(saved.comment.side,'new');
 await evaluate(`()=>{[...document.querySelectorAll('.change-workspace .tabs button')].find(b=>b.textContent.startsWith('Conversation')).click();return true}`);
 await until(`()=>!!document.querySelector('[aria-label="Change coordinator conversation"]')&&!document.querySelector('.change-diff')?.checkVisibility()`);
 await evaluate(`()=>{[...document.querySelectorAll('.change-workspace .tabs button')].find(b=>b.textContent.trim()==='Changes').click();return true}`);
 await until('()=>document.querySelector(".change-inline-thread")?.textContent.includes("Inline browser smoke comment")');
 await call('navigate_page',{type:'reload'});
 await until('()=>!!document.querySelector(".change-workspace .tabs")');
 await evaluate(`()=>{[...document.querySelectorAll('.change-workspace .tabs button')].find(b=>b.textContent.trim()==='Changes').click();return true}`);
 await until('()=>document.querySelector(".change-inline-thread")?.textContent.includes("Inline browser smoke comment")');
 await call('take_screenshot',{filePath:out+'/04-inline-comment.png',fullPage:true});
 if(process.env.BROWSER_SMOKE_OLD_SIDE){
  await evaluate(`()=>{document.querySelector('[aria-label="Comment on old line 1"]').click();return true}`);
  await until('()=>!!document.querySelector(".change-inline-thread textarea")');
  await evaluate(`()=>{const t=document.querySelector('.change-inline-thread textarea');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(t,'Deleted line browser comment');t.dispatchEvent(new Event('input',{bubbles:true}));return true}`);
  await evaluate(`()=>{[...document.querySelectorAll('.change-inline-thread button')].find(b=>b.textContent.trim()==='Add comment').click();return true}`);
  const old=await until(`async()=>{const r=await fetch('/api/changes/${info.changeId}',{headers:{authorization:'Bearer '+localStorage.getItem('relay.device')}});return (await r.json()).comments.find(c=>c.text==='Deleted line browser comment')||null}`);
  await writeFile(out+'/old-side-result.json',JSON.stringify(old,null,2));
  assert.equal(old.side,'old','Deleted-line comments must retain the old side (otherwise rendered on new line 1)');
  assert.equal(old.sourceSha,saved.sha);assert.equal(old.targetSha,saved.targetSha);assert.equal(old.line,1);
  await call('navigate_page',{type:'reload'});
  await until(`()=>{const b=[...document.querySelectorAll('.change-workspace .tabs button')].find(b=>b.textContent.trim()==='Changes');if(!b)return false;b.click();return true}`);
  await until('()=>[...document.querySelectorAll(".change-inline-thread")].some(t=>t.textContent.includes("Deleted line browser comment"))');
  assert.equal(await evaluate(`()=>{const thread=[...document.querySelectorAll('.change-inline-thread')].find(t=>t.textContent.includes('Deleted line browser comment'));return !!thread?.closest('tr')?.previousElementSibling?.querySelector('[aria-label="Comment on old line 1"]')}`),true,'deleted-line thread must render beside old line 1');
  await call('take_screenshot',{filePath:out+'/05-old-side-comment.png',fullPage:true});
 }
 console.log('PASS: isolated Chrome MCP fixture, authentication, provider-free planned change creation, canonical conversation navigation, meaningful branch and empty diff, change deep-link, file/tab navigation, poll-safe inline draft, persisted new-side anchor and reload'+(process.env.BROWSER_SMOKE_PROBE?' (probe only; project creation not asserted)':', project creation, repository-independent knowledge save/read/reload and project coordinator visibility')+(process.env.BROWSER_SMOKE_OLD_SIDE?', persisted old-side anchor and correct row after reload':''));
 console.log('Artifacts: '+out);
}finally{
 if(mcp){mcp.stdin.end();mcp.kill('SIGTERM');}
 fixture.kill('SIGTERM');
}
