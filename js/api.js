// api.js — Spot+ music API.
//   Metadata : Deezer public API (no key; JSONP so it works from any static site)
//   Audio    : public Piped / Invidious instances (the same idea Spotube uses: match the song on YouTube)
//   Lyrics   : LRCLib (time-synced)
// Requests go from the listener's browser to public providers; availability and CORS vary.
import { getSettings, getVideoCache, setVideoCache } from './store.js';
import {loopQuality} from './playback-policy.js';
import {rankAudioMatches,chooseAudioFormat,raceAudioSources} from './audio-selection.js';
import {corsOK} from './cors-probe.js';

const DEEZER = 'https://api.deezer.com';
const LRCLIB = 'https://lrclib.net/api';

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
    const done = () => { clearTimeout(timer); window[cb] = () => {}; s.remove(); setTimeout(() => { try { delete window[cb]; } catch {} }, 30000); };
    const timer = setTimeout(() => { done(); reject(new Error('Deezer took too long to answer')); }, 12000);
    window[cb] = (data) => { done(); if (data && data.error) reject(new Error(data.error.message || 'Deezer error')); else resolve(data); };
    s.onerror = () => { done(); reject(new Error('Could not reach Deezer')); };
    s.src = `${DEEZER}${path}?${qs}`;
    document.head.appendChild(s);
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

/* =========================== Audio (YouTube via Piped / Invidious) =========================== */
import {matchMusicVideo,chooseLoopFormat,musicVideoLoop,publicMediaURL} from './video-loops.js';
const PIPED_FALLBACK = [
  'https://pipedapi.kavin.rocks', 'https://pipedapi.adminforge.de', 'https://api.piped.private.coffee',
  'https://pipedapi.reallyaweso.me', 'https://pipedapi.leptons.xyz', 'https://pipedapi.nosebs.ru',
];
const INV_FALLBACK = [
  'https://yt.chocolatemoo53.com',
  'https://inv.nadeko.net', 'https://invidious.nerdvpn.de', 'https://iv.melmac.space',
  'https://invidious.privacyredirect.com', 'https://yt.artemislena.eu', 'https://invidious.f5.si',
];

