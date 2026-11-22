// workers/spotify-relay/src/health.js
// Capability & health endpoint reporting real verified Spotify delivery boundaries.

export function buildHealthPayload({ circuitBreaker, metrics, now = Date.now() }) {
  return {
    service: 'Spot+ Spotify Control-Plane Relay',
    status: circuitBreaker.isOpen(now) ? 'degraded' : 'ok',
    capabilities: {
      directAudioProxy: false,
      directAudioProxyReason:
        'Spotify prohibits server-side proxying or relaying of full-track audio streams and delivers audio encrypted via DRM. Authorized full-track playback runs client-side through the official Spotify Web Playback SDK or Spotify Connect.',
      pkceTokenExchange: true,
      pkceTokenRefresh: true,
      trackUriResolution: true,
      publicAudioCaching: false,
    },
    circuitBreaker: circuitBreaker.snapshot(now),
    metrics: {
      uptimeSec: Math.max(0, Math.floor((now - metrics.startedAt) / 1000)),
      totalRequests: metrics.totalRequests,
      rateLimitedRequests: metrics.rateLimitedRequests,
      coalescedHits: metrics.coalescedHits,
      cacheHits: metrics.cacheHits,
      upstreamRequests: metrics.upstreamRequests,
      bytesSent: metrics.bytesSent,
    },
  };
}
