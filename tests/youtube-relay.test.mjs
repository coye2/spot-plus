import test from 'node:test';
import assert from 'node:assert/strict';
import {youtubeRelay} from '../canvas-bridge/youtube-relay.js';

const player = (n) => new Response(JSON.stringify({playabilityStatus: {status: 'OK'}, streamingData: {adaptiveFormats: [
  {itag: 140, mimeType: 'audio/mp4; codecs="mp4a.40.2"', bitrate: 130000, url: `https://rr1.googlevideo.com/videoplayback?expire=${Math.floor(Date.now() / 1000) + 20000}&ip=1.2.3.4&n=${n}`},
  {itag: 251, mimeType: 'audio/webm; codecs="opus"', bitrate: 160000, url: 'https://rr1.googlevideo.com/videoplayback?itag=251'},
]}}));

function fakeYouTube({firstMediaStatus = 206} = {}) {
  const calls = {player: 0, media: []};
  const fetcher = async (url, init = {}) => {
    const u = String(url);
    if (u.includes('visitor_id')) return new Response(JSON.stringify({responseContext: {visitorData: 'v'}}));
    if (u.includes('/youtubei/v1/player')) { calls.player++; return player(calls.player); }
    if (u.includes('googlevideo.com')) {
      calls.media.push({url: u, range: init.headers?.Range});
      const status = calls.media.length === 1 ? firstMediaStatus : 206;
      if (status !== 206) return new Response('', {status});
      const range = /^bytes=(\d+)-(\d+)$/.exec(init.headers.Range);
      const from = Number(range[1]), to = Math.min(Number(range[2]), 4999);
      const length = to - from + 1;
      return new Response(length === 5 ? 'AUDIO' : new Uint8Array(length), {
        status: 206, headers: {'Content-Range': 'bytes ' + from + '-' + to + '/5000', 'Content-Length': String(length)},
      });
    }
    throw new Error('unexpected ' + u);
  };
  return {fetcher, calls};
}

test('/yta streams the AAC audio with the range the player asked for', async () => {
  const {fetcher, calls} = fakeYouTube();
  const r = await youtubeRelay(new Request('https://w.dev/yta?id=aaaaaaaaaaa', {headers: {Range: 'bytes=0-4'}}), {fetcher});
  assert.equal(r.status, 206);
  assert.equal(r.headers.get('Content-Type'), 'audio/mp4');
  assert.equal(r.headers.get('Content-Range'), 'bytes 0-4/5000');
  assert.equal(await r.text(), 'AUDIO');
  assert.equal(calls.media[0].range, 'bytes=0-4');
  assert.match(calls.media[0].url, /n=1/);
});

test('/yta gets a fresh link once when YouTube refuses the old one', async () => {
  const {fetcher, calls} = fakeYouTube({firstMediaStatus: 403});
  const r = await youtubeRelay(new Request('https://w.dev/yta?id=bbbbbbbbbbb'), {fetcher});
  assert.equal(r.status, 206);
  assert.equal(calls.media.length, 2);
  assert.notEqual(calls.media[1].url, calls.media[0].url, 'second try uses a newly requested link');
});

test('/yta rejects bad ids and bad ranges', async () => {
  const {fetcher} = fakeYouTube();
  assert.equal((await youtubeRelay(new Request('https://w.dev/yta?id=nope'), {fetcher})).status, 400);
  assert.equal((await youtubeRelay(new Request('https://w.dev/yta?id=ccccccccccc', {headers: {Range: 'bytes=evil'}}), {fetcher})).status, 416);
});

test('/yta retries with a fresh YouTube session after a bot check', async () => {
  let players = 0, visitors = 0;
  const fetcher = async (url) => {
    const u = String(url);
    if (u.includes('visitor_id')) { visitors++; return new Response(JSON.stringify({responseContext: {visitorData: 'v' + visitors}})); }
    if (u.includes('/youtubei/v1/player')) {
      players++;
      if (players <= 3) return new Response(JSON.stringify({playabilityStatus: {status: 'LOGIN_REQUIRED', reason: 'Sign in to confirm you’re not a bot'}}));
      return player(players);
    }
    if (u.includes('googlevideo.com')) return new Response('AUDIO', {status: 206, headers: {'Content-Range': 'bytes 0-4/5000'}});
    throw new Error('unexpected ' + u);
  };
  const r = await youtubeRelay(new Request('https://w.dev/yta?id=ddddddddddd', {headers: {Range: 'bytes=0-4'}}), {fetcher});
  assert.equal(r.status, 206);
  assert.ok(visitors >= 2, 'asked YouTube for a new session');
});

