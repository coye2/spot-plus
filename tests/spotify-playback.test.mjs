import test from 'node:test';
import assert from 'node:assert/strict';

import { parsePlatformInfo, detectSpotifyCapabilities } from '../js/playback/spotify-capabilities.js';
import {
  generateCodeVerifier,
  generateCodeChallenge,
  createAuthorizationRequest,
  exchangeCodeForTokens,
  refreshAccessToken,
  getValidAccessToken,
  fetchSpotifyProfile,
  loadSession,
  clearSession,
  resolveRedirectUri,
} from '../js/playback/spotify-auth.js';
import {
  SpotifyPlaybackProvider,
  SPOTIFY_STATUS_LABELS,
  extractDirectSpotifyUri,
} from '../js/playback/spotify-provider.js';
import { createSpotifyRelayHandler } from '../workers/spotify-relay/src/index.js';

function createMemoryStorage() {
  const map = new Map();
  return {
    getItem(k) { return map.has(k) ? map.get(k) : null; },
    setItem(k, v) { map.set(k, String(v)); },
    removeItem(k) { map.delete(k); },
    clear() { map.clear(); },
  };
}

function jsonResponse(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });
}

test('capabilities: desktop Chromium with Widevine EME supports official Web Playback SDK and rejects direct audio relay', async () => {
  const nav = {
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36',
    maxTouchPoints: 0,
    async requestMediaKeySystemAccess(keySystem) {
      if (keySystem === 'com.widevine.alpha') return {};
      throw new Error('unsupported');
    },
  };
  const win = { isSecureContext: true, matchMedia: () => ({ matches: false }) };

  const caps = await detectSpotifyCapabilities({ nav, win });
  assert.equal(caps.isIOS, false);
  assert.equal(caps.hasEME, true);
  assert.deepEqual(caps.supportedKeySystems, ['widevine']);
  assert.equal(caps.sdkSupported, true);
  assert.equal(caps.connectRemoteSupported, true);
  assert.equal(caps.directAudioRelaySupported, false);
});

test('capabilities: iOS Safari and iOS standalone PWA honestly report Web Playback SDK unsupported while allowing Connect Remote', async () => {
  const iosNav = {
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.2 Mobile/15E148 Safari/604.1',
    maxTouchPoints: 5,
    standalone: true,
    async requestMediaKeySystemAccess(keySystem) {
      if (keySystem === 'com.apple.fps.1_0') return {};
      throw new Error('unsupported');
    },
  };
  const win = { isSecureContext: true, matchMedia: () => ({ matches: true }) };

  const info = parsePlatformInfo(iosNav, win);
  assert.equal(info.isIOS, true);
  assert.equal(info.isIOSPWA, true);

  const caps = await detectSpotifyCapabilities({ nav: iosNav, win });
  assert.equal(caps.sdkSupported, false);
  assert.match(caps.sdkCaveat, /iOS Home Screen PWAs/i);
  assert.equal(caps.connectRemoteSupported, true);
  assert.equal(caps.directAudioRelaySupported, false);
});

