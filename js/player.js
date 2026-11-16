// player.js — queue, playback, lock-screen controls and offline downloads.
import * as api from './api.js';
import * as store from './store.js';
import { NextAudioBuffer } from './audio-buffer.js';
import {audioHasHeadroom} from './playback-policy.js';

export const AUDIO_CACHE = 'spotplus-audio-v1';
let audio = new Audio();
audio.preload = 'auto';
export let el = audio;

const listeners = { state: new Set(), time: new Set(), error: new Set(), 'effects-skipped': new Set() };
export const on = (ev, fn) => listeners[ev].add(fn);
/** Every media element the player uses (current + preloaded next). */
export const mediaElements = () => [audio, nextBuffer.spare];
/* Effects hooks (set by fx.js): which elements are routed through effects, and whether effects are on. */
let effectsOn = () => false, isCaptured = () => false, prepareElement = async () => {}, corsKnown = () => undefined;
export function setEffectsHooks(hooks) { ({effectsOn, isCaptured, prepareElement, corsKnown} = {effectsOn, isCaptured, prepareElement, corsKnown, ...hooks}); }
// A plain element held in reserve (unlocked on the first tap, never routed through effects) for songs whose
// server doesn't allow effects. A routed element would play them silently.
let plainSpare = null;
/* Smart Radio + learning hooks (set by the app). */
let continueQueue = null, onSkip = () => {}, onFinish = () => {}, resumeAt = () => 0;
export function setQueueHooks(hooks) { ({continueQueue = continueQueue, onSkip = onSkip, onFinish = onFinish, resumeAt = resumeAt} = hooks); }
/* AutoMix: crossfade into the next song. Needs adjustable element volume (not on iPhone) and effects off. */
let mixSeconds = 0, mixing = false;
export const crossfadeSupported = (() => { try { const a = new Audio(); a.volume = 0.5; return a.volume === 0.5; } catch { return false; } })();
export function setAutoMix(seconds) { mixSeconds = crossfadeSupported ? Math.max(0, Math.min(12, Number(seconds) || 0)) : 0; }
const emit = (ev, d) => listeners[ev].forEach((fn) => { try { fn(d); } catch (e) { console.error(e); } });

export const state = { queue: [], index: -1, original: null, shuffle: false, repeat: 'off', loading: false, source: null, offline: false };
export const current = () => state.queue[state.index] || null;
export const isPlaying = () => !audio.paused && !!current() && isRealSrc();
export const duration = () => (isRealSrc() && isFinite(audio.duration) && audio.duration > 0 ? audio.duration : current()?.duration || 0);

let token = 0;
let errRetries = 0;
let failStreak = 0;
let skipList = [];
let objUrl = null;
let restorePos = 0;
let cancelLoad = null;
let pendingPlay = true;
const nextBuffer = new NextAudioBuffer();
let prefetchTimer = 0, warmGeneration = 0, startedAt = 0;
let volumeLevel = 1;
let stallTimer;
function clearStall(){clearTimeout(stallTimer);stallTimer=null;}
function watchStall(){clearStall();const generation=token;stallTimer=setTimeout(()=>{if(generation===token&&pendingPlay&&isRealSrc())recoverMedia();},state.source?.fast?3500:6000);stallTimer.unref?.();}
function recoverMedia(){
  clearStall();if(!isRealSrc()||!current())return;
  const alternatives=state.source?.alternatives||[];
  if(!state.offline&&alternatives.length){const [variant,...rest]=alternatives;load({keepSkip:true,startAt:audio.currentTime||0,sourceOverride:{...state.source,...variant,alternatives:rest}});return;}
  api.reportPlaybackSource(state.source,false);
  if(!state.offline&&state.source&&errRetries<2){errRetries++;skipList.push(state.source.instance);load({keepSkip:true,startAt:audio.currentTime||0});return;}
  state.loading=false;state.error=`Playback failed for “${current().title}”. Retry or choose another audio source in Settings.`;audio.pause();emit('error',state.error);emit('state');
}
function maybeMix() {
  if (!mixSeconds || mixing || effectsOn() || state.repeat === 'one' || audio.paused || !isFinite(audio.duration)) return;
  const left = audio.duration - audio.currentTime;
  if (left > mixSeconds || left < 1 || state.index >= state.queue.length - 1) return;
  const nextTrack = state.queue[state.index + 1];
  if (!nextBuffer.entry || nextBuffer.entry.key !== api.streamKey(nextTrack) || nextBuffer.entry.media.readyState < 3) return;
  mixing = true; onFinish(current()); state.index++; errRetries = 0;
  load({mixSeconds: Math.max(1, left)}).finally(() => { mixing = false; });
}
function fade(media, from, to, seconds) {
  return new Promise(resolve => {
    const start = performance.now(), ms = seconds * 1000;
    const step = () => { const k = Math.min(1, (performance.now() - start) / ms); media.volume = Math.max(0, Math.min(1, from + (to - from) * k)); if (k < 1) setTimeout(step, 50); else resolve(); };
    step();
  });
}
const ducks = new Set();
export function duck(reason, enabled) { if (enabled) ducks.add(reason); else ducks.delete(reason); audio.volume = volumeLevel * (ducks.size ? .18 : 1); }

