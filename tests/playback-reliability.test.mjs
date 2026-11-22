import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { browserMocks, settle } from './helpers.mjs';

browserMocks();

const actionHandlers = new Map();
const positionUpdates = [];
globalThis.MediaMetadata = class MediaMetadata {
  constructor(init) { Object.assign(this, init); }
};
Object.defineProperty(globalThis, 'navigator', {
  configurable: true,
  value: {
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.2 Mobile/15E148 Safari/604.1',
    platform: 'iPhone',
    maxTouchPoints: 5,
    onLine: true,
    mediaSession: {
      metadata: null,
      playbackState: 'none',
      setActionHandler(action, handler) { actionHandlers.set(action, handler); },
      setPositionState(state) { positionUpdates.push(state); },
    },
  },
});

const player = await import('../js/player.js');
const { AdaptiveBufferEngine } = await import('../js/buffer-engine.js');
const { NextAudioBuffer } = await import('../js/audio-buffer.js');
const { shouldSkipTrack } = await import('../js/player-gestures.js');

test('AirPlay attributes are configured on primary and preloaded audio elements', () => {
  assert.equal(player.el.playsInline, true);
  assert.equal(player.el.getAttribute('x-webkit-airplay'), 'allow');
  assert.equal(player.el.disableRemotePlayback, false);

  const buf = new NextAudioBuffer();
  assert.equal(buf.spare.playsInline, true);
  assert.equal(buf.spare.getAttribute('x-webkit-airplay'), 'allow');
  assert.equal(buf.spare.disableRemotePlayback, false);
});

test('AirPlay wireless activation strips crossOrigin and hands off to a plain uncaptured element', async () => {
  const tracks = [
    { id: 'ap-1', title: 'AirPlay Track', artist: 'Artist', duration: 180, local: true },
  ];
  player.playList(tracks, 0, { shuffle: false });
  await settle();

  const before = player.el;
  before.setAttribute('crossorigin', 'anonymous');
  before.currentTime = 24;
  before.webkitCurrentPlaybackTargetIsWireless = true;
  before.dispatchEvent(new Event('webkitcurrentplaybacktargetiswirelesschanged'));
  await settle();

  assert.equal(player.isAirPlayActive(), true);
  assert.notEqual(player.el, before, 'must swap off CORS/captured element when AirPlay turns wireless');
  assert.equal(player.el.crossOrigin, null, 'AirPlay target element must not carry crossOrigin');
  assert.equal(player.el.getAttribute('x-webkit-airplay'), 'allow');
  assert.equal(player.el.disableRemotePlayback, false);

  // Reset AirPlay flag for subsequent tests.
  player.el.webkitCurrentPlaybackTargetIsWireless = false;
  player.el.dispatchEvent(new Event('webkitcurrentplaybacktargetiswirelesschanged'));
  assert.equal(player.isAirPlayActive(), false);
});

test('AirPlay picker helper invokes webkitShowPlaybackTargetPicker when supported', () => {
  let opened = 0;
  player.el.webkitShowPlaybackTargetPicker = () => { opened++; };
  assert.equal(player.canAirPlay(), true);
  assert.equal(player.showAirPlayPicker(), true);
  assert.equal(opened, 1);
  delete player.el.webkitShowPlaybackTargetPicker;
  assert.equal(player.canAirPlay(), false);
});

test('Lock Screen prev() restarts cleanly on first tap past 3s and skips back on double-tap', async () => {
  const tracks = [
    { id: 'ls-1', title: 'Song One', artist: 'Band', duration: 200, local: true },
    { id: 'ls-2', title: 'Song Two', artist: 'Band', duration: 210, local: true },
  ];
  player.playList(tracks, 1, { shuffle: false });
  await settle();

  positionUpdates.length = 0;
  player.el.currentTime = 45;
  actionHandlers.get('previoustrack')();
  assert.equal(player.current()?.id, 'ls-2', 'first tap past 3s restarts current song');
  assert.equal(player.el.currentTime, 0);
  assert.equal(positionUpdates.at(-1)?.position, 0, 'Lock Screen positionState resets to 0 immediately');

  // Even if currentTime has not settled yet, a quick second tap skips to the previous song.
  player.el.currentTime = 10;
  actionHandlers.get('previoustrack')();
  await settle();
  assert.equal(player.current()?.id, 'ls-1', 'second tap within 1.8s skips to previous song');
  assert.equal(navigator.mediaSession.metadata?.title, 'Song One');
});

test('Lock Screen seekto updates positionState immediately with exact target timestamp', async () => {
  const tracks = [{ id: 'sk-1', title: 'Seek Song', artist: 'Band', duration: 240, local: true }];
  player.playList(tracks, 0, { shuffle: false });
  await settle();

  positionUpdates.length = 0;
  actionHandlers.get('seekto')({ seekTime: 87.5 });
  assert.equal(player.el.currentTime, 87.5);
  assert.equal(positionUpdates.at(-1)?.position, 87.5);
});

