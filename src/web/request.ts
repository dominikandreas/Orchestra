export function requestOptions(method:string,token:string|undefined,data?:unknown):RequestInit {
 return {method,headers:{...(data===undefined?{}:{'Content-Type':'application/json'}),...(token?{Authorization:`Bearer ${token}`}:{})},body:data===undefined?undefined:JSON.stringify(data)};
}