/* ---------- iOS/Safari: unlock audio on the first tap ---------- */
function silentWav() {
  const n = 800, b = new ArrayBuffer(44 + n), v = new DataView(b);
  const w = (o, s) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  w(0, 'RIFF'); v.setUint32(4, 36 + n, true); w(8, 'WAVE'); w(12, 'fmt ');
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, 8000, true); v.setUint32(28, 8000, true); v.setUint16(32, 1, true); v.setUint16(34, 8, true);
  w(36, 'data'); v.setUint32(40, n, true);
  for (let i = 0; i < n; i++) v.setUint8(44 + i, 128);
  let s = ''; new Uint8Array(b).forEach((x) => (s += String.fromCharCode(x)));
  return 'data:audio/wav;base64,' + btoa(s);
}
const SILENT = silentWav();
export function unlockElement(element) {
  if(element.src)return;
  element.src=SILENT;
  element.play().then(()=>{if(element.src===SILENT)element.pause();}).catch(()=>{});
}
function unlock() {
  unlockElement(nextBuffer.spare);
  if (!plainSpare) { plainSpare = new Audio(); plainSpare.preload = 'auto'; bindAudio(plainSpare); unlockElement(plainSpare); }
  if (audio.src) return;
  audio.src = SILENT;
  audio.play().then(() => { if (audio.src === SILENT) audio.pause(); }).catch(() => {});
}
window.addEventListener('pointerdown', unlock, { once: true, capture: true });
const isRealSrc = () => audio.src && !audio.src.startsWith('data:');
/** Stop every Spot+ sound when the app is closed for good (iOS can keep a closed web app's audio alive). */
window.addEventListener('pagehide', (e) => { if (!e.persisted) { audio.pause(); nextBuffer.spare.pause(); } });

