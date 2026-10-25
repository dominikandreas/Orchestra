// Deliberately no store import. Only the approved snapshot is loaded, in a separate host process.
import { pathToFileURL } from 'node:url';
import { assertCleanCheckout,updateCheckout } from './external-checkout.js';
// A server crash must not orphan a detached host mutation after its authorization monitor dies.
process.on('disconnect',()=>{try{process.kill(-process.pid,'SIGKILL')}catch{process.exit(1)}});
let text='';
for await(const chunk of process.stdin){text+=chunk;if(text.length>32768)throw Error('Input limit exceeded')}
const {input,checkoutPaths}=JSON.parse(text);
try {
 if(input.operation==='deploy')for(const path of checkoutPaths)await assertCleanCheckout(path);
 const adapter=await import(pathToFileURL(process.argv[2]).href);
 if(typeof adapter.default!=='function')throw Error('Connection must export a default function');
 const result=await adapter.default(Object.freeze(input),Object.freeze({updateCheckout:(path:string)=>{
  if(input.operation!=='deploy')throw Error('Checkout updates require deploy');
  return updateCheckout(path,checkoutPaths,input.repository.path,input.revision);
 }}));
 if(result!==undefined)console.log(JSON.stringify(result));
 process.exit(0);
}catch(e){console.error(String(e));process.exit(1)}
