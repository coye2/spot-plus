import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { browserMocks, settle, FakeAudio } from './helpers.mjs';

browserMocks();

// Give window and document real EventTarget behavior so player.js lifecycle listeners bind & fire.
const winTarget = new EventTarget();
globalThis.window = Object.assign(winTarget, {
  caches: {},
  addEventListener: winTarget.addEventListener.bind(winTarget),
  removeEventListener: winTarget.removeEventListener.bind(winTarget),
  dispatchEvent: winTarget.dispatchEvent.bind(winTarget),
});
const docTarget = new EventTarget();
globalThis.document = Object.assign(docTarget, {
  hidden: false,
  createElement: () => new FakeAudio(),
  addEventListener: docTarget.addEventListener.bind(docTarget),
  removeEventListener: docTarget.removeEventListener.bind(docTarget),
  dispatchEvent: docTarget.dispatchEvent.bind(docTarget),
});

// Provide browser globals needed for connectivity, Media Session, and lifecycle tests.
const actionHandlers = new Map();
const positionUpdates = [];
const metaUpdates = [];
globalThis.MediaMetadata = class MediaMetadata {
  constructor(init) { Object.assign(this, init); }
};
const mediaSessionMock = {
  _meta: null,
  get metadata() { return this._meta; },
  set metadata(val) { this._meta = val; metaUpdates.push(val); },
  playbackState: 'none',
  setActionHandler(action, handler) { actionHandlers.set(action, handler); },
  setPositionState(state) { positionUpdates.push(state); },
};

Object.defineProperty(globalThis, 'navigator', {
  configurable: true,
  value: {
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.2 Mobile/15E148 Safari/604.1',
    platform: 'iPhone',
    maxTouchPoints: 5,
    onLine: true,
    mediaSession: mediaSessionMock,
  },
});

globalThis.location = new URL('https://coye2.github.io/spot-plus/');

const { ConnectivityManager } = await import('../js/connectivity.js');
const { telemetry } = await import('../js/playback-telemetry.js');
const store = await import('../js/store.js');
const player = await import('../js/player.js');
const api = await import('../js/api.js');

/* ---------- Phase 4: Connectivity Manager & Truthful Capabilities ---------- */

test('ConnectivityManager tracks AirPlay availability, wireless handoff, and rebinding', async () => {
  const cm = new ConnectivityManager();
  let wirelessTriggered = 0;
  cm.setOnWirelessActive(() => { wirelessTriggered++; });

  const mediaA = new Audio();
  let pickerCalls = 0;
  mediaA.webkitShowPlaybackTargetPicker = () => { pickerCalls++; };
  mediaA.webkitCurrentPlaybackTargetIsWireless = false;

  cm.bindMedia(mediaA);
  let snap = cm.getSnapshot();
  assert.equal(snap.airPlay.supported, true);
  assert.equal(snap.airPlay.available, false);
  assert.equal(snap.canPickWireless, true);
  assert.equal(snap.wirelessActive, false);

  const availEvt = new Event('webkitplaybacktargetavailabilitychanged');
  availEvt.availability = 'available';
  mediaA.dispatchEvent(availEvt);
  assert.equal(cm.getSnapshot().airPlay.available, true);

  const res = await cm.openWirelessPicker();
  assert.equal(res.ok, true);
  assert.equal(res.transport, 'airplay');
  assert.equal(pickerCalls, 1);

  mediaA.webkitCurrentPlaybackTargetIsWireless = true;
  mediaA.dispatchEvent(new Event('webkitcurrentplaybacktargetiswirelesschanged'));
  snap = cm.getSnapshot();
  assert.equal(snap.airPlay.active, true);
  assert.equal(snap.wirelessActive, true);
  assert.equal(snap.activeTransport, 'airplay');
  assert.equal(wirelessTriggered, 1);

  // Rebinding to a new audio element cleans up old listeners and binds the new one.
  const mediaB = new Audio();
  mediaB.webkitShowPlaybackTargetPicker = () => {};
  mediaB.webkitCurrentPlaybackTargetIsWireless = false;
  cm.bindMedia(mediaB);
  assert.equal(cm.getSnapshot().airPlay.active, false);

  // Events on retired mediaA must no longer mutate ConnectivityManager state.
  mediaA.webkitCurrentPlaybackTargetIsWireless = true;
  mediaA.dispatchEvent(new Event('webkitcurrentplaybacktargetiswirelesschanged'));
  assert.equal(cm.getSnapshot().airPlay.active, false);
});

