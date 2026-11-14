import * as store from './store.js';
import * as player from './player.js';
import {HOSTS,PHRASES,validHost,clipUrl} from './dj-hosts.js';
export {HOSTS};

export const state = { phase: 'idle', caption: 'Your next favorite is a request away.', transcript: '', conversation: false, error: '', lastVoice: '', responseMs: 0 };
const listeners = new Set();
export const onChange = fn => listeners.add(fn);
const emit = () => listeners.forEach(fn => fn(state));
const Recognition = globalThis.SpeechRecognition || globalThis.webkitSpeechRecognition;
export const canListen = () => !!Recognition && globalThis.isSecureContext;

let recognition, requestHandler, sequence = 0, restartTimer, timeout, resumeListening = false;
let speechAudio, speechUrl, finishSpeech;
const clips=new Map();
export function bindRequest(fn) { requestHandler = fn; }
function setPhase(phase, caption) { state.phase = phase; if (caption) state.caption = caption; emit(); }
function restoreMusic() { if (resumeListening) { resumeListening = false; if (!player.isPlaying() && !player.state.loading) player.toggle(); } }
function scheduleListen() {
  clearTimeout(restartTimer);
  if (state.conversation && !document.hidden) restartTimer = setTimeout(() => listen(), 500);
}
export function cancelSpeech() {
  ++sequence;
  speechAudio?.pause();
  if (speechUrl) { URL.revokeObjectURL(speechUrl); speechUrl = null; }
  finishSpeech?.(); finishSpeech = null;
  player.duck('dj', false);
  if (state.phase === 'speaking') setPhase('idle');
}
export function stopListening() {
  clearTimeout(restartTimer); clearTimeout(timeout);
  const active = recognition; recognition = null;
  if (active) { active.onend = null; active.onresult = null; active.onerror = null; active.abort(); }
  restoreMusic();
  if (state.phase === 'listening') setPhase('idle', 'Microphone off.');
}
export function stop() { state.conversation = false; stopListening(); cancelSpeech(); setPhase('idle'); }
export function toggleConversation() { state.conversation = !state.conversation; if (state.conversation) listen(); else stopListening(); emit(); }
export function listen() {
  if (recognition) { stopListening(); return; }
  cancelSpeech(); state.error = ''; state.transcript = '';
  if (!canListen()) { state.conversation = false; state.error = 'Voice input is unavailable here. Type a request, or use keyboard dictation.'; setPhase('idle', state.error); return; }
  const active = new Recognition(); recognition = active;
  active.lang = 'en-US'; active.continuous = false; active.interimResults = true;
  let submitted = false;
  active.onstart = () => {
    if (recognition !== active) return;
    resumeListening = player.isPlaying();
    if (resumeListening) player.el.pause();
    setPhase('listening', 'I’m listening. What are you in the mood for?');
  };
  active.onresult = event => {
    if (recognition !== active) return;
    let text = '', final = false;
    for (let i = 0; i < event.results.length; i++) { text += event.results[i][0].transcript; final ||= event.results[i].isFinal; }
    state.transcript = text.trim(); emit();
    if (final && state.transcript && !submitted) {
      submitted = true; const prompt = state.transcript;
      stopListening(); setPhase('thinking', 'Got it.');
      Promise.resolve(requestHandler?.(prompt)).catch(error => { state.error = error.message; }).finally(() => { if (state.phase === 'thinking') setPhase('idle'); scheduleListen(); });
    }
  };
  active.onerror = event => {
    if (recognition !== active) return;
    state.conversation = false;
    const messages = { 'not-allowed': 'Microphone access is off. Allow it in your browser, or type below.', 'audio-capture': 'No microphone is available. You can type your request.', network: 'Voice recognition could not connect. Type your request or try again.', 'no-speech': 'I didn’t catch that. Tap the mic and try again.' };
    state.error = messages[event.error] || 'Voice input stopped. Tap the mic to try again.';
    stopListening(); setPhase('idle', state.error);
  };
  active.onend = () => { if (recognition === active) { stopListening(); if (!submitted) { state.conversation = false; setPhase('idle', 'Tap the mic when you’re ready.'); } } };
  try { active.start(); timeout = setTimeout(() => { if (recognition === active) { state.conversation = false; stopListening(); } }, 20000); }
  catch { state.conversation = false; stopListening(); setPhase('idle', 'The microphone couldn’t start. Try again, or type below.'); }
}
export function host(){return validHost(store.getSettings().djHost);}
async function prepare(cue,voice=host()){
 const url=clipUrl(voice,cue);if(!url)return null;
 if(!clips.has(url))clips.set(url,fetch(url).then(response=>{if(!response.ok)throw new Error('Voice unavailable');return response.blob();}).catch(error=>{clips.delete(url);throw error;}));
 return clips.get(url);
}
export function warmVoice(){for(const cue of ['preview','start','request','next','pause','resume','like'])prepare(cue).catch(()=>{});}
export async function preview(id=host()){
 store.setSettings({djHost:validHost(id),djVoice:true});warmVoice();
 return speak(PHRASES.preview,{cue:'preview',force:true});
}
export async function speak(text,{force=false,cue=null,detail=''}={}){
 if(!force&&!store.getSettings().djVoice){state.caption=text;emit();return;}
 stopListening();cancelSpeech();const mine=sequence,started=performance.now();
 state.error='';state.caption=cue&&PHRASES[cue]?PHRASES[cue]+(detail?' '+detail:''):String(text).slice(0,280);emit();
 if(!cue||!PHRASES[cue]){setPhase('idle');return;}
 speechAudio ||= new Audio();player.unlockElement(speechAudio);
 try{
  const blob=await prepare(cue);if(mine!==sequence)return;
  speechUrl=URL.createObjectURL(blob);speechAudio.src=speechUrl;
  await new Promise((resolve,reject)=>{
   let timer;const finish=()=>{clearTimeout(timer);resolve();};finishSpeech=finish;
   speechAudio.onended=finish;speechAudio.onerror=()=>{clearTimeout(timer);reject(new Error('Voice playback unavailable'));};
   timer=setTimeout(finish,15000);
   speechAudio.play().then(()=>{if(mine!==sequence)return;state.lastVoice=HOSTS.find(h=>h.id===host()).name;state.responseMs=Math.round(performance.now()-started);player.duck('dj',true);setPhase('speaking');}).catch(error=>{clearTimeout(timer);reject(error);});
  });
 }catch{if(mine===sequence){state.error='Couldn’t play the voice. Your request still works.';emit();}}
 finally{if(mine===sequence){cancelSpeech();setPhase('idle');scheduleListen();}}
}
document.addEventListener?.('visibilitychange', () => { if (document.hidden) stop(); });
window.addEventListener('pagehide', stop);