test('/yta picks the format the app asks for, like Spotube’s quality setting', async () => {
  const formats = [
    {itag: 140, mimeType: 'audio/mp4; codecs="mp4a.40.2"', bitrate: 130000, url: 'https://rr1.googlevideo.com/videoplayback?itag=140&expire=9999999999'},
    {itag: 139, mimeType: 'audio/mp4; codecs="mp4a.40.5"', bitrate: 48000, url: 'https://rr1.googlevideo.com/videoplayback?itag=139&expire=9999999999'},
    {itag: 251, mimeType: 'audio/webm; codecs="opus"', bitrate: 160000, url: 'https://rr1.googlevideo.com/videoplayback?itag=251&expire=9999999999'},
  ];
  const seen = [];
  const fetcher = async (url) => {
    const u = String(url);
    if (u.includes('visitor_id')) return new Response(JSON.stringify({responseContext: {visitorData: 'v'}}));
    if (u.includes('/youtubei/v1/player')) return new Response(JSON.stringify({playabilityStatus: {status: 'OK'}, streamingData: {adaptiveFormats: formats}}));
    seen.push(u);
    return new Response('A', {status: 206, headers: {'Content-Range': 'bytes 0-0/9'}});
  };
  const types = {};
  for (const [fmt, id] of [['opus', 'eeeeeeeeee1'], ['aac', 'eeeeeeeeee2'], ['low', 'eeeeeeeeee3']]) {
    const r = await youtubeRelay(new Request(`https://w.dev/yta?id=${id}&fmt=${fmt}`, {headers: {Range: 'bytes=0-0'}}), {fetcher});
    types[fmt] = r.headers.get('Content-Type');
  }
  assert.deepEqual(seen.map(u => new URL(u).searchParams.get('itag')), ['251', '140', '139']);
  assert.deepEqual(types, {opus: 'audio/webm', aac: 'audio/mp4', low: 'audio/mp4'});
});

test('/match retries once when YouTube search hiccups', async () => {
  const {youtubeMatch} = await import('../canvas-bridge/youtube-match.js');
  let calls = 0;
  const fetcher = async () => {
    calls++;
    if (calls === 1) return new Response('busy', {status: 503});
    return new Response(JSON.stringify({contents: {}}));
  };
  const r = await youtubeMatch(new Request('https://w.dev/match?q=the%20cure'), {fetcher});
  assert.equal(r.status, 200);
  assert.equal(calls, 2);
});

test('/yta answers Safari’s open-ended request with the whole song, fetched from YouTube in bounded slices', async () => {
  const {SLICE, NEXT_SLICE} = await import('../canvas-bridge/youtube-relay.js');
  const TOTAL = SLICE + NEXT_SLICE + Math.floor(SLICE / 2);
  const audio = new Uint8Array(TOTAL).map((_, i) => i % 251);
  const asked = [];
  const waits = [];
  const fetcher = async (url, init = {}) => {
    const u = String(url);
    if (u.includes('visitor_id')) return new Response(JSON.stringify({responseContext: {visitorData: 'v'}}));
    if (u.includes('/youtubei/v1/player')) return player(1);
    const [, a, b] = /bytes=(\d+)-(\d*)/.exec(init.headers.Range);
    if (b === '') return new Response('', {status: 403}); // YouTube refuses open-ended ranges
    const from = Number(a), to = Math.min(Number(b), TOTAL - 1);
    asked.push([from, to]);
    return new Response(audio.slice(from, to + 1), {status: 206, headers: {'Content-Range': `bytes ${from}-${to}/${TOTAL}`}});
  };
  const r = await youtubeRelay(new Request('https://w.dev/yta?id=fffffffffff', {headers: {Range: 'bytes=0-'}}), {fetcher, waitUntil: (p) => waits.push(p)});
  assert.equal(r.status, 206);
  assert.equal(r.headers.get('Content-Range'), `bytes 0-${TOTAL - 1}/${TOTAL}`);
  assert.equal(r.headers.get('Content-Length'), String(TOTAL));
  const body = new Uint8Array(await r.arrayBuffer());
  await Promise.all(waits);
  assert.equal(body.length, TOTAL);
  assert.deepEqual(body.slice(SLICE - 2, SLICE + 2), audio.slice(SLICE - 2, SLICE + 2));
  assert.deepEqual(asked, [[0, SLICE - 1], [SLICE, SLICE + NEXT_SLICE - 1], [SLICE + NEXT_SLICE, TOTAL - 1]]);
});