test('ConnectivityManager supports W3C Remote Playback API when AirPlay is absent', async () => {
  const cm = new ConnectivityManager();
  const listeners = new Map();
  let watchCb = null;
  let prompted = 0;
  let cancelledId = null;

  const remote = {
    state: 'disconnected',
    addEventListener(type, fn) { listeners.set(type, fn); },
    removeEventListener(type) { listeners.delete(type); },
    watchAvailability(cb) { watchCb = cb; return Promise.resolve(42); },
    cancelWatchAvailability(id) { cancelledId = id; return Promise.resolve(); },
    prompt() { prompted++; return Promise.resolve(); },
  };
  const media = new Audio();
  media.disableRemotePlayback = false;
  media.remote = remote;

  cm.bindMedia(media);
  await settle();
  assert.equal(cm.getSnapshot().remotePlayback.supported, true);
  assert.equal(cm.getSnapshot().canPickWireless, false, 'hidden until a receiver is available');

  watchCb?.(true);
  assert.equal(cm.getSnapshot().remotePlayback.available, true);
  assert.equal(cm.getSnapshot().canPickWireless, true);

  const pickRes = await cm.openWirelessPicker();
  assert.equal(pickRes.ok, true);
  assert.equal(pickRes.transport, 'remote-playback');
  assert.equal(prompted, 1);

  remote.state = 'connected';
  listeners.get('connect')?.();
  assert.equal(cm.getSnapshot().wirelessActive, true);
  assert.equal(cm.getSnapshot().activeTransport, 'remote-playback');

  // Unbinding cancels watchAvailability cleanly.
  cm.bindMedia(new Audio());
  assert.equal(cancelledId, 42);
});

test('ConnectivityManager reports CarPlay and Android Auto truthfully (zero fake dashboard claims)', () => {
  const cm = new ConnectivityManager();
  cm.bindMedia(new Audio());
  const snap = cm.getSnapshot();
  assert.equal(snap.carPlay.nativeDashboardSupported, false);
  assert.equal(snap.androidAuto.nativeDashboardSupported, false);
  assert.equal(snap.carPlay.nowPlayingBridgeSupported, true);
  assert.match(snap.carPlay.detail, /CarPlay Audio entitlement/i);
  assert.match(snap.androidAuto.detail, /MediaLibraryService/i);
});

/* ---------- Phase 2: Operation Continuity ---------- */

test('Continuity tracks intent vs pauseReason and keeps restore() idempotent during active playback', async () => {
  const tracks = [
    { id: 'cont-1', title: 'Continuity One', artist: 'Band', duration: 180, local: true },
    { id: 'cont-2', title: 'Continuity Two', artist: 'Band', duration: 200, local: true },
  ];
  player.playList(tracks, 0, { shuffle: false });
  await settle();

  assert.equal(player.getContinuityState().intent, 'playing');
  assert.equal(player.current()?.id, 'cont-1');

  // Calling restore({ ifIdle: true }) while actively playing must NOT clobber the current song.
  store.savePlayer({ queue: [tracks[1]], index: 0, pos: 50, vol: 0.5, repeat: 'off' });
  player.restore({ ifIdle: true });
  assert.equal(player.current()?.id, 'cont-1');
  assert.equal(player.getContinuityState().intent, 'playing');

  // User pause marks explicit pauseReason = 'user'.
  player.pause();
  await settle();
  const afterPause = player.getContinuityState();
  assert.equal(afterPause.intent, 'paused');
  assert.equal(afterPause.pauseReason, 'user');
});