test('auth: RFC 7636 PKCE verifier/challenge, CSRF state validation, token exchange, refresh, and profile check without secrets', async () => {
  const storage = createMemoryStorage();
  const verifier = generateCodeVerifier(64);
  assert.equal(verifier.length, 64);
  const challenge = await generateCodeChallenge(verifier);
  assert.ok(/^[A-Za-z0-9_-]{43}$/.test(challenge), 'S256 challenge must be 43-char base64url');

  const clientId = '0123456789abcdef0123456789abcdef';
  const req = await createAuthorizationRequest({
    clientId,
    redirectUri: 'https://coye2.github.io/spot-plus/',
    storage,
  });
  const authUrl = new URL(req.url);
  assert.equal(authUrl.searchParams.get('client_id'), clientId);
  assert.equal(authUrl.searchParams.get('code_challenge_method'), 'S256');
  assert.equal(authUrl.searchParams.get('client_secret'), null);

  // State mismatch must reject cleanly
  await assert.rejects(
    () => exchangeCodeForTokens({ code: 'abc123456789', state: 'wrong_state', storage }),
    /state mismatch/i,
  );

  // Fresh PKCE flow + valid exchange
  const req2 = await createAuthorizationRequest({
    clientId,
    redirectUri: 'https://coye2.github.io/spot-plus/',
    storage,
  });
  const capturedBodies = [];
  const fetcher = async (url, opts = {}) => {
    capturedBodies.push({ url: String(url), body: String(opts.body || '') });
    if (String(url).includes('/api/token') && String(opts.body).includes('authorization_code')) {
      return jsonResponse({
        access_token: 'tok_access_initial_1234567890',
        refresh_token: 'tok_refresh_1234567890',
        expires_in: 60,
        token_type: 'Bearer',
      });
    }
    if (String(url).includes('/api/token') && String(opts.body).includes('refresh_token')) {
      return jsonResponse({
        access_token: 'tok_access_refreshed_9876543210',
        expires_in: 3600,
        token_type: 'Bearer',
      });
    }
    if (String(url).endsWith('/v1/me')) {
      return jsonResponse({
        id: 'listener_1',
        display_name: 'Coye',
        product: 'premium',
        country: 'US',
      });
    }
    return jsonResponse({ error: 'unexpected' }, 500);
  };

  const session = await exchangeCodeForTokens({
    code: 'auth_code_valid_99999',
    state: req2.state,
    storage,
    fetcher,
  });
  assert.equal(session.accessToken, 'tok_access_initial_1234567890');
  assert.ok(!capturedBodies[0].body.includes('client_secret'), 'PKCE must never send client_secret');

  const profile = await fetchSpotifyProfile({
    accessToken: session.accessToken,
    storage,
    fetcher,
  });
  assert.equal(profile.isPremium, true);
  assert.equal(profile.displayName, 'Coye');

  // Force near-expiry refresh via getValidAccessToken
  const refreshedToken = await getValidAccessToken({
    storage,
    fetcher,
    now: session.expiresAt - 10_000,
  });
  assert.equal(refreshedToken, 'tok_access_refreshed_9876543210');

  // Explicit refresh still works
  const refreshedSession = await refreshAccessToken({ storage, fetcher });
  assert.equal(refreshedSession.accessToken, 'tok_access_refreshed_9876543210');

  clearSession(storage);
  assert.equal(loadSession(storage), null);

  assert.equal(
    resolveRedirectUri({ origin: 'https://ais-dev-example.run.app', hostname: 'ais-dev-example.run.app', pathname: '/' }),
    'https://ais-dev-example.run.app/auth/spotify/callback',
  );
  assert.equal(
    resolveRedirectUri({ origin: 'https://coye2.github.io', hostname: 'coye2.github.io', pathname: '/spot-plus/' }),
    'https://coye2.github.io/spot-plus/',
  );
});

test('provider: direct Spotify URI extraction uses 0 network calls', () => {
  assert.equal(
    extractDirectSpotifyUri({ id: 'sp:4cOdK2wGLETKBW3PvgPWqT' }),
    'spotify:track:4cOdK2wGLETKBW3PvgPWqT',
  );
  assert.equal(
    extractDirectSpotifyUri({ spotifyId: '7qiZfU4dY1lWllzX7mPBI3' }),
    'spotify:track:7qiZfU4dY1lWllzX7mPBI3',
  );
  assert.equal(extractDirectSpotifyUri({ id: 'it:12345', title: 'Stargazing' }), null);
});

