import {requestOptions} from './request';
export type Item=Record<string,any>;

export const token=()=>localStorage.getItem('relay.device');
export async function api(path:string,method='GET',data?:any){
 const r=await fetch('/api'+path,requestOptions(method,token()||undefined,data));
 const b=await r.json().catch(()=>({}));
 if(!r.ok)throw Error(b.error||`Request failed (${r.status})`);
 return b;
}

export function ago(s?:string|number){
 if(!s)return '';
 const m=Math.floor((Date.now()-new Date(s).getTime())/60000);
 if(m<1)return 'now';
 if(m<60)return `${m}m`;
 if(m<1440)return `${Math.floor(m/60)}h`;
 if(m<43200)return `${Math.floor(m/1440)}d`;
 return new Date(s).toLocaleDateString([],{month:'short',day:'numeric'});
}
export const label=(s?:string)=>s?s.replaceAll('_',' ').replace(/^\w/,x=>x.toUpperCase()):'';
export const cx=(...c:any[])=>c.filter(Boolean).join(' ');
export const short=(sha?:string)=>sha?sha.slice(0,7):'';

export const thinkingLevels=['off','minimal','low','medium','high','xhigh'] as const;
export const thinkingLabel:Record<string,string>={off:'Off',minimal:'Minimal',low:'Low',medium:'Medium',high:'High',xhigh:'Max'};

/** Autonomy levels, from most to least supervised. */
export const autonomyModes=[
 {value:'approve',label:'Ask first',description:'Waits for approval before editing files.'},
 {value:'prepare',label:'Prepare',description:'Edits, tests and opens a change request. You merge.'},
 {value:'auto',label:'Auto-merge',description:'Merges when required tests and reviews pass.'}
];
export const autonomyLabel=(v?:string)=>autonomyModes.find(m=>m.value===v)?.label||'Prepare';

export const jobKinds=[
 {value:'implement',label:'Implement'},
 {value:'review',label:'Review'},
 {value:'address',label:'Address feedback'},
 {value:'conflict',label:'Resolve conflicts'},
 {value:'test',label:'Run tests'},
 {value:'coverage',label:'Improve coverage'},
 {value:'improve',label:'Improve'},
 {value:'adapt',label:'Adapt agents'}
];
export const kindLabel=(v?:string)=>jobKinds.find(k=>k.value===v)?.label||label(v);

export const triggers=[
 {value:'change_created',label:'Change request opened'},
 {value:'change_updated',label:'Change request updated'},
 {value:'comment',label:'Comment added'},
 {value:'conflict',label:'Merge conflict detected'},
 {value:'test_failed',label:'Tests failed'},
 {value:'schedule',label:'Schedule'}
];
export const triggerLabel=(v?:string)=>triggers.find(t=>t.value===v)?.label||label(v);

/** Session status groups used for sorting and dot colours. */
export const activeStatuses=['running','queued'];
export const attentionStatuses=['awaiting_approval','blocked','failed','interrupted'];
export const statusLabel:Record<string,string>={running:'Running',queued:'Queued',completed:'Done',failed:'Failed',blocked:'Blocked',awaiting_approval:'Needs approval',interrupted:'Interrupted',cancelled:'Stopped',idle:'Idle',open:'Open',merged:'Merged',closed:'Closed',passed:'Passed',not_run:'Not run',starting:'Starting',stopped:'Stopped',ready:'Ready',importing:'Importing',error:'Error',connected:'Connected',disconnected:'Not connected',pending:'Pending',active:'Active',draft:'Draft',enabled:'Enabled',paused:'Paused'};
export const statusText=(s?:string)=>s?statusLabel[s]||label(s):'';
export function statusTone(s?:string){
 if(!s)return 'neutral';
 if(['running','queued','starting','pending','importing'].includes(s))return 'live';
 if(['completed','passed','merged','connected','active','enabled','ready'].includes(s))return 'ok';
 if(['failed','error','blocked'].includes(s))return 'bad';
 if(['awaiting_approval','interrupted','disconnected','draft'].includes(s))return 'warn';
 if(s==='open')return 'open';
 return 'neutral';
}

export function modelsFor(connection:Item|undefined,catalog:Item[]):Item[]{
 if(!connection)return [];
 return connection.models||catalog.find(p=>p.id===connection.provider)?.models||connection.config?.models||[];
}
export function modelName(id?:string,connection?:Item,catalog:Item[]=[]){
 if(!id)return '';
 return modelsFor(connection,catalog).find(m=>m.id===id)?.name||id;
}

export const imagePayload=(images:Item[])=>images.map(img=>({type:'image',data:img.data,mimeType:img.mimeType,name:img.name,url:img.url}));

export const lifetimeOptions = [
  { value: 30, label: '30 minutes idle (default)' },
  { value: 60, label: '1 hour idle' },
  { value: 360, label: '6 hours idle' },
  { value: 1440, label: '24 hours idle' },
  { value: 10080, label: '7 days idle' },
  { value: 0, label: '♾️ Infinite (never auto-stops)' },
];

export function formatLifetime(minutes?: number) {
  if (minutes === 0) return 'Infinite';
  if (!minutes || minutes === 30) return '30m idle';
  if (minutes < 60) return `${minutes}m idle`;
  if (minutes < 1440) return `${Math.round(minutes / 60)}h idle`;
  return `${Math.round(minutes / 1440)}d idle`;
}
