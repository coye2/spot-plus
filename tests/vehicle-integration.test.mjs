import test from 'node:test';
import assert from 'node:assert/strict';

import {
  DEFAULT_FLAGS,
  featureFlags,
  isFeatureEnabled,
  resetFeatureFlags,
} from '../js/feature-flags.js';
import {
  DriveMediaBridge,
  buildVehicleMetadata,
  classifyVehicleInterruption,
  detectVehicleCapabilities,
  sanitizeHeadUnitText,
} from '../js/vehicle/drive-bridge.js';
import {
  buildGatewaySnapshot,
  createGatewayPairingSecret,
  deriveGatewayCredentials,
  openGatewaySnapshot,
  sealGatewaySnapshot,
} from '../js/vehicle/gateway-pairing.js';
import {
  EngineAuthorityLock,
  MESSAGE_TYPES,
  createEnvelope,
  isAllowedBridgeOrigin,
  isSafeMediaUrl,
  validateEnvelope,
} from '../js/vehicle/microbridge-protocol.js';
import {
  NativeMicrobridgeClient,
  browseLibrarySnapshot,
} from '../js/vehicle/microbridge-client.js';
import {
  handleGatewayRequest,
  isAllowedDirectUrl,
  resetGatewayRateLimits,
} from '../workers/media-gateway/src/gateway.js';
import { md5Hex } from '../workers/media-gateway/src/md5.js';

// ---------------- Regression Protection: Feature Flags ----------------
test('all vehicle integration flags default to false until hardware-verified', () => {
  resetFeatureFlags();
  assert.equal(DEFAULT_FLAGS.vehicleDriveBridge, false);
  assert.equal(DEFAULT_FLAGS.vehicleGatewayPairing, false);
  assert.equal(DEFAULT_FLAGS.vehicleNativeMicrobridge, false);
  assert.equal(isFeatureEnabled('vehicleDriveBridge'), false);
  assert.equal(isFeatureEnabled('vehicleGatewayPairing'), false);
  assert.equal(isFeatureEnabled('vehicleNativeMicrobridge'), false);
  assert.equal(featureFlags.get().sPlusStateMachine, true);
});

// ---------------- Path 1: Browser-Native Vehicle Media Bridge ----------------
test('Path 1: detects truthful WebKit/CarPlay Now Playing vs Chromium/AVRCP capabilities', () => {
  const iosCaps = detectVehicleCapabilities({
    navigator: {
      userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148',
      platform: 'iPhone',
      standalone: true,
      mediaSession: { setActionHandler() {}, setPositionState() {} },
    },
    media: { webkitShowPlaybackTargetPicker() {} },
  });
  assert.equal(iosCaps.engine, 'webkit');
  assert.equal(iosCaps.os, 'ios');
  assert.equal(iosCaps.standalonePwa, true);
  assert.equal(iosCaps.confirmed.carPlayNowPlaying, true);
  assert.equal(iosCaps.confirmed.airPlayRouting, true);
  assert.equal(iosCaps.platformBlockedInPwa.carPlayLauncherApp, true);
  assert.equal(iosCaps.platformBlockedInPwa.androidAutoLauncherApp, true);

  const androidCaps = detectVehicleCapabilities({
    navigator: {
      userAgent: 'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36',
      platform: 'Linux armv8l',
      mediaSession: { setActionHandler() {}, setPositionState() {} },
    },
    media: { remote: { prompt() {} } },
  });
  assert.equal(androidCaps.engine, 'chromium');
  assert.equal(androidCaps.os, 'android');
  assert.equal(androidCaps.confirmed.carPlayNowPlaying, false);
  assert.equal(androidCaps.confirmed.bluetoothAvrcp, true);
  assert.equal(androidCaps.confirmed.remotePlaybackRouting, true);
  assert.equal(androidCaps.platformBlockedInPwa.androidAutoLibraryTree, true);
});

