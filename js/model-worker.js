// Pinned official browser runtime, downloaded only after the user enables Local AI.
let generator;
async function initialize() {
  if(generator)return generator;
  const { pipeline, env }=await import('https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.1/dist/transformers.min.js');
  env.allowLocalModels=false;
  env.backends.onnx.wasm.numThreads=1;
  generator=await pipeline('text-generation','HuggingFaceTB/SmolLM2-360M-Instruct',{
    dtype:'q4',device:'wasm',
    progress_callback:p=>{if(p.status==='progress')self.postMessage({type:'progress',progress:Math.round(p.progress||0),message:`Downloading local AI: ${Math.round(p.progress||0)}%`});}
  });
  return generator;
}
self.onmessage=async({data})=>{
  try {
    const model=await initialize();
    if(data.type==='load'){self.postMessage({id:data.id,result:true});return;}
    const messages=[{role:'system',content:'Convert the music request to a short music search phrase. Return only artist names, genres, or mood keywords, at most 6 words. Do not explain or invent songs. Examples: music for studying -> chill instrumental; energetic workout -> workout rock; some Taylor Swift -> Taylor Swift.'},{role:'user',content:String(data.prompt||'').slice(0,300)}];
    const result=await model(messages,{max_new_tokens:24,do_sample:false,return_full_text:false});
    const generated=result[0]?.generated_text;
    const text=typeof generated==='string'?generated:Array.isArray(generated)?generated.at(-1)?.content:'';
    self.postMessage({id:data.id,result:String(text||'').trim().slice(0,120)});
  } catch(error) {self.postMessage({id:data.id,error:`Local AI is unavailable: ${error.message}. The lighter DJ can still play music.`});}
};