test('Offline -> online and freeze -> resume recovery only auto-resumes when intent is playing', async () => {
  telemetry.reset();
  const tracks = [
    { id: 'net-1', title: 'Network Resilience', artist: 'Band', duration: 210, local: true },
  ];
  player.playList(tracks, 0, { shuffle: false });
  await settle();

  // Simulate OS freeze pausing the audio element without user pause.
  globalThis.document.dispatchEvent(new Event('freeze'));
  player.el.paused = true;
  assert.equal(player.getContinuityState().pauseReason, 'os-interruption');

  globalThis.document.dispatchEvent(new Event('resume'));
  await settle();
  assert.equal(player.el.paused, false, 'resume should restore playback after OS freeze');
  assert.ok(telemetry.snapshot().counters.continuityRecoveries >= 1);

  // If user explicitly pauses, online/resume events MUST NOT auto-resume.
  player.pause();
  await settle();
  const prevRecoveries = telemetry.snapshot().counters.continuityRecoveries;
  globalThis.window.dispatchEvent(new Event('offline'));
  globalThis.window.dispatchEvent(new Event('online'));
  globalThis.document.dispatchEvent(new Event('resume'));
  await settle();
  assert.equal(player.el.paused, true);
  assert.equal(telemetry.snapshot().counters.continuityRecoveries, prevRecoveries);
});

test('pageshow bfcache event reconciles state without restarting playback', async () => {
  const tracks = [{ id: 'bf-1', title: 'BFCache Track', artist: 'Band', duration: 220, local: true }];
  player.playList(tracks, 0, { shuffle: false });
  await settle();
  player.el.currentTime = 42;

  const evt = new Event('pageshow');
  evt.persisted = true;
  globalThis.window.dispatchEvent(evt);
  assert.equal(player.el.currentTime, 42);
  assert.equal(player.getContinuityState().lastLifecycleEvent, 'pageshow-bfcache');
});

test('fx.js resumes iOS interrupted AudioContext and app.js defers SW reload during playback', () => {
  const fxSrc = readFileSync(new URL('../js/fx.js', import.meta.url), 'utf8');
  assert.match(fxSrc, /ctx\.state === 'suspended' \|\| ctx\.state === 'interrupted'/);

  const appSrc = readFileSync(new URL('../js/app.js', import.meta.url), 'utf8');
  assert.match(appSrc, /pendingSwReload/);
  assert.match(appSrc, /if\s*\(player\.isPlaying\(\)\|\|player\.state\.loading\)pendingSwReload=true/);
});

/* ---------- Phase 3: Operation Velocity & Relay Protection ---------- */

test('retryBackoffMs returns bounded exponential delays with jitter', () => {
  for (let attempt = 1; attempt <= 5; attempt++) {
    const ms = player.retryBackoffMs(attempt, { baseMs: 600, maxMs: 8000 });
    const base = Math.min(8000, 600 * (2 ** (attempt - 1)));
    assert.ok(ms >= Math.floor(base * 0.8) && ms <= Math.ceil(Math.min(8000, base * 1.2)),
      `attempt ${attempt}: ${ms}ms should stay within ±20% of ${base}ms`);
  }
});

