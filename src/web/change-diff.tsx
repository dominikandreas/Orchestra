import React,{useEffect,useRef,useState} from 'react';
import {api,ago,type Item} from './lib';
import {Markdown} from './markdown';
import {ErrorNote,Spinner} from './ui';

type DiffLine={text:string,kind:'context'|'add'|'delete'|'meta',oldLine?:number,newLine?:number};
type DiffFile={path:string,oldPath:string,lines:DiffLine[],binary:boolean};
const unquote=(s:string)=>{try{return s.startsWith('"')?JSON.parse(s):s;}catch{return s;}};
const cleanPath=(s:string)=>unquote(s.replace(/\t.*$/,'')).replace(/^[ab]\//,'');

// Legacy parser kept for callers/tests; the workspace itself fetches only structured lazy endpoints.
export function parseChangeDiff(raw:string):DiffFile[]{
 const files:DiffFile[]=[];
 let file:DiffFile|undefined,oldLine=0,newLine=0,inHunk=false;
 for(const text of raw.split('\n')){
  if(text.startsWith('diff --git ')){
   const paths=text.slice(11).match(/"(?:[^"\\]|\\.)*"|\S+/g)||[];
   file={path:cleanPath(paths[1]||paths[0]||'Unknown file'),oldPath:cleanPath(paths[0]||''),lines:[],binary:false};
   files.push(file);inHunk=false;continue;
  }
  if(!file)continue;
  if(!inHunk&&/^(rename|copy) from /.test(text))file.oldPath=unquote(text.replace(/^(rename|copy) from /,''));
  if(!inHunk&&/^(rename|copy) to /.test(text))file.path=unquote(text.replace(/^(rename|copy) to /,''));
  if(!inHunk&&text.startsWith('--- ')){file.oldPath=cleanPath(text.slice(4));continue;}
  if(!inHunk&&text.startsWith('+++ ')){const path=cleanPath(text.slice(4));file.path=path==='/dev/null'?file.oldPath:path;continue;}
  const hunk=text.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
  if(hunk){oldLine=+hunk[1];newLine=+hunk[2];inHunk=true;file.lines.push({text,kind:'meta'});continue;}
  if(inHunk&&text.startsWith('+'))file.lines.push({text:text.slice(1),kind:'add',newLine:newLine++});
  else if(inHunk&&text.startsWith('-'))file.lines.push({text:text.slice(1),kind:'delete',oldLine:oldLine++});
  else if(inHunk&&text.startsWith(' '))file.lines.push({text:text.slice(1),kind:'context',oldLine:oldLine++,newLine:newLine++});
  else if(text){file.lines.push({text,kind:'meta'});if(/^(Binary files|GIT binary patch)/.test(text))file.binary=true;}
 }
 return files;
}

export function normalizeChangeDiff(diff:string|Item|undefined):DiffFile[]{
 if(typeof diff==='string')return parseChangeDiff(diff);
 if(!diff)return [];
 if(Array.isArray(diff.files)&&diff.files.every((f:Item)=>Array.isArray(f.hunks)||Array.isArray(f.lines))){
  return diff.files.map((f:Item)=>({path:f.path,oldPath:f.oldPath||f.path,binary:Boolean(f.binary),lines:(f.hunks?f.hunks.flatMap((h:Item)=>[{kind:'meta',text:h.header},...h.lines]):f.lines).map((l:Item)=>({text:l.text||'',kind:l.kind==='addition'?'add':l.kind==='deletion'?'delete':l.kind,oldLine:l.oldLine??undefined,newLine:l.newLine??undefined}))}));
 }
 return parseChangeDiff(diff.patch||diff.raw||diff.diff||'');
}

