// A narrow public-metadata adapter, never an arbitrary URL or credential proxy.
import {spotifyStats} from './spotify-stats.js';
import {jamRoute} from './jam.js';
export {JamRoom} from './jam.js';
const SOURCE = 'https://canvas.auramusic.site/api/canvas';
const CORS = {'Access-Control-Allow-Origin':'*','Access-Control-Allow-Methods':'GET, OPTIONS','Content-Type':'application/json; charset=utf-8','X-Content-Type-Options':'nosniff'};
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
  if (new URL(request.url).pathname.startsWith('/jam/')) return jamRoute(request, env);
  if (request.method !== 'GET') return json({error:'Use GET'},405);
  const url = new URL(request.url);
  if (url.pathname === '/spotify-stats') return spotifyStats(request,{fetcher,cache,waitUntil});
  if (url.pathname === '/health') return json({service:'Spot+ Canvas bridge',status:'ok',jam:!!env?.JAM,lyrics:true});
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
export default {fetch(request,env,ctx) { return handle(request,{env,cache:caches.default,waitUntil:promise=>ctx.waitUntil(promise)}); }};
