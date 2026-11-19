// api.js — Spot+ music API.
//   Metadata : Deezer public API (no key; JSONP so it works from any static site)
//   Audio    : public Piped / Invidious instances (the same idea Spotube uses: match the song on YouTube)
//   Lyrics   : LRCLib (time-synced)
// Requests go from the listener's browser to public providers; availability and CORS vary.
import { getSettings, getVideoCache, setVideoCache } from './store.js';
import {loopQuality, prefersAac} from './playback-policy.js';
import {rankAudioMatches,chooseAudioFormat,raceAudioSources} from './audio-selection.js';
import {corsOK, knownCors} from './cors-probe.js';
import { router, validateSourceCandidate, isVerifiedEquivalent } from './source-router.js';
import { memoryEngine } from './memory-engine.js';
import { bufferEngine } from './buffer-engine.js';

const DEEZER = 'https://api.deezer.com';
const LRCLIB = 'https://lrclib.net/api';
memoryEngine.ready().catch(() => {});

/* =========================== Deezer (metadata) =========================== */
const memo = new Map();
const MEMO_TTL = 10 * 60 * 1000;
let seq = 0;

// Catalog responses are kept on the device (IndexedDB) for a day: pages open
// instantly from the saved copy, then refresh quietly in the background.
const DISK_TTL = 24 * 60 * 60 * 1000;
let diskPromise = null;
function disk() {
  if (!globalThis.indexedDB) return Promise.resolve(null);
  return diskPromise ??= new Promise(resolve => {
    const r = indexedDB.open('spotplus-catalog', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('responses');
    r.onsuccess = () => resolve(r.result); r.onerror = () => resolve(null); r.onblocked = () => resolve(null);
  });
}
async function diskGet(key) {
  const db = await disk(); if (!db) return null;
  return new Promise(resolve => { try { const q = db.transaction('responses').objectStore('responses').get(key); q.onsuccess = () => resolve(q.result || null); q.onerror = () => resolve(null); } catch { resolve(null); } });
}
let writes = 0;
async function diskPut(key, value) {
  const db = await disk(); if (!db) return;
  try {
    const tx = db.transaction('responses', 'readwrite'), store = tx.objectStore('responses');
    store.put({t: Date.now(), value}, key);
    // Every so often, drop entries older than a day so the cache stays small.
    if (++writes % 40 === 0) { const c = store.openCursor(); c.onsuccess = () => { const cur = c.result; if (!cur) return; if (Date.now() - cur.value.t > DISK_TTL) cur.delete(); cur.continue(); }; }
  } catch { /* Storage full or unavailable: memory cache still works. */ }
}
function jsonpNetwork(path, qs) {
  return new Promise((resolve, reject) => {
    const cb = `__dz_${Date.now().toString(36)}_${++seq}`;
    qs.set('output', 'jsonp');
    qs.set('callback', cb);
    const s = document.createElement('script');
    const done = () => { clearTimeout(timer); window[cb] = () => {}; s.remove?.(); setTimeout(() => { try { delete window[cb]; } catch {} }, 30000).unref?.(); };
    const timer = setTimeout(() => { done(); reject(new Error('Deezer took too long to answer')); }, 12000);
    window[cb] = (data) => { done(); if (data && data.error) reject(new Error(data.error.message || 'Deezer error')); else resolve(data); };
    s.onerror = () => { done(); reject(new Error('Could not reach Deezer')); };
    s.src = `${DEEZER}${path}?${qs}`;
    try { (document.head || document.documentElement || document.body).appendChild(s); } catch (err) { done(); reject(err); }
  });
}
function jsonp(path, params = {}) {
  const qs = new URLSearchParams(params);
  const key = path + '?' + qs;
  const hit = memo.get(key);
  if (hit && Date.now() - hit.t < MEMO_TTL) return hit.p;
  const fresh = () => {
    const p = jsonpNetwork(path, new URLSearchParams(params));
    p.then(value => diskPut(key, value), () => {});
    return p;
  };
  const p = diskGet(key).then(saved => {
    if (saved && Date.now() - saved.t < DISK_TTL) {
      // Serve the saved copy now; refresh it in the background when it's a bit old.
      if (Date.now() - saved.t > MEMO_TTL) fresh().then(value => memo.set(key, {t: Date.now(), p: Promise.resolve(value)})).catch(() => {});
      return saved.value;
    }
    return fresh();
  });
  memo.set(key, { t: Date.now(), p });
  p.catch(() => memo.delete(key));
  return p;
}

export function normTrack(t, album) {
  const al = t.album || album || {};
  return {
    id: String(t.id),
    title: t.title || '',
    searchTitle: t.title_short || t.title || '',
    artist: t.artist?.name || album?.artist?.name || '',
    artistId: t.artist?.id || album?.artist?.id || null,
    album: al.title || '',
    albumId: al.id || null,
    cover: al.cover_medium || al.cover || '',
    coverXl: al.cover_xl || al.cover_big || al.cover_medium || '',
    duration: t.duration || 0,
    explicit: !!t.explicit_lyrics,
    preview: t.preview || '',
    rank: t.rank || 0,
  };
}
const normAlbum = (a) => ({
  id: a.id, title: a.title, artist: a.artist?.name || '', artistId: a.artist?.id || null,
  cover: a.cover_medium || a.cover || '', coverXl: a.cover_xl || a.cover_big || '',
  year: (a.release_date || '').slice(0, 4), released: a.release_date || '', type: a.record_type || 'album', count: a.nb_tracks || 0,
});
const normArtist = (a) => ({ id: a.id, name: a.name, picture: a.picture_medium || a.picture || '', pictureXl: a.picture_xl || a.picture_big || '', fans: a.nb_fan || 0 });
const normPlaylist = (p) => ({
  id: p.id, title: p.title, cover: p.picture_medium || p.picture || '', coverXl: p.picture_xl || p.picture_big || '',
  count: p.nb_tracks || 0, by: p.user?.name || p.creator?.name || '', description: p.description || '',
});
const data = (r) => (r && Array.isArray(r.data) ? r.data : []);
const settled = (r) => (r.status === 'fulfilled' ? r.value : null);

export async function home() {
  const [chart, rel] = await Promise.allSettled([jsonp('/chart/0', { limit: 20 }), jsonp('/editorial/0/releases', { limit: 20 })]);
  const c = settled(chart);
  if (!c) throw chart.reason;
  return {
    tracks: data(c.tracks).map((t) => normTrack(t)),
    albums: data(c.albums).map(normAlbum),
    artists: data(c.artists).map(normArtist),
    playlists: data(c.playlists).map(normPlaylist),
    releases: data(settled(rel)).map(normAlbum),
  };
}

export async function searchTracks(q) { return data(await jsonp('/search/track', { q, limit: 30 })).map(t => normTrack(t)); }
export async function search(q) {
  const [t, ar, al, pl] = await Promise.allSettled([
    jsonp('/search/track', { q, limit: 25 }),
    jsonp('/search/artist', { q, limit: 12 }),
    jsonp('/search/album', { q, limit: 12 }),
    jsonp('/search/playlist', { q, limit: 12 }),
  ]);
  if (t.status === 'rejected' && ar.status === 'rejected') throw t.reason;
  return {
    tracks: data(settled(t)).map((x) => normTrack(x)),
    artists: data(settled(ar)).map(normArtist),
    albums: data(settled(al)).map(normAlbum),
    playlists: data(settled(pl)).map(normPlaylist),
  };
}

export async function artist(id) {
  const [a, top, albums, related] = await Promise.allSettled([
    jsonp(`/artist/${id}`), jsonp(`/artist/${id}/top`, { limit: 20 }),
    jsonp(`/artist/${id}/albums`, { limit: 60 }), jsonp(`/artist/${id}/related`, { limit: 14 }),
  ]);
  if (a.status === 'rejected') throw a.reason;
  return {
    artist: normArtist(a.value),
    top: data(settled(top)).map((t) => normTrack(t)),
    albums: data(settled(albums)).map(normAlbum).sort((x, y) => (y.year || '').localeCompare(x.year || '')),
    related: data(settled(related)).map(normArtist),
  };
}

export async function artistRadio(id) {
  return data(await jsonp(`/artist/${id}/radio`, { limit: 50 })).map((t) => normTrack(t));
}

export async function album(id) {
  const a = await jsonp(`/album/${id}`);
  return { album: normAlbum(a), tracks: data(a.tracks).map((t) => normTrack(t, a)) };
}

export async function playlist(id) {
  const p = await jsonp(`/playlist/${id}`);
  let tracks = data(p.tracks);
  const total = Math.min(p.nb_tracks || 0, 1000);
  while (tracks.length < total) {
    const more = data(await jsonp(`/playlist/${id}/tracks`, { index: tracks.length, limit: 100 }).catch(() => null));
    if (!more.length) break;
    tracks = tracks.concat(more);
  }
  return { playlist: normPlaylist(p), tracks: tracks.map((t) => normTrack(t)) };
}

export function parseDeezerPlaylist(input) {
  const s = String(input || '').trim();
  const m = s.match(/playlist\/(\d+)/) || s.match(/^(\d{3,})$/);
  return m ? m[1] : null;
}

/* =========================== Audio (Multi-Engine: JioSaavn, HiFi/Monochrome, Piped, Invidious, Audius, Deezer) =========================== */
import {matchMusicVideo,chooseLoopFormat,musicVideoLoop,publicMediaURL} from './video-loops.js';
const PIPED_FALLBACK = [
  'https://api.piped.private.coffee', 'https://pipedapi.kavin.rocks', 'https://pipedapi.adminforge.de',
  'https://pipedapi.reallyaweso.me', 'https://pipedapi.leptons.xyz', 'https://pipedapi.nosebs.ru',
];
const INV_FALLBACK = [
  'https://inv.nadeko.net', 'https://invidious.nerdvpn.de', 'https://iv.melmac.space',
  'https://yt.artemislena.eu', 'https://invidious.privacyredirect.com', 'https://invidious.f5.si',
  'https://yt.chocolatemoo53.com',
];
const JIOSAAVN_FALLBACK = ['https://saavn.sumit.co'];
const MONO_BASE = 'https://tracks.monochrome.st';
const HIFI_REGISTRY_URL = 'https://raw.githubusercontent.com/kipavy/spotube-plugin-lossless-sources/main/sources.json';
const HIFI_FALLBACK = [
  'https://hifi-api-w9y8.onrender.com',
  'https://hifi-api-bffw.onrender.com',
  'https://monochrome-api.samidy.com',
  'https://tidal-api.binimum.org',
  'https://tidal.kinoplus.online',
  'https://hifi.geeked.wtf',
];

async function fetchJSON(url, ms = 9000, signal) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), ms);
  try {
    const r = await fetch(url, { signal: signal ? AbortSignal.any([signal, ctl.signal]) : ctl.signal });
    if (!r.ok) {
      const err = new Error(`HTTP ${r.status}`);
      err.status = r.status;
      throw err;
    }
    return await r.json();
  } catch (e) {
    throw e.name === 'AbortError' ? new Error('timed out') : e;
  } finally {
    clearTimeout(timer);
  }
}
const uniq = (a) => [...new Set(a.filter(Boolean))];
const clean = (u) => String(u).trim().replace(/\/+$/, '');
export const host = (u) => { try { return new URL(u).host; } catch { return u; } };
function decodeEntities(s) {
  return String(s ?? '')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#0*39;|&#x0*27;|&apos;/gi, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCharCode(parseInt(h, 16)));
}
const isFatalHttp = (err) => [401, 403, 410, 429, 500, 502, 503, 504].includes(err?.status);

