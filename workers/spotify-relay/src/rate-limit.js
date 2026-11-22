// workers/spotify-relay/src/rate-limit.js
// Per-user & per-IP rate limits, in-flight request coalescing, exponential backoff,
// circuit breaker, and request/bandwidth telemetry to prevent Cloudflare quota exhaustion.

export class SlidingWindowLimiter {
  constructor({ limit = 60, windowMs = 60_000, maxKeys = 4000 } = {}) {
    this.limit = limit;
    this.windowMs = windowMs;
    this.maxKeys = maxKeys;
    this.buckets = new Map();
  }

  check(key, now = Date.now()) {
    const entry = this.buckets.get(key);
    if (!entry || now - entry.start >= this.windowMs) {
      if (this.buckets.size >= this.maxKeys) this.buckets.clear();
      this.buckets.set(key, { start: now, count: 1 });
      return { allowed: true, remaining: this.limit - 1, retryAfterSec: 0 };
    }
    entry.count += 1;
    if (entry.count > this.limit) {
      const retryAfterSec = Math.max(1, Math.ceil((this.windowMs - (now - entry.start)) / 1000));
      return { allowed: false, remaining: 0, retryAfterSec };
    }
    return { allowed: true, remaining: this.limit - entry.count, retryAfterSec: 0 };
  }

  reset() {
    this.buckets.clear();
  }
}

export class CircuitBreaker {
  constructor({ failureThreshold = 5, baseCooldownMs = 15_000, maxCooldownMs = 300_000 } = {}) {
    this.failureThreshold = failureThreshold;
    this.baseCooldownMs = baseCooldownMs;
    this.maxCooldownMs = maxCooldownMs;
    this.failures = 0;
    this.openUntil = 0;
    this.consecutiveOpens = 0;
  }

  isOpen(now = Date.now()) {
    return now < this.openUntil;
  }

  retryAfterSec(now = Date.now()) {
    return Math.max(0, Math.ceil((this.openUntil - now) / 1000));
  }

  recordSuccess() {
    this.failures = 0;
    this.consecutiveOpens = 0;
    this.openUntil = 0;
  }

  recordRateLimit(retryAfterHeaderSec = 0, now = Date.now()) {
    this.consecutiveOpens += 1;
    const expMs = Math.min(this.maxCooldownMs, this.baseCooldownMs * Math.pow(2, this.consecutiveOpens - 1));
    const headerMs = Number(retryAfterHeaderSec) > 0 ? Number(retryAfterHeaderSec) * 1000 : 0;
    this.openUntil = now + Math.min(this.maxCooldownMs, Math.max(expMs, headerMs));
  }

  recordFailure(now = Date.now()) {
    this.failures += 1;
    if (this.failures >= this.failureThreshold) {
      this.consecutiveOpens += 1;
      const cooldown = Math.min(this.maxCooldownMs, this.baseCooldownMs * Math.pow(2, this.consecutiveOpens - 1));
      this.openUntil = now + cooldown;
      this.failures = 0;
    }
  }

  snapshot(now = Date.now()) {
    return {
      open: this.isOpen(now),
      failures: this.failures,
      retryAfterSec: this.retryAfterSec(now),
    };
  }

  reset() {
    this.failures = 0;
    this.openUntil = 0;
    this.consecutiveOpens = 0;
  }
}

export class RequestCoalescer {
  constructor() {
    this.inflight = new Map();
  }

  async run(key, fn) {
    if (this.inflight.has(key)) return this.inflight.get(key);
    const promise = Promise.resolve().then(fn).finally(() => {
      this.inflight.delete(key);
    });
    this.inflight.set(key, promise);
    return promise;
  }
}

export class BoundedCache {
  constructor({ maxEntries = 500, ttlMs = 10 * 60_000 } = {}) {
    this.maxEntries = maxEntries;
    this.ttlMs = ttlMs;
    this.map = new Map();
  }

  get(key, now = Date.now()) {
    const item = this.map.get(key);
    if (!item) return null;
    if (now >= item.expiresAt) {
      this.map.delete(key);
      return null;
    }
    return item.value;
  }

  set(key, value, now = Date.now()) {
    if (this.map.size >= this.maxEntries) {
      const oldest = this.map.keys().next().value;
      if (oldest !== undefined) this.map.delete(oldest);
    }
    this.map.set(key, { value, expiresAt: now + this.ttlMs });
  }

  clear() {
    this.map.clear();
  }
}

/** Bounded upstream fetch with at most 1 retry on transient 5xx and exponential jittered backoff. */
export async function fetchWithBoundedRetry(url, init, { fetcher = fetch, maxRetries = 1, timeoutMs = 8000 } = {}) {
  let lastError = null;
  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), timeoutMs);
    try {
      const res = await fetcher(url, { ...init, signal: ctl.signal });
      clearTimeout(timer);
      // Never retry 4xx or 429 — respect Spotify rate limits immediately.
      if (res.status < 500 || attempt === maxRetries) return res;
    } catch (err) {
      clearTimeout(timer);
      lastError = err;
      if (attempt === maxRetries) throw err;
    }
    const backoffMs = 250 * Math.pow(2, attempt);
    await new Promise((r) => setTimeout(r, backoffMs));
  }
  throw lastError || new Error('Upstream request failed');
}

export function createMetrics() {
  return {
    startedAt: Date.now(),
    totalRequests: 0,
    rateLimitedRequests: 0,
    coalescedHits: 0,
    cacheHits: 0,
    upstreamRequests: 0,
    bytesSent: 0,
  };
}
