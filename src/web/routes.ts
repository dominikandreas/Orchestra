// Pure route helpers shared by the app shell and tests. No DOM access.
export type Route={page:string,id:string|null,project:string,query:Record<string,string>};
export const pages=['home','sessions','changes','automations','agents','deployments','repositories','settings','assistant'] as const;
const aliases:Record<string,string>={'':'home',overview:'home',work:'sessions',jobs:'sessions',previews:'deployments'};

export function parseRoute(pathname:string,search=''):Route{
 const clean=pathname.replace(/\/+$/,'')||'/';
 const params=new URLSearchParams(search);
 const project=params.get('project')||'all';
 const query:Record<string,string>={};
 params.forEach((v,k)=>{if(k!=='project')query[k]=v;});
 const [first='',second]=clean.replace(/^\//,'').split('/');
 const page=aliases[first]??first;
 if(!(pages as readonly string[]).includes(page))return {page:'home',id:null,project,query};
 const id=second&&['sessions','changes','assistant','settings','repositories'].includes(page)?decodeURIComponent(second):null;
 return {page,id,project,query};
}

export function buildUrl(page:string,id:string|null=null,project='all',query:Record<string,string>={}){
 let path=page==='home'?'/':`/${page}`;
 if(id)path+=`/${encodeURIComponent(id)}`;
 const params=new URLSearchParams();
 if(project&&project!=='all')params.set('project',project);
 for(const [k,v] of Object.entries(query))if(v)params.set(k,v);
 const q=params.toString();
 return q?`${path}?${q}`:path;
}
