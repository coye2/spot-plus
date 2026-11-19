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

export const RETRY_WAITS = [0, 1500];
// Cloudflare's free plan allows 50 subrequests per request. Finding a link may use at most this many, so
// the audio slices that follow always fit (a long track needs about one per 4 MB).
export const RESOLVE_BUDGET = 24;
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
async function servesWholeFile(stream, fetcher, signal) {
  if (!Number.isSafeInteger(stream.length) || stream.length < 2) return true;
  const from = stream.length - 2, to = stream.length - 1;
  const probe = await fetcher(stream.url, {
    headers: {Range: 'bytes=' + from + '-' + to, 'User-Agent': UA}, redirect: 'follow', signal,
  });
  const range = validateUpstreamRange(probe, from, to, stream.length);
  if (!range) { await probe.body?.cancel?.().catch(() => {}); return false; }
  // A returned 206 header is not proof the upstream sent the complete final bytes.
  try { return (await probe.arrayBuffer()).byteLength === 2; }
  catch { return false; }
}

async function resolveLink(id, {fetcher, cache, waitUntil, fresh = false, fmt = 'aac', signal}) {
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
  let result = null, used = 0;
  const upstream = fetcher;
  fetcher = (url, init) => {
    if (++used > RESOLVE_BUDGET) return Promise.reject(new Error('Too many YouTube lookups for one song'));
    return upstream(url, init);
  };
  for (const [attempt, wait] of RETRY_WAITS.entries()) {
    if (signal?.aborted) throw new Error('Playback request cancelled');
    if (attempt) {
      await new Promise((ok) => setTimeout(ok, wait));
      if (signal?.aborted) throw new Error('Playback request cancelled');
      await ensureVisitor(fetcher, {force: true, signal}).catch(() => {});
    }
    result = await innertubeStream(id, {fetcher, signal, preferAac: fmt !== 'opus', order: FORMATS[fmt], validate: (stream) => servesWholeFile(stream, fetcher, signal)});
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

// YouTube's upstream refuses unbounded ranges. Return an honest 206 with an exact
// Content-Range and stitch verified bounded chunks under backpressure.
export const SLICE = 1 << 20;
export const NEXT_SLICE = 4 << 20;

const mediaRequest = (url, from, to, signal, fetcher) => fetcher(url, {
  headers: {Range: 'bytes=' + from + '-' + to, 'User-Agent': UA},
  redirect: 'follow', signal,
});

async function discard(response) {
  try { await response?.body?.cancel?.(); } catch { /* best effort */ }
}

// Do not let an upstream return 5 bytes while claiming 5 MB. An early EOF is
// a failed stream, not a successful full-length song.
async function pipeExact(response, expectedBytes, writer) {
  if (!response.body) throw new Error('Missing upstream audio body');
  const reader = response.body.getReader();
  let actual = 0;
  try {
    while (true) {
      const {done, value} = await reader.read();
      if (done) break;
      actual += value.byteLength;
      if (actual > expectedBytes) throw new Error('Audio range exceeded its declared length');
      await writer.write(value);
    }
  } finally { reader.releaseLock(); }
  if (actual !== expectedBytes) throw new Error('Audio stream truncated: ' + actual + '/' + expectedBytes);
}

function unsatisfiable(total = 0) {
  return new Response(null, {
    status: 416,
    headers: {'Content-Range': 'bytes */' + (total || '*'), 'Cache-Control': 'no-store'},
  });
}

export async function youtubeRelay(request, {fetcher = fetch, cache, waitUntil = () => {}} = {}) {
  const url = new URL(request.url);
  const id = (url.searchParams.get('id') || '').trim();
  if (!/^[\w-]{11}$/.test(id)) return fail(400, 'Provide a YouTube video id');
  if (request.method !== 'GET' && request.method !== 'HEAD') return fail(405, 'GET or HEAD only');
  const fmt = Object.hasOwn(FORMATS, url.searchParams.get('fmt') || '') ? url.searchParams.get('fmt') : 'aac';
  const want = parseRequestRange(request.headers.get('Range'));
  if (!want) return unsatisfiable();

  let link, first, firstSpan, selected, lastStatus = 0, reason = 'Upstream audio unavailable';
  for (const fresh of [false, true]) {
    if (request.signal?.aborted) return fail(499, 'Playback request cancelled');
    try {
      link = await resolveLink(id, {fetcher, cache, waitUntil, fresh, fmt, signal: request.signal});
      let totalHint = Number(link.length) || 0;
      if (want.suffix !== undefined && !totalHint) {
        // Suffix ranges are uncommon but valid; discover the length using one byte.
        const sizeProbe = await mediaRequest(link.url, 0, 0, undefined, fetcher);
        const sizeSpan = validateUpstreamRange(sizeProbe, 0, 0);
        totalHint = sizeSpan?.total || 0;
        await discard(sizeProbe);
      }
      selected = want.suffix !== undefined
        ? resolveRequestRange(want, totalHint)
        : (totalHint ? resolveRequestRange(want, totalHint) : {start: want.start, end: want.end});
      if (!selected) return unsatisfiable(totalHint);
      const firstEnd = Math.min(selected.end ?? (selected.start + SLICE - 1), selected.start + SLICE - 1);
      first = await mediaRequest(link.url, selected.start, firstEnd, undefined, fetcher);
      lastStatus = first.status;
      firstSpan = validateUpstreamRange(first, selected.start, firstEnd, totalHint);
      if (firstSpan && first.body) break;
      reason = 'Unverified upstream range (' + first.status + ')';
      await discard(first);
      first = null;
      memo.delete(fmt + ':' + id);
      await cache?.delete(linkKey(id, fmt)).catch(() => {});
    } catch (error) {
      reason = String(error?.message || error).slice(0, 120);
      first = null;
    }
  }
  if (!first || !firstSpan) return fail(502, 'YouTube relay failed: ' + reason + (lastStatus ? ' (' + lastStatus + ')' : ''));

  const total = firstSpan.total;
  selected = resolveRequestRange(want, total);
  if (!selected) { await discard(first); return unsatisfiable(total); }
  const last = selected.end;
  const expected = last - selected.start + 1;
  const headers = new Headers({
    'Content-Type': link.mime,
    'Accept-Ranges': 'bytes',
    'Content-Range': 'bytes ' + selected.start + '-' + last + '/' + total,
    'Cache-Control': 'no-store',
    'X-Spotplus-Source': 'youtube-relay',
    'X-Spotplus-Itag': String(link.itag || 0),
  });
  if (link.duration > 0) headers.set('X-Spotplus-Duration', String(link.duration));
  headers.set('Content-Length', String(expected));
  if (request.method === 'HEAD') { await discard(first); return new Response(null, {status: 206, headers}); }

  // FixedLengthStream is required by Cloudflare to preserve Content-Length.
  // The TransformStream branch is for node:test's standard WHATWG stream mocks.
  const {readable, writable} = globalThis.FixedLengthStream
    ? new globalThis.FixedLengthStream(expected) : new TransformStream();
  const task = (async () => {
    const writer = writable.getWriter();
    let active = first;
    try {
      await pipeExact(first, firstSpan.length, writer);
      active = null;
      let renewed = false;
      for (let from = firstSpan.end + 1; from <= last;) {
        const to = Math.min(from + NEXT_SLICE - 1, last);
        let part = await mediaRequest(link.url, from, to, undefined, fetcher);
        active = part;
        let span = validateUpstreamRange(part, from, to, total);
        if (!span && !renewed) {
          renewed = true;
          await discard(part);
          memo.delete(fmt + ':' + id);
          await cache?.delete(linkKey(id, fmt)).catch(() => {});
          const newer = await resolveLink(id, {fetcher, cache, waitUntil, fresh: true, fmt});
          // A new itag or file length would splice two different encodings and corrupt the song.
          if (newer.mime !== link.mime ||
              (link.itag && newer.itag && link.itag !== newer.itag) ||
              (newer.length && newer.length !== total)) throw new Error('Upstream audio format changed');
          link = newer;
          part = await mediaRequest(link.url, from, to, undefined, fetcher);
          active = part;
          span = validateUpstreamRange(part, from, to, total);
        }
        if (!span) throw new Error('Upstream returned an invalid or incomplete range');
        await pipeExact(part, span.length, writer);
        active = null;
        from = span.end + 1;
      }
      await writer.close();
    } catch (error) {
      await discard(active);
      try { await writer.abort(error); } catch { /* listener already gone */ }
    } finally { writer.releaseLock(); }
  })();
  waitUntil(task);
  return new Response(readable, {status: 206, headers});
}
