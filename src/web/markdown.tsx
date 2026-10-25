import React,{useState} from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import rehypeHighlight from 'rehype-highlight';
import 'katex/dist/katex.min.css';
import {Check,Copy} from 'lucide-react';

/** Normalize \(...\) and \[...\] LaTeX delimiters into $...$ / $$...$$ so both MathJax and KaTeX conventions render. */
function normalizeMath(raw:string):string{
 if(!raw)return '';
 return raw
  .replace(/\\\[([\s\S]*?)\\\]/g,(_,body)=>`$$${body}$$`)
  .replace(/\\\(([\s\S]*?)\\\)/g,(_,body)=>`$${body}$`);
}

function CodeBlock({className,children}:any){
 const [copied,setCopied]=useState(false);
 const match=/language-([\w-]+)/.exec(className||'');
 const lang=match?.[1]||'text';
 const extractText=(node:any):string=>{
  if(node===null||node===undefined)return '';
  if(typeof node==='string'||typeof node==='number')return String(node);
  if(Array.isArray(node))return node.map(extractText).join('');
  if(node.props?.children!==undefined)return extractText(node.props.children);
  return '';
 };
 const codeText=extractText(children).replace(/\n$/,'');

 const onCopy=async()=>{
  try{
   await navigator.clipboard.writeText(codeText);
   setCopied(true);
   setTimeout(()=>setCopied(false),1500);
  }catch{}
 };

 return (
  <div className="code-block">
   <div className="code-block-bar">
    <span className="code-lang">{lang}</span>
    <button type="button" className="code-copy" onClick={onCopy} title="Copy code">
     {copied?<><Check size={12}/><span>Copied</span></>:<><Copy size={12}/><span>Copy</span></>}
    </button>
   </div>
   <pre className={className}><code>{children}</code></pre>
  </div>
 );
}

export function Markdown({children,className=''}:{children?:string|null,className?:string}){
 const content=normalizeMath(children||'');
 if(!content.trim())return null;
 return (
  <div className={`md ${className}`.trim()}>
   <ReactMarkdown
    remarkPlugins={[remarkGfm,remarkMath]}
    rehypePlugins={[[rehypeKatex,{throwOnError:false,strict:false}],rehypeHighlight]}
    components={{
     pre({children}:any){
      const child:any=Array.isArray(children)?children[0]:children;
      const cls=child?.props?.className||'';
      const inner=child?.props?.children??children;
      return <CodeBlock className={cls}>{inner}</CodeBlock>;
     },
     a({href,children,...props}:any){
      const external=href&&/^https?:\/\//.test(href);
      return <a href={href} target={external?'_blank':undefined} rel={external?'noreferrer':undefined} {...props}>{children}</a>;
     }
    }}
   >
    {content}
   </ReactMarkdown>
  </div>
 );
}
