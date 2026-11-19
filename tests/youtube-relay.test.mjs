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
