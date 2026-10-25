import {test} from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

test('design-first pipeline executes real Docker tasks and reaches ready without auto-merging',{
 skip:(process.env.ORCHESTRA_DOCKER_TEST||process.env.RELAY_DOCKER_TEST)!=='1',timeout:180000
},async()=>{
 const root=await mkdtemp(join(tmpdir(),'orchestra-pipeline-docker-'));
 process.env.RELAY_DATA_DIR=join(root,'data');
 const s=await import('../src/server/store.js'),g=await import('../src/server/git.js');
 const jobs=await import('../src/server/jobs.js'),p=await import('../src/server/change-pipeline.js');
 const {planProjectChange}=await import('../src/server/planned-change.js');
 const server=http.createServer(async(req,res)=>{
  let body='';for await(const chunk of req)body+=chunk;
  const input=JSON.parse(body),hasTool=input.messages.some((m:any)=>m.role==='tool');
  res.writeHead(200,{'Content-Type':'text/event-stream'});
  const send=(delta:any,finish:any=null)=>res.write(`data: ${JSON.stringify({id:'pipeline-fixture',object:'chat.completion.chunk',created:Math.floor(Date.now()/1000),model:'fixture',choices:[{index:0,delta,finish_reason:finish}]})}\n\n`);
  if(!hasTool){
   const review=input.tools?.some((t:any)=>t.function.name==='submit_review');
   send({role:'assistant',tool_calls:[{index:0,id:'fixture-tool',type:'function',function:{name:review?'submit_review':'workspace',arguments:JSON.stringify(review?{body:'Fixture design/review evidence.',verdict:'approved'}:{command:"printf 'pipeline implementation\\n' > result.txt"})}}]});
   send({},'tool_calls');
  }else{send({role:'assistant',content:'Fixture artifact: goals, researched files, acceptance criteria and task evidence recorded.'});send({},'stop');}
  res.end('data: [DONE]\n\n');
 });
 await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));
 try{
  const source=join(root,'source');await g.command('git',['init','-b','main',source]);
  await g.git(source,'config','user.name','Fixture');await g.git(source,'config','user.email','fixture@localhost');
  await writeFile(join(source,'README.md'),'Pipeline fixture\n');await g.git(source,'add','.');await g.git(source,'commit','-m','Initial');
  const project=s.put('projects',{name:'Pipeline Docker fixture'}),user=s.put('users',{name:'Fixture',role:'owner'});
  const connection=s.put('connections',{name:'Local fixture',provider:'pipeline-fixture',ownerId:user.id,status:'connected',secret:s.encrypt({type:'api_key',key:'fixture-only'}),config:{name:'Pipeline fixture',api:'openai-completions',baseUrl:`http://127.0.0.1:${(server.address() as any).port}/v1`,models:[{id:'fixture',name:'Fixture',reasoning:false,input:['text'],contextWindow:64000,maxTokens:2048,cost:{input:0,output:0,cacheRead:0,cacheWrite:0}}]}});
  let repo=await g.importRepository(source,'Pipeline repository',project.id);
  repo=s.put('repos',{id:repo.id,autonomy:'auto',requireReview:true,testCommand:'test -f result.txt && cat result.txt',connectionId:connection.id,model:'fixture'});
  const change=await planProjectChange(project.id,{repoId:repo.id,title:'Design before implementation',description:'Create result.txt after research.',connectionId:connection.id,model:'fixture'},user);
  assert.equal(change.sourceSha,change.targetSha);
  const stages:string[]=[];
  for(let attempt=0;attempt<12;attempt++){
   p.advanceChangePipelines();const pipeline=p.getChangePipeline(change.id)!;
   if(pipeline.status==='ready')break;
   assert.equal(pipeline.status,'running',pipeline.reason);
   const job=s.get('jobs',pipeline.currentJobId)!;assert.ok(job);
   stages.push(pipeline.stage);assert.equal(job.status,'queued');
   await jobs.runJob(job);
   const finished=s.get('jobs',job.id)!;assert.equal(finished.status,'completed',finished.error);
   if(['design','research'].includes(pipeline.stage)){
    assert.equal(await g.revision(repo,change.source),change.sourceSha);
    assert.equal(await g.git(finished.path,'status','--porcelain'),'');
   }
  }
  assert.deepEqual(stages,['design','research','implement','review','test']);
  assert.equal(p.getChangePipeline(change.id)!.status,'ready');
  assert.equal(s.get('changes',change.id)!.status,'open');
  assert.equal(await g.git(repo.path,'show',`${change.source}:result.txt`),'pipeline implementation');
  await assert.rejects(()=>g.git(repo.path,'show','main:result.txt'));
  assert.equal(p.getChangePipeline(change.id)!.evidence.length,5);
 }finally{
  await new Promise<void>(r=>server.close(()=>r()));s.db.close();await rm(root,{recursive:true,force:true});
 }
});
