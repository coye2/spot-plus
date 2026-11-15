import * as store from './store.js';
import * as player from './player.js';
import {HOSTS,PHRASES,validHost,clipUrl} from './dj-hosts.js';
import * as liveVoice from './live-voice.js';
import {speechChunks} from './dj-dialogue.js';
import {transcriptParts} from './dj-recognition.js';
export {HOSTS};

export const state = { phase: 'idle', caption: 'Tap the mic and tell me what you want to hear.', transcript: '', conversation: false, error: '', lastVoice: '', responseMs: 0 };
const listeners = new Set();
export const onChange = fn => listeners.add(fn);
const emit = () => listeners.forEach(fn => fn(state));
const Recognition = globalThis.SpeechRecognition || globalThis.webkitSpeechRecognition;
export const canListen = () => !!Recognition && globalThis.isSecureContext;

let recognition, requestHandler, sequence = 0, restartTimer, timeout, finalTimer, resumeListening = false;
let speechAudio, speechUrl, finishSpeech, liveAbort, wakeReply, interruptHandler;
const clips=new Map();
export function bindRequest(fn) { requestHandler = fn; }
export function bindInterrupt(fn){interruptHandler=fn;}
function setPhase(phase, caption) { state.phase = phase; if (caption) state.caption = caption; emit(); }
function restoreMusic() { if (resumeListening) { resumeListening = false; if (!player.isPlaying() && !player.state.loading) player.toggle(); } }
function scheduleListen() {
  clearTimeout(restartTimer);
  if (state.conversation && !document.hidden) restartTimer = setTimeout(() => listen(), 500);
}
export function cancelSpeech() {
  ++sequence;
  liveAbort?.abort();liveAbort=null;wakeReply?.();wakeReply=null;
  speechAudio?.pause();
  if (speechUrl) { URL.revokeObjectURL(speechUrl); speechUrl = null; }
  finishSpeech?.(); finishSpeech = null;
  player.duck('dj', false);
  if (state.phase === 'speaking') setPhase('idle');
}
export function stopListening() {
  clearTimeout(restartTimer); clearTimeout(timeout);clearTimeout(finalTimer);
  const active = recognition; recognition = null;
  if (active) { active.onend = null; active.onresult = null; active.onerror = null; active.abort(); }
  restoreMusic();
  if (['listening','connecting'].includes(state.phase)) setPhase('idle', 'Microphone off.');
}
export function stop() { state.conversation = false; stopListening(); cancelSpeech(); setPhase('idle'); }
export function toggleConversation() { state.conversation = !state.conversation; if (state.conversation) listen(); else stopListening(); emit(); }
export function listen() {
  if (recognition) { stopListening(); return; }
  interruptHandler?.();cancelSpeech(); state.error = ''; state.transcript = '';
  if (!canListen()) { state.conversation = false; state.error = 'Voice input is unavailable here. Type a request, or use keyboard dictation.'; setPhase('idle', state.error); return; }
  const active = new Recognition(); recognition = active;
  active.lang = navigator.language?.startsWith('en')?navigator.language:'en-US'; active.continuous = true; active.interimResults = true;active.maxAlternatives=5;
  let submitted = false,finalText='',interimText='';const known=[player.current(),...store.getRecent(),...store.getLikes()].filter(Boolean).slice(0,100);
  const submit=()=>{
    if(recognition!==active||submitted||!finalText||interimText)return;
    submitted=true;const prompt=finalText;state.transcript=prompt;stopListening();setPhase('thinking','Got it.');
    Promise.resolve(requestHandler?.(prompt)).catch(error=>{state.error=error.message;emit();}).finally(()=>{if(state.phase==='thinking')setPhase('idle');scheduleListen();});
  };
  resumeListening=player.isPlaying();if(resumeListening)player.el.pause();setPhase('connecting','Opening your microphone…');
  active.onstart = () => {
    if (recognition !== active) return;
    setPhase('listening', 'I’m listening. What are you in the mood for?');
  };
  active.onresult = event => {
    if (recognition !== active) return;
    const parts=transcriptParts(event.results,known);finalText=parts.final;interimText=parts.interim;state.transcript=parts.text;emit();clearTimeout(finalTimer);
    // Wait through partial segments; a brief quiet gap submits the full request once.
    if(finalText&&!parts.interim)finalTimer=setTimeout(submit,550);
  };
  active.onerror = event => {
    if (recognition !== active) return;
    state.conversation = false;
    const messages = { 'not-allowed': 'Microphone access is off. Allow it in your browser, or type below.', 'audio-capture': 'No microphone is available. You can type your request.', network: 'Voice recognition could not connect. Type your request or try again.', 'no-speech': 'I didn’t catch that. Tap the mic and try again.' };
    state.error = messages[event.error] || 'Voice input stopped. Tap the mic to try again.';
    stopListening(); setPhase('idle', state.error);
  };
  active.onend = () => { if (recognition === active) {if(finalText&&!interimText&&!submitted){submit();return;}stopListening();if(!submitted){state.conversation=false;setPhase('idle','I didn’t catch a complete request. Tap the mic, or edit the words below.');}} };
  try { active.start(); timeout = setTimeout(() => { if (recognition === active) {if(finalText&&!interimText){submit();return;}state.conversation = false; stopListening();} },30000); }
  catch { state.conversation = false; stopListening(); setPhase('idle', 'The microphone couldn’t start. Try again, or type below.'); }
}
export function host(){return validHost(store.getSettings().djHost);}
async function prepare(cue,voice=host()){
 const url=clipUrl(voice,cue);if(!url)return null;
 if(!clips.has(url))clips.set(url,fetch(url).then(response=>{if(!response.ok)throw new Error('Voice unavailable');return response.blob();}).catch(error=>{clips.delete(url);throw error;}));
 return clips.get(url);
}
export function warmVoice(){prepare('preview').catch(()=>{});}
export async function preview(id=host()){
 store.setSettings({djHost:validHost(id),djVoice:true});warmVoice();
 return playPreview(PHRASES.preview,{cue:'preview',force:true});
}
async function playPreview(text,{force=false,cue=null,detail=''}={}){
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

// The only recorded audio is the host picker preview. All replies below are synthesized.
export function beginReply(){
 stopListening();cancelSpeech();const mine=sequence,controller=new AbortController();liveAbort=controller;
 const jobs=[];let closed=false,caption='',first=true;const started=performance.now();
 state.error='';state.caption='';setPhase('thinking');
 speechAudio ||= new Audio();player.unlockElement(speechAudio);
 const enabled=store.getSettings().djVoice;
 if(enabled&&liveVoice.state.phase!=='ready')state.error='Enable live DJ to hear newly generated replies.';
 const done=(async()=>{
  try{while(mine===sequence){
   if(!jobs.length){if(closed)break;await new Promise(resolve=>{wakeReply=resolve;});continue;}
   const result=await jobs.shift();if(mine!==sequence)break;if(result.error)throw result.error;
   speechUrl=URL.createObjectURL(result.blob);speechAudio.src=speechUrl;
   await new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>reject(new Error('Voice playback timed out.')),25000);
    const finish=()=>{clearTimeout(timer);resolve();};finishSpeech=finish;
    speechAudio.onended=finish;speechAudio.onerror=()=>{clearTimeout(timer);reject(new Error('Tap Talk to DJ again to allow audio.'));};
    speechAudio.play().then(()=>{if(mine!==sequence)return;state.lastVoice=HOSTS.find(h=>h.id===host()).name;if(first){state.responseMs=Math.round(performance.now()-started);first=false;}player.duck('dj',true);setPhase('speaking');}).catch(error=>{clearTimeout(timer);reject(error);});
   });
   if(speechUrl){URL.revokeObjectURL(speechUrl);speechUrl=null;}
  }}catch(error){if(mine===sequence&&error.name!=='AbortError'){state.error=error.message;emit();}}
  finally{if(mine===sequence){cancelSpeech();setPhase('idle');scheduleListen();}}
 })();
 return {
  push(text){if(closed||mine!==sequence)return;caption+=(caption?' ':'')+text;state.caption=caption.slice(0,600);emit();if(enabled&&liveVoice.state.phase==='ready')for(const chunk of speechChunks(text))jobs.push(liveVoice.generate(chunk,host(),controller.signal).catch(error=>({error})));wakeReply?.();wakeReply=null;},
  caption(text){if(mine===sequence){state.caption=String(text).slice(0,600);emit();}},
  end(){closed=true;wakeReply?.();wakeReply=null;},done,
 };
}
export async function speak(text){const reply=beginReply();reply.push(String(text));reply.end();await reply.done;}
document.addEventListener?.('visibilitychange', () => { if (document.hidden) stop(); });
window.addEventListener('pagehide', stop);