test('Path 1: sanitizes head-unit metadata, rejects unsafe artwork URLs, and guarantees album fallback', () => {
  assert.equal(sanitizeHeadUnitText('Song\u0000\n\tTitle   Live'), 'Song Title Live');
  const meta = buildVehicleMetadata({
    id: 'tr1',
    title: 'Midnight\nDrive',
    artist: 'The Synth\u0007Wave',
    album: '',
    cover: 'javascript:alert(1)',
    coverXl: 'https://cdn.example.com/art-1000.jpg',
  });
  assert.equal(meta.title, 'Midnight Drive');
  assert.equal(meta.artist, 'The Synth Wave');
  assert.equal(meta.album, 'The Synth Wave');
  assert.ok(meta.artwork.every((a) => a.src.startsWith('https://cdn.example.com/')));
});

test('Path 1: DriveMediaBridge debounces duplicate AVRCP pulses, nulls +/-10s buttons, and protects disconnects', () => {
  const handlers = new Map();
  const posCalls = [];
  const mockMs = {
    metadata: null,
    playbackState: 'none',
    setActionHandler(action, fn) { handlers.set(action, fn); },
    setPositionState(state) { posCalls.push(state); },
  };
  let nextCount = 0;
  let routeListener = null;
  const mockMedia = {
    webkitCurrentPlaybackTargetIsWireless: true,
    addEventListener(ev, fn) { if (ev === 'webkitcurrentplaybacktargetiswirelesschanged') routeListener = fn; },
    removeEventListener() {},
  };

  const bridge = new DriveMediaBridge({ navigator: { mediaSession: mockMs } });
  bridge.enable({
    media: mockMedia,
    commands: {
      play() {},
      pause() {},
      next() { nextCount += 1; },
      previous() {},
      seekTo() {},
    },
  });

  // iOS CarPlay/Lock Screen must keep track skip buttons instead of +/-10s podcast buttons
  assert.equal(handlers.get('seekbackward'), null);
  assert.equal(handlers.get('seekforward'), null);
  assert.equal(typeof handlers.get('nexttrack'), 'function');

  // Duplicate OEM steering-wheel pulse within debounce window fires only once
  handlers.get('nexttrack')();
  handlers.get('nexttrack')();
  assert.equal(nextCount, 1);
  assert.equal(bridge.getSnapshot().stats.commandsDebounced, 1);

  // Deduplicates identical metadata writes & throttles position updates
  assert.equal(bridge.syncMetadata({ id: '1', title: 'One', artist: 'A', album: 'B' }), true);
  assert.equal(bridge.syncMetadata({ id: '1', title: 'One', artist: 'A', album: 'B' }), false);
  assert.equal(bridge.syncPosition({ duration: 180, position: 10, now: 1000 }), true);
  assert.equal(bridge.syncPosition({ duration: 180, position: 10.5, now: 1200 }), false);
  assert.equal(bridge.syncPosition({ duration: 180, position: 12, now: 2500 }), true);
  assert.equal(posCalls.length, 2);

  // Wireless route change rebinds action handlers without tearing down media
  mockMedia.webkitCurrentPlaybackTargetIsWireless = false;
  routeListener();
  assert.equal(bridge.getSnapshot().stats.routeChanges, 1);

  // Route disconnect must NEVER auto-resume audio out of phone speakers
  const disconnectClass = classifyVehicleInterruption({
    reason: 'os-interruption',
    wasWireless: true,
    isWireless: false,
  });
  assert.equal(disconnectClass.kind, 'route-disconnect');
  assert.equal(disconnectClass.autoResumeSafe, false);

  bridge.disable();
  assert.equal(bridge.isEnabled(), false);
});

