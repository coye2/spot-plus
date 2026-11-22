import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {browserMocks, FakeAudio, settle} from './helpers.mjs';
import {
  equalPowerGains,
  buildGainCurve,
  effectiveMixSeconds,
  orderForMix,
  normalizeMixSettings,
  runCrossfade,
} from '../js/automix.js';
import {audioHasHeadroom} from '../js/playback-policy.js';
import {youtubeRelay, SLICE, NEXT_SLICE} from '../canvas-bridge/youtube-relay.js';

browserMocks();
const player = await import('../js/player.js');
const api = await import('../js/api.js');
const {memoryEngine} = await import('../js/memory-engine.js');

test('equal-power crossfade keeps total acoustic power constant across the entire transition', () => {
  for (const p of [0, 0.15, 0.25, 0.5, 0.75, 0.9, 1]) {
    const {outGain, inGain} = equalPowerGains(p);
    const power = outGain * outGain + inGain * inGain;
    assert.ok(Math.abs(power - 1) < 1e-6, `power at p=${p} was ${power}`);
  }
  const curveIn = buildGainCurve('in', 32, 0.8);
  const curveOut = buildGainCurve('out', 32, 0.8);
  assert.equal(curveIn.length, 32);
  assert.ok(curveIn[0] < 0.001 && Math.abs(curveIn[31] - 0.8) < 1e-6);
  assert.ok(Math.abs(curveOut[0] - 0.8) < 1e-6 && curveOut[31] < 0.001);
});

test('effectiveMixSeconds adapts Smart Mix to song length and skips spoken audio & tiny clips', () => {
  assert.equal(effectiveMixSeconds({seconds: 0, style: 'smart', currentDuration: 200, nextDuration: 200}), 0);
  assert.equal(effectiveMixSeconds({seconds: 6, style: 'smart', currentDuration: 200, nextDuration: 200, spoken: true}), 0);
  assert.equal(effectiveMixSeconds({seconds: 6, style: 'smart', currentDuration: 15, nextDuration: 200}), 0);
  assert.equal(effectiveMixSeconds({seconds: 9, style: 'smart', currentDuration: 45, nextDuration: 200}), 2);
  const std = effectiveMixSeconds({seconds: 9, style: 'smart', currentDuration: 210, nextDuration: 195});
  assert.ok(std >= 4 && std <= 8, `expected adaptive 4..8s, got ${std}`);
  assert.equal(effectiveMixSeconds({seconds: 9, style: 'fade', currentDuration: 210, nextDuration: 195}), 9);
  assert.deepEqual(normalizeMixSettings({automix: '6', mixStyle: 'blend'}), {
    enabled: true, seconds: 6, style: 'blend', preferredStyle: 'blend', curve: 'equal-power',
  });
});

test('orderForMix spaces out same-artist tracks while keeping the current song at index', () => {
  const tracks = [
    {id: '0', artist: 'Artist A', duration: 200},
    {id: '1', artist: 'Artist A', duration: 205},
    {id: '2', artist: 'Artist A', duration: 190},
    {id: '3', artist: 'Artist B', duration: 210},
    {id: '4', artist: 'Artist B', duration: 198},
    {id: '5', artist: 'Artist C', duration: 202},
  ];
  const mixed = orderForMix(tracks, 0);
  assert.equal(mixed[0].id, '0', 'current playing track stays at index 0');
  assert.equal(mixed.length, tracks.length);
  assert.deepEqual(new Set(mixed.map(t => t.id)), new Set(tracks.map(t => t.id)));
  for (let i = 1; i < mixed.length; i++) {
    assert.notEqual(mixed[i].artist, mixed[i - 1].artist, `back-to-back artist clash at index ${i}`);
  }
});

test('runCrossfade supports hardware-timed Web Audio path (iOS) and clean cancellation', async () => {
  const outEl = new FakeAudio();
  const inEl = new FakeAudio();
  let cleaned = false;
  let webAudioCancelled = false;
  let receivedStyle = '';
  const handle = runCrossfade({
    outgoing: outEl,
    incoming: inEl,
    targetVolume: 0.9,
    seconds: 4,
    style: 'blend',
    elementVolumeSupported: false,
    webAudioFade: (_o, _i, opts) => {
      receivedStyle = opts.style;
      return {
        done: new Promise(() => {}),
        cancel: () => { webAudioCancelled = true; },
      };
    },
    onCleanupOutgoing: () => { cleaned = true; },
  });
  assert.equal(handle.mode, 'webaudio');
  assert.equal(receivedStyle, 'blend');
  handle.cancel();
  assert.equal(webAudioCancelled, true);
  assert.equal(cleaned, true);
});

