import http from 'node:http';
import https from 'node:https';
import { readFileSync } from 'node:fs';
import httpProxy from 'http-proxy';
import { all,get,put,token,hash,type Row } from './store.js';
import { command,createWorktree,revision,locked } from './git.js';
export async function startPreview(repo:Row,job:Row|undefined,userId:string){if(!repo.previewCommand)throw Error('Set a preview command in repository settings first.');const p=put('previews',{repoId:repo.id,projectId:repo.projectId,jobId:job?.id,userId,status:'starting',lastUsed:Date.now()});const name=`relay-preview-${p.id}`;try{const path=job?.path||await locked(repo.id,()=>createWorktree(repo,`preview-${p.id}`,repo.base));await command('docker',['run','-d','--name',name,'--label','relay.managed=true','--cap-drop=ALL','--security-opt=no-new-privileges','--pids-limit=256','--memory=2g','--cpus=2','--user',`${process.getuid?.()||1000}:${process.getgid?.()||1000}`,'-p',`127.0.0.1::${repo.port}`,'--mount',`type=bind,source=${path},target=/workspace`,'--mount',`type=bind,source=${path}/.git,target=/workspace/.git,readonly`,'-w','/workspace','-e','HOME=/tmp',repo.image,'bash','-lc',repo.previewCommand],undefined,180000);const port=Number((await command('docker',['port',name,`${repo.port}/tcp`])).split(':').at(-1));let ready=false;for(let i=0;i<60;i++){try{const r=await fetch(`http://127.0.0.1:${port}`,{signal:AbortSignal.timeout(1000)});ready=r.status<500;if(ready)break;}catch{}await new Promise(r=>setTimeout(r,1000));}if(!ready)throw Error('Preview did not become ready within 60 seconds. Check container logs.');return put('previews',{id:p.id,status:'running',port,name,path});}catch(e){put('previews',{id:p.id,status:'failed',name,error:String(e)});throw e;}}
export async function stopPreview(id:string){const p=get('previews',id);if(p?.name)await command('docker',['rm','-f',p.name]).catch(()=>{});return put('previews',{id,status:'stopped'});}
export function previewLink(p:Row,userId:string,baseUrlOrHost:string){
 const raw=token();
 put('previewGrants',{hash:hash(raw),previewId:p.id,userId,expires:Date.now()+10*60000});
 if(process.env.RELAY_PREVIEW_URL)return `${process.env.RELAY_PREVIEW_URL}/open#${raw}`;
 const root=baseUrlOrHost.startsWith('http://')||baseUrlOrHost.startsWith('https://')
  ? baseUrlOrHost
  : `${process.env.RELAY_TLS_CERT?'https':'http'}://${baseUrlOrHost}`;
 return `${root.replace(/\/+$/,'')}/preview/${p.id}/open#${raw}`;
}
function parseCookies(header?:string):Record<string,string>{
 if(!header)return {};
 const map:Record<string,string>={};
 for(const part of header.split(';')){
  const [k,...v]=part.trim().split('=');
  if(k)map[k]=v.join('=');
 }
 return map;
}
function stripOrchestraCookies(header?:string):string|undefined{
 if(!header)return undefined;
 const kept=header.split(';').map(c=>c.trim()).filter(c=>!c.startsWith('relay_')&&!c.startsWith('orchestra_'));
 return kept.length?kept.join('; '):undefined;
}
export function authorizePreview(req:http.IncomingMessage,previewId:string):Row|null{
 const p=get('previews',previewId);
 if(!p||p.status!=='running')return null;
 const cookies=parseCookies(req.headers.cookie);
 const secret=cookies[`relay_preview_${previewId}`]||cookies['relay_preview'];
 if(secret){
  const g=all('previewGrants').find(g=>g.previewId===previewId&&g.hash===hash(secret)&&g.expires>Date.now());
  const u=g&&get('users',g.userId);
  if(u&&!u.disabled&&(['owner','admin'].includes(u.role)||(u.projects||[]).includes(p.projectId))){
   put('previews',{id:p.id,lastUsed:Date.now()});
   return p;
  }
 }
 const rawAuth=req.headers.authorization?.replace(/^Bearer /,'');
 if(rawAuth){
  const d=all('devices').find(d=>d.hash===hash(rawAuth));
  const u=d&&get('users',d.userId);
  if(u&&!u.disabled&&(['owner','admin'].includes(u.role)||(u.projects||[]).includes(p.projectId))){
   put('previews',{id:p.id,lastUsed:Date.now()});
   return p;
  }
 }
 return null;
}
export function claimGrantToken(previewId:string,rawToken:string,isSecure=false):string[]|null{
 const g=all('previewGrants').find(g=>g.previewId===previewId&&g.hash===hash(rawToken)&&g.expires>Date.now()&&!g.claimed);
 if(!g)return null;
 const secret=token();
 put('previewGrants',{...g,hash:hash(secret),claimed:true,expires:Date.now()+8*3600000});
 const sec=isSecure?'; Secure':'';
 return [
  `relay_preview_${previewId}=${secret}; Path=/; HttpOnly; SameSite=Lax${sec}`,
  `relay_active_preview=${previewId}; Path=/; SameSite=Lax${sec}`
 ];
}
function renderOpenPage(previewId:string):string{
 return `<!doctype html>
<html>
<head>
 <meta charset="utf-8">
 <meta name="viewport" content="width=device-width, initial-scale=1">
 <title>Opening preview · Orchestra</title>
 <style>
  body { font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #0f141c; color: #f0f6fc; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; }
  .card { background: #161b22; border: 1px solid #30363d; border-radius: 8px; padding: 32px; max-width: 400px; text-align: center; }
  h1 { font-size: 18px; margin: 0 0 8px; font-weight: 600; }
  p { font-size: 14px; color: #8b949e; margin: 0; line-height: 1.5; }
  .spinner { width: 24px; height: 24px; border: 3px solid #30363d; border-top-color: #58a6ff; border-radius: 50%; animation: spin 0.8s linear infinite; margin: 0 auto 16px; }
  @keyframes spin { to { transform: rotate(360deg); } }
 </style>
</head>
<body>
 <div class="card">
  <div class="spinner" id="sp"></div>
  <h1>Opening preview</h1>
  <p id="msg">Connecting to your preview container…</p>
 </div>
 <script>
  const t = location.hash.slice(1);
  if (!t) {
   document.getElementById('sp').style.display = 'none';
   document.getElementById('msg').textContent = 'Missing preview token. Open a fresh link from the Orchestra dashboard.';
  } else {
   fetch('/preview/${previewId}/claim', { method: 'POST', body: t }).then(r => {
    if (r.ok) location.replace('/preview/${previewId}/');
    else {
     document.getElementById('sp').style.display = 'none';
     document.getElementById('msg').textContent = 'Preview link expired or unauthorized. Open a fresh link from Orchestra.';
    }
   }).catch(() => {
    document.getElementById('sp').style.display = 'none';
    document.getElementById('msg').textContent = 'Could not reach Orchestra server.';
   });
  }
 </script>
</body>
</html>`;
}
export function registerPreviewIngress(app:any){
 const proxy=httpProxy.createProxyServer({ws:true});
 proxy.on('error',(_err,_req,res:any)=>{
  if(res&&res.writeHead&&!res.headersSent){
   res.writeHead(502,{'content-type':'text/plain; charset=utf-8'});
   res.end('Preview is not available');
  }else if(res&&res.destroy){
   res.destroy();
  }
 });

 app.addHook('onRequest',async(req:any,reply:any)=>{
  const rawReq:http.IncomingMessage=req.raw;
  const rawRes:http.ServerResponse=reply.raw;
  const url=req.url||rawReq.url||'/';
  const isSecure=Boolean(process.env.RELAY_TLS_CERT||req.headers['x-forwarded-proto']==='https');

  // Case 1: Explicit preview route: /preview/:id
  const match=url.match(/^\/preview\/([^/?#]+)(?:([/?#].*)|$)/);
  if(match){
   const previewId=match[1];
   const rest=match[2]||'';

   if(rest==='/open'||rest.startsWith('/open?')){
    reply.hijack();
    rawRes.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Referrer-Policy':'same-origin'});
    rawRes.end(renderOpenPage(previewId));
    return;
   }

   if(rest==='/claim'&&req.method==='POST'){
    reply.hijack();
    let body='';
    for await(const chunk of rawReq){
     body+=chunk;
     if(body.length>512){
      rawRes.writeHead(400);
      rawRes.end();
      return;
     }
    }
    const cookies=claimGrantToken(previewId,body.trim(),isSecure);
    if(!cookies){
     rawRes.writeHead(401,{'Content-Type':'text/plain'});
     rawRes.end('Unauthorized or expired');
     return;
    }
    rawRes.setHeader('Set-Cookie',cookies);
    rawRes.writeHead(200,{'Content-Type':'text/plain'});
    rawRes.end('ok');
    return;
   }

   const qIdx=url.indexOf('?');
   if(qIdx!==-1){
    const params=new URLSearchParams(url.slice(qIdx+1));
    const directToken=params.get('token')||params.get('grant');
    if(directToken){
     const cookies=claimGrantToken(previewId,directToken,isSecure);
     if(cookies){
      params.delete('token');
      params.delete('grant');
      const rem=params.toString();
      const clean=`/preview/${previewId}/${rem?`?${rem}`:''}`;
      reply.hijack();
      rawRes.setHeader('Set-Cookie',cookies);
      rawRes.writeHead(302,{Location:clean});
      rawRes.end();
      return;
     }
    }
   }

   if(!rest){
    reply.hijack();
    rawRes.writeHead(302,{Location:`/preview/${previewId}/`});
    rawRes.end();
    return;
   }

   const p=authorizePreview(rawReq,previewId);
   if(!p){
    reply.hijack();
    rawRes.writeHead(401,{'Content-Type':'text/html; charset=utf-8'});
    rawRes.end('<title>Unauthorized</title><p style="font-family:sans-serif;padding:24px;color:#c9d1d9;background:#0d1117">Access denied. Open this preview from the Orchestra dashboard.</p>');
    return;
   }

   reply.hijack();
   let targetPath=rest.startsWith('/')?rest:`/${rest}`;
   if(targetPath.startsWith('?'))targetPath='/'+targetPath;
   if(!targetPath)targetPath='/';
   rawReq.url=targetPath;
   delete rawReq.headers.authorization;
   const cleanCookies=stripOrchestraCookies(rawReq.headers.cookie);
   if(cleanCookies)rawReq.headers.cookie=cleanCookies;
   else delete rawReq.headers.cookie;
   rawReq.headers['x-forwarded-host']=rawReq.headers.host;
   rawReq.headers['x-forwarded-proto']=isSecure?'https':'http';
   rawReq.headers['x-forwarded-prefix']=`/preview/${previewId}`;
   proxy.web(rawReq,rawRes,{target:`http://127.0.0.1:${p.port}`});
   return;
  }

  // Case 2: Fallback sub-resource proxying based on Referer header
  if(!url.startsWith('/api/')){
   const referer=rawReq.headers.referer||'';
   const refMatch=referer.match(/\/preview\/([^/?#]+)/);
   if(refMatch){
    const previewId=refMatch[1];
    const isOrchestraDashboardPage=['/','/overview','/repositories','/changes','/work','/automations','/previews','/settings','/onboarding'].some(page=>url===page||url.startsWith(page+'?')||url.startsWith(page+'/'));
    if(!isOrchestraDashboardPage){
     const p=authorizePreview(rawReq,previewId);
     if(p){
      reply.hijack();
      delete rawReq.headers.authorization;
      const cleanCookies=stripOrchestraCookies(rawReq.headers.cookie);
      if(cleanCookies)rawReq.headers.cookie=cleanCookies;
      else delete rawReq.headers.cookie;
      rawReq.headers['x-forwarded-host']=rawReq.headers.host;
      rawReq.headers['x-forwarded-proto']=isSecure?'https':'http';
      proxy.web(rawReq,rawRes,{target:`http://127.0.0.1:${p.port}`});
      return;
     }
    }
   }
  }
 });

 if(app.server){
  app.server.on('upgrade',(req:http.IncomingMessage,socket:any,head:Buffer)=>{
   let previewId:string|undefined;
   const match=req.url?.match(/^\/preview\/([^/?#]+)(?:[/?#]|$)/);
   if(match){
    previewId=match[1];
    req.url=req.url!.slice(`/preview/${previewId}`.length)||'/';
   }else{
    const referer=req.headers.referer||'';
    const refMatch=referer.match(/\/preview\/([^/?#]+)/);
    if(refMatch)previewId=refMatch[1];
   }
   if(!previewId){
    socket.destroy();
    return;
   }
   const p=authorizePreview(req,previewId);
   if(!p){
    socket.destroy();
    return;
   }
   delete req.headers.authorization;
   const cleanCookies=stripOrchestraCookies(req.headers.cookie);
   if(cleanCookies)req.headers.cookie=cleanCookies;
   else delete req.headers.cookie;
   proxy.ws(req,socket,head,{target:`http://127.0.0.1:${p.port}`});
  });
 }

 app.addHook('onClose',async()=>{
  proxy.close();
 });
}
export function servePreviews(host:string){const proxy=httpProxy.createProxyServer({ws:true});proxy.on('error',(_err,_req,res:any)=>{if(res.writeHead){res.writeHead(502);res.end('Preview is not available');}else res.destroy();});
 const authorize=(req:http.IncomingMessage)=>{const cookie=req.headers.cookie?.split(';').map(s=>s.trim()).find(s=>s.startsWith('relay_preview='))?.slice(14);const grant=cookie&&all('previewGrants').find(g=>g.hash===hash(cookie)&&g.expires>Date.now());const p=grant&&get('previews',grant.previewId),u=grant&&get('users',grant.userId);if(!p||p.status!=='running'||!u||u.disabled||!(['owner','admin'].includes(u.role)||(u.projects||[]).includes(p.projectId)))return;put('previews',{id:p.id,lastUsed:Date.now()});return p;};
 const handler=async(req:http.IncomingMessage,res:http.ServerResponse)=>{res.setHeader('Referrer-Policy','no-referrer');if(req.url==='/open'){res.setHeader('Content-Type','text/html');res.end(`<title>Opening preview</title><p>Opening your preview…</p><script>const t=location.hash.slice(1);history.replaceState(null,'','/open');fetch('/claim',{method:'POST',body:t}).then(r=>{if(r.ok)location.replace('/');else document.body.textContent='Preview link expired. Open a fresh link in Orchestra.'})</script>`);return;}if(req.url==='/claim'&&req.method==='POST'){let body='';for await(const chunk of req){body+=chunk;if(body.length>256){res.writeHead(400);res.end();return;}}const g=all('previewGrants').find(g=>g.hash===hash(body)&&g.expires>Date.now()&&!g.claimed);if(!g){res.writeHead(401);res.end();return;}const secret=token();put('previewGrants',{...g,hash:hash(secret),claimed:true,expires:Date.now()+8*3600000});res.setHeader('Set-Cookie',`relay_preview=${secret}; HttpOnly; SameSite=Strict; Path=/${process.env.RELAY_TLS_CERT?'; Secure':''}`);res.end('ok');return;}
 const p=authorize(req);if(!p){res.writeHead(401);res.end('Open this preview from Orchestra.');return;}delete req.headers.cookie;delete req.headers.authorization;proxy.web(req,res,{target:`http://127.0.0.1:${p.port}`});};
 const server=process.env.RELAY_TLS_CERT?https.createServer({cert:readFileSync(process.env.RELAY_TLS_CERT),key:readFileSync(process.env.RELAY_TLS_KEY!)},handler):http.createServer(handler);
 server.on('upgrade',(req,socket,head)=>{const p=authorize(req);if(!p){socket.destroy();return;}delete req.headers.cookie;delete req.headers.authorization;proxy.ws(req,socket,head,{target:`http://127.0.0.1:${p.port}`});});server.listen(Number(process.env.RELAY_PREVIEW_PORT||4311),host);
 setInterval(()=>{for(const p of all('previews').filter(p=>p.status==='running'&&p.lastUsed<Date.now()-30*60000))void stopPreview(p.id)},60000).unref();return server;}