let hifiRegistryPromise = null;
function refreshHifiRegistry(force = false) {
  if (!instanceSnapshot) instances();
  try {
    const cached = JSON.parse(localStorage.getItem('spotplus.hifiRegistry') || 'null');
    if (cached && Array.isArray(cached.hosts) && Date.now() - cached.t < 6 * 3600e3 && !force) {
      instanceSnapshot.hifi = uniq([...cached.hosts, ...HIFI_FALLBACK]);
      return Promise.resolve(instanceSnapshot.hifi);
    }
  } catch {}
  if (hifiRegistryPromise) return force ? hifiRegistryPromise : Promise.resolve(instanceSnapshot?.hifi || HIFI_FALLBACK);
  const publicOrigin = u => { try { const {protocol, hostname} = new URL(u); return protocol === 'https:' && /\.[a-z]{2,}$/i.test(hostname) && !/(^|\.)(onion|i2p|ygg|loki)$/i.test(hostname); } catch { return false; } };
  hifiRegistryPromise = (async () => {
    try {
      const registry = await fetchJSON(HIFI_REGISTRY_URL, 3500);
      const fromReg = Array.isArray(registry?.sources)
        ? registry.sources.filter((x) => x && x.type === 'hifi-api' && x.base).map((x) => clean(x.base)).filter(publicOrigin)
        : [];
      const merged = uniq([...fromReg, ...HIFI_FALLBACK]);
      if (instanceSnapshot) instanceSnapshot.hifi = merged;
      try { localStorage.setItem('spotplus.hifiRegistry', JSON.stringify({ t: Date.now(), hosts: fromReg })); } catch {}
      return merged;
    } catch {
      return instanceSnapshot?.hifi || HIFI_FALLBACK;
    } finally {
      hifiRegistryPromise = null;
    }
  })();
  hifiRegistryPromise.catch(() => {});
  return force ? hifiRegistryPromise : Promise.resolve(instanceSnapshot?.hifi || HIFI_FALLBACK);
}

let instancePromise = null;
let instanceSnapshot = null;
export function instances(force = false) {
  if (!instanceSnapshot) {
    try { instanceSnapshot = JSON.parse(localStorage.getItem('spotplus.instances') || 'null'); } catch {}
    if (!Array.isArray(instanceSnapshot?.piped) || !Array.isArray(instanceSnapshot?.invidious)) {
      instanceSnapshot = { t: 0, piped: PIPED_FALLBACK, invidious: INV_FALLBACK, jiosaavn: JIOSAAVN_FALLBACK, hifi: HIFI_FALLBACK };
    } else {
      if (!Array.isArray(instanceSnapshot.jiosaavn)) instanceSnapshot.jiosaavn = JIOSAAVN_FALLBACK;
      if (!Array.isArray(instanceSnapshot.hifi)) instanceSnapshot.hifi = HIFI_FALLBACK;
    }
  }
  if (instancePromise) return force ? instancePromise : Promise.resolve(instanceSnapshot);
  if (!force && Date.now() - instanceSnapshot.t < 6 * 3600e3) return Promise.resolve(instanceSnapshot);
  const publicOrigin = u => { try { const {protocol, hostname} = new URL(u); return protocol === 'https:' && /\.[a-z]{2,}$/i.test(hostname) && !/(^|\.)(onion|i2p|ygg|loki)$/i.test(hostname); } catch { return false; } };
  instancePromise = (async () => {
    const [p, i] = await Promise.allSettled([
      fetchJSON('https://piped-instances.kavin.rocks/', 4000),
      fetchJSON('https://api.invidious.io/instances.json?sort_by=health', 4000),
    ]);
    const piped = Array.isArray(settled(p))
      ? p.value.filter((x) => x && x.api_url).sort((a, b) => (b.uptime_24h || 0) - (a.uptime_24h || 0)).map((x) => clean(x.api_url)).filter(publicOrigin)
      : [];
    const inv = Array.isArray(settled(i))
      ? i.value.filter(([, d]) => d && d.type === 'https' && d.api !== false && d.cors !== false && d.uri).map(([, d]) => clean(d.uri)).filter(publicOrigin)
      : [];
    const out = {
      t: Date.now(),
      piped: uniq([...piped, ...PIPED_FALLBACK]),
      invidious: uniq([...inv, ...INV_FALLBACK]),
      jiosaavn: JIOSAAVN_FALLBACK,
      hifi: instanceSnapshot?.hifi || HIFI_FALLBACK,
    };
    instanceSnapshot = out;
    try { localStorage.setItem('spotplus.instances', JSON.stringify(out)); } catch {}
    return out;
  })().finally(() => { instancePromise = null; });
  return force ? instancePromise : Promise.resolve(instanceSnapshot);
}

// Shared match & stream lookup on the Spot+ bridge: edge-cached search and stream resolution.
export const MATCH_ENDPOINT = 'https://spot-plus-canvas.pwr97pnmkn.workers.dev/match';
export const STREAM_ENDPOINT = 'https://spot-plus-canvas.pwr97pnmkn.workers.dev/stream';
// Full songs from SoundCloud's official API through the worker (off until the worker has a SoundCloud key).
export const SC_ENDPOINT = 'https://spot-plus-canvas.pwr97pnmkn.workers.dev/sc';
const SC_BASE = 'https://soundcloud.com';
let scOff = 0;
async function soundcloudStream(track, signal, ms = 3000) {
  if (scOff > Date.now()) throw new Error('SoundCloud is not set up');
  const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), ms);
  try {
    const params = new URLSearchParams({title: track.searchTitle || track.title || '', artist: track.artist || '', album: track.album || '', duration: String(Math.round(Number(track.duration) || 0))});
    const r = await fetch(`${SC_ENDPOINT}?${params}`, {signal: signal ? AbortSignal.any([signal, ctl.signal]) : ctl.signal, credentials: 'omit'});
    if (r.status === 503 || r.status === 404 && !r.headers.get('content-type')?.includes('json')) scOff = Date.now() + 30 * 60e3;
    if (!r.ok) throw new Error('Not on SoundCloud');
    const d = await r.json();
    if (!/^https:\/\//.test(d.url || '')) throw new Error('No SoundCloud link');
    return {url: d.url, mime: 'audio/mpeg', bitrate: 128000, kind: 'soundcloud', engineLabel: 'SoundCloud', instance: SC_BASE, title: d.title, channel: d.artist, duration: d.duration || track.duration, verified: true, alternatives: []};
  } finally { clearTimeout(timer); }
}
export const soundcloudReady = () => scOff <= Date.now();

// Full YouTube audio relayed through the Spot+ worker into Spot+'s own player (no YouTube player, no ads,
// no extra tap). Unofficial: depends on YouTube's internal API and can break when YouTube changes it.
export const RELAY_ENDPOINT = 'https://spot-plus-canvas.pwr97pnmkn.workers.dev/yta';
const RELAY_BASE = 'https://spot-plus-canvas.pwr97pnmkn.workers.dev/yta';
let relayOff = 0;
/** Spotube-style quality: Opus 160 kbps where it plays, AAC 128 kbps on iPhone/Safari, or the data-saver tier. */
export function relayFormat(quality = getSettings().quality, ua = globalThis.navigator?.userAgent || '') {
  const apple = appleMobile() || (/Safari\//.test(ua) && !/Chrome|Chromium|CriOS|Android|Edg/.test(ua));
  let opus = false;
  try { opus = !apple && !!globalThis.document?.createElement('audio').canPlayType('audio/webm; codecs="opus"'); } catch { opus = false; }
  if (quality === 'low') return opus ? 'low-opus' : 'low';
  return opus ? 'opus' : 'aac';
}
const RELAY_BITRATE = {opus: 160000, aac: 128000, low: 48000, 'low-opus': 50000};
// The relay usually answers in well under a second. When YouTube refuses an upload, the worker spends a few
// seconds retrying before it gives up, so the next upload starts in parallel after a short wait (hedging)
// instead of queueing behind it. The first upload that really streams wins; the others are cancelled.
export const RELAY_HEDGE_MS = 1500;
const RELAY_PROBE_MS = 9000;
const RELAY_PARALLEL = 2;
export async function relayStream(track, signal, matches) {
  if (relayOff > Date.now()) throw new Error('Relay is off');
  const ids = uniq((matches || []).map((m) => m?.id).filter((id) => /^[\w-]{11}$/.test(id || ''))).slice(0, 3);
  if (!ids.length) throw new Error('No YouTube match');
  const fmt = relayFormat();
  // Ask for two bytes: proves the relay really streams this song before the player commits to it.
  const probe = async (id, probeSignal) => {
    const url = `${RELAY_ENDPOINT}?id=${id}&fmt=${fmt}`;
    const r = await fetch(url, {headers: {Range: 'bytes=0-1'}, signal: probeSignal, credentials: 'omit'});
    if (r.status === 404 && !(r.headers.get('content-type') || '').includes('json')) { relayOff = Date.now() + 30 * 60e3; throw new Error('Relay is not deployed'); }
    if (r.status !== 206 && r.status !== 200) { r.body?.cancel?.().catch(() => {}); throw new Error('Relay answered ' + r.status); }
    r.body?.cancel?.().catch(() => {});
    const pick = matches.find((m) => m?.id === id) || {};
    return {url, mime: (r.headers.get('content-type') || 'audio/mp4').split(';')[0], bitrate: RELAY_BITRATE[fmt] || 128000, kind: 'ytrelay', engineLabel: 'YouTube audio', instance: RELAY_BASE, videoId: id, catalogId: id, title: pick.title, channel: pick.channel || pick.author, duration: pick.duration || track.duration, alternatives: []};
  };
  // Two rounds: YouTube's bot check on the server comes and goes, and each new request gets a fresh session.
  const queue = [...ids, ...ids.slice(0, 2)];
  return new Promise((resolve, reject) => {
    const live = new Map(); // id -> AbortController of its probe in flight
    let last = 'No audio', done = false, hedge = null;
    const finish = (settle, value) => {
      if (done) return;
      done = true; clearTimeout(hedge);
      for (const ctl of live.values()) ctl.abort();
      signal?.removeEventListener?.('abort', onAbort);
      settle(value);
    };
    const onAbort = () => finish(reject, signal.reason || new Error('Aborted'));
    const launch = () => {
      clearTimeout(hedge);
      if (done) return;
      if (!live.size && !queue.length) return finish(reject, new Error(last));
      // The same upload is never asked twice at once; its second round waits for the first to finish.
      const next = queue.findIndex((id) => !live.has(id));
      if (next < 0 || live.size >= RELAY_PARALLEL) return;
      const [id] = queue.splice(next, 1);
      const ctl = new AbortController();
      live.set(id, ctl);
      const timer = setTimeout(() => ctl.abort(), RELAY_PROBE_MS);
      probe(id, ctl.signal).then((stream) => finish(resolve, stream), (error) => {
        if (relayOff > Date.now()) return finish(reject, error);
        last = error?.message || last;
      }).finally(() => { clearTimeout(timer); live.delete(id); launch(); });
      if (queue.length) hedge = setTimeout(launch, RELAY_HEDGE_MS);
    };
    if (signal?.aborted) return onAbort();
    signal?.addEventListener?.('abort', onAbort, {once: true});
    launch();
  });
}
// Ask the worker once (on the first song) whether SoundCloud is set up, so nothing waits on it when it is not.
let scKnown = '';
let relayKnown = '';
let scCheck = null;
function checkSoundcloud() {
  if (scCheck) return scCheck;
  const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), 5000);
  scCheck = fetch(SC_ENDPOINT.replace(/\/sc$/, '/health'), {credentials: 'omit', signal: ctl.signal}).then((r) => r.json()).finally(() => clearTimeout(timer))
    .then((h) => {
      scKnown = h?.sc ? 'on' : 'off'; if (!h?.sc) scOff = Date.now() + 30 * 60e3;
      relayKnown = h?.relay ? 'on' : 'off'; if (!h?.relay) relayOff = Date.now() + 30 * 60e3;
    })
    // Couldn't reach the worker (the phone just woke up, a network switch): ask again on the next song.
    // This used to switch the relay off for 5 minutes, so every song failed until the app was restarted.
    .catch(() => { scKnown = ''; relayKnown = ''; scCheck = null; });
  return scCheck;
}
let matchDown = 0;
let streamDown = 0;
// When every direct server failed recently, Auto goes straight to YouTube's player (instant start).
let directDown = 0;
const appleMobile = () => /iP(hone|ad|od)/.test(globalThis.navigator?.userAgent || '') || (globalThis.navigator?.platform === 'MacIntel' && globalThis.navigator?.maxTouchPoints > 1);
/**
 * How long lossless servers get before YouTube's player starts. Elsewhere a known video starts at once
 * (lossless takes over mid-song). On iPhone the YouTube player needs its own tap, while a lossless link
 * plays straight from the tap on the song, so lossless gets longer there.
 */
