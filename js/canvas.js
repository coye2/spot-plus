// Background visuals only. Music playback is deliberately outside this module.
import {resolveVideoLoop} from './api.js';
import {musicVideoLoop,loopWindow} from './video-loops.js';
import {scheduler, PRIORITY} from './request-scheduler.js';
export const CANVAS_ENDPOINT = 'https://spot-plus-canvas.pwr97pnmkn.workers.dev/canvas';
const CACHE_KEY = 'spotplus.canvasCache.v1';
const PREFERENCE_KEY = 'spotplus.canvasEnabled';
export function canvasURL(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.hostname === 'canvaz.scdn.co' && !url.username && !url.password && !url.port && /^\/upload\/.+\.mp4$/.test(url.pathname) ? url.href : null;
  } catch { return null; }
}
export function canvasQuery(track) {
  const id = track?.spotifyId || String(track?.id || '').replace(/^spotify:/, '');
  if (/^[a-zA-Z0-9]{22}$/.test(id)) return new URLSearchParams({trackId:id});
  const song = String(track?.searchTitle || track?.title || '').trim().slice(0, 200);
  const artist = String(track?.artist || '').trim().slice(0, 160);
  if (!song || !artist || track?.local) return null;
  const query = new URLSearchParams({song, artist});
  if (track.album) query.set('album', String(track.album).slice(0, 200));
  if (Number.isFinite(track.duration) && track.duration > 0) query.set('durationMs', String(Math.round(track.duration * 1000)));
  return query;
}
export function canvasEnabled({reducedMotion = false, saveData = false} = {}) {
  try { const value = localStorage.getItem(PREFERENCE_KEY); if (value !== null) return value === 'true'; } catch {}
  return !reducedMotion && !saveData;
}
export function setCanvasEnabled(enabled) {
  try { localStorage.setItem(PREFERENCE_KEY, String(!!enabled)); } catch {}
}
function cacheEntries() {
  try { const items = JSON.parse(localStorage.getItem(CACHE_KEY) || '[]'); return Array.isArray(items) ? items.filter(x => x && x.expires > Date.now() && (x.url === null || canvasURL(x.url))) : []; } catch { return []; }
}
export async function findCanvas(track, signal, endpoint = CANVAS_ENDPOINT) {
  const query = canvasQuery(track);
  if (!query) return null;
  const key = query.toString(), cached = cacheEntries().find(x => x.key === key);
  if (cached) return cached.url;
  if (!endpoint) throw new Error('Canvas bridge is not configured');
  if (!scheduler.canRun(PRIORITY.DECORATIVE)) return null;
  const controller = new AbortController();
  const cancel = () => controller.abort();
  signal?.addEventListener('abort', cancel, {once:true});
  if (signal?.aborted) controller.abort();
  const timer = setTimeout(cancel, 3500);
  try {
    const response = await fetch(endpoint + '?' + key, {signal:controller.signal, credentials:'omit', referrerPolicy:'no-referrer'});
    scheduler.noteStatus(response.status);
    if (!response.ok && response.status !== 404) throw new Error('Canvas lookup unavailable');
    const data = response.status === 404 ? null : await response.json();
    const url = canvasURL(data?.canvasUrl || data?.url);
    if (response.ok && !url && data?.success !== false) throw new Error('Invalid Canvas response');
    try { localStorage.setItem(CACHE_KEY, JSON.stringify([{key, url, expires:Date.now() + (url ? 86400000 : 3600000)}, ...cacheEntries().filter(x => x.key !== key)].slice(0, 150))); } catch {}
    return url;
  } finally { clearTimeout(timer); signal?.removeEventListener('abort', cancel); }
}

export async function findVisualLoop(track, signal, {skipCanvas=false,skip=[],source,canvasLookup=findCanvas,videoLookup=resolveVideoLoop} = {}) {
  signal?.throwIfAborted();
  if (!skipCanvas) {
    try {
      const url = await canvasLookup(track,signal);
      signal?.throwIfAborted();
      if (canvasURL(url)) return {kind:'canvas',url};
    } catch (error) { if (signal?.aborted) throw error; }
  }
  signal?.throwIfAborted();
  const clip = await videoLookup(track,{signal,source,skip});
  signal?.throwIfAborted();
  return musicVideoLoop(clip);
}