async function fetchJSON(url, ms = 9000, signal) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), ms);
  try {
    const r = await fetch(url, { signal: signal ? AbortSignal.any([signal, ctl.signal]) : ctl.signal });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
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

let instancePromise = null;
let instanceSnapshot = null;
export function instances(force = false) {
  if (!instanceSnapshot) {
    try { instanceSnapshot = JSON.parse(localStorage.getItem('spotplus.instances') || 'null'); } catch {}
    if (!Array.isArray(instanceSnapshot?.piped) || !Array.isArray(instanceSnapshot?.invidious)) instanceSnapshot = { t: 0, piped: PIPED_FALLBACK, invidious: INV_FALLBACK };
  }
  if (instancePromise) return force ? instancePromise : Promise.resolve(instanceSnapshot);
  if (!force && Date.now() - instanceSnapshot.t < 6 * 3600e3) return Promise.resolve(instanceSnapshot);
  instancePromise = (async () => {
    const [p, i] = await Promise.allSettled([
      fetchJSON('https://piped-instances.kavin.rocks/', 6000),
      fetchJSON('https://api.invidious.io/instances.json?sort_by=health', 6000),
    ]);
    const piped = Array.isArray(settled(p))
      ? p.value.filter((x) => x && x.api_url).sort((a, b) => (b.uptime_24h || 0) - (a.uptime_24h || 0)).map((x) => clean(x.api_url))
      : [];
    const inv = Array.isArray(settled(i))
      ? i.value.filter(([, d]) => d && d.type === 'https' && d.api !== false && d.cors !== false && d.uri).map(([, d]) => clean(d.uri))
      : [];
    const out = { t: Date.now(), piped: uniq([...piped, ...PIPED_FALLBACK]), invidious: uniq([...inv, ...INV_FALLBACK]) };
    instanceSnapshot = out;
    try { localStorage.setItem('spotplus.instances', JSON.stringify(out)); } catch {}
    return out;
  })().finally(() => { instancePromise = null; });
  return force ? instancePromise : Promise.resolve(instanceSnapshot);
}

// Shared match lookup on the Spot+ bridge: one fast, edge-cached search for every user.
export const MATCH_ENDPOINT = 'https://spot-plus-canvas.pwr97pnmkn.workers.dev/match';
let matchDown = 0;
async function bridgeMatches(t, signal) {
  if (matchDown > Date.now()) throw new Error('Match lookup paused');
  const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), 2500);
  try {
    const r = await fetch(MATCH_ENDPOINT + '?q=' + encodeURIComponent(query(t)), {signal: signal ? AbortSignal.any([signal, ctl.signal]) : ctl.signal, credentials: 'omit'});
    if (r.status === 404) matchDown = Date.now() + 3600e3;
    if (!r.ok) throw new Error('Match lookup unavailable');
    const matches = best(((await r.json()).items || []).slice(0, 8), t);
    if (!matches.length) throw new Error('No match');
    return matches;
  } finally { clearTimeout(timer); }
}
const goodKey = 'spotplus.goodInstance';
const failedInstances = new Map();
function lastGood() { try { return JSON.parse(localStorage.getItem(goodKey) || '{}'); } catch { return {}; } }
function markGood(kind, base) { const g = lastGood(); g[kind] = base; try { localStorage.setItem(goodKey, JSON.stringify(g)); } catch {} }
export function reportPlaybackSource(source, ok = true) {
  if (!source?.instance || !['piped','invidious'].includes(source.kind)) return;
  if (ok) { failedInstances.delete(source.instance); markGood(source.kind,source.instance); }
  else { failedInstances.set(source.instance,Date.now()+60000); for (const [key,value] of streamCache) if (value.stream.instance===source.instance) forget(key); }
}