/* ---------- Loading a track ---------- */
async function load(opts = {}) {
  const t = current();
  if (!t) return;
  const my = ++token;
  if(!opts.keepSkip)state.playbackId=(state.playbackId||0)+1;
  clearStall();
  startedAt = performance.now();
  state.startupMs = null;
  cancelLoad?.abort();
  cancelLoad = new AbortController();
  const controller = cancelLoad;
  pendingPlay = opts.autoplay !== false;
  ++warmGeneration; clearTimeout(prefetchTimer);
  api.cancelPrewarm(t);
  const warmed = !opts.keepSkip && !effectsOn() && nextBuffer.take(api.streamKey(t));
  if (!(opts.mixSeconds && warmed)) audio.pause();
  if (warmed) {
    const previous = audio, target = volumeLevel * (ducks.size ? .18 : 1);
    audio = warmed.media; el = audio; bindAudio(audio);
    if (opts.mixSeconds) {
      // AutoMix: the old song fades out while the new one fades in; a fresh spare preloads the song after.
      audio.volume = 0; fade(audio, 0, target, opts.mixSeconds);
      fade(previous, previous.volume, 0, opts.mixSeconds).then(() => { previous.pause(); previous.removeAttribute('src'); previous.load(); });
      const spare = new Audio(); spare.preload = 'none'; bindAudio(spare); nextBuffer.spare = spare;
    } else {
      audio.volume = target;
      nextBuffer.recycle(previous);
    }
  } else {
    nextBuffer.clear(); audio.removeAttribute('src'); audio.load();
  }
  state.error = null;
  if (opts.startAt == null) { const resume = resumeAt(t); if (resume) opts = {...opts, startAt: resume}; }
  restorePos = opts.startAt || 0;
  if (!opts.keepSkip) skipList = [];
  state.loading = true; state.source = null; state.offline = false;
  emit('state');
  emit('time');
  updateSession(t);
  try {
    let src;
    const blob = !warmed && ((t.local || store.getDownloads().some(d => d.id === t.id)) ? await offlineBlob(t.id) : null);
    if (my !== token) return;
    if (warmed) {
      if (objUrl) { URL.revokeObjectURL(objUrl); objUrl = null; }
      state.source = warmed.source; src = warmed.source.url;
    } else if (blob) {
      if (objUrl) URL.revokeObjectURL(objUrl);
      objUrl = URL.createObjectURL(blob);
      src = objUrl;
      state.offline = true;
    } else {
      if (objUrl) { URL.revokeObjectURL(objUrl); objUrl = null; }
      const r = opts.sourceOverride || await api.resolve(t, { skip: skipList, signal:controller.signal, cors: effectsOn() });
      if (my !== token) return;
      state.source = r;
      src = r.url;
    }
    if (!warmed) {
      if (isCaptured(audio) && !(await prepareElement(audio, src))) {
        // This song's server doesn't allow effects: switch to the plain element so it still plays.
        if (my !== token) return;
        const plain = plainSpare || new Audio(); plainSpare = null;
        audio.removeAttribute('src'); audio.load();
        audio = plain; el = audio; bindAudio(audio); audio.preload = 'auto';
        audio.volume = volumeLevel * (ducks.size ? .18 : 1);
        emit('effects-skipped');
      } else if (!isCaptured(audio) && effectsOn()) await prepareElement(audio, src);
      // Effects off: if this server is already known to allow effects, get ready anyway so switching
      // them on later is seamless (no restart). Unknown or refusing servers play exactly as before.
      else if (!isCaptured(audio) && corsKnown(src) === true) audio.crossOrigin = 'anonymous';
      else if (!isCaptured(audio)) audio.removeAttribute('crossorigin');
      if (my !== token) return;
      audio.src = src;
    }
    audio.preload = 'auto';
    audio.addEventListener('loadedmetadata', () => { if(my!==token)return;if(opts.startAt)audio.currentTime=Math.min(opts.startAt,duration());restorePos=0; }, { once: true });
    emit('state');
    if (pendingPlay) {
      watchStall();
      await audio.play().catch((e) => { if(my!==token)return;if (e.name === 'NotAllowedError' || e.name === 'AbortError') { clearStall();state.loading = false; emit('state'); } else {recoverMedia();} });
    } else {
      state.loading = false; emit('state');
    }
    if(my!==token)return;
    failStreak = 0;
    store.addRecent(t);
    prefetch();
  } catch (e) {
    if (my !== token) return;
    state.loading = false;
    state.error = `Couldn’t play “${t.title}”. ${e.message}`;
    emit('state');
    emit('error', `Couldn't play “${t.title}”: ${e.message}`);
    failStreak++;
  }
  save();
}

function prefetch() {
  const generation = ++warmGeneration;
  clearTimeout(prefetchTimer);
  const next = state.queue[state.index + 1] || (state.repeat === 'all' ? state.queue[0] : null);
  if (store.getSettings().preloadNext === false || navigator.connection?.saveData || /2g/.test(navigator.connection?.effectiveType || '') || !next || next.local || !isPlaying() || state.loading) { nextBuffer.clear(); return; }
  prefetchTimer = setTimeout(async () => {
    try {
      if (generation !== warmGeneration || !isPlaying() || state.loading) return;
      if (!audioHasHeadroom(audio,12)) { prefetch(); return; }
      const source = await (api.prewarm(next) || api.resolve(next));
      if (generation !== warmGeneration || !isPlaying() || state.loading || !audioHasHeadroom(audio,8)) return;
      if (!effectsOn()) nextBuffer.warm(api.streamKey(next), source);
    } catch { /* Foreground playback retains its own retry path. */ }
  }, 250);
  prefetchTimer.unref?.();
}

