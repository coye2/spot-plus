import {devProfile} from './dev-profile.js';
import {liveStats, InstallCounter} from './installs.js';
export {InstallCounter};
import {youtubeMatch} from './youtube-match.js';
// A narrow public-metadata adapter, never an arbitrary URL or credential proxy.
import {spotifyStats} from './spotify-stats.js';
import {spotifyPublic} from './spotify-public.js';
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
    const result = json({results: lyricHits(await boundedJSON(response, 400000))}, 200, 86400);
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
const json = (data,status=200,maxAge=0) => new Response(JSON.stringify(data), {status,headers:{...CORS,'Cache-Control':maxAge ? 'public, max-age='+maxAge : 'no-store'}});
export async function handle(request, {fetcher=fetch,cache,waitUntil=()=>{},env} = {}) {
  if (request.method === 'OPTIONS') return new Response(null,{status:204,headers:CORS});
  const url = new URL(request.url);
  if (['/stats','/installs','/listening'].includes(url.pathname) && (request.method === 'GET' ? url.pathname === '/stats' : request.method === 'POST' && url.pathname !== '/stats'))
    return liveStats(request, env, async text => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode('spotplus:' + text)))].slice(0, 8).map(b => b.toString(16).padStart(2, '0')).join(''));
  if (request.method !== 'GET') return json({error:'Use GET'},405);
  if (url.pathname === '/spotify-stats') return spotifyStats(request,{fetcher,cache,waitUntil});
  if (url.pathname === '/dev') return devProfile(request,{fetcher,cache,waitUntil});
  if (url.pathname === '/match') return youtubeMatch(request,{fetcher,cache,waitUntil});
  if (url.pathname === '/spotify-public') return spotifyPublic(request,{fetcher,cache,waitUntil});
  if (url.pathname === '/health') return json({service:'Spot+ Canvas bridge',status:'ok',lyrics:true,spotifyPublic:true,match:true,stats:true,dev:true});
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
      const missing = json({success:false,canvasUrl:null},200,3600);
      if (cache) waitUntil(cache.put(key,missing.clone()).catch(()=>{}));
      return missing;
    }
    if (!response.ok) { console.warn(JSON.stringify({event:'canvas_upstream_status',status:response.status})); return json({error:'Canvas source unavailable'},503); }
    const clip = clipFrom(await boundedJSON(response));
    if (!clip) return json({error:'Invalid source response'},502);
    const result = json(clip,200,86400);
    if (cache) waitUntil(cache.put(key,result.clone()).catch(()=>{}));
    return result;
  } catch (error) { console.warn(JSON.stringify({event:'canvas_upstream_error',name:error.name,message:String(error.message).slice(0,160)})); return json({error:'Canvas source unavailable'},503); }
  finally { clearTimeout(timeout); }
}
/* ---------- Security layer: origin allowlist, rate limit, hardened headers ---------- */
export const ALLOWED_ORIGINS = ['https://coye2.github.io','https://open.spotify.com','http://localhost:8080','http://127.0.0.1:8080'];
const SECURITY_HEADERS = {
  'X-Content-Type-Options':'nosniff','X-Frame-Options':'DENY','Referrer-Policy':'no-referrer',
  'Content-Security-Policy':"default-src 'none'; frame-ancestors 'none'",'Cross-Origin-Resource-Policy':'cross-origin',
  'Strict-Transport-Security':'max-age=63072000; includeSubDomains','Permissions-Policy':'interest-cohort=()',
};
const RATE = {limit:120, windowMs:60000}, hits = new Map();
export function rateLimited(ip, now = Date.now(), table = hits, rate = RATE) {
  const entry = table.get(ip);
  if (!entry || now - entry.start > rate.windowMs) { table.set(ip,{start:now,count:1}); if (table.size > 5000) table.clear(); return false; }
  entry.count++;
  return entry.count > rate.limit;
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
  if (new URL(request.url).search.length > 1200) return finish(json({error:'Request too long'},414));
  const ip = request.headers.get('CF-Connecting-IP') || 'local';
  if (rateLimited(ip)) { const r = json({error:'Too many requests. Try again in a minute.'},429); return finish(new Response(r.body,{status:429,headers:{...Object.fromEntries(r.headers),'Retry-After':'60'}})); }
  return finish(await handle(request, options));
}
export default {fetch(request,env,ctx) { return secureHandle(request,{env,cache:caches.default,waitUntil:promise=>ctx.waitUntil(promise)}); }};