// A YouTube stand-in that knows which app identity asked, and can refuse links past the first chunk
// (what YouTube now does to ANDROID_VR / IOS links without a PO token).
function clientAwareYouTube({total, cutOff = new Set(), refuseOnce = null}) {
  const audio = new Uint8Array(total).map((_, i) => (i * 7) % 253);
  const seen = {clients: [], ranges: []};
  let issued = 0;
  const fetcher = async (url, init = {}) => {
    const u = String(url);
    if (u.includes('visitor_id')) return new Response(JSON.stringify({responseContext: {visitorData: 'v'}}));
    if (u.includes('/youtubei/v1/player')) {
      const client = JSON.parse(init.body).context.client.clientName;
      seen.clients.push(client);
      issued++;
      return new Response(JSON.stringify({playabilityStatus: {status: 'OK'}, streamingData: {adaptiveFormats: [
        {itag: 140, mimeType: 'audio/mp4; codecs="mp4a.40.2"', bitrate: 130000, contentLength: String(total),
          url: `https://rr1.googlevideo.com/videoplayback?c=${client}&k=${issued}&expire=${Math.floor(Date.now() / 1000) + 20000}`},
      ]}}));
    }
    const link = new URL(u);
    const [, a, b] = /bytes=(\d+)-(\d*)/.exec(init.headers.Range);
    const from = Number(a), to = Math.min(Number(b), total - 1);
    seen.ranges.push([link.searchParams.get('c'), link.searchParams.get('k'), from, to]);
    if (b === '' || (from > 0 && cutOff.has(link.searchParams.get('c')))) return new Response('', {status: 403});
    if (refuseOnce && from === refuseOnce.from && link.searchParams.get('k') === refuseOnce.k) return new Response('', {status: 403});
    return new Response(audio.slice(from, to + 1), {status: 206, headers: {'Content-Range': `bytes ${from}-${to}/${total}`}});
  };
  return {fetcher, seen, audio};
}

test('/yta asks YouTube as VISIONOS first: the client that still gets whole songs without a PO token', async () => {
  const {fetcher, seen} = clientAwareYouTube({total: 5000});
  const r = await youtubeRelay(new Request('https://w.dev/yta?id=ggggggggggg', {headers: {Range: 'bytes=0-1'}}), {fetcher});
  assert.equal(r.status, 206);
  assert.equal(seen.clients[0], 'VISIONOS');
  assert.deepEqual(seen.ranges[0].slice(0, 1), ['VISIONOS']);
});

test('/yta never hands over a link that stops after the first chunk: it checks the end of the file first', async () => {
  // VISIONOS links get cut off here, so the relay must move on to the next client before answering.
  const {fetcher, seen} = clientAwareYouTube({total: 5000, cutOff: new Set(['VISIONOS'])});
  const r = await youtubeRelay(new Request('https://w.dev/yta?id=hhhhhhhhhhh', {headers: {Range: 'bytes=0-1'}}), {fetcher});
  assert.equal(r.status, 206);
  // Wave 1 asks VISIONOS twice at once; all its links fail the end-of-file check, so wave 2 (ANDROID_VR) serves.
  assert.deepEqual(seen.clients.slice(0, 2), ['VISIONOS', 'VISIONOS']);
  assert.ok(seen.ranges.filter(([c]) => c === 'VISIONOS').every(([, , from]) => from === 4998), 'VISIONOS links only checked, never served');
  assert.equal(seen.ranges.at(-1)[0], 'ANDROID_VR');
});

test('/yta keeps a song whole when YouTube refuses one slice mid-song: fresh link, same byte, no gap', async () => {
  const {SLICE, NEXT_SLICE} = await import('../canvas-bridge/youtube-relay.js');
  const total = SLICE + NEXT_SLICE + 1000;
  const {fetcher, seen, audio} = clientAwareYouTube({total, refuseOnce: {from: SLICE + NEXT_SLICE, k: '1'}});
  const waits = [];
  const r = await youtubeRelay(new Request('https://w.dev/yta?id=iiiiiiiiiii', {headers: {Range: 'bytes=0-'}}), {fetcher, waitUntil: (p) => waits.push(p)});
  const body = new Uint8Array(await r.arrayBuffer());
  await Promise.all(waits);
  assert.equal(body.length, total);
  assert.deepEqual(body, audio);
  // The original lookup wave, then one fresh wave for the refused slice (each wave asks several times at once).
  assert.ok(seen.clients.length >= 2 && seen.clients.length <= 6, String(seen.clients.length));
});