// Inside the Spot+ iPhone app, the web view lets YouTube's player start without its own tap.
let embedUnlocked = /SpotPlusApp\//.test(globalThis.navigator?.userAgent || '');
/** The player reports when YouTube's player has played with sound this session (iPhone then autoplays it too). */
export function setEmbedUnlocked(on = true) { embedUnlocked = !!on; }
export function embedWait(t, now = Date.now()) {
  if (directDown > now) return 0;
  // SoundCloud plays ad-free straight from the tap; give it a moment before YouTube's player.
  if (scOff <= now && scKnown === 'on') return 1800;
  // The relay plays the same full YouTube songs in Spot+'s own player, without ads; let it answer first.
  if (relayOff <= now && relayKnown === 'on') return 7000;
  if (scOff <= now && !scKnown) return 900;
  if (appleMobile() && !embedUnlocked) return 2600;
  return 0;
}
async function bridgeMatches(t, signal) {
  if (matchDown > Date.now()) throw new Error('Match lookup paused');
  const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), 3500);
  try {
    const r = await fetch(MATCH_ENDPOINT + '?q=' + encodeURIComponent(query(t)), {signal: signal ? AbortSignal.any([signal, ctl.signal]) : ctl.signal, credentials: 'omit'});
    if (r.status === 404) matchDown = Date.now() + 3600e3;
    if (!r.ok) throw new Error('Match lookup unavailable');
    const matches = best(((await r.json()).items || []).slice(0, 8), t);
    if (!matches.length) throw new Error('No match');
    return matches;
  } finally { clearTimeout(timer); }
}
// The worker's /stream hands out YouTube links tied to Cloudflare's address, which phones cannot play. Off.
const BRIDGE_STREAM_ON = false;
export async function bridgeStream(videoId, { signal, preferAac = false, timeoutMs = 900 } = {}) {
  if (!BRIDGE_STREAM_ON || !videoId || streamDown > Date.now() || !router.isAvailable(STREAM_ENDPOINT)) return null;
  const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), timeoutMs);
  const combined = signal ? AbortSignal.any([signal, ctl.signal]) : ctl.signal;
  let onAbort = null;
  const abortPromise = new Promise((_, reject) => {
    onAbort = () => reject(new DOMException('Aborted', 'AbortError'));
    if (combined.aborted) onAbort();
    else combined.addEventListener('abort', onAbort, { once: true });
  });
  const started = performance.now();
  try {
    router.claimHalfOpen(STREAM_ENDPOINT);
    const r = await Promise.race([
      fetch(`${STREAM_ENDPOINT}?id=${encodeURIComponent(videoId)}${preferAac ? '&aac=1' : ''}`, {
        signal: combined,
        credentials: 'omit',
      }),
      abortPromise,
    ]);
    if (r.status === 404) {
      streamDown = Date.now() + 10 * 60e3;
      router.recordResolution(STREAM_ENDPOINT, performance.now() - started, false, { fatal: true });
      return null;
    }
    if (!r.ok) {
      if (r.status >= 500) streamDown = Date.now() + 30e3;
      router.recordResolution(STREAM_ENDPOINT, performance.now() - started, false, { fatal: r.status >= 500 });
      return null;
    }
    const data = await r.json();
    if (!data?.url || !/^https:\/\//.test(data.url)) {
      router.recordResolution(STREAM_ENDPOINT, performance.now() - started, false);
      return null;
    }
    router.recordResolution(STREAM_ENDPOINT, performance.now() - started, true);
    return {
      url: data.url,
      mime: data.mime || 'audio/mp4',
      bitrate: Number(data.bitrate) || 128000,
      kind: 'bridge',
      instance: data.instance || 'https://spot-plus-canvas.pwr97pnmkn.workers.dev',
      videoId,
      fast: true,
      itag: data.itag || null,
      alternatives: Array.isArray(data.alternatives) ? data.alternatives : [],
    };
  } catch {
    if (!signal?.aborted) router.recordResolution(STREAM_ENDPOINT, performance.now() - started, false);
    return null;
  } finally {
    clearTimeout(timer);
    if (onAbort) combined.removeEventListener('abort', onAbort);
  }
}
const goodKey = 'spotplus.goodInstance';
const failedInstances = new Map();
function lastGood() { try { return JSON.parse(localStorage.getItem(goodKey) || '{}'); } catch { return {}; } }
function markGood(kind, base) { const g = lastGood(); g[kind] = base; try { localStorage.setItem(goodKey, JSON.stringify(g)); } catch {} }
export function reportPlaybackSource(source, ok = true, meta = {}) {
  if (!source?.instance || !['piped','invidious','bridge','audius','jiosaavn','hifi','monochrome'].includes(source.kind)) return;
  const hostKey = source.kind === 'bridge' ? STREAM_ENDPOINT : source.instance;
  router.recordPlayback(hostKey, { ok, startupMs: meta.startupMs, stalled: !!meta.stalled });
  if (ok) {
    failedInstances.delete(source.instance);
    if (source.kind === 'bridge') streamDown = 0;
    else if (['piped','invidious','jiosaavn','hifi','monochrome'].includes(source.kind)) markGood(source.kind, source.instance);
  } else {
    failedInstances.set(source.instance, Date.now() + (source.kind === 'bridge' ? 30e3 : 90e3));
    if (source.kind === 'bridge') streamDown = Date.now() + 20e3;
    bufferEngine.recordFailure();
    memoryEngine.forgetByInstance(source.instance);
  }
}

