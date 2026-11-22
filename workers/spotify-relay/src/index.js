// workers/spotify-relay/src/index.js
// Spot+ Spotify Control-Plane Cloudflare Worker.
//
// IMPORTANT PROTOCOL BOUNDARY:
// Spotify does NOT permit server-side proxying, decrypting, or relaying of full-track audio bytes.
// This Worker strictly serves authorized, policy-compliant control-plane assistance:
//   - GET  /health       : capability & circuit-breaker diagnostics
//   - POST /auth/token   : optional PKCE authorization code exchange proxy (zero secret exposure, zero token storage)
//   - POST /auth/refresh : optional PKCE refresh token exchange proxy (zero token storage)
//   - GET  /resolve      : short-lived in-memory Spotify track URI resolution (never caches protected audio; Cache-Control: private, no-store)
//   - GET  /audio        : explicit 501 documenting why direct audio proxying is unsupported

import {
  isOriginAllowed,
  extractBearerToken,
  deriveUserKey,
  validatePkceTokenPayload,
  validateRefreshPayload,
} from './auth.js';
import {
  SlidingWindowLimiter,
  CircuitBreaker,
  RequestCoalescer,
  BoundedCache,
  fetchWithBoundedRetry,
  createMetrics,
} from './rate-limit.js';
import { buildHealthPayload } from './health.js';

const SPOTIFY_TOKEN_URL = 'https://accounts.spotify.com/api/token';
const SPOTIFY_SEARCH_URL = 'https://api.spotify.com/v1/search';

const SECURITY_HEADERS = Object.freeze({
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
  'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'",
  'Cache-Control': 'private, no-store, max-age=0',
  'Pragma': 'no-cache',
});

