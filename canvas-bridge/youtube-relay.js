// /yta: full-length YouTube audio relayed through the worker.
// YouTube's audio links are locked to the address that asked for them (here, Cloudflare's), so a phone
// cannot play them directly. The worker asks for the link and fetches the audio in the same request, then
// streams it to the app's own <audio> element: no YouTube player, no ads, and no extra tap.
// Unofficial: this depends on YouTube's internal player API and can break when YouTube changes it.
import {innertubeStream} from './youtube-stream.js';

const memo = new Map(); // video id -> {url, mime, expires} for this worker instance
const MAX_MEMO = 400;

const fail = (status, error) => new Response(JSON.stringify({error}), {status, headers: {'Content-Type': 'application/json', 'Cache-Control': 'no-store'}});

function expiresOf(link) {
  const e = Number(new URL(link).searchParams.get('expire')) || 0;
  return e ? e * 1000 : Date.now() + 3 * 3600e3;
}

const linkKey = (id) => `https://relay.internal/link/${id}`;

async function resolveLink(id, {fetcher, cache, waitUntil, fresh = false}) {
  const hit = memo.get(id);
  if (!fresh && hit && hit.expires - Date.now() > 10 * 60e3) return hit;
  // Other copies of the worker in this Cloudflare location share the link through the edge cache.
  if (!fresh && cache) {
    const shared = await cache.match(linkKey(id)).then((r) => r?.json()).catch(() => null);
    if (shared?.url && shared.expires - Date.now() > 10 * 60e3) { memo.set(id, shared); return shared; }
  }
  // AAC (m4a) first: every iPhone plays it in a plain <audio> element.
  const result = await innertubeStream(id, {fetcher, preferAac: true});
  const stream = result?.stream;
  if (!stream?.url) throw new Error(result?.reason || result?.error || 'No audio');
  const entry = {url: stream.url, mime: String(stream.mime || 'audio/mp4').split(';')[0], expires: expiresOf(stream.url)};
  memo.set(id, entry);
  if (memo.size > MAX_MEMO) memo.delete(memo.keys().next().value);
  const life = Math.floor((entry.expires - Date.now()) / 1000) - 900;
  if (cache && life > 60) waitUntil(cache.put(linkKey(id), new Response(JSON.stringify(entry), {headers: {'Cache-Control': `max-age=${life}`}})).catch(() => {}));
  return entry;
}

export async function youtubeRelay(request, {fetcher = fetch, cache, waitUntil = () => {}} = {}) {
  const url = new URL(request.url);
  const id = (url.searchParams.get('id') || '').trim();
  if (!/^[\w-]{11}$/.test(id)) return fail(400, 'Provide a YouTube video id');
  if (request.method !== 'GET' && request.method !== 'HEAD') return fail(405, 'GET only');
  const range = request.headers.get('Range') || 'bytes=0-';
  if (!/^bytes=\d*-\d*$/.test(range)) return fail(416, 'Bad range');

  let lastStatus = 0;
  for (const fresh of [false, true]) {
    let link;
    try { link = await resolveLink(id, {fetcher, cache, waitUntil, fresh}); }
    catch (error) { return fail(502, String(error.message || 'No audio').slice(0, 120)); }
    const upstream = await fetcher(link.url, {method: request.method, headers: {Range: range, 'User-Agent': 'Mozilla/5.0'}, redirect: 'follow'});
    lastStatus = upstream.status;
    // 403: the link expired or this request left Cloudflare from another address; get a new link once.
    if ((upstream.status === 403 || upstream.status === 410) && !fresh) { memo.delete(id); await cache?.delete(linkKey(id)).catch(() => {}); continue; }
    if (!upstream.ok) break;
    const headers = new Headers();
    headers.set('Content-Type', link.mime);
    headers.set('Accept-Ranges', 'bytes');
    for (const h of ['Content-Length', 'Content-Range']) { const v = upstream.headers.get(h); if (v) headers.set(h, v); }
    headers.set('Cache-Control', 'private, max-age=3600');
    headers.set('X-Spotplus-Source', 'youtube-relay');
    return new Response(request.method === 'HEAD' ? null : upstream.body, {status: upstream.status, headers});
  }
  return fail(502, 'YouTube refused the audio (' + lastStatus + ')');
}
