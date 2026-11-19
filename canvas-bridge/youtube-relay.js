// /yta: full-length YouTube audio relayed through the worker.
// YouTube's audio links are locked to the address that asked for them (here, Cloudflare's), so a phone
// cannot play them directly. The worker asks for the link and fetches the audio in the same request, then
// streams it to the app's own <audio> element: no YouTube player, no ads, and no extra tap.
// Unofficial: this depends on YouTube's internal player API and can break when YouTube changes it.
import {innertubeStream, ensureVisitor, AUDIO_ITAGS} from './youtube-stream.js';
import {parseRequestRange, validateUpstreamRange, resolveRequestRange} from './relay-integrity.js';

// Like Spotube's quality setting: Opus 160 kbps where the browser plays it, AAC 128 kbps for iPhone/Safari,
// and a data-saver tier. Each falls back to the next format YouTube has for the song.
export const FORMATS = {
  opus: [AUDIO_ITAGS.opus, AUDIO_ITAGS.aac, AUDIO_ITAGS.opus70],
  aac: [AUDIO_ITAGS.aac, AUDIO_ITAGS.aacLow],
  low: [AUDIO_ITAGS.aacLow, AUDIO_ITAGS.aac],
  'low-opus': [AUDIO_ITAGS.opus50, AUDIO_ITAGS.opus70, AUDIO_ITAGS.aacLow, AUDIO_ITAGS.aac],
};

export const RETRY_WAITS = [0, 1200, 2800];
const memo = new Map(); // video id -> {url, mime, expires} for this worker instance
const MAX_MEMO = 400;

const fail = (status, error) => new Response(JSON.stringify({error}), {status, headers: {'Content-Type': 'application/json', 'Cache-Control': 'no-store'}});

function expiresOf(link) {
  const e = Number(new URL(link).searchParams.get('expire')) || 0;
  return e ? e * 1000 : Date.now() + 3 * 3600e3;
}

// v2: links cached before the switch to the VISIONOS client stop after the first chunk, so they are not reused.
const linkKey = (id, fmt) => `https://relay.internal/link/v3/${fmt}/${id}`;
const UA = 'Mozilla/5.0';

// YouTube sometimes hands out a link that plays the first chunk and refuses the rest (it wants a PO token
// for that client). Asking for the last two bytes catches that before the app gets a song that cuts out.
async function servesWholeFile(stream, fetcher) {
  if (!Number.isSafeInteger(stream.length) || stream.length < 2) return true;
  const from = stream.length - 2, to = stream.length - 1;
  const probe = await fetcher(stream.url, {
    headers: {Range: 'bytes=' + from + '-' + to, 'User-Agent': UA}, redirect: 'follow',
  });
  const range = validateUpstreamRange(probe, from, to, stream.length);
  if (!range) { await probe.body?.cancel?.().catch(() => {}); return false; }
  // A returned 206 header is not proof the upstream sent the complete final bytes.
  try { return (await probe.arrayBuffer()).byteLength === 2; }
  catch { return false; }
}

async function resolveLink(id, {fetcher, cache, waitUntil, fresh = false, fmt = 'aac'}) {
  const hit = memo.get(`${fmt}:${id}`);
  if (!fresh && hit && hit.expires - Date.now() > 10 * 60e3) return hit;
  // Other copies of the worker in this Cloudflare location share the link through the edge cache.
  if (!fresh && cache) {
    const shared = await cache.match(linkKey(id, fmt)).then((r) => r?.json()).catch(() => null);
    if (shared?.url && shared.expires - Date.now() > 10 * 60e3) { memo.set(`${fmt}:${id}`, shared); return shared; }
  }
  // AAC (m4a) first: every iPhone plays it in a plain <audio> element. YouTube sometimes answers
  // "confirm you're not a bot" for a session; a fresh session usually gets through, so try up to 3 times.
  // The check comes in bursts of a few seconds, so the retries are spread out to outlast one.
  let result = null;
  for (const [attempt, wait] of RETRY_WAITS.entries()) {
    if (attempt) { await new Promise((ok) => setTimeout(ok, wait)); await ensureVisitor(fetcher, {force: true}).catch(() => {}); }
    result = await innertubeStream(id, {fetcher, preferAac: fmt !== 'opus', order: FORMATS[fmt], validate: (stream) => servesWholeFile(stream, fetcher)});
    if (result?.stream?.url) break;
  }
  const stream = result?.stream;
  if (!stream?.url) throw new Error(result?.reason || result?.error || 'No audio');
  const entry = {url: stream.url, mime: String(stream.mime || 'audio/mp4').split(';')[0], expires: expiresOf(stream.url),
    length: Number(stream.length) || 0, duration: Number(stream.duration) || 0, itag: Number(stream.itag) || 0};
  memo.set(`${fmt}:${id}`, entry);
  if (memo.size > MAX_MEMO) memo.delete(memo.keys().next().value);
  const life = Math.floor((entry.expires - Date.now()) / 1000) - 900;
  if (cache && life > 60) waitUntil(cache.put(linkKey(id, fmt), new Response(JSON.stringify(entry), {headers: {'Cache-Control': `max-age=${life}`}})).catch(() => {}));
  return entry;
}