test('provider: truthful status gating, official Web Playback SDK play/seek/end flow, and Connect Remote fallback', async () => {
  const storage = createMemoryStorage();
  storage.setItem('spotplus.spotify.pkce.session', JSON.stringify({
    clientId: '0123456789abcdef0123456789abcdef',
    accessToken: 'valid_token_abcdefghijklmnop',
    refreshToken: 'valid_refresh_abcdefghijklmnop',
    expiresAt: Date.now() + 3600_000,
    profile: { id: 'u1', displayName: 'Coye', product: 'premium', isPremium: true },
  }));

  const events = [];
  let sdkListenerMap = new Map();
  const fakeSdk = {
    Player: class FakePlayer {
      constructor() {
        this.volume = 0.85;
      }
      addListener(ev, fn) { sdkListenerMap.set(ev, fn); }
      activateElement() {}
      async connect() {
        queueMicrotask(() => sdkListenerMap.get('ready')?.({ device_id: 'dev_sdk_1' }));
        return true;
      }
      async setVolume(v) { this.volume = v; }
      async resume() {}
      async pause() {}
      async seek() {}
      disconnect() {}
    },
  };

  const apiCalls = [];
  const fetcher = async (url, opts = {}) => {
    apiCalls.push({ url: String(url), method: opts.method || 'GET' });
    if (String(url).includes('/me/player/play')) return new Response(null, { status: 204 });
    return jsonResponse({}, 200);
  };

  const provider = new SpotifyPlaybackProvider({
    storage,
    fetcher,
    capabilitiesDetector: async () => ({
      isIOS: false,
      isStandalone: false,
      sdkSupported: true,
      connectRemoteSupported: true,
      directAudioRelaySupported: false,
      sdkCaveat: '',
    }),
    sdkLoader: async () => fakeSdk,
    onPlay: () => events.push('play'),
    onPause: () => events.push('pause'),
    onEnded: () => events.push('ended'),
  });

  const initSnap = await provider.init();
  // Never advertise 'playback-ready' before a real track has played
  assert.equal(initSnap.status, 'ready');
  assert.equal(initSnap.label, SPOTIFY_STATUS_LABELS.ready);
  assert.equal(initSnap.verifiedPlayback, false);

  const loaded = await provider.loadAndPlay({
    id: 'sp:4cOdK2wGLETKBW3PvgPWqT',
    title: 'Never Gonna Give You Up',
    artist: 'Rick Astley',
    duration: 213,
  });
  assert.equal(loaded.kind, 'spotify-official');
  assert.equal(loaded.uri, 'spotify:track:4cOdK2wGLETKBW3PvgPWqT');
  assert.equal(apiCalls.length, 1, 'Direct Spotify ID needs only the /me/player/play call');

  // Simulate real SDK state advancing -> now status truthfully flips to playback-ready
  sdkListenerMap.get('player_state_changed')?.({
    paused: false,
    position: 2500,
    duration: 213000,
    track_window: { current_track: { duration_ms: 213000 } },
  });
  assert.equal(provider.getStatusSnapshot().status, 'playback-ready');
  assert.equal(provider.verifiedPlayback, true);

  await provider.seek(120);
  assert.equal(provider.currentTime, 120);

  // Simulate near-end then natural track completion (paused at 0 after being near end)
  sdkListenerMap.get('player_state_changed')?.({
    paused: false,
    position: 212000,
    duration: 213000,
    track_window: { current_track: { duration_ms: 213000 } },
  });
  sdkListenerMap.get('player_state_changed')?.({
    paused: true,
    position: 0,
    duration: 213000,
    track_window: { current_track: { duration_ms: 213000 } },
  });
  assert.ok(events.includes('ended'));

  provider.disconnectAccount();
  assert.equal(provider.getStatusSnapshot().status, 'disconnected');
  assert.equal(loadSession(storage), null);
});

test('provider: iOS PWA falls back to active Spotify Connect remote device when available', async () => {
  const storage = createMemoryStorage();
  storage.setItem('spotplus.spotify.pkce.session', JSON.stringify({
    clientId: '0123456789abcdef0123456789abcdef',
    accessToken: 'valid_token_abcdefghijklmnop',
    refreshToken: 'valid_refresh_abcdefghijklmnop',
    expiresAt: Date.now() + 3600_000,
    profile: { id: 'u1', displayName: 'Coye', product: 'premium', isPremium: true },
  }));

  const fetcher = async (url) => {
    const s = String(url);
    if (s.includes('/me/player/devices')) {
      return jsonResponse({ devices: [{ id: 'ios_spotify_app', name: 'iPhone Spotify', is_active: true, is_restricted: false }] });
    }
    if (s.includes('/me/player/volume') || s.includes('/me/player/play')) {
      return new Response(null, { status: 204 });
    }
    return jsonResponse({}, 404);
  };

  const provider = new SpotifyPlaybackProvider({
    storage,
    fetcher,
    capabilitiesDetector: async () => ({
      isIOS: true,
      isIOSPWA: true,
      isStandalone: true,
      sdkSupported: false,
      connectRemoteSupported: true,
      directAudioRelaySupported: false,
      sdkCaveat: 'iOS PWA unsupported for Web Playback SDK.',
    }),
  });

  await provider.init();
  assert.equal(provider.getStatusSnapshot().status, 'browser-unsupported');

  const res = await provider.loadAndPlay({
    id: 'sp:4cOdK2wGLETKBW3PvgPWqT',
    title: 'Test Track',
    artist: 'Test Artist',
    duration: 180,
  });
  assert.equal(res.deviceId, 'ios_spotify_app');
  assert.match(res.engineLabel, /Spotify Connect/);
  assert.equal(provider.getStatusSnapshot().status, 'playback-ready');
  provider.stop();
});