test('/yta asks several times at once, each with its own identity, and serves the first good answer', async () => {
  let visitors = 0;
  const asked = [];
  const fetcher = async (url, init = {}) => {
    const u = String(url);
    if (u.includes('visitor_id')) { visitors++; return new Response(JSON.stringify({responseContext: {visitorData: 'v' + visitors}})); }
    if (u.includes('/youtubei/v1/player')) {
      const id = JSON.parse(init.body).context.client.visitorData;
      asked.push(id);
      // Only the third identity gets through YouTube's bot check.
      if (asked.length !== 3) return new Response(JSON.stringify({playabilityStatus: {status: 'LOGIN_REQUIRED', reason: 'bot'}}));
      return new Response(JSON.stringify({playabilityStatus: {status: 'OK'}, streamingData: {adaptiveFormats: [{itag: 140, mimeType: 'audio/mp4', bitrate: 1, contentLength: '5000', url: 'https://rr1.googlevideo.com/videoplayback?expire=9999999999&who=' + id}]}}));
    }
    if (u.includes('googlevideo.com')) {
      const [, from, to] = /bytes=(\d+)-(\d+)/.exec(init.headers.Range);
      const end = Math.min(Number(to), 4999), n = end - Number(from) + 1;
      return new Response(new Uint8Array(n), {status: 206, headers: {'Content-Range': `bytes ${from}-${end}/5000`, 'Content-Length': String(n)}});
    }
    throw new Error('unexpected ' + u);
  };
  const r = await youtubeRelay(new Request('https://w.dev/yta?id=parallel111', {headers: {Range: 'bytes=0-1'}}), {fetcher});
  assert.equal(r.status, 206);
  assert.equal(new Set(asked.slice(0, 3)).size, 3, 'three different identities in the first wave');
});

test('/yta tries the other uploads in the same request when YouTube refuses the first, and keeps the rest of the song on the one that played', async () => {
  const base = fakeYouTube();
  const asked = [];
  const fetcher = async (url, init = {}) => {
    const u = String(url);
    if (u.includes('/youtubei/v1/player')) {
      const id = JSON.parse(init.body).videoId; asked.push(id);
      if (id !== 'kkkkkkkkkk2') return new Response(JSON.stringify({playabilityStatus: {status: 'LOGIN_REQUIRED', reason: 'Sign in to confirm you’re not a bot'}}));
    }
    return base.fetcher(url, init);
  };
  const r = await youtubeRelay(new Request('https://w.dev/yta?id=kkkkkkkkkk0&alt=kkkkkkkkkk1,kkkkkkkkkk2', {headers: {Range: 'bytes=0-4'}}), {fetcher});
  assert.equal(r.status, 206);
  assert.equal(r.headers.get('X-Spotplus-Video'), 'kkkkkkkkkk2');
  assert.equal(await r.text(), 'AUDIO');
  assert.ok(asked.includes('kkkkkkkkkk0') && asked.includes('kkkkkkkkkk1'));
  // The rest of the song (a later range) comes from the upload that played, never the first one.
  asked.length = 0;
  const rest = await youtubeRelay(new Request('https://w.dev/yta?id=kkkkkkkkkk0&alt=kkkkkkkkkk1,kkkkkkkkkk2', {headers: {Range: 'bytes=5-9'}}), {fetcher});
  assert.equal(rest.status, 206);
  assert.equal(rest.headers.get('X-Spotplus-Video'), 'kkkkkkkkkk2');
  assert.ok(!asked.includes('kkkkkkkkkk0'));
  await rest.arrayBuffer();
});

test('/yta never switches upload partway through a song it has no record of', async () => {
  const asked = [];
  const fetcher = async (url, init = {}) => {
    const u = String(url);
    if (u.includes('visitor_id')) return new Response(JSON.stringify({responseContext: {visitorData: 'v'}}));
    if (u.includes('/youtubei/v1/player')) { asked.push(JSON.parse(init.body).videoId); return new Response(JSON.stringify({playabilityStatus: {status: 'LOGIN_REQUIRED', reason: 'bot'}})); }
    throw new Error('unexpected ' + u);
  };
  const r = await youtubeRelay(new Request('https://w.dev/yta?id=mmmmmmmmmm0&alt=mmmmmmmmmm1', {headers: {Range: 'bytes=100-200'}}), {fetcher});
  assert.equal(r.status, 502);
  assert.deepEqual([...new Set(asked)], ['mmmmmmmmmm0']);
});