/* ---------- Audio element events ---------- */
let lastSave = 0, lastPos = 0;
const boundAudio = new WeakSet();
function bindAudio(media) {
if (boundAudio.has(media)) return;
boundAudio.add(media);
const listen = (event,fn) => media.addEventListener(event,() => { if (media === audio) fn(); });
// Only the current track may make sound: a spare/preloaded element that starts on its own is stopped at once.
media.addEventListener('play',() => { if (media !== audio && media.src && !media.src.startsWith('data:')) media.pause(); else if (media === audio) window.dispatchEvent?.(new Event('spotplus:music-play')); });
listen('playing', () => { clearStall();if (state.startupMs == null && startedAt && isRealSrc()) state.startupMs = Math.round(performance.now() - startedAt); state.loading = false; api.reportPlaybackSource(state.source); emit('state'); prefetch(); });
listen('play', () => { if ('mediaSession' in navigator) { navigator.mediaSession.playbackState = 'playing'; updateSession(current()); } emit('state'); });
listen('pause', () => { clearStall();if ('mediaSession' in navigator) navigator.mediaSession.playbackState = 'paused'; emit('state'); save(); ++warmGeneration; clearTimeout(prefetchTimer); if(nextBuffer.entry)nextBuffer.clear(); });
listen('waiting', () => { if (isRealSrc() && audio.currentTime > 1 && state.source?.fast) { api.reportChoppy(state.source); recoverMedia(); return; }
  if (isRealSrc()) { watchStall();state.loading = true; ++warmGeneration; clearTimeout(prefetchTimer); nextBuffer.clear(); api.cancelPrewarm(); emit('state'); } });
listen('canplay', () => { if (state.loading && !audio.paused) { state.loading = false; emit('state'); } });
listen('progress', () => emit('state'));
listen('timeupdate', () => {
  if(isRealSrc() && audio.currentTime>0)restorePos=0;
  emit('time');
  const now = Date.now();
  if (now - lastPos > 1000) { lastPos = now; positionState(); }
  if (now - lastSave > 10000) { lastSave = now; save(); }
  maybeMix();
});
listen('ended', () => {
  if (state.repeat === 'one') { state.playbackId=(state.playbackId||0)+1;audio.currentTime = 0;emit('state');audio.play().catch(() => {}); }
  else { onFinish(current()); if (!mixing) next(false); }
});
listen('error',recoverMedia);
}
bindAudio(audio);
bindAudio(nextBuffer.spare);

