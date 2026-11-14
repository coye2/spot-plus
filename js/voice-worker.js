let model;
const samples = new Map();
const preview = "You're with Spot Plus. Let's find your next favorite.";
const phrases=[preview,"You're with Spot Plus. Let's get into it.","Got you. Let's switch the vibe.",'On to the next one.','Music paused.','Back to the music.','Saved to your Liked Songs.','Taking it back.','Shuffle on.','Shuffle off.'];
const MODEL = 'onnx-community/Kokoro-82M-v1.0-ONNX';
self.addEventListener('message', async ({data}) => {
  try {
    if (!model) {
      const { KokoroTTS } = await import('https://cdn.jsdelivr.net/npm/kokoro-js@1.2.1/dist/kokoro.web.js');
      model = await KokoroTTS.from_pretrained(MODEL, { dtype: 'q8', device: 'wasm', progress_callback: p => { if (p.status === 'progress') self.postMessage({type:'progress',progress:Math.round(p.progress || 0)}); } });
    }
    if (data.type === 'load') {
      // Compile the model and prepare a real voice sample before declaring it ready.
      const voice=['am_puck','af_heart','bm_george','af_nicole'].includes(data.voice)?data.voice:'am_puck';
      for(const text of phrases){
        const sample = await model.generate(text,{voice,speed:1.05});
        samples.set(voice+'|'+text,sample.toBlob());
      }
      self.postMessage({id:data.id}); return;
    }
    const cached=samples.get(data.voice+'|'+data.text);
    if(cached){self.postMessage({id:data.id,blob:cached});return;}
    const result = await model.generate(String(data.text).slice(0,280), { voice: ['am_puck','af_heart','bm_george','af_nicole'].includes(data.voice) ? data.voice : 'am_puck', speed:1.05 });
    self.postMessage({id:data.id,blob:result.toBlob()});
  } catch (error) { self.postMessage({id:data.id,error:error.message}); }
});
