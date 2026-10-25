import React,{createContext,useContext,useEffect,useRef,useState} from 'react';
import {X,Loader2,ChevronDown,Check} from 'lucide-react';
import {cx,statusText,statusTone,type Item} from './lib';

/* ---------- Workspace context ---------- */
export type Workspace={
 me:Item,state:Item,catalog:Item[],refresh:()=>Promise<void>,
 project:string,setProject:(p:string)=>void,
 go:(page:string,id?:string|null,query?:Record<string,string>)=>void,
 notify:(msg:string,tone?:'ok'|'bad')=>void,
 modal:(node:React.ReactNode)=>void,close:()=>void,
 run:(fn:()=>Promise<any>,ok?:string)=>Promise<boolean>,
 isAdmin:boolean,canEdit:boolean,
 theme:string,setTheme:(t:string)=>void
};
export const WorkspaceContext=createContext<Workspace>(null as any);
export const useWorkspace=()=>useContext(WorkspaceContext);

/* ---------- Primitives ---------- */
export function Spinner({size=14}:{size?:number}){return <Loader2 size={size} className="spin"/>;}

export function Status({value,live}:{value?:string,live?:boolean}){
 const tone=statusTone(value);
 return <span className={cx('status',`tone-${tone}`)}><i className={cx('dot',`tone-${tone}`,(live??tone==='live')&&'pulse')}/>{statusText(value)}</span>;
}
export function Dot({status,title}:{status?:string,title?:string}){const tone=statusTone(status);return <i title={title||statusText(status)} className={cx('dot',`tone-${tone}`,tone==='live'&&'pulse')}/>;}

export function Empty({icon:Icon,title,children}:{icon?:any,title:string,children?:React.ReactNode}){
 return <div className="empty">{Icon&&<Icon size={20} strokeWidth={1.6}/>}<strong>{title}</strong>{children&&<div className="empty-body">{children}</div>}</div>;
}

export function PageHeader({title,subtitle,actions,children}:{title:React.ReactNode,subtitle?:React.ReactNode,actions?:React.ReactNode,children?:React.ReactNode}){
 return <header className="page-header"><div className="page-header-main"><div><h1>{title}</h1>{subtitle&&<p>{subtitle}</p>}</div>{actions&&<div className="page-actions">{actions}</div>}</div>{children}</header>;
}

export function Modal({title,onClose,children,size='md',footer}:{title:React.ReactNode,onClose:()=>void,children:React.ReactNode,size?:'sm'|'md'|'lg'|'xl',footer?:React.ReactNode}){
 useEffect(()=>{const h=(e:KeyboardEvent)=>{if(e.key==='Escape'){e.stopPropagation();onClose();}};window.addEventListener('keydown',h);return()=>window.removeEventListener('keydown',h);},[onClose]);
 return <div className="overlay" onMouseDown={e=>{if(e.target===e.currentTarget)onClose();}}>
  <section role="dialog" aria-modal="true" aria-label={typeof title==='string'?title:undefined} className={cx('modal',`modal-${size}`)}>
   <header className="modal-header"><h2>{title}</h2><button type="button" className="icon-btn" aria-label="Close" onClick={onClose}><X size={16}/></button></header>
   <div className="modal-body">{children}</div>
   {footer&&<footer className="modal-footer">{footer}</footer>}
  </section>
 </div>;
}

export function Field({label,hint,children,inline}:{label:React.ReactNode,hint?:React.ReactNode,children:React.ReactNode,inline?:boolean}){
 return <label className={cx('field',inline&&'field-inline')}><span className="field-label">{label}</span>{children}{hint&&<small className="field-hint">{hint}</small>}</label>;
}

export function ErrorNote({children}:{children?:React.ReactNode}){return children?<div role="alert" className="note note-bad">{children}</div>:null;}

export function Segmented<T extends string>({value,options,onChange,size}:{value:T,options:{value:T,label:React.ReactNode,title?:string}[],onChange:(v:T)=>void,size?:'sm'}){
 return <div className={cx('segmented',size==='sm'&&'segmented-sm')} role="radiogroup">{options.map(o=><button type="button" role="radio" aria-checked={o.value===value} key={o.value} title={o.title} className={o.value===value?'on':''} onClick={()=>onChange(o.value)}>{o.label}</button>)}</div>;
}

export function Switch({checked,onChange,label,disabled}:{checked:boolean,onChange:(v:boolean)=>void,label?:string,disabled?:boolean}){
 return <button type="button" role="switch" aria-checked={checked} aria-label={label} disabled={disabled} className={cx('switch',checked&&'on')} onClick={()=>onChange(!checked)}><i/></button>;
}

export function Tabs({value,tabs,onChange}:{value:string,tabs:{id:string,label:React.ReactNode,count?:number}[],onChange:(id:string)=>void}){
 return <nav className="tabs">{tabs.map(t=><button type="button" key={t.id} className={value===t.id?'on':''} onClick={()=>onChange(t.id)}>{t.label}{t.count!==undefined&&t.count>0&&<span className="count">{t.count}</span>}</button>)}</nav>;
}

export function Kbd({children}:{children:React.ReactNode}){return <kbd>{children}</kbd>;}

