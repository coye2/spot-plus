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
      return new Response('AUDIO', {status: 206, headers: {'Content-Range': 'bytes 0-4/5000', 'Content-Length': '5'}});
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
  assert.match(calls.media[1].url, /n=2/, 'second try uses a newly requested link');
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
  const r = await youtubeRelay(new Request('https://w.dev/yta?id=ddddddddddd'), {fetcher});
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
    const r = await youtubeRelay(new Request(`https://w.dev/yta?id=${id}&fmt=${fmt}`), {fetcher});
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
  const {SLICE} = await import('../canvas-bridge/youtube-relay.js');
  const TOTAL = Math.floor(SLICE * 2.5);
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
  assert.deepEqual(asked, [[0, SLICE - 1], [SLICE, 2 * SLICE - 1], [2 * SLICE, TOTAL - 1]]);
});