// Each server's typical answer time (moving average), so the fastest ones are asked first.
const SPEED_KEY='spotplus.instanceSpeed';
let speeds=null;
function speedTable(){if(!speeds){try{speeds=JSON.parse(localStorage.getItem(SPEED_KEY)||'{}');}catch{speeds={};}}return speeds;}
export function recordSpeed(base,ms,ok,{fatal=false}={}){
  bufferEngine.recordLatency(ms);
  router.recordResolution(base,ms,ok,{fatal});
  const table=speedTable(),old=table[base];const sample=ok?ms:Math.max(ms,6000)+4000;
  table[base]=Math.round(old?old*.6+sample*.4:sample);
  clearTimeout(recordSpeed.t);recordSpeed.t=setTimeout(()=>{try{localStorage.setItem(SPEED_KEY,JSON.stringify(Object.fromEntries(Object.entries(table).sort((a,b)=>a[1]-b[1]).slice(0,80))));}catch{}},1500);
  recordSpeed.t.unref?.();
}
export function rankBySpeed(list,{custom=[],failed=()=>false,table=speedTable()}={}){
  const cost=base=>failed(base)?1e9:custom.includes(base)?-1:(table[base]??2500);
  return list.map((base,i)=>({base,i,c:cost(base)})).sort((a,b)=>a.c-b.c||a.i-b.i).map(x=>x.base);
}
function customHostsFor(kind, set) {
  const raw = kind === 'piped' ? set.customPiped : kind === 'hifi' ? set.customHifi : kind === 'invidious' ? set.customInvidious : '';
  return String(raw || '').split(/[\s,]+/).filter((x) => /^https?:\/\//.test(x)).map(clean);
}
function orderedInstances(kind, inst, set) {
  const custom = customHostsFor(kind, set);
  const list = uniq([...custom, lastGood()[kind], ...(inst[kind] || [])]);
  const routerRanked = router.rank(list, { custom });
  return rankBySpeed(routerRanked,{custom,failed:base=>(failedInstances.get(base)||0)>Date.now() || !router.isAvailable(base)});
}

const best = rankAudioMatches;
const query = (t) => `${t.artist} ${t.title}`.trim();

async function pipedSearch(base, t, signal, ms = 2800) {
  for (const filter of ['music_songs', 'videos']) {
    const d = await fetchJSON(`${base}/search?q=${encodeURIComponent(query(t))}&filter=${filter}`, ms, signal);
    const items = (d.items || [])
      .filter((x) => x && typeof x.url === 'string' && x.url.includes('v='))
      .map((x) => ({ id: new URL(x.url, 'https://youtube.com').searchParams.get('v'), title: x.title, duration: x.duration, channel: x.uploaderName }));
    const matches=best(items,t);if(matches.length)return matches;
  }
  throw new Error('no results');
}
async function invSearch(base, t, signal, ms = 2800) {
  const d = await fetchJSON(`${base}/api/v1/search?q=${encodeURIComponent(query(t))}&type=video&fields=videoId,title,lengthSeconds,author`, ms, signal);
  const items = (Array.isArray(d) ? d : []).filter((x) => x.videoId).map((x) => ({ id: x.videoId, title: x.title, duration: x.lengthSeconds, channel: x.author }));
  if (!items.length) throw new Error('no results');
  const matches=best(items,t);if(!matches.length)throw new Error('No matching recording');return matches;
}

const probe = typeof document !== 'undefined' ? document.createElement('audio') : null;
function pickFormat(list) {
  const picked=chooseAudioFormat(list,{quality:getSettings().quality,canPlay:mime=>!!probe?.canPlayType(mime)});
  if(!picked)throw new Error('No compatible audio format');
  const rest=list.filter(f=>f.url!==picked.url&&probe?.canPlayType(f.mime));
  const alternatives=[];if(picked.fallbackURL)alternatives.push({...picked,url:picked.fallbackURL,fallbackURL:undefined});
  const other=chooseAudioFormat(rest,{quality:getSettings().quality,canPlay:mime=>!!probe?.canPlayType(mime)});if(other)alternatives.unshift(other);
  return {...picked,alternatives};
}
async function pipedStream(base, id, signal, track, ms = 2800) {
  const d = await fetchJSON(`${base}/streams/${id}`, ms, signal);
  if(d.livestream || (track&&d.title&&!best([{title:d.title,channel:d.uploader,duration:d.duration}],track).length))throw new Error('Recording did not match');
  const list = (d.audioStreams || []).filter((s) => s.url && s.videoOnly!==true).map((s) => ({ url: s.url, mime: s.mimeType || '', codec:s.codec||'', bitrate: Number(s.bitrate) || parseFloat(s.quality)*1000 || 0 }));
  if (!list.length) throw new Error(d.error || d.message || 'no audio streams');
  return pickFormat(list);
}
async function invStream(base, id, signal, track, ms = 2800) {
  const d = await fetchJSON(`${base}/api/v1/videos/${id}?fields=adaptiveFormats,error,title,author,lengthSeconds,liveNow`, ms, signal);
  if(d.liveNow || (track&&d.title&&!best([{title:d.title,channel:d.author,duration:d.lengthSeconds}],track).length))throw new Error('Recording did not match');
  const list = (d.adaptiveFormats || [])
    .filter((f) => (f.type || '').startsWith('audio/'))
    .map((f) => {const proxy=`${base}/latest_version?id=${id}&itag=${f.itag}&local=true`;return {url:publicMediaURL(f.url)||proxy,fallbackURL:publicMediaURL(f.url)?proxy:undefined,mime:f.type,bitrate:Number(f.bitrate)||0};});
  if (!list.length) throw new Error(d.error || 'no audio streams');
  return pickFormat(list);
}
const ENGINES = { piped: { search: pipedSearch, stream: pipedStream }, invidious: { search: invSearch, stream: invStream } };
async function audiusStream(track,signal) {
  const base='https://api.audius.co';
  const data=await fetchJSON(base+'/v1/tracks/search?query='+encodeURIComponent(query(track))+'&limit=10&app_name=SpotPlus',3200,signal);
  const matches=best((data.data||[]).filter(t=>t.is_streamable===true&&!t.is_stream_gated&&t.access?.stream!==false&&t.user?.name).map(t=>({id:t.id,title:t.title,channel:t.user.name,duration:t.duration,verified:!!t.user.is_verified})),track);
  if(!matches.length)throw new Error('No matching public Audius release');
  return {url:base+'/v1/tracks/'+encodeURIComponent(matches[0].id)+'/stream?app_name=SpotPlus',mime:'audio/mpeg',bitrate:320000,kind:'audius',engineLabel:'Audius',instance:base,catalogId:matches[0].id,title:matches[0].title,channel:matches[0].channel,duration:matches[0].duration,verified:true,alternatives:[]};
}

const JIOSAAVN_BLOCK_WORDS = /\b(karaoke|nightcore|ringtone|tribute|8d|sped up|slowed|instrumental|cover)\b/i;
async function jiosaavnStream(base, track, signal, ms = 2600) {
  const d = await fetchJSON(`${base}/api/search/songs?query=${encodeURIComponent(query(track))}&limit=8`, ms, signal);
  const rows = Array.isArray(d?.data?.results) ? d.data.results : Array.isArray(d?.results) ? d.results : [];
  if (!rows.length) throw new Error('No JioSaavn results');
  const wantedBlocked = JIOSAAVN_BLOCK_WORDS.test(`${track.title} ${track.artist}`);
  const items = rows.map((s) => {
    const primary = Array.isArray(s.artists?.primary)
      ? s.artists.primary.map((a) => decodeEntities(a?.name)).filter(Boolean).join(', ')
      : decodeEntities(s.primaryArtists || '');
    const title = decodeEntities(s.name || s.title || '');
    const formats = (Array.isArray(s.downloadUrl) ? s.downloadUrl : [])
      .filter((x) => /^https:\/\//.test(x?.url || ''))
      .map((x) => {
        const kbps = parseInt(String(x.quality || '160'), 10) || 160;
        return { url: x.url, mime: 'audio/mp4', bitrate: kbps * 1000 };
      });
    return {
      id: String(s.id || ''),
      title,
      channel: primary,
      duration: Number(s.duration) || 0,
      formats,
      verified: true,
    };
  }).filter((item) => item.id && item.formats.length && (wantedBlocked || !JIOSAAVN_BLOCK_WORDS.test(`${item.title} ${item.channel}`)));
  const matches = best(items, track);
  if (!matches.length) throw new Error('No matching JioSaavn release');
  const chosen = matches[0];
  const picked = pickFormat(chosen.formats);
  return {
    ...picked,
    kind: 'jiosaavn',
    engineLabel: 'JioSaavn',
    instance: base,
    catalogId: chosen.id,
    title: chosen.title,
    channel: chosen.channel,
    duration: chosen.duration,
    verified: true,
  };
}

function decodeHifiManifest(data) {
  if (!data || typeof data !== 'object') return null;
  if (typeof data.OriginalTrackUrl === 'string' && /^https:\/\//.test(data.OriginalTrackUrl)) {
    return { url: data.OriginalTrackUrl, mime: /\.flac(\?|$)/i.test(data.OriginalTrackUrl) ? 'audio/flac' : 'audio/mp4', codec: '' };
  }
  if (Array.isArray(data.urls) && /^https:\/\//.test(data.urls[0] || '')) {
    const u = data.urls[0];
    return { url: u, mime: data.mimeType || (/\.flac(\?|$)/i.test(u) ? 'audio/flac' : 'audio/mp4'), codec: data.codecs || '' };
  }
  if (typeof data.url === 'string' && /^https:\/\//.test(data.url)) {
    return { url: data.url, mime: data.mimeType || (/\.flac(\?|$)/i.test(data.url) ? 'audio/flac' : 'audio/mp4'), codec: data.codecs || '' };
  }
  if (data.manifestMimeType === 'application/vnd.tidal.bts' && typeof data.manifest === 'string' && typeof atob === 'function') {
    try {
      const parsed = JSON.parse(atob(data.manifest));
      const u = Array.isArray(parsed?.urls) ? parsed.urls[0] : '';
      if (/^https:\/\//.test(u || '')) {
        return { url: u, mime: parsed.mimeType || 'audio/flac', codec: parsed.codecs || '' };
      }
    } catch { /* ignore malformed manifest */ }
  }
  return null;
}
async function monochromeStream(base, track, signal, ms = 2200) {
  const data = await fetchJSON(`${base}/search/tracks?q=${encodeURIComponent(query(track))}`, ms, signal);
  const rows = Array.isArray(data?.tracks) ? data.tracks : [];
  const wantInstrumental = /\binstrumental\b/i.test(`${track.title} ${track.artist}`);
  const items = rows.filter((row) => row && row.playable !== false && row.id && (wantInstrumental || !/\binstrumental\b/i.test(row.title || ''))).map((row) => ({
    id: String(row.id),
    title: String(row.title || '').replace(/\s+-\s+.*\bremix\b.*/i, ''),
    channel: Array.isArray(row.artistNames) ? row.artistNames.filter(Boolean).join(', ') : '',
    duration: Math.round((Number(row.duration) || 0) / (Number(row.duration) > 10000 ? 1000 : 1)),
    verified: true,
  }));
  const matches = best(items, track);
  if (!matches.length) throw new Error('No matching Monochrome track');
  const chosen = matches[0];
  const mime = 'audio/flac';
  if (probe && !probe.canPlayType(mime) && !probe.canPlayType('audio/x-flac')) throw new Error('This device cannot play lossless audio');
  return {
    url: `${base}/track/${encodeURIComponent(chosen.id)}`,
    mime,
    bitrate: 900000,
    lossless: true,
    fast: true,
    kind: 'monochrome',
    engineLabel: 'Monochrome',
    instance: base,
    catalogId: chosen.id,
    title: chosen.title,
    channel: chosen.channel,
    duration: chosen.duration,
    verified: true,
    alternatives: [],
  };
}
async function hifiStream(base, track, signal, ms = 2600) {
  const sData = await fetchJSON(`${base}/search/?s=${encodeURIComponent(query(track))}`, ms, signal);
  const rawItems = sData?.data?.items || sData?.items || sData?.tracks || [];
  const items = (Array.isArray(rawItems) ? rawItems : [])
    .filter((x) => x && x.id != null && x.allowStreaming !== false && x.streamReady !== false)
    .map((x) => ({
      id: String(x.id),
      title: x.title || '',
      channel: x.artist?.name || (Array.isArray(x.artists) ? x.artists.map((a) => a?.name).filter(Boolean).join(', ') : ''),
      duration: Number(x.duration) || 0,
      verified: true,
    }));
  const matches = best(items, track);
  if (!matches.length) throw new Error('No matching HiFi track');
  const chosen = matches[0];
  const set = getSettings();
  const canFlac = !probe || !!probe.canPlayType('audio/flac');
  const tiers = set.quality === 'low' ? ['LOW', 'HIGH'] : canFlac && !prefersAac() ? ['LOSSLESS', 'HIGH'] : ['HIGH', 'LOSSLESS'];
  let stream = null;
  for (const qTier of tiers) {
    try {
      const res = await fetchJSON(`${base}/track/?id=${encodeURIComponent(chosen.id)}&quality=${qTier}`, ms, signal);
      const decoded = decodeHifiManifest(res?.data || res);
      if (!decoded) continue;
      if (probe && decoded.mime && !probe.canPlayType(decoded.mime + (decoded.codec && !decoded.mime.includes('codecs=') ? `; codecs="${decoded.codec}"` : ''))) continue;
      stream = {
        ...decoded,
        bitrate: /flac/i.test(decoded.mime) ? 1411000 : qTier === 'HIGH' ? 320000 : 128000,
        lossless: /flac/i.test(decoded.mime),
      };
      break;
    } catch (e) {
      if (qTier === tiers.at(-1)) throw e;
    }
  }
  if (!stream) throw new Error('No compatible HiFi stream');
  return {
    ...stream,
    kind: 'hifi',
    engineLabel: stream.lossless ? 'HiFi Lossless' : 'HiFi',
    instance: base,
    catalogId: chosen.id,
    title: chosen.title,
    channel: chosen.channel,
    duration: chosen.duration,
    verified: true,
    alternatives: [],
  };
}

// Only used after Canvas is missing. Audio resolution never waits on this work.
const videoLoopCache = new Map();
export async function resolveVideoLoop(track, {signal, source, skip = []} = {}) {
  const target = loopQuality(globalThis.navigator?.connection);
  const key = JSON.stringify([track.searchTitle || track.title, track.artist,target]);
  const cached = videoLoopCache.get(key);
  if (cached?.expires > Date.now() && !skip.includes(cached.value.instance)) return cached.value;
  const fast = await fastVideoLoop(track,{signal,skip,target});
  if (fast) { videoLoopCache.set(key,{value:fast,expires:Date.now()+10*60e3}); return fast; }
  const list = await instances(), settings = getSettings(), controller = new AbortController();
  const cancel = () => controller.abort();
  signal?.addEventListener('abort',cancel,{once:true}); if (signal?.aborted) cancel();
  const timer = setTimeout(cancel,12000);
  const providers = ['invidious','piped'].flatMap(kind => uniq([source?.kind === kind ? source.instance : '', kind === 'invidious' ? 'https://yt.chocolatemoo53.com' : '', ...orderedInstances(kind,list,settings)])
    .filter(base => publicMediaURL(base) && !skip.includes(base)).slice(0,kind === 'invidious' ? 3 : 1).map(base=>({kind,base})));
  try {
    const result = await Promise.any(providers.map(async ({kind,base}) => {
      const q = encodeURIComponent(query(track)+' official music video'); let items;
      if (kind === 'invidious') {
        const data = await fetchJSON(base+'/api/v1/search?q='+q+'&type=video',5500,controller.signal);
        items = (Array.isArray(data) ? data : []).map(x=>({id:x.videoId,title:x.title,channel:x.author,verified:x.authorVerified,duration:x.lengthSeconds}));
      } else {
        const data = await fetchJSON(base+'/search?q='+q+'&filter=videos',5500,controller.signal);
        items = (data.items || []).filter(x=>x.url?.includes('v=')).map(x=>({id:new URL(x.url,'https://youtube.com').searchParams.get('v'),title:x.title,channel:x.uploaderName,verified:x.uploaderVerified,duration:x.duration}));
      }
      const match = matchMusicVideo(items,track); if (!match) throw new Error('No matching music video');
      const data = await fetchJSON(base+(kind === 'invidious' ? '/api/v1/videos/' : '/streams/')+match.id,6500,controller.signal);
      const details = {...match,title:data.title,channel:data.author || data.uploader,duration:data.lengthSeconds || data.duration || match.duration};
      if (!matchMusicVideo([details],track) || data.liveNow || data.livestream) throw new Error('Video metadata did not match');
      const formats = kind === 'invidious'
        ? (data.adaptiveFormats || []).filter(f=>/^\d{1,3}$/.test(String(f.itag))).map(f=>({url:publicMediaURL(f.url)||base+'/latest_version?id='+match.id+'&itag='+f.itag+'&local=true',mime:f.type || '',height:parseInt(f.qualityLabel || f.resolution,10),bitrate:f.bitrate,fps:f.fps}))
        : (data.videoStreams || []).filter(f=>f.videoOnly === true).map(f=>({url:f.url,mime:f.mimeType || '',codec:f.codec || '',height:f.height || parseInt(f.quality,10),bitrate:f.bitrate,fps:f.fps}));
      const format = chooseLoopFormat(formats,target); if (!format) throw new Error('No compatible video');
      return musicVideoLoop({kind:'music-video',engine:kind,instance:base,url:format.url,videoId:match.id,title:details.title,duration:details.duration,height:format.height});
    }).map(async promise=>{const value=await promise;if(!value)throw new Error('Invalid video');return value;}));
    videoLoopCache.set(key,{value:result,expires:Date.now()+5*60e3});
    if (videoLoopCache.size > 30) videoLoopCache.delete(videoLoopCache.keys().next().value);
    return result;
  } finally { clearTimeout(timer); controller.abort(); signal?.removeEventListener('abort',cancel); }
}

function kinds(s = getSettings().source) {
  if (s === 'soundcloud') return ['soundcloud'];
  if (s === 'ytrelay') return ['ytrelay'];
  if (s === 'jiosaavn') return ['jiosaavn'];
  if (s === 'hifi') return ['hifi'];
  if (s === 'piped') return ['piped'];
  if (s === 'invidious') return ['invidious'];
  if (s === 'audius') return ['audius'];
  if (s === 'youtube') return ['youtube'];
  // HiFi relays are inactive and public Invidious/Piped servers are blocked by YouTube (their links stall).
  return ['soundcloud', 'ytrelay', 'monochrome', 'jiosaavn'];
}

export async function previewStream(t) {
  // Signed preview URLs expire; refresh persisted tracks through the catalog when possible.
  let track = null;
  try {
    track = t.spotifyId || t.provider === 'spotify-import' || !/^\d+$/.test(String(t.id || ''))
      ? await matchCatalogTrack(t)
      : normTrack(await jsonp(`/track/${encodeURIComponent(t.id)}`));
  } catch (e) {
    if (/^https:\/\//.test(t?.preview || '')) track = t;
    else {
      const alt = await itunesPreview(t).catch(() => null);
      if (alt) return alt;
      throw e;
    }
  }
  if (!track?.preview) {
    const alt = await itunesPreview(t).catch(() => null);
    if (alt) return alt;
    throw new Error('No preview is available for this song');
  }
  return { url: track.preview, mime: 'audio/mpeg', bitrate: 128000, kind: 'preview', engineLabel: 'Deezer', instance: DEEZER, preview: true, alternatives: [] };
}

async function itunesPreview(t) {
  const d = await fetchJSON(`https://itunes.apple.com/search?term=${encodeURIComponent(query(t))}&media=music&entity=song&limit=8`, 2200);
  const items = (d?.results || []).filter((x) => /^https:\/\//.test(x?.previewUrl || '')).map((x) => ({
    id: String(x.trackId || ''),
    title: x.trackName || '',
    channel: x.artistName || '',
    duration: Math.round((Number(x.trackTimeMillis) || 0) / 1000),
    previewUrl: x.previewUrl,
    verified: true,
  }));
  const matched = best(items, t);
  if (!matched.length) return null;
  return { url: matched[0].previewUrl, mime: 'audio/mp4', bitrate: 256000, kind: 'preview', engineLabel: 'iTunes AAC preview', instance: 'https://itunes.apple.com', preview: true, alternatives: [] };
}

// Uploads a label blocked from playing outside YouTube (errors 101/150). Remembered so each costs time once.
const BLOCKED_KEY = 'spotplus.ytBlocked';
let blockedEmbeds = null;
const blockedSet = () => {
  if (!blockedEmbeds) { try { blockedEmbeds = new Set(JSON.parse(globalThis.localStorage?.getItem(BLOCKED_KEY) || '[]')); } catch { blockedEmbeds = new Set(); } }
  return blockedEmbeds;
};
export function markEmbedBlocked(id) {
  if (!/^[\w-]{11}$/.test(String(id || ''))) return;
  const set = blockedSet(); set.delete(id); set.add(id);
  try { globalThis.localStorage?.setItem(BLOCKED_KEY, JSON.stringify([...set].slice(-600))); } catch { /* storage full */ }
}
/** The upload that actually played: try it first next time. */
export function rememberEmbed(t, id) {
  if (!t?.id || !/^[\w-]{11}$/.test(String(id || ''))) return;
  const old = getVideoCache(t.id);
  if (old?.manual && old.id !== id) return;
  setVideoCache(t.id, { id, manual: !!old?.manual, matchVersion: 3, embedOk: true });
}
const NOT_THE_SONG = /\b(cover|karaoke|instrumental|8d|slowed|sped ?up|nightcore|reverb|bass ?boost|1 ?hour|loop|reaction|tutorial|lesson|piano version|guitar version)\b/i;
const foldText = (v) => String(v || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\([^)]*\)|\[[^\]]*\]/g, ' ').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
/** A wider net for YouTube's player: lyric videos, music videos, and live uploads of the same song. */
export function looseEmbedMatches(items, t) {
  const title = foldText(t.searchTitle || t.title), artistWords = foldText(t.artist).split(' ').filter((w) => w.length > 2);
  const own = `${t.title} ${t.album || ''}`;
  return (items || []).filter((x) => {
    const name = foldText(x?.title), who = foldText(`${x?.title} ${x?.channel || x?.author || ''}`);
    if (!/^[\w-]{11}$/.test(String(x?.id || '')) || !title || !name.includes(title)) return false;
    if (artistWords.length && !artistWords.some((w) => who.includes(w))) return false;
    if (NOT_THE_SONG.test(x.title) && !NOT_THE_SONG.test(own)) return false;
    if (/\bremix\b/i.test(x.title) && !/\bremix\b/i.test(own)) return false;
    const d = Number(x.duration || x.lengthSeconds) || 0, want = Number(t.duration) || 0;
    return !(d && want && (d < want * 0.8 || d > want * 1.6));
  });
}
/** More uploads to try after every candidate was blocked; empty when there are none left. */
export async function moreEmbedCandidates(t, tried = [], signal) {
  const skip = new Set([...tried, ...blockedSet()]);
  // Lyric videos are uploaded by fan channels and are almost never blocked outside YouTube.
  const lookups = [[query(t), ''], [query(t), '&type=video'], [query(t) + ' lyrics', '']].map(async ([q, extra]) => {
    const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), 3500);
    try {
      const r = await fetch(MATCH_ENDPOINT + '?q=' + encodeURIComponent(q) + extra, {signal: signal ? AbortSignal.any([signal, ctl.signal]) : ctl.signal, credentials: 'omit'});
      return r.ok ? ((await r.json()).items || []) : [];
    } catch { return []; } finally { clearTimeout(timer); }
  });
  const all = (await Promise.all(lookups)).flat();
  return uniq(looseEmbedMatches(all, t).map((x) => x.id)).filter((id) => !skip.has(id)).slice(0, 8);
}

