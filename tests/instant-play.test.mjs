import test from 'node:test';
import assert from 'node:assert/strict';
import {browserMocks, FakeAudio, settle} from './helpers.mjs';
import {prefersAac, mediaWarmHeadroom, seamlessHandoffWindow, KEEP_WARM_AFTER_PAUSE_MS, audioHasHeadroom, stallBudget} from '../js/playback-policy.js';
import {NextAudioBuffer} from '../js/audio-buffer.js';

test('InstantPlay prefers AAC on iPhone and iPad', () => {
  assert.equal(prefersAac('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)', 'iPhone', 5), true);
  assert.equal(prefersAac('Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X)', 'iPad', 5), true);
  assert.equal(prefersAac('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', 'MacIntel', 5), true);
  assert.equal(prefersAac('Mozilla/5.0 (Linux; Android 14)', 'Linux armv8l', 2), false);
  assert.equal(prefersAac('Mozilla/5.0 (Windows NT 10.0; Win64; x64)', 'Win32', 0), false);
});

test('InstantPlay media warm headroom is lower on fast links and cautious on slow ones', () => {
  assert.equal(mediaWarmHeadroom({effectiveType: '4g', downlink: 20}), 3);
  assert.equal(mediaWarmHeadroom({effectiveType: '3g'}), 10);
  assert.equal(mediaWarmHeadroom({saveData: true}), 16);
  assert.equal(KEEP_WARM_AFTER_PAUSE_MS, 90_000);
  assert.equal(stallBudget(0), 7000);
  assert.equal(stallBudget(0.2), 7000);
  assert.equal(stallBudget(2), 4500);
  const media = {src: 'https://cdn.example/a.m4a', paused: false, currentTime: 5, duration: 200, buffered: {length: 1, start: () => 0, end: () => 12}};
  assert.equal(audioHasHeadroom(media, 6), true);
  assert.equal(audioHasHeadroom(media, 12), false);
});

test('seamless handoff window opens only when the current song is ending', () => {
  const media = {paused: false, duration: 180, currentTime: 179.8};
  assert.equal(seamlessHandoffWindow(media), true);
  media.currentTime = 100;
  assert.equal(seamlessHandoffWindow(media), false);
  media.paused = true; media.currentTime = 179.9;
  assert.equal(seamlessHandoffWindow(media), false);
});

test('NextAudioBuffer reports readiness without consuming the warm entry', () => {
  const media = new FakeAudio(); media.readyState = 2;
  const buffer = new NextAudioBuffer(() => media);
  buffer.warm('song', {url: 'https://audio.example/song.m4a'});
  assert.equal(buffer.isReady('song'), true);
  assert.equal(buffer.isReady('other'), false);
  media.readyState = 1;
  assert.equal(buffer.isReady('song', 2), false);
  assert.ok(buffer.take('song'));
});

browserMocks();
test('fast path forces AAC on Apple mobile and still offers AAC fallback for Opus', async () => {
  localStorage.setItem('spotplus.goodInstance', JSON.stringify({invidious: 'https://inv.example'}));
  localStorage.setItem('spotplus.settings', JSON.stringify({source: 'invidious'}));
  Object.defineProperty(globalThis, 'navigator', {
    value: {userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)', platform: 'iPhone', maxTouchPoints: 5},
    configurable: true,
  });
  globalThis.document = {createElement: () => ({canPlayType: () => 'probably'})};
  globalThis.fetch = async (url) => {
    if (String(url).includes('/match')) return new Response(JSON.stringify({items: [{id: 'fHI8X4OXluQ', title: 'The Weeknd - Blinding Lights (Official Audio)', channel: 'The Weeknd', duration: 204}]}));
    return new Response('[]');
  };
  const api = await import('../js/api.js');
  const ios = await api.resolve({id: 'ios-aac', title: 'Blinding Lights', artist: 'The Weeknd', duration: 200});
  assert.match(ios.url, /itag=140/);
  assert.equal(ios.mime, 'audio/mp4');
  assert.ok(ios.fast);

  Object.defineProperty(globalThis, 'navigator', {
    value: {userAgent: 'Mozilla/5.0 (X11; Linux x86_64) Chrome/120', platform: 'Linux x86_64', maxTouchPoints: 0},
    configurable: true,
  });
  const desktop = await api.resolve({id: 'desktop-opus', title: 'Blinding Lights', artist: 'The Weeknd', duration: 200});
  assert.match(desktop.url, /itag=251/);
  assert.ok(desktop.alternatives.length >= 1);
  assert.match(desktop.alternatives[0].url, /itag=140/);
  await settle();
});