test('Foreground track skip keeps active audio session intact without blanking src', async () => {
  const tracks = [
    { id: 'ns-1', title: 'Track A', artist: 'Band', duration: 190, local: true },
    { id: 'ns-2', title: 'Track B', artist: 'Band', duration: 200, local: true },
  ];
  player.playList(tracks, 0, { shuffle: false });
  await settle();

  let blanked = false;
  const origRemove = player.el.removeAttribute.bind(player.el);
  player.el.removeAttribute = (name) => {
    if (name === 'src') blanked = true;
    return origRemove(name);
  };

  positionUpdates.length = 0;
  player.next(true);
  assert.equal(navigator.mediaSession.playbackState, 'playing', 'playbackState stays playing across track skip');
  assert.equal(positionUpdates[0]?.position, 0, 'new track resets Lock Screen position immediately');
  await settle();
  assert.equal(blanked, false, 'normal track skip must not blank src and tear down iOS AVAudioSession');
  assert.equal(player.current()?.id, 'ns-2');
});

test('syncPlaybackState hook fires false on pause and true on play to prevent Web Audio humming', async () => {
  const calls = [];
  player.setEffectsHooks({ syncPlaybackState: (playing) => calls.push(playing) });
  const tracks = [{ id: 'hm-1', title: 'Hum Free', artist: 'Band', duration: 180, local: true }];
  player.playList(tracks, 0, { shuffle: false });
  await settle();

  calls.length = 0;
  player.pause();
  assert.ok(calls.includes(false), 'pause must gate & suspend Web Audio via syncPlaybackState(false)');

  calls.length = 0;
  player.toggle();
  await settle();
  assert.ok(calls.includes(true), 'resume must reopen Web Audio via syncPlaybackState(true)');
  player.setEffectsHooks({ syncPlaybackState: () => {} });
});

test('iPhone (missing navigator.connection) gets fast instant-play buffer profile when healthy', () => {
  const engine = new AdaptiveBufferEngine();
  const profile = engine.profile(undefined);
  assert.equal(profile.condition, 'fast');
  assert.ok(profile.headroomSec <= 6, `expected fast iOS headroom <= 6s, got ${profile.headroomSec}`);
  assert.ok(profile.maxPreloadAhead >= 2, `expected iOS preload ahead >= 2, got ${profile.maxPreloadAhead}`);
  assert.equal(profile.preloadStageA, true);
  assert.equal(profile.preloadStageB, true);
});

test('pitch-worklet clears ring buffers on reset and sustained silence to eliminate buzz tails', () => {
  const src = readFileSync(new URL('../js/pitch-worklet.js', import.meta.url), 'utf8');
  assert.match(src, /port\.onmessage/, 'pitch-worklet must accept reset messages');
  assert.match(src, /silentBlocks/, 'pitch-worklet must track sustained silence and flush buffers');
  assert.match(src, /clearBuffers\(\)/, 'pitch-worklet must zero ring buffers on reset/silence');
  assert.match(src, /output\[c\]\.fill\(0\)/, 'pitch-worklet must zero-fill output when input is silent or absent');
});

test('fx.js gates master output, suspends AudioContext on pause, and never forces mid-song background reload', () => {
  const src = readFileSync(new URL('../js/fx.js', import.meta.url), 'utf8');
  assert.match(src, /export function syncPlaybackState/, 'fx.js must export syncPlaybackState');
  assert.match(src, /masterGate/, 'fx.js must route output through masterGate before destination');
  assert.match(src, /ctx\.suspend\(\)/, 'fx.js must suspend AudioContext after gating to zero on pause');
  assert.match(src, /isWirelessAirPlay/, 'fx.js must bypass Web Audio when AirPlay is wireless');
});

test('horizontal swipe gesture on Now Playing artwork detects next/prev cleanly without vertical conflict', () => {
  assert.equal(shouldSkipTrack(-110, 8, 220, 390), 'next');
  assert.equal(shouldSkipTrack(110, -10, 220, 390), 'prev');
  assert.equal(shouldSkipTrack(-45, 5, 55, 390), 'next');
  assert.equal(shouldSkipTrack(45, 5, 55, 390), 'prev');
  assert.equal(shouldSkipTrack(-20, 2, 300, 390), null);
  assert.equal(shouldSkipTrack(-40, 60, 200, 390), null);
});

test('preview server shim unwraps non-CORS audio to direct relay URLs while proxying fetch and CORS audio', () => {
  const src = readFileSync(new URL('../scripts/serve.mjs', import.meta.url), 'utf8');
  assert.match(src, /toDirectWorkerUrl/, 'preview shim must unwrap non-CORS media src to direct worker URLs');
  assert.match(src, /toPreviewWorkerUrl/, 'preview shim must wrap fetch and CORS media src through preview proxy');
  assert.match(src, /window\.__SPOTPLUS_PREVIEW__\s*=\s*true/, 'preview shim must flag preview runtime');
  assert.match(src, /preview-updated/, 'preview service worker must notify clients after clearing stale shell caches');
});

test('check-update uses numeric version comparison and never downgrades preview to older main', () => {
  const src = readFileSync(new URL('../js/app.js', import.meta.url), 'utf8');
  assert.match(src, /case 'check-update':[\s\S]*isNewer\(latest,APP_VERSION\)/, 'check-update must compare semver numerically');
  assert.match(src, /You’re on the latest preview/, 'check-update must report preview up-to-date cleanly');
  assert.match(src, /e\.data\?\.type\s*===\s*'preview-updated'/, 'app must reload when preview SW clears stale shell caches');
});