// One video, one cancellable lookup. Hidden players never keep downloading loops.
export class CanvasPlayer {
  constructor(video, {lookup = findVisualLoop, onState = () => {}, media = url => Promise.resolve(url)} = {}) {
    this.video = video; this.lookup = lookup; this.onState = onState; this.media = media;
    this.generation = 0; this.key = ''; this.url = null; this.state = 'idle'; this.playing = false;
    video.muted = true; video.defaultMuted = true; video.loop = true; video.playsInline = true;
    video.addEventListener('error', () => { if (this.key && video.getAttribute('src')) this.recover(); });
    video.addEventListener('playing', () => { if (this.key) { clearTimeout(this.mediaTimer); this.mediaTimer = null; this.report('ready'); } });
    video.addEventListener('loadedmetadata', () => {
      if (this.clip?.kind !== 'music-video') return;
      this.clip = {...this.clip,...loopWindow(video.duration)};
      video.currentTime = this.clip.start;
    });
    video.addEventListener('timeupdate', () => {
      if (this.clip?.kind !== 'music-video' || video.seeking) return;
      if (video.currentTime >= this.clip.end || video.currentTime < this.clip.start-.5) video.currentTime = this.clip.start;
    });
    video.addEventListener('waiting', () => { if (this.playing && !this.mediaTimer) this.armMediaTimeout(); });
  }
  report(state) { this.state = state; this.onState(state,this.clip); }
  clear() {
    this.generation++; this.controller?.abort(); this.controller = null;
    clearTimeout(this.mediaTimer); this.mediaTimer = null;
    this.key = ''; this.url = null; this.clip = null; this.track = null; this.fallbacks = 0; this.failedProviders = []; this.playing = false; this.video.pause();
    if (this.video.getAttribute('src')) { this.video.removeAttribute('src'); this.video.load(); }
    this.report('idle');
  }
  fail(state) {
    clearTimeout(this.mediaTimer); this.mediaTimer = null;
    this.url = null; this.video.pause(); this.video.removeAttribute('src'); this.video.load(); this.report(state);
  }
  armMediaTimeout() {
    clearTimeout(this.mediaTimer);
    const generation = this.generation;
    this.mediaTimer = setTimeout(() => { if (generation === this.generation && this.playing) this.recover(); },12000);
  }
  recover() {
    const previous = this.clip;
    this.fail('error');
    if (!previous || this.fallbacks >= 2 || !this.track) return;
    this.fallbacks++; this.generation++; this.controller?.abort();
    if (previous.instance) this.failedProviders.push(previous.instance);
    this.report('fallback');
    this.load({skipCanvas:true,skip:[...this.failedProviders]});
  }
  resume() {
    if (!this.url || !this.playing || !this.video.paused) return;
    if (!this.video.getAttribute('src')) { this.video.src = this.url; this.video.load(); }
    this.armMediaTimeout();
    const generation = this.generation;
    this.video.muted = true;
    this.video.play().catch(error => {
      if (generation !== this.generation) return;
      clearTimeout(this.mediaTimer); this.mediaTimer = null;
      if (error.name === 'NotSupportedError') this.recover();
      else if (error.name !== 'AbortError') this.report('blocked');
    });
  }
  sync(track, {visible, enabled, playing, networkReady = true, retry = false}) {
    const key = canvasQuery(track)?.toString();
    if (!visible || !enabled || !key) { if (this.key) this.clear(); return; }
    if (!networkReady) {
      if (key !== this.key) { this.clear(); this.key=key; this.track=track; }
      this.playing=false;
      if (this.controller) { this.generation++; this.controller.abort(); this.controller=null; }
      this.video.pause(); clearTimeout(this.mediaTimer); this.mediaTimer=null;
      if (this.video.getAttribute('src')) { this.video.removeAttribute('src'); this.video.load(); }
      this.report('deferred'); return;
    }
    if (key === this.key && this.state === 'deferred') {
      this.playing=playing;
      if(this.url)this.resume();else {this.report('loading');this.load();}
      return;
    }
    if (key === this.key && retry && this.state === 'blocked') { this.playing = playing; this.resume(); return; }
    if (key === this.key && !retry) {
      this.playing = playing;
      if (!playing) { this.video.pause(); clearTimeout(this.mediaTimer); this.mediaTimer = null; }
      else if (this.state !== 'blocked') this.resume();
      return;
    }
    this.clear(); this.key = key; this.track = track; this.playing = playing;
    this.report('loading'); this.load();
  }
  load(options = {}) {
    const generation = this.generation, controller = new AbortController(); this.controller = controller;
    this.lookup(this.track, controller.signal,options).then(value => {
      if (generation !== this.generation) return;
      this.controller=null;
      const canvas = canvasURL(typeof value === 'string' ? value : value?.kind === 'canvas' ? value.url : null);
      this.clip = canvas ? {kind:'canvas',url:canvas} : musicVideoLoop(value);
      if (!this.clip) { this.report('missing'); return; }
      if (this.clip.kind !== 'canvas') {
        this.url = this.clip.url; this.video.removeAttribute('crossorigin');
        if (!this.playing) this.report('waiting');
        this.resume(); return;
      }
      // Canvas clips play from a local copy when we have one (instant start).
      return Promise.resolve(this.media(this.clip.url)).catch(() => this.clip.url).then(src => {
        if (generation !== this.generation) return;
        this.url = src;
        if (String(src).startsWith('blob:')) this.video.removeAttribute('crossorigin'); else this.video.crossOrigin = 'anonymous';
        if (!this.playing) this.report('waiting');
        // Reveal only after a real frame plays, so failures leave the cover intact.
        this.resume();
      });
    }).catch(() => { if (generation === this.generation) { this.controller=null; this.report('error'); } });
  }
}
