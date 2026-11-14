import * as store from './store.js';
import * as player from './player.js';

export const state = { phase: 'idle', caption: 'Your next favorite is a request away.', transcript: '', conversation: false, error: '', neural: 'idle', progress: 0 };
const listeners = new Set();
export const onChange = fn => listeners.add(fn);
const emit = () => listeners.forEach(fn => fn(state));
const Recognition = globalThis.SpeechRecognition || globalThis.webkitSpeechRecognition;
export const canListen = () => !!Recognition && globalThis.isSecureContext;
export const voices = () => globalThis.speechSynthesis?.getVoices().filter(v => /^en([-_]|$)/i.test(v.lang)) || [];
let recognition, requestHandler, sequence = 0, restartTimer, timeout, resumeListening = false;
let worker, neuralSequence = 0, speechAudio, speechUrl, finishSpeech;
const neuralJobs = new Map();
export function bindRequest(fn) { requestHandler = fn; }
function setPhase(phase, caption) { state.phase = phase; if (caption) state.caption = caption; emit(); }
function restoreMusic() { if (resumeListening) { resumeListening = false; if (!player.isPlaying() && !player.state.loading) player.toggle(); } }
function scheduleListen() {
  clearTimeout(restartTimer);
  if (state.conversation && !document.hidden) restartTimer = setTimeout(() => listen(), 500);
}
export function cancelSpeech() {
  ++sequence;
  globalThis.speechSynthesis?.cancel();
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
function bestVoice() {
  const available = voices(), selected = store.getSettings().djVoiceURI;
  return available.find(v => v.voiceURI === selected) || available.sort((a,b) => rank(b) - rank(a))[0];
}
const rank = v => (/natural|neural|enhanced|premium|siri/i.test(v.name) ? 100 : 0) + (/samantha|ava|daniel|jenny|guy|aria/i.test(v.name) ? 30 : 0) + (v.localService ? 10 : 0);
export async function speak(text, { force = false } = {}) {
  if (!force && !store.getSettings().djVoice) return;
  stopListening(); cancelSpeech();
  const mine = sequence;
  const speechStart = performance.now();
  state.caption = String(text).slice(0,280); state.error = '';
  emit();
  // Natural speech is optional. Slow synthesis must never delay the music.
  if (state.neural === 'ready' && store.getSettings().djVoiceEngine === 'neural' && neuralJobs.size === 0) {
    speechAudio ||= new Audio(); player.unlockElement(speechAudio);
    try {
      const blob = await neuralRequest('speak', { text: state.caption, voice: store.getSettings().djNeuralVoice || 'am_puck' }, force ? 30000 : 1800);
      if (mine !== sequence) return;
      speechAudio ||= new Audio();
      speechUrl = URL.createObjectURL(blob); speechAudio.src = speechUrl;
      await new Promise((resolve,reject) => {
        finishSpeech = resolve;
        speechAudio.onended = resolve; speechAudio.onerror = reject;
        speechAudio.play().then(() => { state.lastVoice='Natural';state.responseMs=Math.round(performance.now()-speechStart);player.duck('dj',true); setPhase('speaking'); }).catch(reject);
      });
      if (mine === sequence) { cancelSpeech(); setPhase('idle'); scheduleListen(); }
      return;
    } catch { if (mine !== sequence) return; state.error = 'Using your device voice for a quicker response.'; }
  }
  if (!globalThis.speechSynthesis || !globalThis.SpeechSynthesisUtterance) { setPhase('idle'); return; }
  await new Promise(resolve => {
    const utterance = new SpeechSynthesisUtterance(state.caption), voice = bestVoice();
    if (voice) utterance.voice = voice;
    utterance.lang = 'en-US'; utterance.rate = 1.03; utterance.pitch = .96;
    let watchdog;
    const finish = () => { clearTimeout(watchdog); if (mine === sequence) { player.duck('dj',false); setPhase('idle'); } resolve(); };
    finishSpeech = finish;
    utterance.onstart = () => { if (mine === sequence) { state.lastVoice='Device';state.responseMs=Math.round(performance.now()-speechStart);player.duck('dj',true); setPhase('speaking'); } };
    utterance.onend = finish; utterance.onerror = finish;
    watchdog = setTimeout(finish, 16000);
    globalThis.speechSynthesis.speak(utterance);
  });
  if (mine === sequence) scheduleListen();
}
function neuralRequest(type, payload = {}, limit = 180000) {
  if (!worker) {
    worker = new Worker(new URL('./voice-worker.js', import.meta.url), { type: 'module' });
    worker.onmessage = ({data}) => {
      if (data.type === 'progress') { state.progress = data.progress; emit(); return; }
      const job = neuralJobs.get(data.id); if (!job) return;
      clearTimeout(job.timer); neuralJobs.delete(data.id);
      data.error ? job.reject(new Error(data.error)) : job.resolve(data.blob || true);
    };
    worker.onerror = () => releaseNeural();
  }
  return new Promise((resolve,reject) => {
    const id = ++neuralSequence;
    const timer = setTimeout(() => {
      reject(new Error('Voice took too long'));
      if(type==='speak'&&limit<30000){
        // Keep the prepared voice available while this late sentence finishes.
        // Further requests use the instant device voice until the worker is free.
        const job=neuralJobs.get(id);if(job)job.timer=setTimeout(()=>releaseNeural(),30000);
      }else{neuralJobs.delete(id);releaseNeural();}
    }, limit);
    neuralJobs.set(id, { resolve, reject, timer }); worker.postMessage({id, type, ...payload});
  });
}
export async function loadNeural() {
  if (state.neural === 'loading' || state.neural === 'ready') return;
  speechAudio ||= new Audio(); player.unlockElement(speechAudio);
  state.neural = 'loading'; state.progress = 0; state.error = ''; emit();
  try { await neuralRequest('load',{voice:store.getSettings().djNeuralVoice || 'am_puck'},600000); state.neural = 'ready'; store.setSettings({djVoiceEngine:'neural',djVoice:true}); }
  catch { state.neural = 'error'; state.error = 'Natural voice could not load. Your device voice is still available.'; }
  emit();
}
export function releaseNeural() {
  worker?.terminate(); worker = null;
  for (const job of neuralJobs.values()) { clearTimeout(job.timer); job.reject(new Error('Voice stopped')); }
  neuralJobs.clear(); state.neural = 'idle'; state.progress = 0; emit();
}
document.addEventListener?.('visibilitychange', () => { if (document.hidden) stop(); });
window.addEventListener('pagehide', stop);
