// api.js — Spot+ music API.
//   Metadata : Deezer public API (no key; JSONP so it works from any static site)
//   Audio    : public Piped / Invidious instances (the same idea Spotube uses: match the song on YouTube)
//   Lyrics   : LRCLib (time-synced)
// Requests go from the listener's browser to public providers; availability and CORS vary.
import { getSettings, getVideoCache, setVideoCache } from './store.js';

const DEEZER = 'https://api.deezer.com';
const LRCLIB = 'https://lrclib.net/api';

/* =========================== Deezer (metadata) =========================== */
const memo = new Map();
const MEMO_TTL = 10 * 60 * 1000;
let seq = 0;

function jsonp(path, params = {}) {
  const qs = new URLSearchParams(params);
  const key = path + '?' + qs;
  const hit = memo.get(key);
  if (hit && Date.now() - hit.t < MEMO_TTL) return hit.p;
  const p = new Promise((resolve, reject) => {
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
  year: (a.release_date || '').slice(0, 4), type: a.record_type || 'album', count: a.nb_tracks || 0,
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

const goodKey = 'spotplus.goodInstance';
function lastGood() { try { return JSON.parse(localStorage.getItem(goodKey) || '{}'); } catch { return {}; } }
function markGood(kind, base) { const g = lastGood(); g[kind] = base; try { localStorage.setItem(goodKey, JSON.stringify(g)); } catch {} }

function orderedInstances(kind, inst, set) {
  const custom = (kind === 'piped' ? set.customPiped : set.customInvidious).split(/[\s,]+/).filter((x) => /^https?:\/\//.test(x)).map(clean);
  return uniq([...custom, lastGood()[kind], ...(inst[kind] || [])]);
}

const BAD = /\b(live|cover|karaoke|instrumental|remix|8d|slowed|sped ?up|nightcore|reverb|reaction|tutorial|1 hour|10 hours)\b/i;
function score(c, t) {
  let s = c.duration ? Math.abs(c.duration - (t.duration || c.duration)) : 30;
  const title = (c.title || '').toLowerCase();
  const m = title.match(BAD);
  if (m && !t.title.toLowerCase().includes(m[1].toLowerCase())) s += 60;
  const want = (t.searchTitle || t.title).toLowerCase().replace(/[^\p{L}\p{N} ]/gu, '').slice(0, 14).trim();
  if (want && !title.replace(/[^\p{L}\p{N} ]/gu, '').includes(want)) s += 20;
  return s;
}
const best = (items, t) => items.map((c) => ({ ...c, score: score(c, t) })).sort((a, b) => a.score - b.score);
const query = (t) => `${t.artist} ${t.searchTitle || t.title}`.trim();

async function pipedSearch(base, t, signal) {
  for (const filter of ['music_songs', 'videos']) {
    const d = await fetchJSON(`${base}/search?q=${encodeURIComponent(query(t))}&filter=${filter}`, 7000, signal);
    const items = (d.items || [])
      .filter((x) => x && typeof x.url === 'string' && x.url.includes('v='))
      .map((x) => ({ id: new URL(x.url, 'https://youtube.com').searchParams.get('v'), title: x.title, duration: x.duration, channel: x.uploaderName }));
    if (items.length) return best(items, t);
  }
  throw new Error('no results');
}
async function invSearch(base, t, signal) {
  const d = await fetchJSON(`${base}/api/v1/search?q=${encodeURIComponent(query(t))}&type=video&fields=videoId,title,lengthSeconds,author`, 7000, signal);
  const items = (Array.isArray(d) ? d : []).filter((x) => x.videoId).map((x) => ({ id: x.videoId, title: x.title, duration: x.lengthSeconds, channel: x.author }));
  if (!items.length) throw new Error('no results');
  return best(items, t);
}

const probe = typeof document !== 'undefined' ? document.createElement('audio') : null;
const canOpus = !!probe?.canPlayType('audio/webm; codecs="opus"');
function pickFormat(list) {
  const q = getSettings().quality;
  const webm = list.filter((s) => s.mime.includes('webm'));
  const mp4 = list.filter((s) => s.mime.includes('mp4'));
  const pool = (canOpus && webm.length ? webm : mp4.length ? mp4 : list).sort((a, b) => b.bitrate - a.bitrate);
  return q === 'low' ? pool[pool.length - 1] : pool[0];
}
async function pipedStream(base, id, signal) {
  const d = await fetchJSON(`${base}/streams/${id}`, 7000, signal);
  const list = (d.audioStreams || []).filter((s) => s.url).map((s) => ({ url: s.url, mime: s.mimeType || '', bitrate: s.bitrate || 0 }));
  if (!list.length) throw new Error(d.error || d.message || 'no audio streams');
  return pickFormat(list);
}
async function invStream(base, id, signal) {
  const d = await fetchJSON(`${base}/api/v1/videos/${id}?fields=adaptiveFormats,error`, 7000, signal);
  const list = (d.adaptiveFormats || [])
    .filter((f) => (f.type || '').startsWith('audio/'))
    .map((f) => ({ url: `${base}/latest_version?id=${id}&itag=${f.itag}&local=true`, mime: f.type, bitrate: Number(f.bitrate) || 0 }));
  if (!list.length) throw new Error(d.error || 'no audio streams');
  return pickFormat(list);
}
const ENGINES = { piped: { search: pipedSearch, stream: pipedStream }, invidious: { search: invSearch, stream: invStream } };

// Only used after Canvas is missing. Audio resolution never waits on this work.
const videoLoopCache = new Map();
export async function resolveVideoLoop(track, {signal, source, skip = []} = {}) {
  const key = JSON.stringify([track.searchTitle || track.title, track.artist]);
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
        ? (data.adaptiveFormats || []).filter(f=>/^\d{1,3}$/.test(String(f.itag))).map(f=>({url:base+'/latest_version?id='+match.id+'&itag='+f.itag+'&local=true',mime:f.type || '',height:parseInt(f.qualityLabel || f.resolution,10),bitrate:f.bitrate}))
        : (data.videoStreams || []).filter(f=>f.videoOnly === true).map(f=>({url:f.url,mime:f.mimeType || '',codec:f.codec || '',height:f.height || parseInt(f.quality,10),bitrate:f.bitrate}));
      const format = chooseLoopFormat(formats); if (!format) throw new Error('No small compatible video');
      return musicVideoLoop({kind:'music-video',engine:kind,instance:base,url:format.url,videoId:match.id,title:details.title,duration:details.duration});
    }).map(async promise=>{const value=await promise;if(!value)throw new Error('Invalid video');return value;}));
    videoLoopCache.set(key,{value:result,expires:Date.now()+5*60e3});
    if (videoLoopCache.size > 30) videoLoopCache.delete(videoLoopCache.keys().next().value);
    return result;
  } finally { clearTimeout(timer); controller.abort(); signal?.removeEventListener('abort',cancel); }
}

