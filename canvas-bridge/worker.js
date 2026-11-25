import {images} from './images.js';
import {monochromeAudio} from './monochrome.js';
import {podcasts} from './podcasts.js';
import {devProfile} from './dev-profile.js';
import {liveStats, InstallCounter} from './installs.js';
export {InstallCounter};
import {youtubeMatch} from './youtube-match.js';
import {wallpapers} from './wallpapers.js';
import {soundcloud} from './soundcloud.js';
import {youtubeRelay} from './youtube-relay.js';
import {youtubeStream} from './youtube-stream.js';
// A narrow public-metadata adapter, never an arbitrary URL or credential proxy.
import {spotifyStats} from './spotify-stats.js';
import {spotifyPublic} from './spotify-public.js';
import {routeAccess} from './access.js';
const SOURCE = 'https://canvas.auramusic.site/api/canvas';
const CORS = {'Access-Control-Allow-Origin':'*','Access-Control-Allow-Methods':'GET, POST, OPTIONS','Content-Type':'application/json; charset=utf-8','X-Content-Type-Options':'nosniff'};
// Lyrics search: Genius's public lyric search, reduced to title, artist and the matching line.
export function lyricHits(data) {
  const hits = (data?.response?.sections || []).flatMap(section => section?.hits || []);
  return hits.map(hit => {
    const r = hit?.result || {}, title = String(r.title || '').slice(0, 200), artist = String(r.primary_artist?.name || r.artist_names || '').slice(0, 200);
    const snippet = String(hit?.highlights?.[0]?.value || '').replace(/\s+/g, ' ').slice(0, 200);
    return title && artist ? {title, artist, snippet} : null;
  }).filter(Boolean).slice(0, 10);
}
async function lyricsSearch(url, {fetcher, cache, waitUntil}) {
  const q = (url.searchParams.get('q') || '').trim();
  if (q.length < 6 || q.length > 200 || /[\u0000-\u001f]/.test(q)) return json({error: 'Provide a lyric line'}, 400);
  const key = new Request(url.origin + '/lyrics-search?q=' + encodeURIComponent(q.toLowerCase()));
  const hit = await cache?.match(key); if (hit) return hit;
  const controller = new AbortController(), timeout = setTimeout(() => controller.abort(), 6000);
  try {
    const response = await fetcher('https://genius.com/api/search/lyric?per_page=10&q=' + encodeURIComponent(q), {signal: controller.signal, redirect: 'manual', headers: {Accept: 'application/json', 'User-Agent': 'SpotPlus/2.0 (https://coye2.github.io/spot-plus/)'}});
    if (!response.ok) return json({results: [], error: 'Lyrics search unavailable'}, 503);
    const result = json({results: lyricHits(await boundedJSON(response, 400000))}, 200, 86400, 86400);
    if (cache) waitUntil(cache.put(key, result.clone()).catch(() => {}));
    return result;
  } catch { return json({results: [], error: 'Lyrics search unavailable'}, 503); }
  finally { clearTimeout(timeout); }
}
export function queryFor(input) {
  const output = new URLSearchParams();
  const id = input.get('trackId');
  if (id && /^[a-zA-Z0-9]{22}$/.test(id)) { output.set('trackId', id); return output; }
  for (const [key, limit] of [['song',200],['artist',160],['album',200]]) {
    const value = (input.get(key) || '').trim();
    if (value.length > limit || /[\u0000-\u001f]/.test(value)) return null;
    if (value) output.set(key,value);
  }
  if (!output.has('song') || !output.has('artist')) return null;
  const duration = Number(input.get('durationMs'));
  if (Number.isInteger(duration) && duration > 0 && duration <= 7200000) output.set('durationMs',String(duration));
  return output;
}
export function clipFrom(data) {
  try {
    const url = new URL(data?.canvasUrl || data?.url);
    if (url.protocol !== 'https:' || url.hostname !== 'canvaz.scdn.co' || url.username || url.password || url.port || !/^\/upload\/.+\.mp4$/.test(url.pathname)) return null;
    return {success:true,canvasUrl:url.href,trackId:/^[a-zA-Z0-9]{22}$/.test(data.trackId || '') ? data.trackId : null};
  } catch { return null; }
}
export async function boundedJSON(response, limit = 65536) {
  const reader = response.body.getReader(); const chunks = []; let size = 0;
  try {
    while (true) {
      const {done,value} = await reader.read(); if (done) break;
      size += value.byteLength;
      if (size > limit) { await reader.cancel(); throw new Error('Response too large'); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk,offset); offset += chunk.byteLength; }
  return JSON.parse(new TextDecoder().decode(bytes));
}
const json = (data,status=200,maxAge=0,swr=0) => new Response(JSON.stringify(data), {
  status,
  headers: {
    ...CORS,
    'Cache-Control': maxAge
      ? `public, max-age=${maxAge}${swr ? `, stale-while-revalidate=${swr}` : ''}`
      : 'no-store',
  },
});
export async function handle(request, {fetcher=fetch,cache,waitUntil=()=>{},env} = {}) {
  if (request.method === 'OPTIONS') return new Response(null,{status:204,headers:CORS});
  const url = new URL(request.url);
  if (url.pathname === '/access' || url.pathname.startsWith('/access/')) return routeAccess(request, env);
  if (['/stats','/installs','/listening','/rate'].includes(url.pathname) && (request.method === 'GET' ? url.pathname === '/stats' : request.method === 'POST' && url.pathname !== '/stats'))
    return liveStats(request, env, async text => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode('spotplus:' + text)))].slice(0, 8).map(b => b.toString(16).padStart(2, '0')).join(''));
  if (request.method !== 'GET' && !(['/yta','/mono'].includes(url.pathname) && request.method === 'HEAD')) return json({error:'Use GET'},405);
  if (url.pathname === '/spotify-stats') return spotifyStats(request,{fetcher,cache,waitUntil});
  if (['/podcasts','/podcast','/audiobooks'].includes(url.pathname)) return podcasts(request,{fetcher,cache,waitUntil});
  if (url.pathname === '/dev') return devProfile(request,{fetcher,cache,waitUntil});
  if (url.pathname === '/match') return youtubeMatch(request,{fetcher,cache,waitUntil});
  if (url.pathname === '/wallpapers') return wallpapers(request,{fetcher,cache,waitUntil});
  if (url.pathname === '/images') return images(request,{fetcher,cache,waitUntil});
  if (url.pathname === '/sc') return soundcloud(request,{env,fetcher,cache,waitUntil});
  if (url.pathname === '/yta') return youtubeRelay(request,{fetcher,cache,waitUntil});
  if (url.pathname === '/mono') return monochromeAudio(request,{fetcher});
  if (url.pathname === '/stream') return youtubeStream(request,{fetcher,cache,waitUntil});
  if (url.pathname === '/spotify-public') return spotifyPublic(request,{fetcher,cache,waitUntil});
  if (url.pathname === '/health') return json({service:'Spot+ Canvas bridge',status:'ok',lyrics:true,spotifyPublic:true,match:true,wallpapers:true,sc:!!(env?.SC_CLIENT_ID&&env?.SC_CLIENT_SECRET),relay:true,relayIntegrity:'v3',mono:true,images:true,stream:true,stats:true,dev:true,podcasts:true,access:true}, 200, 30, 60);
  if (url.pathname === '/lyrics-search') return lyricsSearch(url,{fetcher,cache,waitUntil});
  if (url.pathname !== '/canvas') return json({error:'Not found'},404);
  const query = queryFor(url.searchParams);
  if (!query) return json({error:'Provide a track ID or song and artist'},400);
  const key = new Request(url.origin+'/canvas?'+query);
  const cached = await cache?.match(key); if (cached) return cached;
  const controller = new AbortController(), timeout = setTimeout(()=>controller.abort(),8500);
  try {
    const response = await fetcher(SOURCE+'?'+query,{signal:controller.signal,redirect:'manual',headers:{Accept:'application/json'}});
    if (response.status === 404) {
      const missing = json({success:false,canvasUrl:null},200,3600,3600);
      if (cache) waitUntil(cache.put(key,missing.clone()).catch(()=>{}));
      return missing;
    }
    if (!response.ok) { console.warn(JSON.stringify({event:'canvas_upstream_status',status:response.status})); return json({error:'Canvas source unavailable'},503); }
    const clip = clipFrom(await boundedJSON(response));
    if (!clip) return json({error:'Invalid source response'},502);
    const result = json(clip,200,86400,86400);
    if (cache) waitUntil(cache.put(key,result.clone()).catch(()=>{}));
    return result;
  } catch (error) { console.warn(JSON.stringify({event:'canvas_upstream_error',name:error.name,message:String(error.message).slice(0,160)})); return json({error:'Canvas source unavailable'},503); }
  finally { clearTimeout(timeout); }
}
/* ---------- Security layer: origin allowlist, layered rate/burst limits, malformed rejection, hardened headers ---------- */
export const ALLOWED_ORIGINS = ['https://coye2.github.io','https://open.spotify.com','http://localhost:8080','http://127.0.0.1:8080'];
const SECURITY_HEADERS = {
  'X-Content-Type-Options':'nosniff','X-Frame-Options':'DENY','Referrer-Policy':'no-referrer',
  'Content-Security-Policy':"default-src 'none'; frame-ancestors 'none'",'Cross-Origin-Resource-Policy':'cross-origin',
  'Strict-Transport-Security':'max-age=63072000; includeSubDomains','Permissions-Policy':'interest-cohort=()',
  'Access-Control-Expose-Headers':'Content-Range, Content-Length, Accept-Ranges, X-Spotplus-Source, X-Spotplus-Duration, X-Spotplus-Itag, X-Spotplus-Video',
};
const RATE = {limit:120, windowMs:60000}, hits = new Map();
const BURST_RATE = {limit:60, windowMs:10000}, burstHits = new Map();
// Audio streaming makes many small range requests, so the relay has its own, higher limit.
const RELAY_RATE = {limit:900, windowMs:60000}, relayHits = new Map();
const RELAY_BURST_RATE = {limit:300, windowMs:10000}, relayBurstHits = new Map();
// Higher shared-IP ceilings when clients send distinct non-identifying session buckets (CGNAT-friendly).
const CGNAT_RATE = {limit:600, windowMs:60000}, cgnatHits = new Map();
const CGNAT_RELAY_RATE = {limit:3600, windowMs:60000}, cgnatRelayHits = new Map();