// ---------------- Path 2: Universal Media Gateway (OpenSubsonic PoC) ----------------
test('Path 2: account-free pairing derives domain-separated credentials and AES-GCM seals snapshots', async () => {
  const syncSecret = createGatewayPairingSecret();
  const creds = await deriveGatewayCredentials(syncSecret, { serverUrl: 'https://gateway.example.com/' });
  assert.ok(creds.username.startsWith('sp_'));
  assert.notEqual(creds.apiKey, syncSecret);
  assert.notEqual(creds.sealKeyHex, syncSecret);
  assert.equal(creds.serverUrl, 'https://gateway.example.com');
  assert.equal(creds.trustModel.accountFree, true);
  assert.equal(creds.trustModel.rootSyncSecretExposed, false);

  const snapshot = buildGatewaySnapshot({
    likes: [{ id: 't1', title: 'Cruise', artist: 'Band', album: 'Night', duration: 210, cover: 'https://img.example/1.jpg' }],
    playlists: [{ id: 'p1', name: 'Highway', tracks: [{ id: 't1', title: 'Cruise', artist: 'Band', streamUrl: 'javascript:evil' }] }],
  });
  assert.equal(snapshot.likes.length, 1);
  assert.equal(snapshot.playlists[0].tracks[0].streamUrl, '');

  const sealed = await sealGatewaySnapshot(creds.sealKeyHex, snapshot);
  const opened = await openGatewaySnapshot(creds.sealKeyHex, sealed);
  assert.deepEqual(opened.likes[0].title, 'Cruise');

  // Tampered ciphertext must fail AES-GCM authentication
  await assert.rejects(() => openGatewaySnapshot(creds.sealKeyHex, `${sealed}x`));
});