function youtubeEmbedStream(matches, t) {
  const blocked = blockedSet(), known = getVideoCache(t.id);
  let ids = uniq([...(known?.embedOk ? [known.id] : []), ...(matches || []).map((m) => m?.id)].filter((id) => /^[\w-]{11}$/.test(id || '')));
  // Skip uploads that already refused to play here; keep them only if nothing else is left.
  const open = ids.filter((id) => !blocked.has(id));
  if (open.length) ids = open;
  if (!ids.length) return null;
  if (known?.id !== ids[0]) setVideoCache(t.id, { id: ids[0], manual: !!known?.manual, matchVersion: 3 });
  return {
    url: `https://www.youtube.com/embed/${ids[0]}`,
    videoId: ids[0],
    videoIds: ids,
    mime: 'audio/mp4',
    bitrate: 128000,
    kind: 'youtube-embed',
    instance: 'youtube.com',
    alternatives: [],
  };
}

/** Find a playable audio URL for a track. Returns { url, mime, bitrate, videoId, instance, kind }. */
async function resolveUncached(t, { skip = [], signal, cors = false, allowEmbed = false, fullOnly = false } = {}, _retry = false) {
  const set = getSettings();
  if (t.local) throw new Error('This local file is no longer stored on this device. Import it again.');
  if (set.source === 'preview' || set.source === 'deezer') {
    if (fullOnly) throw new Error('Preview mode cannot probe full audio.');
    return previewStream(t);
  }

  const stored = getVideoCache(t.id);
  const cached = stored?.manual || stored?.matchVersion === 3 ? stored : null;
  const control = new AbortController();
  const isAuto = set.source === 'auto';
  const deadline = setTimeout(() => control.abort(), isAuto ? 14000 : 16000);
  const combined = signal ? AbortSignal.any([signal, control.signal]) : control.signal;
  // Ask the shared lookup once; every server below can skip its own search when it answers first.
  let sharedMatches = cached ? [cached] : null;
  const shared = cached ? null : bridgeMatches(t, combined).then((m) => { sharedMatches = m; return m; });
  shared?.catch(() => {});

  if (set.source === 'youtube') {
    try {
      if (!allowEmbed) throw new Error('YouTube player requires interactive playback.');
      const matches = cached ? [cached] : await shared;
      const embed = youtubeEmbedStream(matches, t);
      if (embed) return embed;
    } catch (e) {
      if (signal?.aborted) throw new DOMException('Playback cancelled', 'AbortError');
      if (isAuto) { /* unreachable here */ }
      else if (allowEmbed && _retry !== 'catalog') {
        const canonical = await canonicalTrack(t).catch(() => null);
        if (canonical) return resolveUncached({ ...t, title: canonical.title, searchTitle: canonical.searchTitle || canonical.title, artist: canonical.artist, duration: t.duration || canonical.duration }, { skip, signal, cors, allowEmbed }, 'catalog');
      }
      if (!allowEmbed) throw e;
    } finally { clearTimeout(deadline); }
    throw new Error('Could not find a playable YouTube recording for this track.');
  }

  const inst = await instances();
  // Fast path: Invidious servers have a fixed audio address for every recording. With the recording
  // known (saved, or from the shared lookup) and a server that worked for you recently, start playing
  // right away instead of asking a server for the audio links first. Failures fall back to the full search.
  if (!_retry && !skip.length) {
    try {
      const fast = await fastStream(t, { cached, shared, set, cors, skip, signal: combined });
      if (fast) { clearTimeout(deadline); return fast; }
    } catch { /* use the full search */ }
  }
  const hasCustom = !!(set.customPiped?.trim() || set.customInvidious?.trim() || set.customHifi?.trim());
  const perKind = isAuto && !hasCustom ? 4 : 8;
  const reqMs = isAuto && !hasCustom ? 2000 : 3200;
  const raceControl = new AbortController();
  const raceSignal = AbortSignal.any([combined, raceControl.signal]);
  const raceCap = isAuto && !hasCustom ? setTimeout(() => raceControl.abort(), 3500) : null;
  try {
    const activeKinds = kinds(set.source);
    const ytKinds = activeKinds.filter((k) => ['piped', 'invidious'].includes(k));
    const streamGroups = ytKinds.map((kind) => orderedInstances(kind, inst, set).slice(0, perKind).map((base) => ({ kind, base })));
    const sources = [];
    if (activeKinds.includes('soundcloud') || activeKinds.includes('ytrelay')) checkSoundcloud();
    if (activeKinds.includes('ytrelay') && !skip.includes(RELAY_BASE) && relayOff <= Date.now()) sources.push({ kind: 'ytrelay', base: RELAY_BASE });
    if (activeKinds.includes('soundcloud') && !skip.includes(SC_BASE) && scOff <= Date.now()) sources.push({ kind: 'soundcloud', base: SC_BASE });
    if (activeKinds.includes('monochrome') && !skip.includes(MONO_BASE)) sources.push({ kind: 'monochrome', base: MONO_BASE });
    if (activeKinds.includes('jiosaavn')) {
      for (const base of orderedInstances('jiosaavn', inst, set).slice(0, 2)) {
        if (!skip.includes(base)) sources.push({ kind: 'jiosaavn', base });
      }
    }
    if (activeKinds.includes('hifi')) {
      refreshHifiRegistry(false).catch(() => {});
      for (const base of orderedInstances('hifi', inst, set).slice(0, hasCustom ? 6 : 3)) {
        if (!skip.includes(base)) sources.push({ kind: 'hifi', base });
      }
    }
    for (let i = 0; i < perKind; i++) for (const group of streamGroups) if (group[i] && !skip.includes(group[i].base)) sources.push(group[i]);
    if (activeKinds.includes('audius') && !skip.includes('https://api.audius.co')) sources.push({ kind: 'audius', base: 'https://api.audius.co' });

    const directRace = raceAudioSources(sources, async ({ kind, base }) => {
      raceSignal.throwIfAborted();
      const began = performance.now();
      try {
        let value;
        if (kind === 'soundcloud') value = await soundcloudStream(t, raceSignal);
        else if (kind === 'ytrelay') value = await relayStream(t, raceSignal, sharedMatches?.length ? sharedMatches : await (shared || Promise.resolve([])));
        else if (kind === 'monochrome') value = await monochromeStream(base, t, raceSignal, reqMs);
        else if (kind === 'audius') value = await audiusStream(t, raceSignal);
        else if (kind === 'jiosaavn') value = await jiosaavnStream(base, t, raceSignal, reqMs);
        else if (kind === 'hifi') value = await hifiStream(base, t, raceSignal, reqMs);
        else value = await attemptServer(kind, base);

        recordSpeed(base, performance.now() - began, true);
        if (cors && !(await corsOK(value.url))) {
          const alt = (value.alternatives || []).find((x) => x.url);
          if (alt && await corsOK(alt.url)) value = { ...value, ...alt, alternatives: [] };
          else throw new Error('Effects not supported by this server');
        }
        return value;
      } catch (error) {
        if (!raceSignal.aborted) recordSpeed(base, performance.now() - began, false, { fatal: isFatalHttp(error) });
        throw error;
      }
    }, { signal: raceSignal, quality: set.quality, concurrency: 8, qualityWait: 180 });
    // Auto: full song through YouTube's official player if no direct server answers quickly.
    let embedTimer = 0;
    const embedFallback = isAuto && allowEmbed && !cors && shared !== undefined ? new Promise((resolve, reject) => {
      const wait = embedWait(t);
      let fired = false;
      const fire = async () => {
        if (fired) return; fired = true; clearTimeout(embedTimer);
        try {
          const matches = sharedMatches?.length ? sharedMatches : await (shared || Promise.reject(new Error('no lookup')));
          const embed = youtubeEmbedStream(matches, t);
          embed ? resolve(embed) : reject(new Error('no embed'));
        } catch (e) { reject(e); }
      };
      embedTimer = setTimeout(fire, wait);
      // Every direct server already failed: start YouTube's player now instead of waiting.
      directRace.catch(() => { directDown = Date.now() + 10 * 60e3; fire(); });
    }) : null;
    directRace.then(() => { directDown = 0; }, () => {});
    let result;
    try { result = embedFallback ? await Promise.any([directRace, embedFallback]) : await directRace; }
    finally { clearTimeout(embedTimer); }
    if (result.kind === 'youtube-embed') { raceControl.abort(); directRace.catch(() => { directDown = Date.now() + 10 * 60e3; }); }
    async function attemptServer(kind, base) {
      router.claimHalfOpen(base);
      const choices = cached ? [cached] : (await Promise.any([shared, ENGINES[kind].search(base, t, raceSignal, reqMs)].filter(Boolean))).slice(0, 2);
      for (const choice of choices) {
        try {
          const stream = await ENGINES[kind].stream(base, choice.id, raceSignal, cached?.manual ? null : t, reqMs);
          raceSignal.throwIfAborted();
          const candidate = { ...stream, videoId: choice.id, instance: base, kind };
          const check = validateSourceCandidate(candidate, { canPlay: mime => !!probe?.canPlayType(mime) });
          if (!check.ok) throw new Error('Incompatible stream candidate');
          return candidate;
        } catch (error) {
          raceSignal.throwIfAborted();
          const videoError = /Recording did not match|no audio streams|No compatible audio format|Incompatible stream|HTTP 404/i.test(error?.message || '');
          if (!videoError || choice === choices.at(-1)) throw error;
        }
      }
    }
    combined.throwIfAborted();
    if (result.videoId) setVideoCache(t.id, { id: result.videoId, manual: !!cached?.manual, matchVersion: 3 });
    return result;
  } catch {
    if (signal?.aborted) throw new DOMException('Playback cancelled', 'AbortError');
    if (cached && !cached.manual && !_retry) { setVideoCache(t.id, null); return resolveUncached(t, { skip, signal, cors, allowEmbed, fullOnly }, true); }
    if (!skip.length && _retry !== 'bridge' && streamDown <= Date.now() && router.isAvailable(STREAM_ENDPOINT)) {
      try {
        const matches = sharedMatches?.length ? sharedMatches : (shared ? await Promise.race([shared, new Promise((_, rej) => setTimeout(() => rej(new Error('slow')), 1200))]) : []);
        const vid = matches?.[0]?.id;
        if (vid) {
          const bridged = await bridgeStream(vid, { signal, preferAac: prefersAac() || set.quality === 'low', timeoutMs: 1200 });
          if (bridged && (!cors || await corsOK(bridged.url))) {
            setVideoCache(t.id, { id: vid, manual: false, matchVersion: 3 });
            return bridged;
          }
        }
      } catch { /* fall through */ }
    }
    if (!sharedMatches?.length && _retry !== 'catalog') {
      const canonical = await canonicalTrack(t).catch(() => null);
      if (canonical) return resolveUncached({ ...t, title: canonical.title, searchTitle: canonical.searchTitle || canonical.title, artist: canonical.artist, duration: t.duration || canonical.duration }, { skip, signal, cors, allowEmbed, fullOnly }, 'catalog');
    }
    if (isAuto && allowEmbed && !cors) {
      directDown = Date.now() + 10 * 60e3;
      const matches = sharedMatches?.length ? sharedMatches : await (shared ? Promise.race([shared, new Promise((_, rej) => setTimeout(() => rej(new Error('slow')), 2500))]).catch(() => null) : null);
      const embed = youtubeEmbedStream(matches, t);
      if (embed) return embed;
    }
    // No 30-second clips in Automatic: give the relay one last, patient try (YouTube's bot check on the server
    // comes and goes), then report the song as unavailable so the player can move on.
    if (isAuto && !fullOnly && kinds(set.source).includes('ytrelay') && relayOff <= Date.now() && !skip.includes(RELAY_BASE)) {
      const matches = sharedMatches?.length ? sharedMatches : await (shared ? shared.catch(() => []) : []);
      // Wider net, as when uploads are unavailable here: lyric videos and other uploads of the same song.
      const wider = await moreEmbedCandidates(t, matches.map((m) => m?.id), signal).catch(() => []);
      for (const [wait, list] of [[0, wider.map((id) => ({id}))], [1500, matches]]) {
        if (wait) await new Promise((ok) => setTimeout(ok, wait));
        if (signal?.aborted || !list.length) continue;
        try { return await relayStream(t, signal, list); } catch { /* next round */ }
      }
    }
    throw new Error('No audio server answered. Try Deezer, JioSaavn, HiFi, Audius, your own server in Settings, or a local audio file.');
  } finally { clearTimeout(raceCap); clearTimeout(deadline); control.abort(); }
}

