/* Inference is isolated from playback and rendering. Models load only on request. */
export const MODEL = 'HuggingFaceTB/SmolLM2-360M-Instruct';
export const status = {phase:'idle',progress:0,message:'Local AI is off. The lighter DJ is ready.'};
let worker, sequence=0;
const pending=new Map(), listeners=new Set();
export const onChange = fn => listeners.add(fn);
function publish(patch) {Object.assign(status,patch);listeners.forEach(fn=>fn(status));}
function getWorker() {
  if (worker) return worker;
  worker=new Worker(new URL('./model-worker.js',import.meta.url),{type:'module'});
  worker.onmessage=({data})=>{
    if(data.type==='progress') {publish({phase:'loading',progress:data.progress||0,message:data.message});return;}
    const job=pending.get(data.id);if(!job)return;
    clearTimeout(job.timer);pending.delete(data.id);
    if(data.error) {publish({phase:'error',message:data.error});job.reject(new Error(data.error));}
    else {publish({phase:'ready',message:'Local AI is ready on this device.',progress:100});job.resolve(data.result);}
  };
  worker.onerror=()=>{release('Local AI could not run in this browser. The lighter DJ is still available.');};
  return worker;
}
function request(type,payload={},timeout=180000) {
  const activeWorker=getWorker();
  return new Promise((resolve,reject)=>{
    const id=++sequence;
    const timer=setTimeout(()=>release('Local AI took too long. Try the lighter DJ or load it on a faster connection.'),timeout);
    pending.set(id,{resolve,reject,timer});activeWorker.postMessage({id,type,...payload});
  });
}
export async function load() {if(status.phase==='ready')return;publish({phase:'loading',progress:0,message:'Downloading the model. Keep this page open…'});return request('load',{},600000);}
export async function interpret(prompt) {if(status.phase!=='ready')return null;publish({phase:'thinking',message:'Understanding your request on this device…'});return request('query',{prompt:prompt.slice(0,300)},30000);}
export function release(message='Local AI is off. The lighter DJ is ready.') {
  worker?.terminate();worker=null;
  for(const p of pending.values()){clearTimeout(p.timer);p.reject(new Error(message));}pending.clear();
  publish({phase:'idle',progress:0,message});
}
export async function removeModel() {
  release();
  if(!('caches' in globalThis)) return;
  const prefix=`https://huggingface.co/${MODEL}/`;
  for(const name of await caches.keys()) {
    if(!name.startsWith('transformers')) continue;
    const cache=await caches.open(name);
    for(const req of await cache.keys()) if(req.url.startsWith(prefix)) await cache.delete(req);
  }
  publish({message:'Downloaded DJ model removed from this browser.'});
}