test('Path 2: OpenSubsonic gateway supports apiKey & salted MD5 auth, browsing, search3, 302 direct WAV range play, and security hardening', async () => {
  resetGatewayRateLimits();
  const env = {
    SPOTPLUS_GATEWAY_USER: 'sp_driver',
    SPOTPLUS_GATEWAY_API_KEY: 'test-gateway-key-998877',
    GATEWAY_ALLOW_TEST_AUDIO: 'true',
  };
  const scrobbleLog = [];
  const origin = 'https://gateway.spotplus.test';

  // 1) Missing/wrong auth rejected with 401 and zero wildcard CORS
  const unauth = await handleGatewayRequest(new Request(`${origin}/rest/ping?f=json`), { env });
  assert.equal(unauth.status, 401);
  assert.equal(unauth.headers.get('Access-Control-Allow-Origin'), null);

  // 2) OpenSubsonic apiKey auth works + truthful gateway identity
  const pingRes = await handleGatewayRequest(new Request(`${origin}/rest/ping.view?apiKey=${env.SPOTPLUS_GATEWAY_API_KEY}&f=json`), { env });
  assert.equal(pingRes.status, 200);
  const pingBody = await pingRes.json();
  assert.equal(pingBody['subsonic-response'].status, 'ok');
  assert.equal(pingBody['subsonic-response'].openSubsonic, true);
  assert.equal(pingBody['subsonic-response'].type, 'spotplus-gateway');

  // 3) Legacy Subsonic salted MD5 auth + XML response works
  const salt = 'carplay99';
  const token = md5Hex(env.SPOTPLUS_GATEWAY_API_KEY + salt);
  const xmlRes = await handleGatewayRequest(new Request(`${origin}/rest/getOpenSubsonicExtensions?u=${env.SPOTPLUS_GATEWAY_USER}&t=${token}&s=${salt}&f=xml`), { env });
  assert.equal(xmlRes.status, 200);
  const xmlText = await xmlRes.text();
  assert.match(xmlText, /<subsonic-response[^>]*status="ok"[^>]*type="spotplus-gateway"/);
  assert.match(xmlText, /apiKeyAuthentication/);

  // 4) CarPlay / Android Auto library browsing & search3
  const playlistsRes = await handleGatewayRequest(new Request(`${origin}/rest/getPlaylists?apiKey=${env.SPOTPLUS_GATEWAY_API_KEY}&f=json`), { env });
  const playlists = (await playlistsRes.json())['subsonic-response'].playlists.playlist;
  assert.ok(playlists.length >= 2);

  const plDetailRes = await handleGatewayRequest(new Request(`${origin}/rest/getPlaylist?id=${playlists[0].id}&apiKey=${env.SPOTPLUS_GATEWAY_API_KEY}&f=json`), { env });
  const tracks = (await plDetailRes.json())['subsonic-response'].playlist.entry;
  assert.equal(tracks.length, 3);

  const searchRes = await handleGatewayRequest(new Request(`${origin}/rest/search3?query=CarPlay&apiKey=${env.SPOTPLUS_GATEWAY_API_KEY}&f=json`), { env });
  const found = (await searchRes.json())['subsonic-response'].searchResult3.song;
  assert.equal(found.length, 1);
  assert.equal(found[0].id, 'test-track-523');

  // 5) Direct 302 stream redirect (zero play-count side effect) + Range 206 playback on authorized WAV
  const streamRes = await handleGatewayRequest(new Request(`${origin}/rest/stream?id=test-track-523&apiKey=${env.SPOTPLUS_GATEWAY_API_KEY}`), { env, scrobbleLog });
  assert.equal(streamRes.status, 302);
  assert.equal(streamRes.headers.get('X-Spotplus-Gateway-Mode'), 'direct-redirect');
  assert.equal(scrobbleLog.length, 0);

  const directUrl = streamRes.headers.get('Location');
  assert.ok(directUrl.startsWith(`${origin}/authorized-test-audio/`));
  const audioRes = await handleGatewayRequest(new Request(directUrl, { headers: { Range: 'bytes=0-1023' } }), { env });
  assert.equal(audioRes.status, 206);
  assert.equal(audioRes.headers.get('Content-Type'), 'audio/wav');
  assert.match(audioRes.headers.get('Content-Range'), /^bytes 0-1023\/\d+$/);
  const bytes = new Uint8Array(await audioRes.arrayBuffer());
  assert.equal(bytes.byteLength, 1024);
  assert.equal(String.fromCharCode(...bytes.slice(0, 4)), 'RIFF');
  assert.equal(String.fromCharCode(...bytes.slice(8, 12)), 'WAVE');

  // 6) Scrobble records play explicitly
  const scrobbleRes = await handleGatewayRequest(new Request(`${origin}/rest/scrobble?id=test-track-523&submission=true&apiKey=${env.SPOTPLUS_GATEWAY_API_KEY}`), { env, scrobbleLog });
  assert.equal(scrobbleRes.status, 200);
  assert.equal(scrobbleLog.length, 1);

  // 7) SSRF & malformed-request protections
  assert.equal(isAllowedDirectUrl('https://169.254.169.254/latest/meta-data'), false);
  assert.equal(isAllowedDirectUrl('https://10.0.0.5/internal.mp3'), false);
  assert.equal(isAllowedDirectUrl('http://cdn.example.com/track.mp3'), false);
  assert.equal(isAllowedDirectUrl('https://cdn.example.com/track.mp3', { allowedHosts: ['cdn.example.com'] }), true);

  const traversal = await handleGatewayRequest(new Request(`${origin}/rest/ping?id=%252e%252e%2Fetc%2Fpasswd`), { env });
  assert.equal(traversal.status, 400);
});

// ---------------- Path 3: Spot+ Native Microbridge ----------------
test('Path 3: protocol validates origins, media URLs, envelopes, and single-engine authority lock', () => {
  assert.equal(isAllowedBridgeOrigin('https://coye2.github.io'), true);
  assert.equal(isAllowedBridgeOrigin('https://evil.example.com'), false);

  assert.equal(isSafeMediaUrl('https://spot-plus-canvas.pwr97pnmkn.workers.dev/yta?id=abc12345678'), true);
  assert.equal(isSafeMediaUrl('javascript:alert(1)'), false);
  assert.equal(isSafeMediaUrl('https://169.254.169.254/secret'), false);
  assert.equal(isSafeMediaUrl('http://localhost:3000/audio.mp3', { allowLocalhostHttp: true }), true);

  const goodSeek = createEnvelope(MESSAGE_TYPES.CMD_SEEK, { positionSec: 42 });
  assert.equal(validateEnvelope(goodSeek).ok, true);
  const badSeek = { ...goodSeek, payload: { positionSec: -5 } };
  assert.equal(validateEnvelope(badSeek).ok, false);

  const lock = new EngineAuthorityLock();
  assert.equal(lock.canWebAudioPlay(), true);
  lock.claimNative({ platform: 'android-media3', version: '0.1.0' });
  assert.equal(lock.canWebAudioPlay(), false);
  assert.equal(lock.snapshot().webAudioMutedByBridge, true);
  lock.releaseToWeb();
  assert.equal(lock.canWebAudioPlay(), true);
});

