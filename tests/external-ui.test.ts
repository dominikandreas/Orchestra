import {test} from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import React,{act} from 'react';
import {ExternalDeployments} from '../src/web/external-deployments.js';

test('deployment UI links by prompt, reviews exact code, pins operations, escapes logs and enforces viewer controls',async()=>{
 const dom=new JSDOM('<div id="root"></div>',{url:'http://localhost'});
 Object.assign(globalThis,{window:dom.window,document:dom.window.document,IS_REACT_ACT_ENVIRONMENT:true});
 const {createRoot}=await import('react-dom/client');
 const host=document.getElementById('root')!,root=createRoot(host),calls:any[]=[];
 const digest='a'.repeat(64),revision='b'.repeat(40);
 const d:any={id:'deployment',name:'Fixture',repoId:'repo',status:'needs_approval',policy:'manual',jobId:'job',connection:{id:'connection',version:1,contractVersion:1,digest,content:'export default async () => "read-only fixture";',notes:'Review assumptions',checkoutPaths:[]},versions:[],operations:[]};
 const api=async(path:string,method='GET',data?:any)=>{calls.push({path,method,data});if(path==='/external-deployments'&&method==='POST')return d;if(path.endsWith('/approve'))d.approvedDigest=digest;if(path.endsWith('/operations'))d.operations.push({id:'operation',operation:data.operation,status:'awaiting_approval',revision:data.revision,digest,connectionId:'connection',log:'<script>globalThis.pwned=true</script>',created:'now'});return structuredClone(d)};
 const props={api,deployments:[d],repos:[{id:'repo',name:'Managed repo'}],jobs:[{id:'job',status:'completed'}],admin:true,refresh:async()=>{},openJob:(id:string)=>calls.push({job:id})};
 const render=async(admin=true)=>{await act(async()=>{root.render(React.createElement(ExternalDeployments,{...props,admin}))})};
 const button=(text:string)=>[...host.querySelectorAll('button')].find(b=>b.textContent?.includes(text))!;
 const click=async(text:string)=>{await act(async()=>{button(text).click()})};
 try{
 await render();assert.match(host.textContent!,/Creates a tracked agent job/);assert.equal(calls.length,0);
 // Native form submission with controlled fields verifies prompt onboarding, not a static service form.
 const form=host.querySelector('form')!;
 const inputs=form.querySelectorAll('input,textarea');
 for(const [element,value] of [[inputs[0],'Prompt deployment'],[inputs[1],'Link existing service; do not restart']] as const){await act(async()=>{const proto=element.tagName==='TEXTAREA'?dom.window.HTMLTextAreaElement.prototype:dom.window.HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(proto,'value')!.set!.call(element,value);element.dispatchEvent(new dom.window.Event('input',{bubbles:true}));element.dispatchEvent(new dom.window.Event('change',{bubbles:true}))})}
 await act(async()=>{form.dispatchEvent(new dom.window.Event('submit',{bubbles:true,cancelable:true}))});
 assert.deepEqual(calls.find(c=>c.path==='/external-deployments').data,{repoId:'repo',name:'Prompt deployment',prompt:'Link existing service; do not restart'});
 await click('Fixture');assert.match(host.textContent!,/read-only fixture/);assert.equal(button('Status').disabled,true);assert.equal(button('Approve exact connection').disabled,true);
 const checkbox=host.querySelector('input[type=checkbox]') as HTMLInputElement;await act(async()=>checkbox.click());assert.equal(button('Approve exact connection').disabled,false);
 await click('Approve exact connection');assert.deepEqual(calls.find(c=>c.path.endsWith('/approve')).data,{digest});assert.equal(button('Status').disabled,false);
 await click('Status');assert.deepEqual(calls.find(c=>c.path.endsWith('/operations')).data,{operation:'status',lines:100});assert.ok(host.textContent!.includes('<script>globalThis.pwned=true</script>'));assert.equal(host.querySelector('script'),null);
 // Persisted pending deployment displays its immutable SHA/digest and sends those exact values.
 d.operations=[{id:'pending',operation:'deploy',status:'awaiting_approval',revision,digest,connectionId:'connection',created:'now'}];await click('Inspect');await click('Approve deployment of');assert.deepEqual(calls.find(c=>c.path==='/external-operations/pending/approve').data,{digest,revision});
 await render(false);assert.equal(button('Request deployment'),undefined);assert.equal(button('Approve deployment of'),undefined);assert.equal(button('Ask agent to connect'),undefined);assert.ok(button('Logs'));
 await click('Onboarding job');assert.ok(calls.some(c=>c.job==='job'));
 }finally{await act(async()=>root.unmount());dom.window.close();}
});