test('worker: origin allowlist, honest /health, 501 /audio refusal, coalescing, no-store cache, rate limiting, and circuit breaker', async () => {
  const relay = createSpotifyRelayHandler();
  const origin = 'https://coye2.github.io';

  // 1. Disallowed origin -> 403
  const badOriginRes = await relay.handle(
    new Request('https://worker.example/health', { headers: { Origin: 'https://evil.example' } }),
  );
  assert.equal(badOriginRes.status, 403);

  // 2. Honest /health -> 200, directAudioProxy: false, private no-store
  const healthRes = await relay.handle(
    new Request('https://worker.example/health', { headers: { Origin: origin } }),
  );
  assert.equal(healthRes.status, 200);
  assert.equal(healthRes.headers.get('Cache-Control'), 'private, no-store, max-age=0');
  const health = await healthRes.json();
  assert.equal(health.capabilities.directAudioProxy, false);

  // 3. Explicit 501 refusal on /audio
  const audioRes = await relay.handle(
    new Request('https://worker.example/audio?id=4cOdK2wGLETKBW3PvgPWqT', { headers: { Origin: origin } }),
  );
  assert.equal(audioRes.status, 501);
  const audioJson = await audioRes.json();
  assert.match(audioJson.error, /unsupported/i);

  // 4. /resolve requires Bearer token
  const noAuthRes = await relay.handle(
    new Request('https://worker.example/resolve?title=Stargazing&artist=Myles+Smith', { headers: { Origin: origin } }),
  );
  assert.equal(noAuthRes.status, 401);

  // 5. Concurrent /resolve calls coalesce to 1 upstream request, and subsequent call hits short-lived cache
  let upstreamCalls = 0;
  const mockFetcher = async () => {
    upstreamCalls += 1;
    await new Promise((r) => setTimeout(r, 15));
    return jsonResponse({
      tracks: {
        items: [{
          id: '3Vr3zh0r7ALn8VLqCiRR10',
          uri: 'spotify:track:3Vr3zh0r7ALn8VLqCiRR10',
          name: 'Stargazing',
          artists: [{ name: 'Myles Smith' }],
          duration_ms: 172533,
          explicit: false,
          is_playable: true,
        }],
      },
    });
  };

  const makeResolveReq = (ip = '1.2.3.4') => new Request(
    'https://worker.example/resolve?title=Stargazing&artist=Myles+Smith',
    {
      headers: {
        Origin: origin,
        Authorization: 'Bearer sp_user_token_1234567890abcdef',
        'CF-Connecting-IP': ip,
      },
    },
  );

  const [r1, r2] = await Promise.all([
    relay.handle(makeResolveReq(), { fetcher: mockFetcher }),
    relay.handle(makeResolveReq(), { fetcher: mockFetcher }),
  ]);
  assert.equal(r1.status, 200);
  assert.equal(r2.status, 200);
  assert.equal(upstreamCalls, 1, 'Concurrent identical resolve requests must coalesce');
  assert.equal(r1.headers.get('Cache-Control'), 'private, no-store, max-age=0');

  // Cached hit avoids upstream completely
  const r3 = await relay.handle(makeResolveReq(), { fetcher: mockFetcher });
  const r3Json = await r3.json();
  assert.equal(r3Json.cached, true);
  assert.equal(upstreamCalls, 1);

  // 6. Upstream 429 opens circuit breaker -> next call short-circuits with 503
  const rateLimitedFetcher = async () => new Response(JSON.stringify({ error: 'rate limited' }), {
    status: 429,
    headers: { 'Retry-After': '30', 'Content-Type': 'application/json' },
  });
  const rlRes = await relay.handle(
    new Request('https://worker.example/resolve?title=NewSong&artist=NewArtist', {
      headers: {
        Origin: origin,
        Authorization: 'Bearer sp_user_token_1234567890abcdef',
        'CF-Connecting-IP': '1.2.3.4',
      },
    }),
    { fetcher: rateLimitedFetcher },
  );
  assert.equal(rlRes.status, 429);

  const cbRes = await relay.handle(
    new Request('https://worker.example/resolve?title=AnotherSong&artist=AnotherArtist', {
      headers: {
        Origin: origin,
        Authorization: 'Bearer sp_user_token_1234567890abcdef',
        'CF-Connecting-IP': '1.2.3.4',
      },
    }),
    { fetcher: mockFetcher },
  );
  assert.equal(cbRes.status, 503);
  assert.ok(Number(cbRes.headers.get('Retry-After')) >= 1);

  // 7. Reset & verify per-user rate limit triggers 429 after 40 requests
  relay.reset();
  let lastStatus = 200;
  for (let i = 0; i < 42; i += 1) {
    const res = await relay.handle(makeResolveReq(`10.0.0.${i}`), { fetcher: mockFetcher });
    lastStatus = res.status;
  }
  assert.equal(lastStatus, 429);
});