test('Path 3: NativeMicrobridgeClient executes handshake, resolution, recovery, state sync, and CarPlay/Auto browse over loopback', async () => {
  const sentToNative = [];
  let deliverToWeb = null;

  const loopbackTransport = {
    kind: 'android-media3',
    send(env) {
      sentToNative.push(env);
      if (env.type === MESSAGE_TYPES.HELLO) {
        queueMicrotask(() => {
          deliverToWeb(createEnvelope(MESSAGE_TYPES.HELLO_ACK, {
            platform: 'android-media3',
            version: '0.1.0',
            features: ['android-auto-library', 'background-exoplayer'],
          }, { replyTo: env.id }), 'https://coye2.github.io');
        });
      }
    },
    listen(fn) {
      deliverToWeb = fn;
      return () => { deliverToWeb = null; };
    },
  };

  let lastState = null;
  const client = new NativeMicrobridgeClient({
    transport: loopbackTransport,
    resolveTrack: async (track) => ({
      url: `https://spot-plus-canvas.pwr97pnmkn.workers.dev/yta?id=${track.id}`,
      mime: 'audio/mp4',
      duration: 214,
      kind: 'ytrelay',
    }),
    getLibrarySnapshot: async () => ({
      likes: [{ id: 's1', title: 'Nightcall', artist: 'Kavinsky', album: 'OutRun', duration: 258 }],
      playlists: [{ id: 'p1', name: 'Late Drive', tracks: [{ id: 's1', title: 'Nightcall', artist: 'Kavinsky', album: 'OutRun', duration: 258 }] }],
    }),
    onStateSync: (s) => { lastState = s; },
  });

  const conn = await client.connect();
  assert.equal(conn.ok, true);
  assert.equal(client.authority.canWebAudioPlay(), false);

  // Untrusted origin messages are ignored
  deliverToWeb(createEnvelope(MESSAGE_TYPES.STATE_SYNC, { state: 'PLAYING', route: 'android-auto' }), 'https://attacker.invalid');
  assert.equal(lastState, null);

  // Trusted origin state sync propagates
  deliverToWeb(createEnvelope(MESSAGE_TYPES.STATE_SYNC, { state: 'PLAYING', positionSec: 12.5, route: 'android-auto' }), 'https://coye2.github.io');
  assert.equal(lastState.state, 'PLAYING');
  assert.equal(lastState.route, 'android-auto');

  // Native requests track resolution (or fresh stream on 403 recovery)
  const reqEnv = createEnvelope(MESSAGE_TYPES.ERROR_REQUEST_FRESH_STREAM, { track: { id: 'abc12345678' } });
  deliverToWeb(reqEnv, 'https://coye2.github.io');
  await new Promise((r) => setTimeout(r, 20));
  const resolvedMsg = sentToNative.find((m) => m.type === MESSAGE_TYPES.RESOLVE_RESULT && m.replyTo === reqEnv.id);
  assert.ok(resolvedMsg);
  assert.equal(resolvedMsg.payload.sourceKind, 'ytrelay');

  // Native browses CarPlay / Android Auto library tree
  const rootItems = browseLibrarySnapshot(
    { likes: [{ id: '1', title: 'A' }], playlists: [{ id: 'p1', name: 'Mix', tracks: [{ id: '1', title: 'A' }] }] },
    MESSAGE_TYPES.LIBRARY_GET_ROOT,
  );
  assert.equal(rootItems.length, 2);
  assert.equal(rootItems[0].id, 'spotplus:likes');

  client.disconnect();
  assert.equal(client.authority.canWebAudioPlay(), true);
});