// YouTube serves its audio in bounded slices: an open-ended request ("the rest of the file", which is what
// Safari asks for) is refused. The relay answers the start with a 1 MB slice (fast first sound), then
// fetches the rest in bigger slices and joins them into one response. Bigger later slices keep a long
// track well under Cloudflare's per-request subrequest limit (yt-dlp itself asks for 10 MB at a time).
export const SLICE = 1 << 20;
export const NEXT_SLICE = 4 << 20;

function parseRange(header) {
  const m = /^bytes=(\d*)-(\d*)$/.exec(header || 'bytes=0-');
  if (!m || (m[1] === '' && m[2] === '')) return null;
  if (m[1] === '') return {suffix: Number(m[2])};
  return {start: Number(m[1]), end: m[2] === '' ? null : Number(m[2])};
}
const totalOf = (res) => Number((/\/(\d+)\s*$/.exec(res.headers.get('Content-Range') || '') || [])[1]) || 0;

export async function youtubeRelay(request, {fetcher = fetch, cache, waitUntil = () => {}} = {}) {
  const url = new URL(request.url);
  const id = (url.searchParams.get('id') || '').trim();
  if (!/^[\w-]{11}$/.test(id)) return fail(400, 'Provide a YouTube video id');
  if (request.method !== 'GET' && request.method !== 'HEAD') return fail(405, 'GET only');
  const fmt = Object.hasOwn(FORMATS, url.searchParams.get('fmt') || '') ? url.searchParams.get('fmt') : 'aac';
  const want = parseRange(request.headers.get('Range'));
  if (!want || want.suffix !== undefined) return fail(416, 'Bad range');

  // Everything for one request happens here, back to back: YouTube's link only works from the Cloudflare
  // address that asked for it, and a later request may leave from another address.
  let link = null, first = null, lastStatus = 0;
  const firstEnd = want.end === null ? want.start + SLICE - 1 : Math.min(want.end, want.start + SLICE - 1);
  for (const fresh of [false, true]) {
    try { link = await resolveLink(id, {fetcher, cache, waitUntil, fresh, fmt}); }
    catch (error) { return fail(502, String(error.message || 'No audio').slice(0, 120)); }
    first = await fetcher(link.url, {headers: {Range: `bytes=${want.start}-${firstEnd}`, 'User-Agent': UA}, redirect: 'follow'});
    lastStatus = first.status;
    if ((first.status === 403 || first.status === 410) && !fresh) { memo.delete(`${fmt}:${id}`); await cache?.delete(linkKey(id, fmt)).catch(() => {}); continue; }
    break;
  }
  if (!first?.ok) return fail(502, 'YouTube refused the audio (' + lastStatus + ')');

  const total = totalOf(first);
  const last = total ? Math.min(want.end === null ? total - 1 : want.end, total - 1) : firstEnd;
  const headers = new Headers({'Content-Type': link.mime, 'Accept-Ranges': 'bytes', 'Cache-Control': 'private, max-age=3600', 'X-Spotplus-Source': 'youtube-relay'});
  if (total) headers.set('Content-Range', `bytes ${want.start}-${last}/${total}`);
  headers.set('Content-Length', String(last - want.start + 1));
  if (request.method === 'HEAD') { first.body?.cancel?.(); return new Response(null, {status: 206, headers}); }
  // One slice covers it (the app's 2-byte check, small seeks): pass it straight through.
  if (last <= firstEnd) return new Response(first.body, {status: 206, headers});

  // Bigger requests: stream the slices one after another, as one response. If YouTube refuses a slice
  // (the link aged out or was cut off), get a fresh link once and carry on from the same byte.
  // Cloudflare's FixedLengthStream keeps the exact Content-Length on a streamed body, which Safari needs.
  const {readable, writable} = globalThis.FixedLengthStream ? new globalThis.FixedLengthStream(last - want.start + 1) : new TransformStream();
  const slice = (from, to) => fetcher(link.url, {headers: {Range: `bytes=${from}-${to}`, 'User-Agent': UA}, redirect: 'follow'});
  const pump = (async () => {
    try {
      await first.body.pipeTo(writable, {preventClose: true});
      let renewed = false;
      for (let from = firstEnd + 1; from <= last;) {
        const to = Math.min(from + NEXT_SLICE - 1, last);
        let part = await slice(from, to);
        if ((part.status === 403 || part.status === 410) && !renewed) {
          renewed = true;
          part.body?.cancel?.();
          memo.delete(`${fmt}:${id}`);
          link = await resolveLink(id, {fetcher, cache, waitUntil, fresh: true, fmt});
          part = await slice(from, to);
          // A different file (another format) would corrupt the join, so only carry on with the same size.
          if (part.ok && totalOf(part) && totalOf(part) !== total) throw new Error('format changed');
        }
        if (!part.ok) throw new Error('slice ' + part.status);
        await part.body.pipeTo(writable, {preventClose: true});
        from = to + 1;
      }
      await writable.close();
    } catch (error) {
      // The player sees a short response and simply asks again for the rest.
      await writable.abort(error).catch(() => {});
    }
  })();
  waitUntil(pump);
  return new Response(readable, {status: 206, headers});
}