function previewSource(url) {
  return /^https:\/\//.test(url || '') ? { url, mime: 'audio/mpeg', bitrate: 128000, kind: 'preview', engineLabel: 'Deezer', instance: DEEZER, preview: true, alternatives: [] } : null;
}

/** When every full-track server is down, start the catalog sample so the song is not a dead error. */
async function previewRescue(t) {
  const fresh = await previewStream(t).catch(() => null);
  if (fresh?.url) return fresh;
  const ready = previewSource(t?.preview);
  if (ready) return ready;
  if (!globalThis.document?.head) {
    return itunesPreview(t).catch(() => null);
  }
  let timer;
  const timeout = new Promise((resolve) => {
    timer = setTimeout(() => resolve(null), 2000);
  });
  try {
    const direct = await Promise.race([previewStream(t).catch(() => null), timeout]);
    if (direct?.url) return direct;
    const found = await Promise.race([
      (async () => {
        const rows = data(await jsonp('/search', { q: `${t.artist} ${t.searchTitle || t.title}`, limit: 8 })).map((x) => normTrack(x));
        return rows.find((x) => previewSource(x.preview) && best([{ title: x.title, channel: x.artist, duration: x.duration, verified: true }], t).length) || null;
      })(),
      timeout,
    ]);
    if (found?.preview) return previewSource(found.preview);
    return await Promise.race([itunesPreview(t).catch(() => null), timeout]);
  } catch { return null; } finally { clearTimeout(timer); }
}

export const FAST_ITAGS={opus:251,aac:140};
// Servers that stuttered recently aren't used for fast starts (they stream audio through themselves).
const choppy=new Map();
export function reportChoppy(source){if(source?.fast&&source.instance){choppy.set(source.instance,Date.now()+3*3600e3);router.recordPlayback(source.instance,{stalled:true});memoryEngine.forgetByInstance(source.instance);}}
// H.264 video itags by height: plays everywhere, including iPhone.
export const VIDEO_ITAGS={1080:137,720:136,480:135,360:134};
/** Loops, fast path: one cached search for the official video, then a fixed address on a server that works for you. */
export async function fastVideoLoop(track,{signal,skip=[],target=720}={}){
  const base=lastGood().invidious;
  if(!base||skip.includes(base)||(failedInstances.get(base)||0)>Date.now()||matchDown>Date.now())return null;
  const ctl=new AbortController(),timer=setTimeout(()=>ctl.abort(),1800);
  try{
    const r=await fetch(MATCH_ENDPOINT+'?type=video&q='+encodeURIComponent(query(track)),{signal:signal?AbortSignal.any([signal,ctl.signal]):ctl.signal,credentials:'omit'});
    if(!r.ok)return null;
    const match=matchMusicVideo((await r.json()).items||[],track);
    if(!match)return null;
    const height=[1080,720,480,360].find(h=>h<=target)||360;
    return musicVideoLoop({kind:'music-video',engine:'invidious',instance:base,url:`${base}/latest_version?id=${match.id}&itag=${VIDEO_ITAGS[height]}&local=true`,videoId:match.id,title:match.title,duration:match.duration,height,fast:true});
  }catch{return null;}finally{clearTimeout(timer);}
}
const isAllowedCustomOrigin = (u) => /^https:\/\//.test(u) || /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?(\/|$)/.test(u);
function mirrorBases(set, skip, includeFallback = false) {
  const custom = (set.customInvidious || '').split(/[\s,]+/).map(clean).filter(isAllowedCustomOrigin);
  const now = Date.now();
  const list = includeFallback ? [...custom, lastGood().invidious, ...INV_FALLBACK] : [...custom, lastGood().invidious];
  const raw = uniq(list).filter(base =>
    base && !skip.includes(base) && (failedInstances.get(base) || 0) <= now && (choppy.get(base) || 0) <= now && router.isAvailable(base));
  return router.rank(raw, { custom });
}
/** Direct audio URLs for a known recording — no extra “get the links” request. */
export function instantMirrors(videoId, bases, { opus = false } = {}) {
  const itag = opus ? FAST_ITAGS.opus : FAST_ITAGS.aac;
  const mime = opus ? 'audio/webm; codecs="opus"' : 'audio/mp4';
  return bases.map(base => ({
    url: `${base}/latest_version?id=${videoId}&itag=${itag}&local=true`,
    mime,
    bitrate: opus ? 160000 : 128000,
    kind: 'invidious',
    instance: base,
    videoId,
    fast: true,
  }));
}
async function fastStream(t,{cached,shared,set,cors,skip,signal}){
  // Unchecked mirror links: public Invidious servers are mostly down, and a dead link costs seconds of
  // silence before the stall check gives up. Auto uses checked servers and YouTube's player instead.
  if(['auto','piped','audius','preview','deezer','youtube','jiosaavn','hifi'].includes(set.source))return null;
  const customMirrors = (set.customInvidious || '').split(/[\s,]+/).map(clean).filter(isAllowedCustomOrigin);
  const hasMirrorCandidate = !!(customMirrors.length || lastGood().invidious);
  const bridgeReady = !cors && streamDown <= Date.now() && router.isAvailable(STREAM_ENDPOINT);
  if (!hasMirrorCandidate && !bridgeReady) return null;
  let id=cached?.id;
  // Don't sit on a slow match: a cached recording starts immediately, a fresh one waits briefly.
  if(!id&&shared){
    let slowTimer;
    try{id=(await Promise.race([shared,new Promise((_,reject)=>{slowTimer=setTimeout(()=>reject(new Error('slow')),900);})]))[0]?.id;}
    catch{id=null;}finally{clearTimeout(slowTimer);}
  }
  if(!id||!/^[\w-]{11}$/.test(id))return null;
  signal?.throwIfAborted();
  const opus=!prefersAac()&&set.quality!=='low'&&!!probe?.canPlayType('audio/webm; codecs="opus"');
  const mirrors=instantMirrors(id, mirrorBases(set, skip, false), {opus});
  // Give the Cloudflare /stream bridge a short, abortable head start; fall back to verified mirrors if slow/offline.
  let bridged = null;
  if (bridgeReady) {
    bridged = await bridgeStream(id, { signal, preferAac: !opus, timeoutMs: 650 });
  }
  if(!cached?.id)setVideoCache(t.id,{id,manual:false,matchVersion:3});
  const asAlt=source=>({url:source.url,mime:source.mime,bitrate:source.bitrate,instance:source.instance,kind:source.kind,fast:true,videoId:id});
  if(bridged?.url){
    const extraMirrors=instantMirrors(id, mirrorBases(set, skip, true), {opus}).map(asAlt);
    return {...bridged,alternatives:[...(bridged.alternatives||[]),...extraMirrors]};
  }
  const [first,...rest]=mirrors;
  if(!first)return null;
  if(cors&&!(await corsOK(first.url)))return null;
  const alternatives=rest.map(asAlt);
  if(opus)alternatives.unshift({url:first.url.replace(`itag=${FAST_ITAGS.opus}`,`itag=${FAST_ITAGS.aac}`),mime:'audio/mp4',bitrate:128000,instance:first.instance,kind:'invidious',fast:true,videoId:id});
  return {...first,alternatives};
}

