// Public Canvas metadata only. Music playback is deliberately outside this module.
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
  const controller = new AbortController();
  const cancel = () => controller.abort();
  signal?.addEventListener('abort', cancel, {once:true});
  if (signal?.aborted) controller.abort();
  const timer = setTimeout(cancel, 10000);
  try {
    const response = await fetch(endpoint + '?' + key, {signal:controller.signal, credentials:'omit', referrerPolicy:'no-referrer'});
    if (!response.ok && response.status !== 404) throw new Error('Canvas lookup unavailable');
    const data = response.status === 404 ? null : await response.json();
    const url = canvasURL(data?.canvasUrl || data?.url);
    if (response.ok && !url && data?.success !== false) throw new Error('Invalid Canvas response');
    try { localStorage.setItem(CACHE_KEY, JSON.stringify([{key, url, expires:Date.now() + (url ? 86400000 : 3600000)}, ...cacheEntries().filter(x => x.key !== key)].slice(0, 150))); } catch {}
    return url;
  } finally { clearTimeout(timer); signal?.removeEventListener('abort', cancel); }
}

// One video, one cancellable lookup. Hidden players never keep downloading loops.
export class CanvasPlayer {
  constructor(video, {lookup = findCanvas, onState = () => {}} = {}) {
    this.video = video; this.lookup = lookup; this.onState = onState;
    this.generation = 0; this.key = ''; this.url = null; this.state = 'idle'; this.playing = false;
    video.muted = true; video.defaultMuted = true; video.loop = true; video.playsInline = true;
    video.addEventListener('error', () => { if (this.key && video.getAttribute('src')) this.fail('error'); });
    video.addEventListener('playing', () => { if (this.key) this.report('ready'); });
  }
  report(state) { this.state = state; this.onState(state); }
  clear() {
    this.generation++; this.controller?.abort(); this.controller = null;
    this.key = ''; this.url = null; this.playing = false; this.video.pause();
    if (this.video.getAttribute('src')) { this.video.removeAttribute('src'); this.video.load(); }
    this.report('idle');
  }
  fail(state) {
    this.url = null; this.video.pause(); this.video.removeAttribute('src'); this.video.load(); this.report(state);
  }
  resume() {
    if (!this.url || !this.playing || !this.video.paused) return;
    if (!this.video.getAttribute('src')) { this.video.src = this.url; this.video.load(); }
    const generation = this.generation;
    this.video.muted = true;
    this.video.play().catch(() => { if (generation === this.generation) this.report('blocked'); });
  }
  sync(track, {visible, enabled, playing, retry = false}) {
    const key = canvasQuery(track)?.toString();
    if (!visible || !enabled || !key) { if (this.key) this.clear(); return; }
    if (key === this.key && retry && this.state === 'blocked') { this.playing = playing; this.resume(); return; }
    if (key === this.key && !retry) {
      this.playing = playing;
      if (!playing) this.video.pause();
      else if (this.state !== 'blocked') this.resume();
      return;
    }
    this.clear(); this.key = key; this.playing = playing;
    const generation = this.generation, controller = new AbortController(); this.controller = controller;
    this.report('loading');
    this.lookup(track, controller.signal).then(url => {
      if (generation !== this.generation) return;
      if (!canvasURL(url)) { this.report('missing'); return; }
      this.url = url;
      if (!this.playing) this.report('waiting');
      // Reveal only after a real frame plays, so failures leave the cover intact.
      this.resume();
    }).catch(() => { if (generation === this.generation) this.report('error'); });
  }
}