function kinds(s = getSettings().source) {
  return s === 'piped' ? ['piped'] : s === 'invidious' ? ['invidious'] : ['piped', 'invidious'];
}

/** Find a playable audio URL for a track. Returns { url, mime, bitrate, videoId, instance, kind }. */
async function resolveUncached(t, { skip = [], signal } = {}, _retry = false) {
  const set = getSettings();
  if (t.local) throw new Error('This local file is no longer stored on this device. Import it again.');
  if (set.source === 'preview') {
    // Signed preview URLs expire; refresh persisted tracks through the catalog.
    const track = t.spotifyId || t.provider==='spotify-import' ? await matchCatalogTrack(t) : normTrack(await jsonp(`/track/${encodeURIComponent(t.id)}`));
    if (!track.preview) throw new Error('No preview is available for this song');
    return {url:track.preview, mime:'audio/mpeg', bitrate:128000, kind:'preview', instance:DEEZER, preview:true};
  }
  const inst = await instances();
  const cached = getVideoCache(t.id);
  const control=new AbortController();
  const deadline=setTimeout(()=>control.abort(),18000);
  const combined=signal?AbortSignal.any([signal,control.signal]):control.signal;
  try {
    const attempts=kinds(set.source).flatMap(kind=>orderedInstances(kind,inst,set).filter(u=>!skip.includes(u)).slice(0,3).map(async base=>{
      combined.throwIfAborted();
      const id=cached?.id||(await ENGINES[kind].search(base,t,combined))[0].id;
      const stream=await ENGINES[kind].stream(base,id,combined);
      combined.throwIfAborted();
      return {...stream,videoId:id,instance:base,kind};
    }));
    const result=await Promise.any(attempts);
    combined.throwIfAborted();
    setVideoCache(t.id,{id:result.videoId,manual:!!cached?.manual});
    markGood(result.kind,result.instance);
    return result;
  } catch {
    if(signal?.aborted)throw new DOMException('Playback cancelled','AbortError');
    if(cached&&!cached.manual&&!_retry){setVideoCache(t.id,null);return resolveUncached(t,{skip,signal},true);}
    throw new Error('No audio server answered. Try another source in Settings, a 30-second preview, or a local audio file.');
  } finally {clearTimeout(deadline);control.abort();}
}

// Keep short-lived results in memory. Resolve the next queued song after playback
// starts, so skip/next usually does not wait for a fresh provider search.
const streamCache=new Map(),warmups=new Map(),warmControllers=new Map();
export const streamKey=(t,s=getSettings(),videoId=getVideoCache(t.id)?.id||'')=>[t.id,s.source,s.quality,s.customPiped,s.customInvidious,videoId].join('|');
function remember(key,stream){streamCache.set(key,{time:Date.now(),stream});if(streamCache.size>6)streamCache.delete(streamCache.keys().next().value);}
export function clearStreamCache(){streamCache.clear();for(const c of warmControllers.values())c.abort();warmups.clear();warmControllers.clear();}
export async function resolve(t,options={}) {
  const settings=getSettings(),key=streamKey(t,settings),hit=streamCache.get(key);
  if(!options.skip?.length && hit && Date.now()-hit.time<120000){options.signal?.throwIfAborted();return hit.stream;}
  if(options.skip?.length)streamCache.delete(key);
  const warm=warmups.get(key);
  if(warm&&!options.skip?.length){try {const stream=await warm;options.signal?.throwIfAborted();return stream;}catch {options.signal?.throwIfAborted();}}
  const stream=await resolveUncached(t,options);
  options.signal?.throwIfAborted();
  remember(streamKey(t,settings,stream.videoId||getVideoCache(t.id)?.id||''),stream);
  return stream;
}
export function prewarm(t){
  if(!t||t.local||navigator.connection?.saveData||/2g/.test(navigator.connection?.effectiveType||''))return;
  const settings=getSettings(),key=streamKey(t,settings);if(warmups.has(key))return;
  const hit=streamCache.get(key);if(hit&&Date.now()-hit.time<120000)return;
  const controller=new AbortController();warmControllers.set(key,controller);
  const promise=resolveUncached(t,{signal:controller.signal}).then(stream=>{controller.signal.throwIfAborted();remember(streamKey(t,settings,stream.videoId||getVideoCache(t.id)?.id||''),stream);return stream;}).finally(()=>{warmups.delete(key);warmControllers.delete(key);});
  warmups.set(key,promise);promise.catch(()=>{});
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
