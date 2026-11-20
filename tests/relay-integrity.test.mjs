import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseRequestRange, parseContentRange, validateUpstreamRange, resolveRequestRange,
} from '../canvas-bridge/relay-integrity.js';
import {youtubeRelay, SLICE, NEXT_SLICE} from '../canvas-bridge/youtube-relay.js';

// Cloudflare's FixedLengthStream fails the response when the bytes written don't match the declared length.
// The relay relies on it (it pipes natively instead of counting bytes in JavaScript), so tests get the same rule.
globalThis.FixedLengthStream ??= class FixedLengthStream extends TransformStream {
  constructor(expected) {
    let seen = 0;
    super({
      transform(chunk, controller) {
        seen += chunk.byteLength;
        if (seen > expected) throw new Error('FixedLengthStream: too many bytes');
        controller.enqueue(chunk);
      },
      flush() { if (seen !== expected) throw new Error(`FixedLengthStream: ${seen}/${expected} bytes`); },
    });
  }
};

test('range parser accepts explicit, open-ended and suffix ranges but rejects reversed and invalid input', () => {
  assert.deepEqual(parseRequestRange('bytes=1-9'), {start: 1, end: 9});
  assert.deepEqual(parseRequestRange('bytes=42-'), {start: 42, end: null});
  assert.deepEqual(parseRequestRange('bytes=-128'), {suffix: 128});
  assert.deepEqual(parseRequestRange(null), {start: 0, end: null});
  for (const bad of ['bytes=9-1', 'bytes=0-1,2-3', 'bytes=garbage', 'bytes=-0', 'bytes=9007199254740993-', 'bytes=-']) {
    assert.equal(parseRequestRange(bad), null, bad);
  }
});
test('upstream 206 must agree on start, end, full size and announced length', () => {
  const ok = new Response('abc', {status: 206, headers: {'Content-Range': 'bytes 2-4/10', 'Content-Length': '3'}});
  assert.deepEqual(parseContentRange(ok.headers.get('Content-Range')), {start: 2, end: 4, total: 10, length: 3});
  assert.equal(validateUpstreamRange(ok, 2, 4, 10).length, 3);
  assert.equal(validateUpstreamRange(ok, 1, 4, 10), null);
  assert.equal(validateUpstreamRange(ok, 2, 4, 11), null);
  assert.equal(validateUpstreamRange(new Response('abc', {status: 200}), 2, 4), null);
  assert.equal(validateUpstreamRange(new Response('abc', {status: 206, headers: {'Content-Range': 'bytes 2-4/10', 'Content-Length': '999'}}), 2, 4), null);
  assert.deepEqual(resolveRequestRange({suffix: 200}, 50), {start: 0, end: 49});
  assert.deepEqual(resolveRequestRange({start: 40, end: null}, 50), {start: 40, end: 49});
  assert.equal(resolveRequestRange({start: 50, end: null}, 50), null);
});

function mockAudio({id, total = 4000, duration = 180, lengthKnown = true, status200 = false, badRange = false, truncateAt = -1} = {}) {
  const audio = Uint8Array.from({length: total}, (_, i) => (i * 7 + 3) % 251);
  const calls = [];
  let issued = 0;
  const fetcher = async (url, opts = {}) => {
    const u = String(url);
    if (u.includes('visitor_id')) return new Response(JSON.stringify({responseContext: {visitorData: 'visitor'}}));
    if (u.includes('/youtubei/v1/player')) {
      issued++;
      return new Response(JSON.stringify({playabilityStatus: {status: 'OK'},
        videoDetails: {lengthSeconds: String(duration)},
        streamingData: {adaptiveFormats: [{
          itag: 140, mimeType: 'audio/mp4; codecs="mp4a.40.2"', bitrate: 128000,
          ...(lengthKnown ? {contentLength: String(total)} : {}),
          url: 'https://rr.googlevideo.com/videoplayback?v=' + id + '&n=' + issued +
            '&expire=' + (Math.floor(Date.now() / 1000) + 3600),
        }]}}));
    }
    assert.ok(u.includes('googlevideo.com'), 'only allow fixed upstream audio host');
    const range = /^bytes=(\d+)-(\d+)$/.exec(opts.headers?.Range || '');
    assert.ok(range, 'upstream requests must be bounded');
    const start = Number(range[1]), end = Math.min(Number(range[2]), total - 1);
    calls.push([start, end]);
    const actual = start === truncateAt ? Math.max(0, end - start) : end - start + 1;
    return new Response(audio.slice(start, start + actual), {
      status: status200 ? 200 : 206,
      headers: {'Content-Range': 'bytes ' + (badRange ? start + 1 : start) + '-' + end + '/' + total},
    });
  };
  return {fetcher, calls, audio};
}

