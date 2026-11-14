export const state={phase:'idle',progress:0,message:'Enable live DJ to generate speech on this device.'};
const listeners=new Set(),pending=new Map();let worker,sequence=0,loadPromise,lifecycle=0;
export const onChange=fn=>listeners.add(fn);
function publish(patch){Object.assign(state,patch);listeners.forEach(fn=>fn(state));}
function getWorker(){
 if(worker)return worker;
 worker=new Worker(new URL('./live-voice-worker.js',import.meta.url),{type:'module'});
 worker.onmessage=({data})=>{
  if(data.type==='progress'){publish({phase:'loading',progress:data.progress,message:data.message});return;}
  const job=pending.get(data.id);if(!job)return;clearTimeout(job.timer);pending.delete(data.id);
  if(data.error){job.reject(new Error(data.error));}else job.resolve(data.result);
 };
 worker.onerror=()=>release('This browser could not start the live voice. Try Safari on iPhone or Chrome on Android.');return worker;
}
function request(type,payload={},timeout=45000,signal){
 if(signal?.aborted)return Promise.reject(new DOMException('Cancelled','AbortError'));
 const id=++sequence,active=getWorker();
 return new Promise((resolve,reject)=>{
  const cancel=()=>{active.postMessage({type:'cancel',id});const job=pending.get(id);if(job){clearTimeout(job.timer);pending.delete(id);job.reject(new DOMException('Cancelled','AbortError'));}};
  const timer=setTimeout(()=>{const job=pending.get(id);pending.delete(id);active.postMessage({type:'cancel',id});job?.reject(new Error('Your device is taking too long to generate speech. Try a shorter reply.'));},timeout);
  pending.set(id,{timer,resolve:value=>{signal?.removeEventListener('abort',cancel);resolve(value);},reject:error=>{signal?.removeEventListener('abort',cancel);reject(error);}});
  signal?.addEventListener('abort',cancel,{once:true});active.postMessage({id,type,...payload});
 });
}
export function load(){
 if(state.phase==='ready')return Promise.resolve();if(loadPromise)return loadPromise;
 const generation=lifecycle;
 publish({phase:'loading',progress:0,message:'Downloading your live voice. Keep Spot+ open…'});
 loadPromise=request('load',{},900000).then(()=>{if(generation===lifecycle)publish({phase:'ready',progress:100,message:'Live voice ready.'});}).catch(error=>{if(generation===lifecycle){worker?.terminate();worker=null;publish({phase:'error',message:error.message});}throw error;}).finally(()=>{if(generation===lifecycle)loadPromise=null;});return loadPromise;
}
export function generate(text,host,signal){if(state.phase!=='ready')return Promise.reject(new Error('Enable live DJ first.'));return request('speak',{text,host},60000,signal);}
export function release(message='Live voice is off. Downloads are saved for next time.'){
 lifecycle++;worker?.terminate();worker=null;for(const job of pending.values()){clearTimeout(job.timer);job.reject(new Error(message));}pending.clear();loadPromise=null;publish({phase:'idle',progress:0,message});
}
export async function removeDownloads(){release();if('caches' in globalThis)await caches.delete('spotplus-live-voice-v1');}