function pruneTable(table, now, windowMs, maxSize = 5000) {
  if (table.size <= maxSize) return;
  for (const [k, v] of table) {
    if (now - v.start > windowMs) table.delete(k);
    if (table.size <= maxSize * 0.8) return;
  }
  while (table.size > maxSize) {
    const oldest = table.keys().next().value;
    if (oldest === undefined) break;
    table.delete(oldest);
  }
}

export function rateLimited(ip, now = Date.now(), table = hits, rate = RATE) {
  const entry = table.get(ip);
  if (!entry || now - entry.start > rate.windowMs) {
    table.delete(ip);
    table.set(ip,{start:now,count:1});
    pruneTable(table, now, rate.windowMs);
    return false;
  }
  entry.count++;
  return entry.count > rate.limit;
}

export function resetRateLimits() {
  hits.clear();
  burstHits.clear();
  relayHits.clear();
  relayBurstHits.clear();
  cgnatHits.clear();
  cgnatRelayHits.clear();
}

/** Reject malformed paths, control characters, path traversal, and query-parameter pollution floods early. */
export function validateRequest(url, rawUrl = '') {
  const raw = String(rawUrl || '');
  if (/(^|[\\/])\.\.([\\/?#]|$)|%2e%2e|%252e%252e|%00/i.test(raw)) {
    return { ok: false, status: 400, error: 'Malformed request path' };
  }
  if (!url || url.pathname.length > 120 || url.pathname.includes('..')) {
    return { ok: false, status: 400, error: 'Malformed request path' };
  }
  if (/[\u0000-\u001f\u007f]/.test(url.pathname) || /[\u0000-\u001f\u007f]/.test(url.search)) {
    return { ok: false, status: 400, error: 'Malformed control characters' };
  }
  let paramCount = 0;
  for (const [k, v] of url.searchParams) {
    paramCount++;
    if (paramCount > 12 || k.length > 40 || /[\u0000-\u001f\u007f]/.test(k) || /[\u0000-\u001f\u007f]/.test(v)) {
      return { ok: false, status: 400, error: 'Malformed query parameters' };
    }
  }
  return { ok: true };
}

/** Normalize cache keys by whitelisting known parameters so cache-busting params cannot amplify origin hits. */
export function canonicalCacheKey(url, allowedParams = []) {
  const out = new URLSearchParams();
  for (const name of [...allowedParams].sort()) {
    const val = url.searchParams.get(name);
    if (val != null && val !== '') out.set(name, val.trim().replace(/\s+/g, ' ').toLowerCase());
  }
  const qs = out.toString();
  return `${url.origin}${url.pathname}${qs ? '?' + qs : ''}`;
}

export async function secureHandle(request, options = {}) {
  const origin = request.headers.get('Origin');
  const allowed = !origin || ALLOWED_ORIGINS.includes(origin);
  const finish = response => {
    const headers = new Headers(response.headers);
    for (const [k,v] of Object.entries(SECURITY_HEADERS)) headers.set(k,v);
    if (origin && allowed) { headers.set('Access-Control-Allow-Origin',origin); headers.set('Vary','Origin'); }
    else headers.delete('Access-Control-Allow-Origin');
    return new Response(response.body,{status:response.status,statusText:response.statusText,headers});
  };
  if (!allowed) return finish(json({error:'Origin not allowed'},403));
  let url;
  try { url = new URL(request.url); } catch { return finish(json({error:'Malformed URL'},400)); }
  if (url.search.length > 1200) return finish(json({error:'Request too long'},414));
  const check = validateRequest(url, request.url);
  if (!check.ok) return finish(json({error:check.error}, check.status));

  const now = typeof options.now === 'number' ? options.now : Date.now();
  const ip = request.headers.get('CF-Connecting-IP') || 'local';
  const rawClient = (request.headers.get('X-Spotplus-Client') || '').trim();
  const clientBucket = /^[a-zA-Z0-9_-]{8,64}$/.test(rawClient) ? rawClient : '';
  const subject = clientBucket ? `${ip}:${clientBucket}` : ip;
  const relay = ['/yta', '/mono'].includes(url.pathname);

  const limited = relay
    ? (rateLimited(subject, now, relayHits, RELAY_RATE)
      || rateLimited(subject, now, relayBurstHits, RELAY_BURST_RATE)
      || (clientBucket && rateLimited(ip, now, cgnatRelayHits, CGNAT_RELAY_RATE)))
    : (rateLimited(subject, now, hits, RATE)
      || rateLimited(subject, now, burstHits, BURST_RATE)
      || (clientBucket && rateLimited(ip, now, cgnatHits, CGNAT_RATE)));

  if (limited) {
    const r = json({error:'Too many requests. Try again in a minute.'},429);
    return finish(new Response(r.body,{status:429,headers:{...Object.fromEntries(r.headers),'Retry-After':'60'}}));
  }
  return finish(await handle(request, options));
}
export default {fetch(request,env,ctx) { return secureHandle(request,{env,cache:caches.default,waitUntil:promise=>ctx.waitUntil(promise)}); }};