// Each server's typical answer time (moving average), so the fastest ones are asked first.
const SPEED_KEY='spotplus.instanceSpeed';
let speeds=null;
function speedTable(){if(!speeds){try{speeds=JSON.parse(localStorage.getItem(SPEED_KEY)||'{}');}catch{speeds={};}}return speeds;}
export function recordSpeed(base,ms,ok){
  const table=speedTable(),old=table[base];const sample=ok?ms:Math.max(ms,6000)+4000;
  table[base]=Math.round(old?old*.6+sample*.4:sample);
  clearTimeout(recordSpeed.t);recordSpeed.t=setTimeout(()=>{try{localStorage.setItem(SPEED_KEY,JSON.stringify(Object.fromEntries(Object.entries(table).sort((a,b)=>a[1]-b[1]).slice(0,80))));}catch{}},1500);
}
export function rankBySpeed(list,{custom=[],failed=()=>false,table=speedTable()}={}){
  const cost=base=>failed(base)?1e9:custom.includes(base)?-1:(table[base]??2500);
  return list.map((base,i)=>({base,i,c:cost(base)})).sort((a,b)=>a.c-b.c||a.i-b.i).map(x=>x.base);
}
function orderedInstances(kind, inst, set) {
  const custom = (kind === 'piped' ? set.customPiped : set.customInvidious).split(/[\s,]+/).filter((x) => /^https?:\/\//.test(x)).map(clean);
  const list = uniq([...custom, lastGood()[kind], ...(kind==='invidious'?INV_FALLBACK.slice(0,1):[]), ...(inst[kind] || [])]);
  return rankBySpeed(list,{custom,failed:base=>(failedInstances.get(base)||0)>Date.now()});
}

const best = rankAudioMatches;
const query = (t) => `${t.artist} ${t.title}`.trim();

async function pipedSearch(base, t, signal) {
  for (const filter of ['music_songs', 'videos']) {
    const d = await fetchJSON(`${base}/search?q=${encodeURIComponent(query(t))}&filter=${filter}`, 4500, signal);
    const items = (d.items || [])
      .filter((x) => x && typeof x.url === 'string' && x.url.includes('v='))
      .map((x) => ({ id: new URL(x.url, 'https://youtube.com').searchParams.get('v'), title: x.title, duration: x.duration, channel: x.uploaderName }));
    const matches=best(items,t);if(matches.length)return matches;
  }
  throw new Error('no results');
}
async function invSearch(base, t, signal) {
  const d = await fetchJSON(`${base}/api/v1/search?q=${encodeURIComponent(query(t))}&type=video&fields=videoId,title,lengthSeconds,author`, 4500, signal);
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
async function pipedStream(base, id, signal, track) {
  const d = await fetchJSON(`${base}/streams/${id}`, 4500, signal);
  if(d.livestream || (track&&d.title&&!best([{title:d.title,channel:d.uploader,duration:d.duration}],track).length))throw new Error('Recording did not match');
  const list = (d.audioStreams || []).filter((s) => s.url && s.videoOnly!==true).map((s) => ({ url: s.url, mime: s.mimeType || '', codec:s.codec||'', bitrate: Number(s.bitrate) || parseFloat(s.quality)*1000 || 0 }));
  if (!list.length) throw new Error(d.error || d.message || 'no audio streams');
  return pickFormat(list);
}
async function invStream(base, id, signal, track) {
  const d = await fetchJSON(`${base}/api/v1/videos/${id}?fields=adaptiveFormats,error,title,author,lengthSeconds,liveNow`, 4500, signal);
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
  const data=await fetchJSON(base+'/v1/tracks/search?query='+encodeURIComponent(query(track))+'&limit=10&app_name=SpotPlus',4500,signal);
  const matches=best((data.data||[]).filter(t=>t.is_streamable===true&&!t.is_stream_gated&&t.access?.stream!==false&&t.user?.is_verified).map(t=>({id:t.id,title:t.title,channel:t.user.name,duration:t.duration,verified:true})),track);
  if(!matches.length)throw new Error('No matching public Audius release');
  return {url:base+'/v1/tracks/'+encodeURIComponent(matches[0].id)+'/stream?app_name=SpotPlus',mime:'audio/mpeg',bitrate:0,kind:'audius',instance:base,catalogId:matches[0].id};
}

// Only used after Canvas is missing. Audio resolution never waits on this work.
const videoLoopCache = new Map();
export async function resolveVideoLoop(track, {signal, source, skip = []} = {}) {
  const target = loopQuality(globalThis.navigator?.connection);
  const key = JSON.stringify([track.searchTitle || track.title, track.artist,target]);
  const cached = videoLoopCache.get(key);
  if (cached?.expires > Date.now() && !skip.includes(cached.value.instance)) return cached.value;
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
  return s === 'piped' ? ['piped'] : s === 'invidious' ? ['invidious'] : s==='audius'?['audius']:['invidious','piped','audius'];
}

/** Find a playable audio URL for a track. Returns { url, mime, bitrate, videoId, instance, kind }. */
async function resolveUncached(t, { skip = [], signal, cors = false } = {}, _retry = false) {
  const set = getSettings();
  if (t.local) throw new Error('This local file is no longer stored on this device. Import it again.');
  if (set.source === 'preview') {
    // Signed preview URLs expire; refresh persisted tracks through the catalog.
    const track = t.spotifyId || t.provider==='spotify-import' ? await matchCatalogTrack(t) : normTrack(await jsonp(`/track/${encodeURIComponent(t.id)}`));
    if (!track.preview) throw new Error('No preview is available for this song');
    return {url:track.preview, mime:'audio/mpeg', bitrate:128000, kind:'preview', instance:DEEZER, preview:true};
  }
  const inst = await instances();
  const stored = getVideoCache(t.id);
  const cached = stored?.manual || stored?.matchVersion===2 ? stored : null;
  const control=new AbortController();
  const deadline=setTimeout(()=>control.abort(),18000);
  const combined=signal?AbortSignal.any([signal,control.signal]):control.signal;
  // Ask the shared lookup once; every server below can skip its own search when it answers first.
  const shared=cached?null:bridgeMatches(t,combined);shared?.catch(()=>{});
  try {
    const groups=kinds(set.source).map(kind=>kind==='audius'?[{kind,base:'https://api.audius.co'}]:orderedInstances(kind,inst,set).slice(0,10).map(base=>({kind,base})));
    const sources=[];for(let i=0;i<10;i++)for(const group of groups)if(group[i]&&!skip.includes(group[i].base))sources.push(group[i]);
    const result=await raceAudioSources(sources,async({kind,base})=>{
      combined.throwIfAborted();
      if(kind==='audius')return audiusStream(t,combined);
      const began=performance.now();
      try{let value=await attemptServer(kind,base);recordSpeed(base,performance.now()-began,true);
        if(cors&&!(await corsOK(value.url))){const alt=(value.alternatives||[]).find(x=>x.url);if(alt&&await corsOK(alt.url))value={...value,...alt,alternatives:[]};else throw new Error('Effects not supported by this server');}
        return value;}
      catch(error){if(!combined.aborted)recordSpeed(base,performance.now()-began,false);throw error;}
    },{signal:combined,quality:set.quality,concurrency:6,qualityWait:450});
    async function attemptServer(kind,base){
      const choices=cached?[cached]:(await Promise.any([shared,ENGINES[kind].search(base,t,combined)].filter(Boolean))).slice(0,3);
      for(const choice of choices){
        try {const stream=await ENGINES[kind].stream(base,choice.id,combined,cached?.manual?null:t);combined.throwIfAborted();return {...stream,videoId:choice.id,instance:base,kind};}
        catch(error){combined.throwIfAborted();if(choice===choices.at(-1))throw error;}
      }
    }
    combined.throwIfAborted();
    if(result.videoId)setVideoCache(t.id,{id:result.videoId,manual:!!cached?.manual,matchVersion:2});
    return result;
  } catch {
    if(signal?.aborted)throw new DOMException('Playback cancelled','AbortError');
    if(cached&&!cached.manual&&!_retry){setVideoCache(t.id,null);return resolveUncached(t,{skip,signal,cors},true);}
    throw new Error('No audio server answered. Try another source in Settings, a 30-second preview, or a local audio file.');
  } finally {clearTimeout(deadline);control.abort();}
}

// Keep short-lived results in memory. Resolve the next queued song after playback
// starts, so skip/next usually does not wait for a fresh provider search.
const streamCache=new Map(),warmups=new Map(),warmControllers=new Map();
export const streamKey=(t,s=getSettings(),videoId=getVideoCache(t.id)?.id||'')=>[t.id,s.source,s.quality,s.customPiped,s.customInvidious,videoId].join('|');
const STREAMS_KEY='spotplus.streams';
export function streamExpiry(url,now=Date.now()){
  const exp=Number(String(url||'').match(/[?&]expire=(\d{9,11})/)?.[1]||0)*1000;
  return Math.min(exp?exp-10*60e3:now+45*60e3,now+3*3600e3);
}
function persisted(){try{return JSON.parse(localStorage.getItem(STREAMS_KEY)||'{}');}catch{return {};}}
function remember(key,stream){
  const until=streamExpiry(stream.url);
  streamCache.set(key,{time:Date.now(),until,stream});if(streamCache.size>40)streamCache.delete(streamCache.keys().next().value);
  if(stream.preview||/^blob:/.test(stream.url))return;
  const all=persisted(),now=Date.now();all[key]={until,stream};
  const kept=Object.entries(all).filter(([,v])=>v.until>now).sort((a,b)=>b[1].until-a[1].until).slice(0,60);
  try{localStorage.setItem(STREAMS_KEY,JSON.stringify(Object.fromEntries(kept)));}catch{}
}
function cachedStream(key){
  const now=Date.now(),hit=streamCache.get(key);
  if(hit&&(hit.until||hit.time+120000)>now)return hit.stream;
  const saved=persisted()[key];
  if(saved?.until>now&&!((failedInstances.get(saved.stream.instance)||0)>now)){streamCache.set(key,{time:now,until:saved.until,stream:saved.stream});return saved.stream;}
  return null;
}
function forget(key){streamCache.delete(key);const all=persisted();if(all[key]){delete all[key];try{localStorage.setItem(STREAMS_KEY,JSON.stringify(all));}catch{}}}
export function clearStreamCache(){streamCache.clear();for(const c of warmControllers.values())c.abort();warmups.clear();warmControllers.clear();}
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
  if (connectedOrigins.has(origin) || connectedOrigins.size>=8) return;
  connectedOrigins.add(origin);
  const link=document.createElement('link');link.rel='preconnect';link.href=origin;link.crossOrigin='anonymous';document.head.append(link);
}
export async function resolve(t,options={}) {
  const settings=getSettings(),key=streamKey(t,settings),hit=!options.skip?.length&&cachedStream(key);
  if(hit&&(!options.cors||await corsOK(hit.url))){options.signal?.throwIfAborted();return hit;}
  if(options.skip?.length)forget(key);
  const warm=warmups.get(key);
  if(warm&&!options.skip?.length){try {const stream=await abortable(warm,options.signal);options.signal?.throwIfAborted();if(!options.cors||await corsOK(stream.url))return stream;}catch {options.signal?.throwIfAborted();}}
  // With effects on, prefer servers that allow them; if none do, play the song normally.
  let stream;
  if(options.cors){try{stream=await resolveUncached(t,options);}catch(e){if(options.signal?.aborted)throw e;stream=await resolveUncached(t,{...options,cors:false});}}
  else stream=await resolveUncached(t,options);
  options.signal?.throwIfAborted();
  remember(streamKey(t,settings,stream.videoId||getVideoCache(t.id)?.id||''),stream);
  return stream;
}
export function prewarm(t){
  if(!t||t.local||navigator.connection?.saveData||/2g/.test(navigator.connection?.effectiveType||''))return;
  const settings=getSettings(),key=streamKey(t,settings);if(warmups.has(key))return warmups.get(key);
  const hit=cachedStream(key);if(hit)return Promise.resolve(hit);
  for (const base of Object.values(lastGood())) preconnect(base);
  if(warmControllers.size>=2){const oldest=warmControllers.keys().next().value;warmControllers.get(oldest).abort();warmControllers.delete(oldest);warmups.delete(oldest);}
  const controller=new AbortController();warmControllers.set(key,controller);
  const promise=resolveUncached(t,{signal:controller.signal}).then(stream=>{controller.signal.throwIfAborted();remember(streamKey(t,settings,stream.videoId||getVideoCache(t.id)?.id||''),stream);preconnect(stream.url);return stream;}).finally(()=>{if(warmControllers.get(key)===controller){warmups.delete(key);warmControllers.delete(key);}});
  warmups.set(key,promise);promise.catch(()=>{});
  return promise;
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

/** Quick health check of the first few instances of each kind. */
export async function testInstances() {
  const inst = await instances(true);
  const set = getSettings();
  const VID = 'jNQXAC9IVRw';
  const out = [];
  await Promise.all(['piped', 'invidious'].flatMap((kind) =>
    orderedInstances(kind, inst, set).slice(0, 5).map(async (base) => {
      const t0 = performance.now();
      try { await ENGINES[kind].stream(base, VID); out.push({ kind, base, ok: true, ms: Math.round(performance.now() - t0) }); }
      catch (e) { out.push({ kind, base, ok: false, err: e.message }); }
    })));
  return out.sort((a, b) => (a.kind + (a.ok ? 0 : 1)).localeCompare(b.kind + (b.ok ? 0 : 1)) || (a.ms || 1e9) - (b.ms || 1e9));
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
