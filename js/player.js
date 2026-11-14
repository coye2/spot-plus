// player.js — queue, playback, lock-screen controls and offline downloads.
import * as api from './api.js';
import * as store from './store.js';
import { NextAudioBuffer } from './audio-buffer.js';

export const AUDIO_CACHE = 'spotplus-audio-v1';
const audio = new Audio();
audio.preload = 'auto';
export const el = audio;

const listeners = { state: new Set(), time: new Set(), error: new Set() };
export const on = (ev, fn) => listeners[ev].add(fn);
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
  if (audio.src) return;
  audio.src = SILENT;
  audio.play().then(() => { if (audio.src === SILENT) audio.pause(); }).catch(() => {});
}
window.addEventListener('pointerdown', unlock, { once: true, capture: true });
const isRealSrc = () => audio.src && !audio.src.startsWith('data:');

/* ---------- Loading a track ---------- */
async function load(opts = {}) {
  const t = current();
  if (!t) return;
  const my = ++token;
  startedAt = performance.now();
  state.startupMs = null;
  cancelLoad?.abort();
  cancelLoad = new AbortController();
  const controller = cancelLoad;
  pendingPlay = opts.autoplay !== false;
  audio.pause();
  audio.removeAttribute('src');
  audio.load();
  state.error = null;
  restorePos = opts.startAt || 0;
  if (!opts.keepSkip) skipList = [];
  state.loading = true; state.source = null; state.offline = false;
  emit('state');
  updateSession(t);
  try {
    let src;
    const warmed = !opts.keepSkip && nextBuffer.take(api.streamKey(t));
    const blob = warmed?.blob || ((t.local || store.getDownloads().some(d => d.id === t.id)) ? await offlineBlob(t.id) : null);
    if (my !== token) return;
    if (blob) {
      if (objUrl) URL.revokeObjectURL(objUrl);
      objUrl = URL.createObjectURL(blob);
      src = objUrl;
      state.offline = !warmed;
      state.source = warmed?.source || null;
    } else {
      if (objUrl) { URL.revokeObjectURL(objUrl); objUrl = null; }
      const r = await api.resolve(t, { skip: skipList, signal:controller.signal });
      if (my !== token) return;
      state.source = r;
      src = r.url;
    }
    audio.src = src;
    audio.addEventListener('loadedmetadata', () => { if(my!==token)return;if(opts.startAt)audio.currentTime=Math.min(opts.startAt,duration());restorePos=0; }, { once: true });
    emit('state');
    if (pendingPlay) {
      await audio.play().catch((e) => { if (e.name === 'NotAllowedError' || e.name === 'AbortError') { state.loading = false; emit('state'); } else throw e; });
    } else {
      state.loading = false; emit('state');
    }
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
  if (store.getSettings().preloadNext === false || navigator.connection?.saveData || /2g/.test(navigator.connection?.effectiveType || '') || !next || next.local) { nextBuffer.clear(); return; }
  api.prewarm(next);
  prefetchTimer = setTimeout(async () => {
    try {
      const source = await api.resolve(next);
      if (generation !== warmGeneration || !isPlaying()) return;
      await nextBuffer.warm(api.streamKey(next), source);
      if (generation === warmGeneration) api.prewarm(state.queue[state.index + 2]);
    } catch { /* Foreground playback retains its own retry path. */ }
  }, 900);
  prefetchTimer.unref?.();
}

/* ---------- Audio element events ---------- */
audio.addEventListener('playing', () => { if (state.startupMs == null && startedAt && isRealSrc()) state.startupMs = Math.round(performance.now() - startedAt); state.loading = false; errRetries = 0; emit('state'); });
audio.addEventListener('play', () => emit('state'));
audio.addEventListener('pause', () => { emit('state'); save(); prefetch(); });
audio.addEventListener('waiting', () => { if (isRealSrc()) { state.loading = true; emit('state'); } });
audio.addEventListener('canplay', () => { if (state.loading && !audio.paused) { state.loading = false; emit('state'); } });
let lastSave = 0, lastPos = 0;
audio.addEventListener('timeupdate', () => {
  if(isRealSrc() && audio.currentTime>0)restorePos=0;
  emit('time');
  const now = Date.now();
  if (now - lastPos > 1000) { lastPos = now; positionState(); }
  if (now - lastSave > 10000) { lastSave = now; save(); }
});
audio.addEventListener('ended', () => {
  if (state.repeat === 'one') { audio.currentTime = 0; audio.play().catch(() => {}); }
  else next();
});
audio.addEventListener('error', () => {
  if (!isRealSrc() || !current()) return;
  const t = current();
  if (!state.offline && state.source && errRetries < 2) {
    errRetries++;
    skipList.push(state.source.instance);
    load({ keepSkip: true, startAt: audio.currentTime || 0 });
    return;
  }
  errRetries = 0;
  state.loading = false;
  state.error = `Playback failed for “${t.title}”. Retry or choose another audio source in Settings.`;
  emit('error', state.error);
  emit('state');
});

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
export function toggle() {
  if (!current()) return;
  if (state.loading) { cancelLoad?.abort(); ++token; state.loading = false; pendingPlay = false; audio.pause(); audio.removeAttribute('src'); audio.load(); emit('state'); return; }
  if (audio.paused) {
    if (!isRealSrc()) { const at = restorePos; restorePos = 0; load({ startAt: at }); }
    else audio.play().catch(() => {});
  } else audio.pause();
}
export function next() {
  if (state.index < state.queue.length - 1) state.index++;
  else if (state.repeat === 'all' && state.queue.length) state.index = 0;
  else { audio.pause(); emit('state'); return; }
  errRetries = 0;
  load();
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
  h('play', () => { if(audio.paused) toggle(); });
  h('pause', () => audio.pause());
  h('previoustrack', prev);
  h('nexttrack', next);
  h('seekto', (d) => seek(d.seekTime));
  h('seekbackward', (d) => seek(audio.currentTime - (d.seekOffset || 10)));
  h('seekforward', (d) => seek(audio.currentTime + (d.seekOffset || 10)));
  audio.addEventListener('play', () => { navigator.mediaSession.playbackState = 'playing'; });
  audio.addEventListener('pause', () => { navigator.mediaSession.playbackState = 'paused'; });
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
export async function download(t, onProgress = () => {}) {
  if (!('caches' in window)) throw new Error('This browser can’t store offline audio');
  navigator.storage?.persist?.().catch(() => {});
  const r = await api.resolve(t);
  if (r.preview) throw new Error('Preview mode provides short samples, not full-song downloads. Choose a full audio source in Settings.');
  const res = await fetch(r.url);
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