// Keep short-lived results in L1 memory + L2 IndexedDB without synchronous localStorage blocking.
const warmups=new Map(),warmControllers=new Map();
export const streamKey=(t,s=getSettings(),videoId=getVideoCache(t.id)?.id||'')=>[t.id,s.source,s.quality,s.customPiped,s.customInvidious,s.customHifi,videoId,prefersAac()?'aac':'any'].join('|');
export function streamExpiry(url,now=Date.now()){
  return memoryEngine.computeExpiry(url,now);
}
function remember(key,stream){
  memoryEngine.putStream(key,stream);
}
function cachedStream(key){
  const stream=memoryEngine.getStream(key);
  if(!stream)return null;
  if((failedInstances.get(stream.instance)||0)>Date.now()||!router.isAvailable(stream.instance))return null;
  const check=validateSourceCandidate(stream,{canPlay:mime=>!!probe?.canPlayType(mime)});
  if(!check.ok){memoryEngine.forgetStream(key);return null;}
  return stream;
}
function forget(key){memoryEngine.forgetStream(key);}
export function clearStreamCache(){streamDown=0;matchDown=0;failedInstances.clear();choppy.clear();router.reset();memoryEngine.clearStreams();for(const c of warmControllers.values())c.abort();warmups.clear();warmControllers.clear();}
export function cancelPrewarm(except) {
  const keep = except && streamKey(except);
  for (const [key,controller] of warmControllers) if (key !== keep) { controller.abort(); warmControllers.delete(key); warmups.delete(key); }
}
function abortable(promise,signal) {
  if (!signal) return promise;
  signal.throwIfAborted();
  return new Promise((resolve,reject)=>{
    const cancel=()=>reject(new DOMException('Playback cancelled','AbortError'));
    signal.addEventListener('abort',cancel,{once:true});
    promise.then(resolve,reject).finally(()=>signal.removeEventListener('abort',cancel));
  });
}
const connectedOrigins=new Set();
function preconnect(url) {
  if (!globalThis.document?.head || !/^https:\/\//.test(url || '')) return;
  const origin=new URL(url).origin;
  if (connectedOrigins.has(origin) || connectedOrigins.size>=12) return;
  connectedOrigins.add(origin);
  const link=document.createElement('link');link.rel='preconnect';link.href=origin;link.crossOrigin='anonymous';document.head.append(link);
}
export function warmConnections(){
  preconnect(MATCH_ENDPOINT);
  preconnect(MONO_BASE);
  preconnect('https://saavn.sumit.co');
  preconnect('https://aac.saavncdn.com');
  preconnect('https://api.audius.co');
  preconnect('https://cdnt-preview.dzcdn.net');
  for (const base of Object.values(lastGood())) preconnect(base);
}
export async function resolve(t,options={}) {
  // Podcasts and audiobooks come with their own direct audio link.
  if(t?.direct){options.signal?.throwIfAborted();return {url:t.direct,mime:t.mime||'audio/mpeg',bitrate:128000,kind:'direct',instance:host(t.direct),cacheLayer:'direct'};}
  const settings=getSettings(),allowEmbed=!!(options.allowEmbed&&settings.source==='youtube'),key=streamKey(t,settings);
  let hit=!options.skip?.length&&cachedStream(key);
  // A saved 30-second clip must not block a new search for the full song.
  if(hit?.preview && settings.source==='auto') hit=null;
  if(hit&&(!options.fullOnly||(!hit.preview&&hit.kind!=='youtube-embed'))&&(allowEmbed||hit.kind!=='youtube-embed')&&(!options.cors||(hit.kind!=='youtube-embed'&&await corsOK(hit.url)))){options.signal?.throwIfAborted();return {...hit,cacheLayer:'memory'};}
  if(options.skip?.length)forget(key);
  const warm=warmups.get(key);
  if(warm&&!options.skip?.length){try {const stream=await abortable(warm,options.signal);options.signal?.throwIfAborted();if(!(stream.preview&&settings.source==='auto')&&(!options.fullOnly||(!stream.preview&&stream.kind!=='youtube-embed'))&&(allowEmbed||stream.kind!=='youtube-embed')&&(!options.cors||(stream.kind!=='youtube-embed'&&await corsOK(stream.url)))){const check=validateSourceCandidate(stream,{canPlay:mime=>!!probe?.canPlayType(mime),requireCors:options.cors,corsKnown:knownCors});if(check.ok)return {...stream,cacheLayer:'prewarm'};}}catch {options.signal?.throwIfAborted();}}
  // With effects on, prefer servers that allow them; if none do, play the song normally.
  let stream;
  const opts={...options,allowEmbed};
  if(opts.cors){try{stream=await resolveUncached(t,opts);}catch(e){if(opts.signal?.aborted)throw e;stream=await resolveUncached(t,{...opts,cors:false});}
    // No effects-friendly full song: play the whole song without effects rather than a 30-second clip.
    if(stream?.preview&&allowEmbed){try{const full=await resolveUncached(t,{...opts,cors:false});if(!full.preview)stream=full;}catch(e){if(opts.signal?.aborted)throw e;}}}
  else stream=await resolveUncached(t,opts);
  opts.signal?.throwIfAborted();
  remember(streamKey(t,settings,stream.videoId||getVideoCache(t.id)?.id||''),stream);
  if(stream.kind!=='youtube-embed')preconnect(stream.url);
  return {...stream,cacheLayer:'network'};
}
/** Never substitute a 30-second catalog clip when probing for full-length audio. */
export async function resolveFull(t, options = {}) {
  if (['preview', 'deezer'].includes(getSettings().source)) return null;
  const source = await resolve(t, {...options, fullOnly:true, allowEmbed:false});
  return source?.preview || source?.kind === 'youtube-embed' ? null : source;
}
export async function resolveEquivalent(t, options = {}) {
  const candidate = await resolve(t, options);
  if (candidate.kind === 'youtube-embed') return candidate;
  if (!isVerifiedEquivalent(t, candidate)) {
    throw new Error('Could not find a verified equivalent recording.');
  }
  return candidate;
}
let embedHook=null;
/** The player boots YouTube's player early when a prewarm finds a song's video. */
export function onEmbedFound(fn){embedHook=typeof fn==='function'?fn:null;}
export function prewarm(t){
  if(!t||t.local||t.direct||navigator.connection?.saveData||/2g/.test(navigator.connection?.effectiveType||''))return;
  const settings=getSettings(),allowEmbed=settings.source==='youtube',key=streamKey(t,settings);if(warmups.has(key))return warmups.get(key);
  const hit=cachedStream(key);if(hit&&!(hit.preview&&settings.source==='auto')&&(allowEmbed||hit.kind!=='youtube-embed')){if(hit.kind==='youtube-embed')try{embedHook?.(hit.videoId);}catch{}return Promise.resolve({...hit,cacheLayer:'memory'});}
  warmConnections();
  // Keep up to three predictive resolves (restore + next + next+1).
  if(warmControllers.size>=3){const oldest=warmControllers.keys().next().value;warmControllers.get(oldest).abort();warmControllers.delete(oldest);warmups.delete(oldest);}
  const controller=new AbortController();warmControllers.set(key,controller);
  const promise=resolveUncached(t,{signal:controller.signal,allowEmbed}).then(stream=>{controller.signal.throwIfAborted();if(stream.kind==='youtube-embed')try{embedHook?.(stream.videoId);}catch{}remember(streamKey(t,settings,stream.videoId||getVideoCache(t.id)?.id||''),stream);if(stream.kind!=='youtube-embed')preconnect(stream.url);return stream;}).finally(()=>{if(warmControllers.get(key)===controller){warmups.delete(key);warmControllers.delete(key);}});
  warmups.set(key,promise);promise.catch(()=>{});
  return promise;
}
/** Resolve the next few queued songs so InstantPlay skip/next already has URLs. */
export function prewarmAhead(tracks){
  if(!Array.isArray(tracks)||!tracks.length)return;
  for(const track of tracks.slice(0,2))prewarm(track);
}
/** The catalog's spelling of a song (same title, sharing an artist name), or null. */
export async function canonicalTrack(t){
  const first=String(t.artist||'').split(/\s*(?:,|&|\bfeat\.?|\bft\.?|\sx\s)\s*/i)[0].trim();
  const fold=s=>String(s||'').normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/\([^)]*\)/g,'').replace(/[^\p{L}\p{N}]/gu,'');
  const words=s=>String(s||'').normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(w=>w.length>2);
  const mine=new Set(words(t.artist));
  const result=data(await jsonp('/search',{q:`${first} ${t.searchTitle||t.title}`,limit:15})).map(x=>normTrack(x));
  const hit=result.find(x=>fold(x.title)===fold(t.searchTitle||t.title)&&words(x.artist).some(w=>mine.has(w))&&fold(x.artist)!==fold(t.artist));
  return hit||null;
}
export async function matchCatalogTrack(t){
  const result=data(await jsonp('/search',{q:`${t.artist} ${t.title}`,limit:20})).map(x=>normTrack(x));
  const clean=s=>String(s).toLowerCase().replace(/[^\p{L}\p{N}]/gu,'');
  const match=result.find(x=>clean(x.title)===clean(t.title)&&clean(x.artist)===clean(t.artist));
  if(!match)throw new Error('No matching preview was found. Use a full audio source or open this track in Spotify.');
  return match;
}