/* ---------- Controls ---------- */
function shuffled(a) {
  const r = a.slice();
  for (let i = r.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [r[i], r[j]] = [r[j], r[i]]; }
  return r;
}
export function playList(tracks, i = 0, { shuffle = null } = {}) {
  if (!tracks || !tracks.length) return;
  if (shuffle !== null) state.shuffle = shuffle;
  const list = tracks.map(store.slim);
  i = Math.max(0, Math.min(i, list.length - 1));
  if (state.shuffle) {
    state.original = list;
    const first = shuffle && i === 0 ? list[Math.floor(Math.random() * list.length)] : list[i];
    state.queue = [first, ...shuffled(list.filter((x) => x !== first))];
    state.index = 0;
  } else {
    state.original = null;
    state.queue = list;
    state.index = i;
  }
  errRetries = 0; failStreak = 0; restorePos = 0;
  load();
}
export function playIndex(i) { if (i >= 0 && i < state.queue.length) { state.index = i; errRetries = 0; load(); } }
// Audio links from YouTube servers expire after a few hours; a paused song may need a fresh one.
const linkExpired = () => { const exp = Number(String(state.source?.url || '').match(/[?&]expire=(\d{9,11})/)?.[1] || 0) * 1000; return !!exp && exp - 60e3 < Date.now(); };
export function toggle() {
  if (!current()) return;
  if (state.loading) { cancelLoad?.abort(); ++token; state.loading = false; pendingPlay = false; audio.pause(); audio.removeAttribute('src'); audio.load(); emit('state'); return; }
  if(!isRealSrc()){const at=restorePos;restorePos=0;load({startAt:at});return;}
  if (audio.paused) {
    if (!isRealSrc()) { const at = restorePos; restorePos = 0; load({ startAt: at }); }
    else if (linkExpired()) load({ startAt: audio.currentTime || 0 });
    else audio.play().catch(() => {});
  } else audio.pause();
}
export function next(fromUser = true) {
  if (fromUser && current() && isRealSrc()) onSkip(current(), audio.currentTime || 0);
  if (state.index < state.queue.length - 1) state.index++;
  else if (state.repeat === 'all' && state.queue.length) state.index = 0;
  else if (continueQueue && !current()?.direct) { radioContinue(); return; }
  else { audio.pause(); emit('state'); return; }
  errRetries = 0;
  load();
}
let radioBusy = false;
async function radioContinue() {
  if (radioBusy) return; radioBusy = true; state.loading = true; emit('state');
  try {
    const more = await continueQueue(state.queue.slice());
    if (more?.length) { state.queue.push(...more); state.index++; state.radio = true; errRetries = 0; save(); load(); return; }
  } catch { /* fall through */ } finally { radioBusy = false; }
  state.loading = false; audio.pause(); emit('state');
}
export function prev() {
  if (audio.currentTime > 3 || state.index <= 0) { audio.currentTime = 0; return; }
  state.index--;
  errRetries = 0;
  load();
}
export function seek(sec) { if (isFinite(sec) && isRealSrc()) audio.currentTime = Math.max(0, Math.min(sec,duration())); }
export function setVolume(v) { volumeLevel = Math.max(0, Math.min(1, v)); audio.volume = volumeLevel * (ducks.size ? .18 : 1); save(); }
export function playNext(t) {
  if (!current()) return playList([t]);
  const track=store.slim(t);
  state.queue.splice(state.index + 1, 0, track);
  if (state.original) state.original.push(track);
  emit('state'); save(); prefetch();
}
export function addToQueue(tracks) {
  const arr = (Array.isArray(tracks) ? tracks : [tracks]).map(store.slim);
  if (!current()) return playList(arr);
  state.queue.push(...arr);
  if (state.original) state.original.push(...arr);
  emit('state'); save(); prefetch();
}
export function removeAt(i) {
  if (i === state.index || i < 0 || i >= state.queue.length) return;
  const [removed] = state.queue.splice(i, 1);
  if (state.original) { const originalIndex = state.original.indexOf(removed); if (originalIndex >= 0) state.original.splice(originalIndex,1); }
  if (i < state.index) state.index--;
  emit('state'); save(); prefetch();
}
export function clearUpNext() { state.queue = state.queue.slice(0, state.index + 1); if(state.original) state.original=state.queue.slice(); emit('state'); save(); prefetch(); }
export function moveQueue(from, to) {
  if (from <= state.index || to <= state.index || from >= state.queue.length || to >= state.queue.length) return;
  const [track] = state.queue.splice(from,1); state.queue.splice(to,0,track);
  if (state.original) state.original=state.queue.slice();
  emit('state'); save(); prefetch();
}
export function retry() { if(current()) load({startAt:audio.currentTime || restorePos}); }
export function toggleShuffle() {
  state.shuffle = !state.shuffle;
  const cur = current();
  if (state.shuffle) {
    state.original = state.queue.slice();
    const rest = state.queue.filter((_, j) => j !== state.index);
    state.queue = cur ? [cur, ...shuffled(rest)] : shuffled(rest);
    state.index = cur ? 0 : -1;
  } else if (state.original) {
    const idx = state.original.findIndex((x) => x.id === cur?.id);
    state.queue = state.original;
    state.index = idx >= 0 ? idx : 0;
    state.original = null;
  }
  emit('state'); save(); prefetch();
}
export function cycleRepeat() {
  state.repeat = state.repeat === 'off' ? 'all' : state.repeat === 'all' ? 'one' : 'off';
  emit('state'); save(); prefetch();
}
/** Use a different YouTube video for the current track (when the auto-match is wrong). */
export function useMatch(videoId) {
  const t = current();
  if (!t) return;
  store.setVideoCache(t.id, { id: videoId, manual: true });
  api.clearStreamCache();
  load();
}

/* ---------- Persist queue between visits ---------- */
function save() {
  store.savePlayer({
    queue: state.queue.slice(Math.max(0, state.index - 50), state.index + 250),
    index: Math.min(state.index, 50),
    shuffle: state.shuffle, repeat: state.repeat, original:state.original, pos: audio.currentTime || restorePos || 0, vol: volumeLevel,
  });
}
export function restore() {
  const s = store.loadPlayer();
  if (!s) return;
  if (typeof s.vol === 'number') { volumeLevel = Math.max(0,Math.min(1,s.vol)); audio.volume = volumeLevel; }
  state.shuffle = !!s.shuffle;
  state.repeat = ['off','all','one'].includes(s.repeat) ? s.repeat : 'off';
  state.original = null;
  if (Array.isArray(s.queue) && s.queue.length) {
    state.queue = s.queue;
    if(state.shuffle && Array.isArray(s.original)) {const byId=new Map(state.queue.map(t=>[String(t.id),t]));state.original=s.original.map(t=>byId.get(String(t.id))).filter(Boolean);}
    state.index = Math.max(0, Math.min(s.index || 0, s.queue.length - 1));
    restorePos = s.pos || 0;
    updateSession(current());
    setTimeout(() => { if (current() && !isRealSrc()) api.prewarm(current()); }, 1500);
  }
  emit('state');
}
export const restoredPosition = () => restorePos;

