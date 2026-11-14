/* Inference is isolated from playback and rendering. Models load only on request. */
export const MODEL = 'HuggingFaceTB/SmolLM2-135M-Instruct';
export const status = {phase:'idle',progress:0,message:'Local AI is off. The lighter DJ is ready.'};
let worker, sequence=0,loadPromise;
const pending=new Map(), listeners=new Set();
export const onChange = fn => listeners.add(fn);
function publish(patch) {Object.assign(status,patch);listeners.forEach(fn=>fn(status));}
function getWorker() {
  if (worker) return worker;
  worker=new Worker(new URL('./model-worker.js',import.meta.url),{type:'module'});
  worker.onmessage=({data})=>{
    if(data.type==='progress') {publish({phase:'loading',progress:data.progress||0,message:data.message});return;}
    const job=pending.get(data.id);if(!job)return;
    if(data.type==='text'){job.onText?.(data.text);return;}
    if(data.type==='sentence'){job.onSentence?.(data.text);return;}
    clearTimeout(job.timer);pending.delete(data.id);
    if(data.error) {publish({phase:'error',message:data.error});job.reject(new Error(data.error));}
    else {publish({phase:'ready',message:'Local AI is ready on this device.',progress:100});job.resolve(data.result);}
  };
  worker.onerror=()=>{release('Local AI could not run in this browser. The lighter DJ is still available.');};
  return worker;
}
function request(type,payload={},timeout=180000,callbacks={}) {
  const activeWorker=getWorker();
  return new Promise((resolve,reject)=>{
    const id=++sequence;
    const timer=setTimeout(()=>release('Local AI took too long. Try the lighter DJ or load it on a faster connection.'),timeout);
    pending.set(id,{resolve,reject,timer,type,...callbacks});activeWorker.postMessage({id,type,...payload});
  });
}
export function load() {if(status.phase==='ready')return Promise.resolve();if(loadPromise)return loadPromise;publish({phase:'loading',progress:0,message:'Downloading the model. Keep this page open…'});loadPromise=request('load',{},600000).finally(()=>{loadPromise=null;});return loadPromise;}
export async function interpret(prompt) {if(status.phase!=='ready')return null;publish({phase:'thinking',message:'Understanding your request on this device…'});return request('query',{prompt:prompt.slice(0,300)},30000);}
export async function chat(prompt,context,history,callbacks){if(status.phase!=='ready')throw new Error('Enable live DJ to talk.');publish({phase:'thinking',message:'Thinking…'});return request('chat',{prompt,context,history},60000,callbacks);}
export function cancel(){for(const [id,job] of pending){if(job.type==='load')continue;worker?.postMessage({type:'cancel',id});clearTimeout(job.timer);job.reject(new DOMException('Cancelled','AbortError'));pending.delete(id);}if(status.phase==='thinking')publish({phase:'ready',message:'Ready to talk.'});}
export function release(message='Local AI is off. The lighter DJ is ready.') {
  worker?.terminate();worker=null;loadPromise=null;
  for(const p of pending.values()){clearTimeout(p.timer);p.reject(new Error(message));}pending.clear();
  publish({phase:'idle',progress:0,message});
}
export async function removeModel() {
  release();
  if(!('caches' in globalThis)) return;
  const prefixes=[MODEL,'HuggingFaceTB/SmolLM2-360M-Instruct','onnx-community/Kokoro-82M-v1.0-ONNX'].map(id=>`https://huggingface.co/${id}/`);
  for(const name of await caches.keys()) {
    if(!name.startsWith('transformers')) continue;
    const cache=await caches.open(name);
    for(const req of await cache.keys()) if(prefixes.some(prefix=>req.url.startsWith(prefix))) await cache.delete(req);
  }
  publish({message:'Downloaded DJ model removed from this browser.'});
}