/** Other YouTube matches for a track, for when the automatic match is wrong. */
export async function candidates(t) {
  try {
    const matches = await bridgeMatches(t);
    if (matches?.length) return matches.slice(0, 8);
  } catch { /* The public match service is down. Try the other catalogs. */ }
  const inst = await instances();
  const set = getSettings();
  for (const kind of kinds()) {
    if(!ENGINES[kind])continue;
    for (const base of orderedInstances(kind, inst, set).slice(0, 4)) {
      try { return (await ENGINES[kind].search(base, t)).slice(0, 10); } catch {}
    }
  }
  throw new Error('Could not search for alternatives right now');
}

/** Quick health check of JioSaavn, HiFi, Audius, Deezer, Piped, and Invidious sources. */
export async function testInstances() {
  const [inst] = await Promise.all([instances(true), refreshHifiRegistry(true).catch(() => {})]);
  const set = getSettings();
  const VID = 'jNQXAC9IVRw';
  const PROBE_TRACK = { id: 'probe-1', title: 'Blinding Lights', artist: 'The Weeknd', duration: 200 };
  const out = [];
  await Promise.all([
    ...orderedInstances('jiosaavn', inst, set).slice(0, 2).map(async (base) => {
      const t0 = performance.now();
      try {
        await jiosaavnStream(base, { id: 'probe-saavn', title: 'Kesariya', artist: 'Arijit Singh', duration: 268 }, undefined, 3000);
        out.push({ kind: 'jiosaavn', base, ok: true, ms: Math.round(performance.now() - t0) });
      } catch (e) { out.push({ kind: 'jiosaavn', base, ok: false, err: e.message }); }
    }),
    ...orderedInstances('hifi', inst, set).slice(0, 3).map(async (base) => {
      const t0 = performance.now();
      try {
        await hifiStream(base, PROBE_TRACK, undefined, 3000);
        out.push({ kind: 'hifi', base, ok: true, ms: Math.round(performance.now() - t0) });
      } catch (e) { out.push({ kind: 'hifi', base, ok: false, err: e.message }); }
    }),
    (async () => {
      const t0 = performance.now();
      try {
        await fetchJSON('https://api.audius.co/v1/tracks/trending?limit=1&app_name=SpotPlus', 3000);
        out.push({ kind: 'audius', base: 'https://api.audius.co', ok: true, ms: Math.round(performance.now() - t0) });
      } catch (e) { out.push({ kind: 'audius', base: 'https://api.audius.co', ok: false, err: e.message }); }
    })(),
    ...['piped', 'invidious'].flatMap((kind) =>
      orderedInstances(kind, inst, set).slice(0, 4).map(async (base) => {
        const t0 = performance.now();
        try { await ENGINES[kind].stream(base, VID, undefined, null, 3000); out.push({ kind, base, ok: true, ms: Math.round(performance.now() - t0) }); }
        catch (e) { out.push({ kind, base, ok: false, err: e.message }); }
      })),
  ]);
  return out.sort((a, b) => (a.ok ? 0 : 1) - (b.ok ? 0 : 1) || a.kind.localeCompare(b.kind) || (a.ms || 1e9) - (b.ms || 1e9));
}

/* =========================== Lyrics (LRCLib) =========================== */
function parseLRC(text) {
  const out = [];
  for (const line of String(text || '').split(/\r?\n/)) {
    const stamps = [...line.matchAll(/\[(\d+):(\d+(?:\.\d+)?)\]/g)];
    if (!stamps.length) continue;
    const words = line.replace(/\[[^\]]*\]/g, '').trim();
    for (const s of stamps) out.push({ t: +s[1] * 60 + +s[2], text: words });
  }
  return out.sort((a, b) => a.t - b.t);
}
const lyricCache = new Map();
export async function lyrics(t) {
  if (lyricCache.has(t.id)) return lyricCache.get(t.id);
  const shape = (r) => (r && (r.syncedLyrics || r.plainLyrics)
    ? { synced: r.syncedLyrics ? parseLRC(r.syncedLyrics) : null, plain: r.plainLyrics || null, instrumental: !!r.instrumental }
    : r && r.instrumental ? { synced: null, plain: null, instrumental: true } : null);
  let res = null;
  try {
    const p = new URLSearchParams({ artist_name: t.artist, track_name: t.searchTitle || t.title, album_name: t.album || '', duration: Math.round(t.duration || 0) });
    res = shape(await fetchJSON(`${LRCLIB}/get?${p}`));
  } catch {}
  if (!res) {
    try {
      const p = new URLSearchParams({ track_name: t.searchTitle || t.title, artist_name: t.artist });
      const arr = await fetchJSON(`${LRCLIB}/search?${p}`);
      const pick = (Array.isArray(arr) ? arr : [])
        .filter((x) => x.syncedLyrics || x.plainLyrics)
        .sort((a, b) => (!!b.syncedLyrics - !!a.syncedLyrics) || Math.abs(a.duration - t.duration) - Math.abs(b.duration - t.duration))[0];
      res = shape(pick);
    } catch {}
  }
  lyricCache.set(t.id, res);
  return res;
}

/* ---------------- Search by lyrics ----------------
   Like Spotify's lyric search: type a line you remember, get the song.
   Candidates come from Spot+'s Cloudflare worker (Genius lyric search) or, as a
   fallback, YouTube lyric videos. Every candidate is then checked against its real
   lyrics (LRCLIB), and the matching line is returned as the snippet. */
export const LYRICS_SEARCH_ENDPOINT = 'https://spot-plus-canvas.pwr97pnmkn.workers.dev/lyrics-search';
const words = value => String(value || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^\p{L}\p{N}' ]+/gu, ' ').split(/\s+/).filter(Boolean);
export function looksLikeLyrics(q) { return words(q).length >= 4; }
/** "Artist - Song (Official Lyric Video)" -> "Artist Song" for a catalog search. */
export function cleanLyricVideoTitle(title) {
  return String(title || '')
    .replace(/[([【][^)\]】]*(lyric|letra|official|audio|video|visuali[sz]er|hd|4k|remaster|explicit)[^)\]】]*[)\]】]/gi, ' ')
    .replace(/\b(lyrics?|lyric video|official (music )?video|with lyrics|letra)\b/gi, ' ')
    .replace(/["“”|]/g, ' ').replace(/\s+[-–—]\s+/g, ' ').replace(/\s+/g, ' ').trim();
}
/** Best-matching lyric line for the query, or null when the song doesn't contain it. */
export function matchingLine(lyricsText, q) {
  const want = words(q);
  if (!want.length || !lyricsText) return null;
  const lines = String(lyricsText).split('\n').map(line => line.replace(/^\[[^\]]*\]\s*/, '').trim()).filter(Boolean);
  let best = null, bestScore = 0;
  for (let i = 0; i < lines.length; i++) {
    const window = words(lines[i] + ' ' + (lines[i + 1] || '')), set = new Set(window);
    const score = want.filter(w => set.has(w)).length / want.length;
    if (score > bestScore) { bestScore = score; best = lines[i]; }
  }
  return bestScore >= 0.6 ? best : null;
}
const lyricSearchMemo = new Map();
async function lyricCandidates(q, signal) {
  try {
    const d = await fetchJSON(`${LYRICS_SEARCH_ENDPOINT}?q=${encodeURIComponent(q)}`, 4500, signal);
    const hits = (Array.isArray(d?.results) ? d.results : []).filter(r => r?.title && r?.artist).slice(0, 8);
    if (hits.length) return hits.map(r => ({query: `${r.artist} ${r.title}`, snippet: typeof r.snippet === 'string' ? r.snippet.slice(0, 200) : ''}));
  } catch (error) { if (signal?.aborted) throw error; }
  const inst = await instances(), set = getSettings();
  const bases = orderedInstances('invidious', inst, set).slice(0, 3);
  const found = await Promise.any(bases.map(async base => {
    const list = await fetchJSON(`${base}/api/v1/search?q=${encodeURIComponent(q + ' lyrics')}&type=video&fields=title,author`, 6000, signal);
    if (!Array.isArray(list) || !list.length) throw new Error('no results');
    return list;
  })).catch(() => []);
  return found.slice(0, 8).map(v => ({query: cleanLyricVideoTitle(v.title), snippet: ''})).filter(c => c.query.length > 2);
}
export async function lyricsSearch(q, {signal} = {}) {
  q = String(q || '').trim().slice(0, 200);
  if (!looksLikeLyrics(q)) return [];
  const key = q.toLowerCase();
  if (lyricSearchMemo.has(key)) return lyricSearchMemo.get(key);
  const job = (async () => {
    const candidates = await lyricCandidates(q, signal);
    const seen = new Set();
    const checked = await Promise.all(candidates.map(async c => {
      const track = data(await jsonp('/search/track', {q: c.query, limit: 1}).catch(() => null)).map(t => normTrack(t))[0];
      if (!track) return null;
      const text = await lyrics(track).catch(() => null);
      const line = matchingLine(text?.plain || (text?.synced || []).map(l => l.text).join('\n'), q);
      return line || c.snippet ? {...track, lyricSnippet: line || c.snippet, lyricVerified: !!line} : null;
    }));
    return checked.filter(t => t && !seen.has(t.id) && seen.add(t.id))
      .sort((a, b) => Number(b.lyricVerified) - Number(a.lyricVerified)).slice(0, 5);
  })();
  lyricSearchMemo.set(key, job);
  job.catch(() => lyricSearchMemo.delete(key));
  return job;
}

/* Rewind artwork: artist photos and song covers/previews by name (cached on device). */
export async function artistPicture(name) {
  const a = data(await jsonp('/search/artist', {q: name, limit: 1}).catch(() => null))[0];
  return a ? a.picture_xl || a.picture_big || a.picture_medium || '' : '';
}
export async function trackArtwork(artist, title) {
  const t = data(await jsonp('/search/track', {q: `${artist} ${title}`, limit: 1}).catch(() => null))[0];
  return t ? {cover: t.album?.cover_medium || '', coverXl: t.album?.cover_xl || t.album?.cover_big || '', preview: t.preview || ''} : null;
}

/** Newest releases for one artist (cheap: one request). */
export async function artistReleases(id) {
  return data(await jsonp(`/artist/${id}/albums`, { limit: 12 })).map(normAlbum);
}
/** Deezer artist ID for a name (for building mixes from listening history). */
export async function findArtist(name) {
  const hit = data(await jsonp('/search/artist', {q: name, limit: 1}))[0];
  return hit ? normArtist(hit) : null;
}

/* ----- Playlist generator helpers ----- */
export async function artistTop(id, limit = 40) { return data(await jsonp(`/artist/${id}/top`, {limit})).map(t => normTrack(t)); }
let genreList = null;
export async function genres() { genreList ||= data(await jsonp('/genre')).filter(g => g.id > 0).map(g => ({id: g.id, name: g.name, picture: g.picture_medium || ''})); return genreList; }
export async function genreArtists(id) { return data(await jsonp(`/genre/${id}/artists`, {limit: 12})).map(normArtist); }
export async function searchArtists(q, limit = 6) { return data(await jsonp('/search/artist', {q, limit})).map(normArtist); }
/** Songs from the best-matching public playlists for a phrase like "chill hip hop". */
export async function vibeTracks(q, playlists = 2) {
  const found = data(await jsonp('/search/playlist', {q, limit: playlists})).slice(0, playlists);
  const lists = await Promise.allSettled(found.map(p => jsonp(`/playlist/${p.id}/tracks`, {limit: 100})));
  return lists.flatMap(r => r.status === 'fulfilled' ? data(r.value).map(t => normTrack(t)) : []);
}
