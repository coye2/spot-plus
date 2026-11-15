// Instant Canvas clips. Spotify Canvas loops are small MP4s, so Spot+ downloads them
// ahead of time (current and upcoming songs) and plays them from memory as blob: URLs.
// Clips are also kept in Cache Storage, so a song you've heard before starts its loop
// instantly even after a relaunch. Music-video loops stream normally (too large).
import {canvasURL,findCanvas,canvasQuery} from './canvas.js';

const CACHE = 'spotplus-canvas-v1';
const MAX_MEMORY = 10, MAX_STORED = 60, MAX_BYTES = 8 * 1024 * 1024;
const memory = new Map(); // canvas URL -> blob: URL (insertion order = LRU)
const pending = new Map();

function remember(url, blobURL) {
  memory.delete(url); memory.set(url, blobURL);
  while (memory.size > MAX_MEMORY) {
    const [oldest, old] = memory.entries().next().value;
    memory.delete(oldest); URL.revokeObjectURL(old);
  }
  return blobURL;
}
/** A playable src for a Canvas URL right now, without waiting: the blob if we have it. */
export function cachedClip(url) {
  const blobURL = memory.get(url);
  if (blobURL) remember(url, blobURL);
  return blobURL || null;
}
async function trim(cache) {
  const keys = await cache.keys();
  for (const request of keys.slice(0, Math.max(0, keys.length - MAX_STORED))) await cache.delete(request);
}
/** Resolve a Canvas URL to a local blob: URL, downloading it once. Falls back to the network URL. */
export function clipSource(url) {
  const safe = canvasURL(url);
  if (!safe) return Promise.resolve(url);
  const hit = cachedClip(safe);
  if (hit) return Promise.resolve(hit);
  if (pending.has(safe)) return pending.get(safe);
  const job = (async () => {
    let response = null, cache = null;
    try { cache = await caches.open(CACHE); response = await cache.match(safe); } catch { /* No Cache Storage (private mode). */ }
    if (!response) {
      response = await fetch(safe, {mode: 'cors', credentials: 'omit', referrerPolicy: 'no-referrer', priority: 'low'});
      if (!response.ok) throw new Error('Clip unavailable');
      if (Number(response.headers.get('content-length')) > MAX_BYTES) throw new Error('Clip too large');
      if (cache) { await cache.put(safe, response.clone()).catch(() => {}); trim(cache).catch(() => {}); }
    }
    const blob = await response.blob();
    if (!blob.size || blob.size > MAX_BYTES) throw new Error('Clip unavailable');
    return remember(safe, URL.createObjectURL(blob.type ? blob : new Blob([blob], {type: 'video/mp4'})));
  })().catch(() => safe).finally(() => pending.delete(safe));
  pending.set(safe, job);
  return job;
}
/** True when this track's Canvas is already in memory, so it needs no network to start. */
export function hasLocalClip(track) {
  const key = canvasQuery(track)?.toString();
  if (!key) return false;
  try {
    const entry = JSON.parse(localStorage.getItem('spotplus.canvasCache.v1') || '[]').find(x => x?.key === key && x.expires > Date.now());
    return !!(entry?.url && memory.has(entry.url));
  } catch { return false; }
}
const warmed = new Set();
/** Look up and download Canvas clips for these tracks in the background. */
export function prefetchClips(tracks, {connection = globalThis.navigator?.connection} = {}) {
  if (connection?.saveData || /(^|-)2g$/.test(connection?.effectiveType || '')) return;
  for (const track of tracks.filter(Boolean).slice(0, 3)) {
    const key = canvasQuery(track)?.toString();
    if (!key || warmed.has(key)) continue;
    warmed.add(key); if (warmed.size > 200) warmed.delete(warmed.values().next().value);
    findCanvas(track).then(url => url && clipSource(url)).catch(() => warmed.delete(key));
  }
}