test('official relay reports authoritative timeline, readable 206 ranges and the correct track bytes', async () => {
  const m = mockAudio({id: 'test01', duration: 203});
  const response = await youtubeRelay(new Request('https://w.dev/yta?id=YYYYYYYYY01', {
    headers: {Range: 'bytes=500-799'},
  }), {fetcher: m.fetcher});
  assert.equal(response.status, 206);
  assert.equal(response.headers.get('Content-Range'), 'bytes 500-799/4000');
  assert.equal(response.headers.get('Content-Length'), '300');
  assert.equal(response.headers.get('X-Spotplus-Duration'), '203');
  assert.equal(response.headers.get('X-Spotplus-Itag'), '140');
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
  assert.deepEqual(new Uint8Array(await response.arrayBuffer()), m.audio.slice(500, 800));
});

test('relay handles Safari suffix seek without sending unbounded upstream ranges', async () => {
  const m = mockAudio({id: 'test02', total: 721, lengthKnown: false});
  const response = await youtubeRelay(new Request('https://w.dev/yta?id=YYYYYYYYY02', {
    headers: {Range: 'bytes=-21'},
  }), {fetcher: m.fetcher});
  assert.equal(response.status, 206);
  assert.equal(response.headers.get('Content-Range'), 'bytes 700-720/721');
  assert.deepEqual(new Uint8Array(await response.arrayBuffer()), m.audio.slice(700));
  assert.deepEqual(m.calls, [[0, 0], [700, 720]]);
});

test('relay denies an unsatisfiable seek instead of returning a fake partial song', async () => {
  const m = mockAudio({id: 'test03', total: 91});
  const response = await youtubeRelay(new Request('https://w.dev/yta?id=YYYYYYYYY03', {
    headers: {Range: 'bytes=92-'},
  }), {fetcher: m.fetcher});
  assert.equal(response.status, 416);
  assert.equal(response.headers.get('Content-Range'), 'bytes */91');
});

test('relay does not accept upstream HTTP 200 or misreported byte ranges', async () => {
  for (const [index, flags] of [{status200: true}, {badRange: true}].entries()) {
    const m = mockAudio({id: 'fail' + index, ...flags});
    const response = await youtubeRelay(new Request('https://w.dev/yta?id=YYYYYYYYY1' + index, {
      headers: {Range: 'bytes=0-1'},
    }), {fetcher: m.fetcher});
    assert.equal(response.status, 502);
  }
});

test('long tracks are streamed as byte-identical bounded pieces, even beyond multiple slices', async () => {
  const total = SLICE + NEXT_SLICE + 4097;
  const m = mockAudio({id: 'long', total});
  const waits = [];
  const response = await youtubeRelay(new Request('https://w.dev/yta?id=YYYYYYYYY20', {
    headers: {Range: 'bytes=0-'},
  }), {fetcher: m.fetcher, waitUntil: p => waits.push(p)});
  const played = new Uint8Array(await response.arrayBuffer());
  await Promise.all(waits);
  assert.equal(response.status, 206);
  assert.equal(played.byteLength, total);
  assert.deepEqual(played, m.audio);
  // Parallel lookups may each check the end of the file once; after that, the audio slices in order.
  const probes = m.calls.filter(([a, b]) => a === total - 2 && b === total - 1).length;
  assert.ok(probes >= 1 && probes <= 3, String(probes));
  assert.deepEqual(m.calls.slice(probes - 1), [[total - 2, total - 1], [0, SLICE - 1],
    [SLICE, SLICE + NEXT_SLICE - 1], [SLICE + NEXT_SLICE, total - 1]]);
});

test('a truncated mid-song chunk produces a failed stream instead of silent song completion', async () => {
  const total = SLICE + 200;
  const m = mockAudio({id: 'cut', total, truncateAt: SLICE});
  const waits = [];
  const response = await youtubeRelay(new Request('https://w.dev/yta?id=YYYYYYYYY21', {
    headers: {Range: 'bytes=0-'},
  }), {fetcher: m.fetcher, waitUntil: p => waits.push(p)});
  assert.equal(response.status, 206);
  await assert.rejects(response.arrayBuffer());
  await Promise.all(waits);
});