export function ChangeDiff({id,active,sourceSha,targetSha,comments,canEdit,onComment}:{id:string,active:boolean,sourceSha:string,targetSha:string,comments:Item[],canEdit:boolean,onComment:()=>Promise<void>}){
 const [manifest,setManifest]=useState<Item|null>(null);
 const [preview,setPreview]=useState<Item|null>(null);
 const [loading,setLoading]=useState(false);
 const [fileLoading,setFileLoading]=useState(false);
 const [reload,setReload]=useState(0);
 const manifestRequest=useRef(0),fileRequest=useRef(0);
 const files:Item[]=manifest?.files||[];
 const [dependencies,setDependencies]=useState(false);
 const [selected,setSelected]=useState('');
 const [anchor,setAnchor]=useState<{path:string,line:number,side:'old'|'new',sourceSha:string,targetSha:string}|null>(null);
 const [text,setText]=useState('');
 const [busy,setBusy]=useState(false);
 const [error,setError]=useState('');
 const hidden=manifest?.counts?.hidden||0;
 const visible=files.filter(f=>dependencies||!f.hidden);
 const metadata=visible.find(f=>f.path===selected)||visible[0];
 const file:DiffFile|undefined=preview&&preview.sourceSha===sourceSha&&preview.targetSha===targetSha&&preview.file.path===metadata?.path?normalizeChangeDiff({files:[{...preview.file,hunks:preview.hunks}]})[0]:undefined;
 useEffect(()=>{
  if(!active)return;
  let disposed=false;const request=++manifestRequest.current;
  setLoading(true);setManifest(null);setPreview(null);setError('');
  void (async()=>{
   try{
    let offset=0,combined:Item[]=[],result:Item;
    do{
     result=await api(`/changes/${id}/files?includeHidden=true&offset=${offset}&limit=500`);
     if(disposed||request!==manifestRequest.current)return;
     if(result.sourceSha!==sourceSha||result.targetSha!==targetSha)throw Error('Revisions changed. Refresh the change before inspecting files.');
     combined.push(...result.files);offset+=result.files.length;
     if(result.hasMore&&!result.files.length)throw Error('Invalid diff pagination');
    }while(result.hasMore);
    setManifest({...result,files:combined});
   }catch(e){if(!disposed&&request===manifestRequest.current)setError((e as Error).message);}
   finally{if(!disposed&&request===manifestRequest.current)setLoading(false);}
  })();
  return ()=>{disposed=true;++manifestRequest.current;};
 },[id,sourceSha,targetSha,active,reload]);
 useEffect(()=>{
  if(!active||!metadata)return;
  let disposed=false;const request=++fileRequest.current;
  setPreview(null);setFileLoading(true);setError('');
  void (async()=>{try{
   const result=await api(`/changes/${id}/file?path=${encodeURIComponent(metadata.path)}&includeHidden=true`);
   if(disposed||request!==fileRequest.current)return;
   if(result.sourceSha!==sourceSha||result.targetSha!==targetSha)throw Error('Revisions changed. Refresh the change before inspecting this file.');
   setPreview(result);
  }catch(e){if(!disposed&&request===fileRequest.current)setError((e as Error).message);}
  finally{if(!disposed&&request===fileRequest.current)setFileLoading(false);}})();
  return ()=>{disposed=true;++fileRequest.current;};
 },[id,metadata?.path,sourceSha,targetSha,active,reload]);
 const save=async()=>{
  if(!anchor||!text.trim()||busy)return;
  setBusy(true);setError('');
  try{
   if(anchor.sourceSha!==sourceSha||anchor.targetSha!==targetSha)throw Error('Revision changed. Cancel and select a line on the current diff.');
   await api(`/changes/${id}/comment`,'POST',{text:text.trim(),...anchor,file:anchor.path});
   setAnchor(null);setText('');await onComment();
  }catch(e){setError((e as Error).message);}finally{setBusy(false);}
 };
 return <section className="change-diff" aria-label="Changed files">
  <div className="change-diff-toolbar"><strong>{manifest?.counts?.total??'…'} changed files</strong><label><input type="checkbox" checked={dependencies} onChange={e=>setDependencies(e.target.checked)}/> Show dependency / generated files{hidden?` (${hidden} hidden by default)`:''}</label><button type="button" className="btn btn-sm" onClick={()=>setReload(n=>n+1)}>Reload files</button></div>
  <ErrorNote>{error}</ErrorNote>
  {loading&&<div className="padded"><Spinner/> Loading file manifest…</div>}
  {anchor&&<p className="padded muted">Line draft retained: {anchor.path}:{anchor.line} ({anchor.side}). {anchor.sourceSha!==sourceSha||anchor.targetSha!==targetSha?'Revision changed; cancel and re-anchor before submitting.':''} <button type="button" className="btn btn-sm" onClick={()=>{if(!text||window.confirm('Discard your unsent line comment?')){setAnchor(null);setText('');}}}>Discard draft</button></p>}
  <div className="change-diff-layout">
   <nav className="change-file-list" aria-label="Files">{visible.map(f=><button type="button" key={f.path} className={f===metadata?'selected':''} aria-current={f===metadata?'true':undefined} onClick={()=>setSelected(f.path)}><span>{f.path}</span><small className="change-file-stats">{f.status} · +{f.additions} −{f.deletions}{f.hidden?' · hidden by default':''}</small></button>)}</nav>
   <div className="change-file-content">
    {fileLoading?<div className="padded"><Spinner/> Loading selected file…</div>:!file?<p className="padded muted">{metadata?'File preview unavailable.':hidden&&!dependencies?'Only dependency/generated files changed. Enable the toggle to inspect them.':'No diff changes between these revisions.'}</p>:<>
     <header className="change-file-heading"><strong>{file.path}</strong><small>{file.binary?'Binary file · no line preview':'Select a line number to comment'} · {sourceSha?.slice(0,8)}</small></header>
     <div className="change-code-scroll"><table className="change-code"><thead><tr><th scope="col">Old</th><th scope="col">New</th><th scope="col">Diff</th></tr></thead><tbody>
      {file.lines.map((line,i)=>{
       const number=line.newLine??line.oldLine;
       const threads=number===undefined?[]:comments.filter(c=>(c.path||c.file)===file.path&&c.line===((c.side||'new')==='old'?line.oldLine:line.newLine)&&c.sourceSha===sourceSha&&c.targetSha===targetSha);
       const active=anchor?.path===file.path&&anchor.line===(anchor.side==='old'?line.oldLine:line.newLine);
       const select=(lineNumber:number,selectedSide:'old'|'new')=>{if(anchor&&text&&!window.confirm('Discard your unsent line comment?'))return;setAnchor({path:file.path,line:lineNumber,side:selectedSide,sourceSha,targetSha});setText('');setError('');};
       return <React.Fragment key={i}><tr className={`change-line change-line-${line.kind}`}>
        <td>{line.oldLine!==undefined&&<button type="button" disabled={!canEdit||busy} aria-label={`Comment on old line ${line.oldLine}`} onClick={()=>select(line.oldLine!,'old')}>{line.oldLine}</button>}</td>
        <td>{line.newLine!==undefined&&<button type="button" disabled={!canEdit||busy} aria-label={`Comment on new line ${line.newLine}`} onClick={()=>select(line.newLine!,'new')}>{line.newLine}</button>}</td>
        <td><pre><span aria-hidden="true">{line.kind==='add'?'+':line.kind==='delete'?'−':' '}</span>{line.text||' '}</pre></td>
       </tr>{threads.length>0&&<tr><td colSpan={3} className="change-inline-thread">{threads.map(c=><article key={c.id}><small>{c.author} · {ago(c.created)}</small><Markdown>{c.text}</Markdown></article>)}</td></tr>}
       {active&&<tr><td colSpan={3} className="change-inline-thread"><form onSubmit={e=>{e.preventDefault();void save();}}><label>Comment on {anchor.side} line {anchor.line}<textarea autoFocus rows={3} value={text} onChange={e=>setText(e.target.value)} required/></label><ErrorNote>{error}</ErrorNote><div className="form-actions"><button type="button" className="btn btn-sm" onClick={()=>{setAnchor(null);setText('');}} disabled={busy}>Cancel</button><button type="submit" className="btn btn-primary btn-sm" disabled={busy||!text.trim()}>{busy&&<Spinner/>}Add comment</button></div></form></td></tr>}
       </React.Fragment>;
      })}
     </tbody></table></div>
     {!file.lines.length&&<p className="padded muted">{preview?.tooLarge?'File exceeds preview size limit; no text downloaded.':file.binary?'Binary file; no text hunks.':'File metadata changed; no text hunks.'}</p>}
    </>}
   </div>
  </div>
 </section>;
}
