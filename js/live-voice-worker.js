// Supertonic 3 inference stays in this worker. Model/code notices are in audio/dj/.
import {UnicodeProcessor} from './vendor/supertonic-text.js';
const BASE='https://huggingface.co/Supertone/supertonic-3/resolve/3cadd1ee6394adea1bd021217a0e650ede09a323/';
const CACHE='spotplus-live-voice-v1';
const cancelled=new Set();let ort,model,loading,chain=Promise.resolve();
async function resource(path){
 const url=BASE+path;let cache,response;
 try{cache=await caches.open(CACHE);response=await cache.match(url);}catch{/* Private browsing may disallow caching. */}
 if(!response){response=await fetch(url);if(!response.ok)throw new Error('Voice download failed. Check your connection and retry.');if(cache){try{await cache.put(url,response);response=await cache.match(url);}catch{response=await fetch(url);}}}
 if(!response?.ok)throw new Error('Voice download is unavailable.');return response;
}
async function initialize(){
 if(model)return model;if(loading)return loading;
 loading=(async()=>{
  ort=await import('https://cdn.jsdelivr.net/npm/onnxruntime-web@1.31.1/dist/ort.webgpu.min.mjs');
  ort.env.wasm.numThreads=1;ort.env.wasm.proxy=false;ort.env.wasm.wasmPaths='https://cdn.jsdelivr.net/npm/onnxruntime-web@1.31.1/dist/';
  const cfg=await (await resource('onnx/tts.json')).json(),processor=new UnicodeProcessor(await (await resource('onnx/unicode_indexer.json')).json());
  const sessions=[];const paths=['duration_predictor','text_encoder','vector_estimator','vocoder'];
  let gpu=false;try{gpu=!!(await navigator.gpu?.requestAdapter());}catch{/* CPU fallback. */}
  // WASM fallback works without WebGPU or cross-origin isolation on mobile Safari and Chrome.
  // Keep the four graphs in one worker and load sequentially to reduce peak memory.
  try{for(let i=0;i<paths.length;i++){
   self.postMessage({type:'progress',progress:Math.round(i/4*90),message:'Preparing your live voice ('+(i+1)+' of 4)…'});
   const bytes=await (await resource('onnx/'+paths[i]+'.onnx')).arrayBuffer();
   const options={graphOptimizationLevel:'all',enableCpuMemArena:false,enableMemPattern:false};
   try{sessions.push(await ort.InferenceSession.create(bytes,{...options,executionProviders:gpu?['webgpu','wasm']:['wasm']}));}
   catch(error){if(!gpu)throw error;gpu=false;sessions.push(await ort.InferenceSession.create(bytes,{...options,executionProviders:['wasm']}));}
  }}catch(error){for(const session of sessions)await session.release();throw error;}
  model={cfg,processor,sessions,styles:new Map(),sampleRate:cfg.ae.sample_rate};
  self.postMessage({type:'progress',progress:95,message:'Warming up your voice…'});
  await synthesize('Ready.','afterhours',null,2);
  return model;
 })().catch(error=>{model=null;throw error;}).finally(()=>{loading=null;});return loading;
}
async function styleFor(host){
 const key={afterhours:'M3',daylight:'F1',classic:'M1'}[host]||'M3';
 if(!model.styles.has(key)){
  const data=await (await resource('voice_styles/'+key+'.json')).json();
  model.styles.set(key,{ttl:new ort.Tensor('float32',Float32Array.from(data.style_ttl.data.flat(Infinity)),data.style_ttl.dims),dp:new ort.Tensor('float32',Float32Array.from(data.style_dp.data.flat(Infinity)),data.style_dp.dims)});
 }return model.styles.get(key);
}
function abort(id){if(cancelled.has(id))throw new Error('Cancelled');}
async function synthesize(text,host,id,steps=4){
 const {cfg,processor,sessions:[dp,encoder,vector,vocoder],sampleRate}=model;
 const style=await styleFor(host);abort(id);const owned=new Set();
 const own=t=>{owned.add(t);return t;};const tensor=(type,data,dims)=>own(new ort.Tensor(type,data,dims));
 const run=async(session,inputs)=>{abort(id);const output=await session.run(inputs);for(const t of Object.values(output))own(t);return output;};
 try{
  const {textIds,textMask}=processor.call([String(text).slice(0,180)],['en']);
  const ids=tensor('int64',BigInt64Array.from(textIds[0],BigInt),[1,textIds[0].length]);
  const mask=tensor('float32',Float32Array.from(textMask.flat(2)),[1,1,textIds[0].length]);
  const durationOutput=await run(dp,{text_ids:ids,style_dp:style.dp,text_mask:mask});
  const seconds=Math.min(16,Math.max(.1,Number(durationOutput.duration.data[0])/({afterhours:.98,daylight:1.03,classic:1}[host]||.98)));
  const embedding=await run(encoder,{text_ids:ids,style_ttl:style.ttl,text_mask:mask});
  const chunk=cfg.ae.base_chunk_size*cfg.ttl.chunk_compress_factor,length=Math.ceil(Math.floor(seconds*sampleRate)/chunk),channels=cfg.ttl.latent_dim*cfg.ttl.chunk_compress_factor;
  const noise=new Float32Array(length*channels);
  for(let i=0;i<noise.length;i+=2){const r=Math.sqrt(-2*Math.log(Math.max(Number.EPSILON,Math.random()))),angle=2*Math.PI*Math.random();noise[i]=r*Math.cos(angle);if(i+1<noise.length)noise[i+1]=r*Math.sin(angle);}
  let latent=tensor('float32',noise,[1,channels,length]);
  const latentMask=tensor('float32',new Float32Array(length).fill(1),[1,1,length]),total=tensor('float32',new Float32Array([steps]),[1]);
  for(let step=0;step<steps;step++){
   const current=tensor('float32',new Float32Array([step]),[1]);
   const output=await run(vector,{noisy_latent:latent,text_emb:embedding.text_emb,style_ttl:style.ttl,latent_mask:latentMask,text_mask:mask,current_step:current,total_step:total});
   owned.delete(latent);latent.dispose();owned.delete(current);current.dispose();latent=output.denoised_latent;
   // Let cancellation messages run between denoising steps.
   await new Promise(resolve=>setTimeout(resolve,0));abort(id);
  }
  const output=await run(vocoder,{latent});abort(id);
  return {samples:Float32Array.from(output.wav_tts.data.subarray(0,Math.floor(seconds*sampleRate))),sampleRate};
 }finally{for(const t of owned)t.dispose();}
}
function wavBlob(samples,rate){
 const buffer=new ArrayBuffer(44+samples.length*2),view=new DataView(buffer);const word=(offset,text)=>[...text].forEach((c,i)=>view.setUint8(offset+i,c.charCodeAt(0)));
 word(0,'RIFF');view.setUint32(4,36+samples.length*2,true);word(8,'WAVE');word(12,'fmt ');view.setUint32(16,16,true);view.setUint16(20,1,true);view.setUint16(22,1,true);view.setUint32(24,rate,true);view.setUint32(28,rate*2,true);view.setUint16(32,2,true);view.setUint16(34,16,true);word(36,'data');view.setUint32(40,samples.length*2,true);
 for(let i=0;i<samples.length;i++)view.setInt16(44+i*2,Math.round(Math.max(-1,Math.min(1,samples[i]))*32767),true);
 return new Blob([buffer],{type:'audio/wav'});
}
self.onmessage=({data})=>{
 if(data.type==='cancel'){cancelled.add(data.id);return;}
 chain=chain.catch(()=>{}).then(async()=>{try{
  const ready=await initialize();abort(data.id);
  if(data.type==='load'){self.postMessage({id:data.id,result:true});return;}
  const started=performance.now(),audio=await synthesize(data.text,data.host,data.id);
  self.postMessage({id:data.id,result:{blob:wavBlob(audio.samples,ready.sampleRate),generationMs:Math.round(performance.now()-started)}});
 }catch(error){self.postMessage({id:data.id,error:error.message});}finally{cancelled.delete(data.id);}});
};