export function createSpotifyRelayHandler() {
  const ipLimiter = new SlidingWindowLimiter({ limit: 60, windowMs: 60_000 });
  const userLimiter = new SlidingWindowLimiter({ limit: 40, windowMs: 60_000 });
  const circuitBreaker = new CircuitBreaker({ failureThreshold: 5, baseCooldownMs: 15_000, maxCooldownMs: 300_000 });
  const coalescer = new RequestCoalescer();
  // Short-lived non-audio metadata URI map (canonical track URI + duration only; never audio bytes).
  const uriCache = new BoundedCache({ maxEntries: 600, ttlMs: 10 * 60_000 });
  const metrics = createMetrics();

  function makeResponse(data, status, origin, extraHeaders = {}) {
    const body = JSON.stringify(data);
    metrics.bytesSent += body.length;
    const headers = new Headers({
      ...SECURITY_HEADERS,
      'Content-Type': 'application/json; charset=utf-8',
      ...extraHeaders,
    });
    if (origin) {
      headers.set('Access-Control-Allow-Origin', origin);
      headers.set('Vary', 'Origin');
    }
    return new Response(body, { status, headers });
  }

  async function handle(request, { fetcher = fetch, env = {}, now = () => Date.now() } = {}) {
    const ts = now();
    metrics.totalRequests += 1;

    const origin = request.headers.get('Origin') || '';
    if (!isOriginAllowed(origin, env)) {
      return makeResponse({ error: 'Origin not allowed' }, 403, '');
    }

    if (request.method === 'OPTIONS') {
      const headers = new Headers({
        ...SECURITY_HEADERS,
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Authorization, Content-Type, Accept',
        'Access-Control-Max-Age': '600',
      });
      if (origin) {
        headers.set('Access-Control-Allow-Origin', origin);
        headers.set('Vary', 'Origin');
      }
      return new Response(null, { status: 204, headers });
    }

    const url = new URL(request.url);
    if (url.search.length > 600) {
      return makeResponse({ error: 'Query string too long' }, 414, origin);
    }

    // Per-IP abuse protection
    const ip = request.headers.get('CF-Connecting-IP') || request.headers.get('X-Forwarded-For') || 'local';
    const ipCheck = ipLimiter.check(ip, ts);
    if (!ipCheck.allowed) {
      metrics.rateLimitedRequests += 1;
      return makeResponse(
        { error: 'Rate limit exceeded. Try again shortly.' },
        429,
        origin,
        { 'Retry-After': String(ipCheck.retryAfterSec) },
      );
    }

    if (url.pathname === '/health' && request.method === 'GET') {
      return makeResponse(buildHealthPayload({ circuitBreaker, metrics, now: ts }), 200, origin);
    }

    // Explicit refusal for direct audio proxying — never fake a DRM bypass or unauthorized relay.
    if (url.pathname === '/audio') {
      return makeResponse(
        {
          error: 'Direct server-side Spotify audio proxying is unsupported.',
          reason:
            'Spotify full-track streams are DRM-protected and Spotify Developer Terms prohibit server-side proxying or redistribution. Use the official client-side Spotify Web Playback SDK or Spotify Connect.',
        },
        501,
        origin,
      );
    }

    if (circuitBreaker.isOpen(ts)) {
      return makeResponse(
        { error: 'Spotify upstream temporarily cooling down. Retry shortly.' },
        503,
        origin,
        { 'Retry-After': String(circuitBreaker.retryAfterSec(ts)) },
      );
    }

    // PKCE Authorization Code Exchange (public client — zero secret required or exposed)
    if (url.pathname === '/auth/token' && request.method === 'POST') {
      let body;
      try { body = await request.json(); } catch { body = null; }
      const check = validatePkceTokenPayload(body);
      if (!check.ok) return makeResponse({ error: check.error }, 400, origin);

      const form = new URLSearchParams({
        grant_type: 'authorization_code',
        client_id: check.clientId,
        code: check.code,
        redirect_uri: check.redirectUri,
        code_verifier: check.codeVerifier,
      });
      metrics.upstreamRequests += 1;
      const upstream = await fetchWithBoundedRetry(
        SPOTIFY_TOKEN_URL,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
          body: form.toString(),
        },
        { fetcher, maxRetries: 1, timeoutMs: 8000 },
      );
      if (upstream.status === 429) {
        circuitBreaker.recordRateLimit(upstream.headers.get('Retry-After'), ts);
      } else if (upstream.status >= 500) {
        circuitBreaker.recordFailure(ts);
      } else {
        circuitBreaker.recordSuccess();
      }
      const data = await upstream.json().catch(() => ({ error: 'invalid_response' }));
      return makeResponse(data, upstream.status, origin);
    }

    // PKCE Refresh Token Exchange
    if (url.pathname === '/auth/refresh' && request.method === 'POST') {
      let body;
      try { body = await request.json(); } catch { body = null; }
      const check = validateRefreshPayload(body);
      if (!check.ok) return makeResponse({ error: check.error }, 400, origin);

      const form = new URLSearchParams({
        grant_type: 'refresh_token',
        client_id: check.clientId,
        refresh_token: check.refreshToken,
      });
      metrics.upstreamRequests += 1;
      const upstream = await fetchWithBoundedRetry(
        SPOTIFY_TOKEN_URL,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
          body: form.toString(),
        },
        { fetcher, maxRetries: 1, timeoutMs: 8000 },
      );
      if (upstream.status === 429) {
        circuitBreaker.recordRateLimit(upstream.headers.get('Retry-After'), ts);
      } else if (upstream.status >= 500) {
        circuitBreaker.recordFailure(ts);
      } else {
        circuitBreaker.recordSuccess();
      }
      const data = await upstream.json().catch(() => ({ error: 'invalid_response' }));
      return makeResponse(data, upstream.status, origin);
    }

    // Track metadata -> canonical Spotify URI resolution (short-lived cache + coalescing, zero audio proxying)
    if (url.pathname === '/resolve' && request.method === 'GET') {
      const token = extractBearerToken(request);
      if (!token) return makeResponse({ error: 'Authorization Bearer token required' }, 401, origin);

      const userKey = await deriveUserKey(token);
      const userCheck = userLimiter.check(userKey, ts);
      if (!userCheck.allowed) {
        metrics.rateLimitedRequests += 1;
        return makeResponse(
          { error: 'Per-user rate limit exceeded' },
          429,
          origin,
          { 'Retry-After': String(userCheck.retryAfterSec) },
        );
      }

      const title = (url.searchParams.get('title') || '').trim().slice(0, 140);
      const artist = (url.searchParams.get('artist') || '').trim().slice(0, 120);
      const isrc = (url.searchParams.get('isrc') || '').trim().replace(/[^A-Za-z0-9]/g, '').slice(0, 16);
      if (!isrc && (!title || !artist)) {
        return makeResponse({ error: 'Provide isrc or both title and artist' }, 400, origin);
      }

      const cacheKey = isrc
        ? `isrc:${isrc.toUpperCase()}`
        : `ta:${artist.toLowerCase()}::${title.toLowerCase()}`;
      const cached = uriCache.get(cacheKey, ts);
      if (cached) {
        metrics.cacheHits += 1;
        return makeResponse({ ...cached, cached: true }, 200, origin);
      }

      const wasInflight = coalescer.inflight.has(cacheKey);
      if (wasInflight) metrics.coalescedHits += 1;

      try {
        const resolved = await coalescer.run(cacheKey, async () => {
          const q = isrc ? `isrc:${isrc}` : `track:${title} artist:${artist}`;
          const searchUrl = `${SPOTIFY_SEARCH_URL}?type=track&limit=5&q=${encodeURIComponent(q)}`;
          metrics.upstreamRequests += 1;
          const upstream = await fetchWithBoundedRetry(
            searchUrl,
            {
              method: 'GET',
              headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
            },
            { fetcher, maxRetries: 1, timeoutMs: 8000 },
          );
          if (upstream.status === 401) return { status: 401, payload: { error: 'Spotify token expired' } };
          if (upstream.status === 429) {
            const retryAfter = upstream.headers.get('Retry-After') || '30';
            circuitBreaker.recordRateLimit(retryAfter, now());
            return { status: 429, retryAfter, payload: { error: 'Spotify rate limited' } };
          }
          if (!upstream.ok) {
            if (upstream.status >= 500) circuitBreaker.recordFailure(now());
            return { status: upstream.status, payload: { error: 'Spotify search failed' } };
          }
          circuitBreaker.recordSuccess();
          const json = await upstream.json().catch(() => null);
          const items = Array.isArray(json?.tracks?.items) ? json.tracks.items : [];
          const best = items.find((item) => item && item.id && item.uri && item.is_playable !== false) || items[0];
          if (!best) return { status: 404, payload: { error: 'Track not found on Spotify' } };
          const result = {
            id: best.id,
            uri: best.uri,
            name: best.name,
            artist: (best.artists || []).map((a) => a.name).join(', '),
            durationMs: Number(best.duration_ms) || 0,
            explicit: !!best.explicit,
          };
          uriCache.set(cacheKey, result, now());
          return { status: 200, payload: { ...result, cached: false } };
        });

        const extra = resolved.retryAfter ? { 'Retry-After': String(resolved.retryAfter) } : {};
        return makeResponse(resolved.payload, resolved.status, origin, extra);
      } catch {
        circuitBreaker.recordFailure(now());
        return makeResponse({ error: 'Spotify resolution failed' }, 502, origin);
      }
    }

    return makeResponse({ error: 'Not found' }, 404, origin);
  }

  return {
    handle,
    reset() {
      ipLimiter.reset();
      userLimiter.reset();
      circuitBreaker.reset();
      uriCache.clear();
    },
    metrics,
  };
}

const defaultRelay = createSpotifyRelayHandler();
export const handleSpotifyRelay = defaultRelay.handle;

export default {
  fetch(request, env) {
    return handleSpotifyRelay(request, { env });
  },
};