test('Single-flight coalescing prevents duplicate Worker /match calls for concurrent resolves', async () => {
  const origFetch = globalThis.fetch;
  const prevSource = store.getSettings().source;
  store.setSettings({ source: 'ytrelay' });
  telemetry.reset();
  api.clearStreamCache();

  let matchCalls = 0;
  let headCalls = 0;
  globalThis.fetch = async (url, opts = {}) => {
    const s = String(url);
    if (s.includes('/match?')) {
      matchCalls++;
      await new Promise((r) => setTimeout(r, 15));
      return new Response(JSON.stringify({
        items: [{ id: 'vid12345678', title: 'Band - Coalesce Song (Official Audio)', channel: 'Band - Topic', duration: 200 }],
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    if (s.includes('/health')) {
      return new Response(JSON.stringify({ ok: true, relay: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    if (s.includes('/yta?') && opts.method === 'HEAD') {
      headCalls++;
      return new Response(null, { status: 200 });
    }
    return new Response(JSON.stringify({ ok: false }), { status: 404 });
  };

  try {
    const track = { id: 'coal-1', title: 'Coalesce Song', artist: 'Band', duration: 200 };
    const [r1, r2] = await Promise.all([
      api.resolve(track),
      api.resolve(track),
    ]);
    assert.ok(r1?.url && r2?.url, 'both concurrent callers should receive a playable URL');
    assert.equal(r1.url, r2.url);
    assert.equal(matchCalls, 1, 'concurrent resolves must coalesce into 1 /match call');
    assert.ok(headCalls <= 2, 'HEAD probes should stay bounded');
    const counters = telemetry.snapshot().counters;
    assert.equal(counters.relayMatchRequests, 1);
    assert.ok(counters.coalescedRequests >= 1, 'telemetry must record coalesced request');
  } finally {
    store.setSettings({ source: prevSource });
    globalThis.fetch = origFetch;
  }
});

test('Rapid 20-track skip stress test ends coherently on track 20 with clean Media Session', async () => {
  const tracks = Array.from({ length: 20 }, (_, i) => ({
    id: `stress-${i + 1}`,
    title: `Stress Track ${i + 1}`,
    artist: 'Stress Artist',
    album: 'Stress Album',
    duration: 180 + i,
    local: true,
    cover: `https://cdn.example.com/art/${i + 1}/250x250.jpg`,
  }));

  player.playList(tracks, 0, { shuffle: false });
  await settle();

  for (let i = 0; i < 19; i++) {
    player.next(true);
  }
  await settle();

  assert.equal(player.current()?.id, 'stress-20');
  assert.equal(navigator.mediaSession.metadata?.title, 'Stress Track 20');
  assert.equal(player.getContinuityState().intent, 'playing');
});

/* ---------- Phase 4: Premium Media Session ---------- */

test('buildSessionArtwork emits absolute multi-size URLs with MIME types and fallback', () => {
  const art = player.buildSessionArtwork({
    id: 'art-1',
    title: 'Art Test',
    cover: 'https://e-cdns-images.dzcdn.net/images/cover/abc/250x250-000000-80-0-0.jpg',
    coverXl: 'https://e-cdns-images.dzcdn.net/images/cover/abc/1000x1000-000000-80-0-0.jpg',
  });
  assert.equal(art.length, 5);
  for (const item of art) {
    assert.match(item.src, /^https?:\/\//, 'artwork URL must be absolute');
    assert.match(item.sizes, /^\d+x\d+$/);
    assert.equal(item.type, 'image/jpeg');
  }

  const fallback = player.buildSessionArtwork({ id: 'art-2', title: 'No Cover' });
  assert.equal(fallback.length, 2);
  assert.match(fallback[0].src, /^https:\/\/coye2\.github\.io\/spot-plus\/icons\/icon-192\.png$/);
  assert.equal(fallback[0].type, 'image/png');
});

/* ---------- Phase 5: Settings Refinement & Capability-Gated UI ---------- */

test('Settings view defines all refined sections and zero fake CarPlay/Android Auto connect buttons', () => {
  const appSrc = readFileSync(new URL('../js/app.js', import.meta.url), 'utf8');
  for (const heading of [
    'Playback',
    'Audio &amp; quality',
    'Devices &amp; connectivity',
    'Appearance',
    'Downloads &amp; storage',
    'Account &amp; notifications',
    'About Spot+',
  ]) {
    assert.ok(appSrc.includes(heading), `Settings should contain section "${heading}"`);
  }
  assert.doesNotMatch(appSrc, /data-act="connect-carplay"|data-act="connect-android-auto"/i);

  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  assert.match(html, /id="npWireless"[^>]*data-act="wireless-output"[^>]*hidden/);

  const swSrc = readFileSync(new URL('../sw.js', import.meta.url), 'utf8');
  assert.match(swSrc, /\.\/js\/connectivity\.js/);
  assert.match(swSrc, /SKIP_WAITING/);
});
