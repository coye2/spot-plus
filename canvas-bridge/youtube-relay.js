// /yta: full-length YouTube audio relayed through the worker.
// YouTube's audio links are locked to the address that asked for them (here, Cloudflare's), so a phone
// cannot play them directly. The worker asks for the link and fetches the audio in the same request, then
// streams it to the app's own <audio> element: no YouTube player, no ads, and no extra tap.
// Unofficial: this depends on YouTube's internal player API and can break when YouTube changes it.
import {innertubeStream, freshVisitor, AUDIO_ITAGS} from './youtube-stream.js';
import {parseRequestRange, validateUpstreamRange, resolveRequestRange} from './relay-integrity.js';

// Like Spotube's quality setting: Opus 160 kbps where the browser plays it, AAC 128 kbps for iPhone/Safari,
// and a data-saver tier. Each falls back to the next format YouTube has for the song.
export const FORMATS = {
  opus: [AUDIO_ITAGS.opus, AUDIO_ITAGS.aac, AUDIO_ITAGS.opus70],
  aac: [AUDIO_ITAGS.aac, AUDIO_ITAGS.aacLow],
  low: [AUDIO_ITAGS.aacLow, AUDIO_ITAGS.aac],
  'low-opus': [AUDIO_ITAGS.opus50, AUDIO_ITAGS.opus70, AUDIO_ITAGS.aacLow, AUDIO_ITAGS.aac],
};

// Two attempts: a short bot-check burst is outlasted by the second, and when YouTube has flagged the server for a
// while, more attempts only made each refusal take 12-15 s (live, 2026-11-19); the app moves on instead.
export const RETRY_WAITS = [0, 1200]; // kept for older callers
// YouTube's refusals come in bursts that hit every request at that moment (live, 2026-11-19: seven parallel
// lookups were refused together), so the waves are spread over about five seconds rather than fired at once.
// Each server gives up within about two seconds: when YouTube is refusing this server's address, the app does
// better retrying through a Spot+ server in another region (relay-west / relay-eu) than waiting here.
export const WAVES = [
  {profile: 'visionos', lookups: 2},
  {profile: 'android_vr', lookups: 1, wait: 800},
];

/** Runs the lookups at once; resolves with the first that found a stream (and cancels the rest), else the first failure. */
function firstGood(jobs, signal) {
  return new Promise((resolve) => {
    const ctl = new AbortController();
    const stop = () => ctl.abort();
    signal?.addEventListener?.('abort', stop, {once: true});
    let left = jobs.length, failure = null;
    const done = (value) => { signal?.removeEventListener?.('abort', stop); resolve(value); };
    for (const job of jobs) {
      Promise.resolve().then(() => job(ctl.signal)).then((r) => {
        if (r?.stream?.url && !ctl.signal.aborted) { ctl.abort(); done(r); return; }
        failure ||= r;
        if (--left === 0) done(failure || {error: 'No audio'});
      }, (e) => { failure ||= {error: String(e?.message || e)}; if (--left === 0) done(failure); });
    }
  });
}
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
  // YouTube refuses a share of lookups from cloud servers ("confirm you're not a bot"), seemingly at random per
  // request. Asking one at a time made a refusal cost seconds and still often fail; instead each wave asks several
  // times at once, each with its own visitor identity, and takes the first good link (the rest are cancelled).
  let used = 0;
  const upstream = fetcher;
  fetcher = (url, init) => {
    if (++used > RESOLVE_BUDGET) return Promise.reject(new Error('Too many YouTube lookups for one song'));
    return upstream(url, init);
  };
  let result = null;
  for (const [index, wave] of WAVES.entries()) {
    if (signal?.aborted) throw new Error('Playback request cancelled');
    if (wave.wait) await new Promise((ok) => setTimeout(ok, wave.wait));
    result = await firstGood(Array.from({length: wave.lookups}, (_, n) => async (waveSignal) => {
      // The first lookup of the first wave uses the shared identity (no extra request); the others bring their own.
      const visitor = index === 0 && n === 0 ? undefined : await freshVisitor(fetcher, {signal: waveSignal});
      return innertubeStream(id, {fetcher, signal: waveSignal, visitor, retryLogin: false, profiles: [wave.profile],
        preferAac: fmt !== 'opus', order: FORMATS[fmt], validate: (stream) => servesWholeFile(stream, fetcher, waveSignal)});
    }), signal);
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

// Audio is piped natively (pipeTo), never copied chunk by chunk in JavaScript: Cloudflare's free plan
// allows 10 ms of CPU per request, and a JavaScript copy loop ran out of it mid-song (live, 1.9.48:
// streams stopped after 77 bytes, 1 MB or 5 MB). Byte counts are still enforced: every slice's
// Content-Range is checked before use, and FixedLengthStream fails the response if the total differs.
async function pipeSlice(response, writable) {
  if (!response.body) throw new Error('Missing upstream audio body');
  await response.body.pipeTo(writable, {preventClose: true});
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
    let active = first;
    try {
      await pipeSlice(first, writable);
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
        await pipeSlice(part, writable);
        active = null;
        from = span.end + 1;
      }
      await writable.close();
    } catch (error) {
      await discard(active);
      try { await writable.abort(error); } catch { /* listener already gone */ }
    }
  })();
  waitUntil(task);
  return new Response(readable, {status: 206, headers});
}
