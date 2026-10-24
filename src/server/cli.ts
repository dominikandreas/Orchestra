import { all,issueInvite,del } from './store.js';
const [action,arg]=process.argv.slice(2);const base=process.env.RELAY_BASE_URL||'http://localhost:4310';
if(action==='invite'){const u=arg?all('users').find(u=>u.id===arg||u.name===arg):undefined;if(arg&&!u)throw Error('User not found');const inv=issueInvite(u?.id,'viewer',[]);console.log(`${base}/onboarding#${inv.token}`);}
else if(action==='recover'){const u=all('users').find(u=>u.role==='owner'&&!u.disabled);const inv=issueInvite(u?.id,'owner',[]);console.log(`${base}/onboarding#${inv.token}`);}
else if(action==='users')console.table(all('users').map(({id,name,role})=>({id,name,role})));
else if(action==='revoke'&&arg){del('devices',arg);console.log('Device revoked');}
else console.log('orchestra cli: invite [user ID/name] | recover | users | revoke <device ID>');
