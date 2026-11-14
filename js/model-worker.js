import {conversationMessages,safeConversationSentence} from './dj-dialogue.js';
let generator,initializing,runtime,stopping,activeId,chain=Promise.resolve();const cancelled=new Set();
async function initialize(){
 if(generator)return generator;if(initializing)return initializing;
 initializing=(async()=>{
  runtime=await import('https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.1/dist/transformers.min.js');
  runtime.env.allowLocalModels=false;runtime.env.backends.onnx.wasm.numThreads=1;
  generator=await runtime.pipeline('text-generation','HuggingFaceTB/SmolLM2-135M-Instruct',{
   revision:'12fd25f77366fa6b3b4b768ec3050bf629380bac',dtype:'q4',device:'wasm',
   progress_callback:p=>{if(p.status==='progress')self.postMessage({type:'progress',progress:Math.round(p.progress||0),message:'Preparing conversation: '+Math.round(p.progress||0)+'%'});}
  });return generator;
 })().finally(()=>{initializing=null;});return initializing;
}
self.onmessage=({data})=>{
 if(data.type==='cancel'){cancelled.add(data.id);if(activeId===data.id)stopping?.interrupt();return;}
 chain=chain.catch(()=>{}).then(async()=>{try{
  const model=await initialize();if(cancelled.has(data.id))throw new Error('Cancelled');
  if(data.type==='load'){self.postMessage({id:data.id,result:true});return;}
  activeId=data.id;stopping=new runtime.InterruptableStoppingCriteria();
  let text='',buffer='',sentences=0;const spoken=[];const chat=data.type==='chat';
  const streamer=chat?new runtime.TextStreamer(model.tokenizer,{skip_prompt:true,skip_special_tokens:true,callback_function:piece=>{
   if(cancelled.has(data.id)||sentences>=2)return;text+=piece;buffer+=piece;
   const boundary=buffer.match(/^([\s\S]*?[.!?])(?:\s|$)/);
   if(boundary&&boundary[1].trim().length>15){const safe=safeConversationSentence(boundary[1],data.context);if(safe){spoken.push(safe);self.postMessage({id:data.id,type:'text',text:spoken.join(' ')});self.postMessage({id:data.id,type:'sentence',text:safe});}buffer=buffer.slice(boundary[0].length);if(++sentences>=2)stopping.interrupt();}
  }}):undefined;
  const messages=chat?conversationMessages(data.prompt,data.context,data.history):[{role:'system',content:'Convert the music request to a short music search phrase. Return only artist names, genres, or mood keywords, at most 6 words. Do not explain or invent songs.'},{role:'user',content:String(data.prompt||'').slice(0,300)}];
  const result=await model(messages,{max_new_tokens:chat?72:24,do_sample:false,repetition_penalty:1.12,return_full_text:false,streamer,stopping_criteria:stopping});
  if(cancelled.has(data.id))throw new Error('Cancelled');
  if(chat&&sentences<2&&buffer.trim()){const clean=safeConversationSentence(buffer.trim().replace(/[,;:]?\s+\S*$/,'').replace(/[.!?]*$/,'.'),data.context);if(clean.length>12){spoken.push(clean);self.postMessage({id:data.id,type:'text',text:spoken.join(' ')});self.postMessage({id:data.id,type:'sentence',text:clean});}}
  if(chat&&!spoken.length)throw new Error('I could not form a clear reply. Try a mood or a music request.');
  const generated=result[0]?.generated_text;const reply=typeof generated==='string'?generated:Array.isArray(generated)?generated.at(-1)?.content:'';
  self.postMessage({id:data.id,result:String(chat?spoken.join(' '):reply||text||'').trim().slice(0,chat?480:120)});
 }catch(error){self.postMessage({id:data.id,error:'Conversation unavailable: '+error.message});}finally{activeId=null;stopping=null;cancelled.delete(data.id);}});
};