test('audioHasHeadroom respects real buffered ranges instead of falsely passing on readyState=3', () => {
  const media = {
    src: 'https://relay.example/yta?id=abc',
    paused: false,
    currentTime: 2,
    duration: 200,
    readyState: 3,
    buffered: {length: 1, start: () => 0, end: () => 4}, // only 2s buffered ahead
  };
  assert.equal(audioHasHeadroom(media, 9), false, '2s buffered ahead must not satisfy a 9s headroom requirement');
  media.buffered.end = () => 14; // 12s buffered ahead
  assert.equal(audioHasHeadroom(media, 9), true);
});

test('progress events do not spam player state emissions (eliminating DOM-thrash audio stutters)', async () => {
  const track = {id: 'stutter-1', title: 'Smooth', artist: 'Band', album: 'LP', duration: 200};
  memoryEngine.putStream(api.streamKey(track), {
    url: 'https://spot-plus-canvas.pwr97pnmkn.workers.dev/yta?id=99999999999&fmt=aac',
    mime: 'audio/mp4', bitrate: 128000, kind: 'ytrelay', instance: 'relay', videoId: '99999999999', alternatives: [],
  });
  globalThis.document.hidden = false;
  player.playList([track], 0);
  await settle();

  let stateCalls = 0;
  player.on('state', () => { stateCalls++; });
  for (let i = 0; i < 20; i++) {
    player.el.dispatchEvent(new Event('progress'));
  }
  assert.equal(stateCalls, 0, 'chunk progress events must never trigger full UI state re-renders');
});

test('/yta starts fetching slice 2 concurrently while slice 1 pipes (zero network gap at 1 MB boundary)', async () => {
  const total = SLICE + NEXT_SLICE + 1024;
  const audio = new Uint8Array(total).map((_, i) => (i * 13) % 251);
  let slice1Finished = false;
  let slice2RequestedBeforeSlice1Finished = false;
  const asked = [];
  const waits = [];

  const fetcher = async (url, init = {}) => {
    const u = String(url);
    if (u.includes('visitor_id')) return new Response(JSON.stringify({responseContext: {visitorData: 'v'}}));
    if (u.includes('/youtubei/v1/player')) {
      return new Response(JSON.stringify({playabilityStatus: {status: 'OK'}, streamingData: {adaptiveFormats: [
        {itag: 140, mimeType: 'audio/mp4; codecs="mp4a.40.2"', bitrate: 130000, contentLength: String(total),
          url: `https://rr1.googlevideo.com/videoplayback?expire=${Math.floor(Date.now() / 1000) + 20000}`},
      ]}}));
    }
    const [, a, b] = /bytes=(\d+)-(\d*)/.exec(init.headers.Range);
    const from = Number(a), to = Math.min(Number(b), total - 1);
    asked.push([from, to]);
    if (from === SLICE && !slice1Finished) slice2RequestedBeforeSlice1Finished = true;
    const chunk = audio.slice(from, to + 1);
    if (from === 0 && to === SLICE - 1) {
      // Stream slice 1 in two yields so slice 2 lookahead is guaranteed to start while slice 1 is still piping.
      const half = Math.floor(chunk.length / 2);
      const stream = new ReadableStream({
        async start(ctrl) {
          ctrl.enqueue(chunk.slice(0, half));
          await new Promise(r => setTimeout(r, 15));
          ctrl.enqueue(chunk.slice(half));
          slice1Finished = true;
          ctrl.close();
        },
      });
      return new Response(stream, {status: 206, headers: {'Content-Range': `bytes ${from}-${to}/${total}`}});
    }
    return new Response(chunk, {status: 206, headers: {'Content-Range': `bytes ${from}-${to}/${total}`}});
  };

  const r = await youtubeRelay(new Request('https://w.dev/yta?id=prefetch111', {headers: {Range: 'bytes=0-'}}), {
    fetcher, waitUntil: (p) => waits.push(p),
  });
  const body = new Uint8Array(await r.arrayBuffer());
  await Promise.all(waits);

  assert.equal(body.length, total);
  assert.deepEqual(body, audio, 'byte-for-byte integrity across lookahead slices');
  assert.equal(slice2RequestedBeforeSlice1Finished, true, 'slice 2 must begin fetching before slice 1 finishes piping');
  // Zero extra requests beyond the initial end-of-file verification + exact 3 bounded slices.
  const mediaSlices = asked.filter(([from]) => from === 0 || from === SLICE || from === SLICE + NEXT_SLICE);
  assert.equal(mediaSlices.length, 3);
});

test('index.html allows data: media-src for iOS silent unlock and exposes Now Playing Mix button', () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  assert.match(html, /media-src[^;]*data:/, 'CSP media-src must permit data: silent unlock WAV');
  assert.match(html, /class="icon np-mix" data-act="mix-sheet"/, 'Now Playing must expose quick Mix button');
  const fxSrc = readFileSync(new URL('../js/fx.js', import.meta.url), 'utf8');
  assert.doesNotMatch(fxSrc, /prewarmRooms\(\)/, 'fx.js must not eagerly pre-generate all reverb buffers on main thread');
});