/* ---------- Lock screen / media keys ---------- */
function updateSession(t) {
  if (!('mediaSession' in navigator) || !t) return;
  try {
    navigator.mediaSession.metadata = new MediaMetadata({
      title: t.title, artist: t.artist, album: t.album,
      artwork: [t.cover && { src: t.cover, sizes: '250x250', type: 'image/jpeg' }, t.coverXl && { src: t.coverXl, sizes: '1000x1000', type: 'image/jpeg' }].filter(Boolean),
    });
  } catch {}
}
function positionState() {
  if (!('mediaSession' in navigator) || !navigator.mediaSession.setPositionState) return;
  const d = duration();
  if (!d) return;
  try { navigator.mediaSession.setPositionState({ duration: d, playbackRate: audio.playbackRate || 1, position: Math.min(audio.currentTime, d) }); } catch {}
}
if ('mediaSession' in navigator) {
  const h = (a, fn) => { try { navigator.mediaSession.setActionHandler(a, fn); } catch {} };
  h('play', () => { updateSession(current()); if(audio.paused) toggle(); });
  h('pause', () => { audio.pause(); updateSession(current()); });
  h('previoustrack', prev);
  h('nexttrack', () => next(true));
  h('seekto', (d) => seek(d.seekTime));
  h('seekbackward', (d) => seek(audio.currentTime - (d.seekOffset || 10)));
  h('seekforward', (d) => seek(audio.currentTime + (d.seekOffset || 10)));
}

/* ---------- Offline downloads ---------- */
const offKey = (id) => new URL(`./__offline/${encodeURIComponent(id)}`, location.href).href;
export async function offlineBlob(id) {
  if (!('caches' in window)) return null;
  try {
    const c = await caches.open(AUDIO_CACHE);
    const r = await c.match(offKey(id));
    return r ? await r.blob() : null;
  } catch { return null; }
}
export async function download(t, onProgress = () => {}, signal) {
  if (!('caches' in window)) throw new Error('This browser can’t store offline audio');
  navigator.storage?.persist?.().catch(() => {});
  // Downloads read the audio directly, which needs a server that allows it: prefer those.
  const r = await api.resolve(t, {cors: true, signal});
  if (r.preview) throw new Error('Preview mode provides short samples, not full-song downloads. Choose a full audio source in Settings.');
  const res = await fetch(r.url, {signal});
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const total = Number(res.headers.get('content-length')) || 0;
  const chunks = [];
  let got = 0;
  if (res.body && res.body.getReader) {
    const reader = res.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value); got += value.length;
      if (total) onProgress(got / total);
    }
  } else chunks.push(new Uint8Array(await res.arrayBuffer()));
  const type = (r.mime || 'audio/mp4').split(';')[0];
  const blob = new Blob(chunks, { type });
  if (blob.size < 50000) throw new Error('download came back incomplete');
  const c = await caches.open(AUDIO_CACHE);
  await c.put(offKey(t.id), new Response(blob, { headers: { 'Content-Type': type } }));
  store.addDownload(t);
}
export async function removeDownload(id) {
  try { const c = await caches.open(AUDIO_CACHE); await c.delete(offKey(id)); } catch {}
  store.removeDownloadMeta(id);
}
export async function clearDownloads() {
  for (const t of store.getDownloads()) await removeDownload(t.id);
}

export async function removeLocalFile(id) {
  const c=await caches.open(AUDIO_CACHE);await c.delete(offKey(id));store.removeLocalFile(id);
}

export async function importLocalFile(file) {
  if (!('caches' in window)) throw new Error('Local files need a secure browser with offline storage.');
  if (!/^audio\//.test(file.type) && !/\.(mp3|m4a|flac|wav|ogg|opus|aac)$/i.test(file.name)) throw new Error('Choose an audio file.');
  if (file.size > 250 * 1024 * 1024) throw new Error('Choose a file smaller than 250 MB.');
  const hash = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
  const id = 'local-' + Array.from(new Uint8Array(hash),b=>b.toString(16).padStart(2,'0')).join('');
  const track = {id, title:file.name.replace(/\.[^.]+$/,''), artist:'Local file', album:'On this device', local:true, duration:0};
  const c = await caches.open(AUDIO_CACHE);
  await c.put(offKey(id),new Response(file,{headers:{'Content-Type':file.type || 'audio/mpeg'}}));
  store.addLocalFile(track);
  return track;
}