/** Click-to-open popover anchored to its trigger. Closes on outside click or Escape. */
export function Popover({trigger,children,align='start',placement='bottom',className,open:controlled,onOpenChange}:{trigger:(open:boolean,toggle:()=>void)=>React.ReactNode,children:React.ReactNode|((close:()=>void)=>React.ReactNode),align?:'start'|'end',placement?:'bottom'|'top',className?:string,open?:boolean,onOpenChange?:(o:boolean)=>void}){
 const [own,setOwn]=useState(false);const open=controlled??own;const set=(o:boolean)=>{setOwn(o);onOpenChange?.(o);};
 const ref=useRef<HTMLDivElement>(null);
 const [actualPlacement,setActualPlacement]=useState<'bottom'|'top'>(placement);
 const [actualAlign,setActualAlign]=useState<'start'|'end'>(align);

 useEffect(()=>{if(!open)return;const h=(e:MouseEvent)=>{if(ref.current&&!ref.current.contains(e.target as Node))set(false);};const k=(e:KeyboardEvent)=>{if(e.key==='Escape'){e.stopPropagation();set(false);}};document.addEventListener('mousedown',h);window.addEventListener('keydown',k,true);return()=>{document.removeEventListener('mousedown',h);window.removeEventListener('keydown',k,true);};},[open]);

 useEffect(()=>{
  if(!open||!ref.current||typeof window==='undefined')return;
  const rect=ref.current.getBoundingClientRect();
  const spaceBelow=window.innerHeight-rect.bottom;
  const spaceAbove=rect.top;
  if(placement==='bottom'&&spaceBelow<280&&spaceAbove>spaceBelow){
   setActualPlacement('top');
  }else if(placement==='top'&&spaceAbove<280&&spaceBelow>spaceAbove){
   setActualPlacement('bottom');
  }else{
   setActualPlacement(placement);
  }
  const spaceRight=window.innerWidth-rect.left;
  if(align==='start'&&spaceRight<280&&rect.right>280){
   setActualAlign('end');
  }else{
   setActualAlign(align);
  }
 },[open,placement,align]);

 const close=()=>set(false);
 return <div className="popover-anchor" ref={ref}>{trigger(open,()=>set(!open))}{open&&<div className={cx('popover',`popover-${actualPlacement}`,`popover-${actualAlign}`,className)}>{typeof children==='function'?(children as any)(close):children}</div>}</div>;
}

export function Menu({label,icon,children,align='end',buttonClass='icon-btn',title,placement}:{label?:React.ReactNode,icon?:React.ReactNode,children:(close:()=>void)=>React.ReactNode,align?:'start'|'end',buttonClass?:string,title?:string,placement?:'bottom'|'top'}){
 return <Popover align={align} placement={placement} className="menu" trigger={(open,toggle)=><button type="button" title={title} aria-label={title} aria-expanded={open} className={cx(buttonClass,open&&'active')} onClick={toggle}>{icon}{label}</button>}>{close=>children(close)}</Popover>;
}
export function MenuItem({icon:Icon,children,onClick,danger,disabled,hint,checked}:{icon?:any,children:React.ReactNode,onClick:()=>void,danger?:boolean,disabled?:boolean,hint?:React.ReactNode,checked?:boolean}){
 return <button type="button" className={cx('menu-item',danger&&'danger')} disabled={disabled} onClick={onClick}>{Icon?<Icon size={14}/>:checked!==undefined?<span className="menu-check">{checked&&<Check size={13}/>}</span>:null}<span className="menu-label">{children}</span>{hint&&<span className="menu-hint">{hint}</span>}</button>;
}
export function MenuSeparator(){return <div className="menu-sep"/>;}

/** Compact dropdown select rendered as a popover list. */
export function Picker({value,options,onChange,placeholder='Select',icon,disabled,placement,className,title}:{value:string,options:{value:string,label:React.ReactNode,hint?:React.ReactNode}[],onChange:(v:string)=>void,placeholder?:string,icon?:React.ReactNode,disabled?:boolean,placement?:'top'|'bottom',className?:string,title?:string}){
 const current=options.find(o=>o.value===value);
 return <Popover placement={placement} className="menu" trigger={(open,toggle)=><button type="button" title={title} disabled={disabled} className={cx('chip',open&&'active',className)} onClick={toggle}>{icon}<span className="chip-text">{current?.label||placeholder}</span><ChevronDown size={12} className="chip-caret"/></button>}>
  {close=><div className="menu-scroll">{options.map(o=><MenuItem key={o.value} checked={o.value===value} hint={o.hint} onClick={()=>{onChange(o.value);close();}}>{o.label}</MenuItem>)}</div>}
 </Popover>;
}

export function Confirm({title,body,action='Confirm',danger,onConfirm,onClose}:{title:string,body:React.ReactNode,action?:string,danger?:boolean,onConfirm:()=>Promise<any>,onClose:()=>void}){
 const [busy,setBusy]=useState(false),[err,setErr]=useState('');
 return <Modal title={title} size="sm" onClose={onClose} footer={<><button className="btn" onClick={onClose}>Cancel</button><button className={cx('btn',danger?'btn-danger':'btn-primary')} disabled={busy} onClick={async()=>{setBusy(true);setErr('');try{await onConfirm();onClose();}catch(e){setErr((e as Error).message);setBusy(false);}}}>{busy&&<Spinner/>}{action}</button></>}>
  <div className="muted">{body}</div><ErrorNote>{err}</ErrorNote>
 </Modal>;
}

export function CopyButton({text,label='Copy'}:{text:string,label?:string}){
 const [done,setDone]=useState(false);
 return <button type="button" className="btn btn-sm" onClick={async()=>{try{await navigator.clipboard.writeText(text);setDone(true);setTimeout(()=>setDone(false),1500);}catch{}}}>{done?'Copied':label}</button>;
}

/** Shared async submit helper for forms. */
export function useSubmit(){
 const [busy,setBusy]=useState(false),[error,setError]=useState('');
 const submit=async(fn:()=>Promise<any>)=>{setBusy(true);setError('');try{await fn();}catch(e){setError((e as Error).message);}finally{setBusy(false);}};
 return {busy,error,setError,submit};
}
