// request-scheduler.js — Priority request scheduler, graceful degradation, and negative caching.
// Protects active music playback and user track changes under Cloudflare Worker or network pressure
// by automatically shedding nonessential tiers (recommendations, decorative loops, analytics counters).

import { isFeatureEnabled } from './feature-flags.js';

export const PRIORITY = Object.freeze({
  PLAYING_AUDIO: 1,
  TRACK_CHANGE: 2,
  RECOVERY: 3,
  SEARCH_METADATA: 4,
  LYRICS: 5,
  RECOMMENDATIONS: 6,
  DECORATIVE: 7,
  ANALYTICS: 8,
});

export const PRESSURE = Object.freeze({
  NORMAL: 'normal',
  ELEVATED: 'elevated',
  CRITICAL: 'critical',
});

export class NegativeCache {
  constructor({ maxEntries = 200 } = {}) {
    this.maxEntries = maxEntries;
    this.map = new Map();
  }

  set(key, ttlMs = 60_000, now = Date.now()) {
    if (!key) return;
    if (this.map.has(key)) this.map.delete(key);
    this.map.set(key, now + Math.max(1000, Number(ttlMs) || 60_000));
    if (this.map.size > this.maxEntries) {
      this.map.delete(this.map.keys().next().value);
    }
  }

  has(key, now = Date.now()) {
    const exp = this.map.get(key);
    if (!exp) return false;
    if (exp <= now) {
      this.map.delete(key);
      return false;
    }
    return true;
  }

  delete(key) {
    this.map.delete(key);
  }

  clear() {
    this.map.clear();
  }

  get size() {
    return this.map.size;
  }
}

export class RequestScheduler {
  constructor({
    elevatedWindowMs = 45_000,
    criticalWindowMs = 120_000,
    slowLatencyMs = 2_800,
    maxConcurrentByTier = { 1: 6, 2: 6, 3: 4, 4: 4, 5: 2, 6: 2, 7: 1, 8: 1 },
    onShed = null,
  } = {}) {
    this.elevatedWindowMs = elevatedWindowMs;
    this.criticalWindowMs = criticalWindowMs;
    this.slowLatencyMs = slowLatencyMs;
    this.maxConcurrentByTier = maxConcurrentByTier;
    this.onShed = typeof onShed === 'function' ? onShed : null;

    this.pressure = PRESSURE.NORMAL;
    this.pressureUntil = 0;
    this.consecutiveErrors = 0;
    this.consecutiveSlow = 0;
    this.consecutiveHealthy = 0;

    this.inFlightByTier = new Map();
    this.coalesced = new Map();
    this.negativeCache = new NegativeCache({ maxEntries: 250 });

    this.stats = {
      admitted: 0,
      shed: 0,
      coalesced: 0,
      shedByTier: {},
      pressureTransitions: 0,
    };
  }

  reset() {
    this.pressure = PRESSURE.NORMAL;
    this.pressureUntil = 0;
    this.consecutiveErrors = 0;
    this.consecutiveSlow = 0;
    this.consecutiveHealthy = 0;
    this.inFlightByTier.clear();
    this.coalesced.clear();
    this.negativeCache.clear();
    this.stats = {
      admitted: 0,
      shed: 0,
      coalesced: 0,
      shedByTier: {},
      pressureTransitions: 0,
    };
  }

  _setPressure(next, until) {
    if (this.pressure !== next) {
      this.pressure = next;
      this.stats.pressureTransitions++;
    }
    this.pressureUntil = Math.max(this.pressureUntil, until);
  }

  /** Record an observed Worker/upstream HTTP status and latency to adapt degradation pressure. */
  noteStatus(status, latencyMs = 0, now = Date.now()) {
    const code = Number(status) || 0;
    if (code === 429) {
      this.consecutiveErrors++;
      this.consecutiveHealthy = 0;
      this._setPressure(PRESSURE.CRITICAL, now + this.criticalWindowMs);
      return this.pressure;
    }
    if (code >= 500 || code === 0) {
      this.consecutiveErrors++;
      this.consecutiveHealthy = 0;
      if (this.consecutiveErrors >= 4) {
        this._setPressure(PRESSURE.CRITICAL, now + this.criticalWindowMs);
      } else if (this.consecutiveErrors >= 2) {
        this._setPressure(PRESSURE.ELEVATED, now + this.elevatedWindowMs);
      }
      return this.pressure;
    }
    if (code >= 200 && code < 400) {
      this.consecutiveErrors = 0;
      if (latencyMs >= this.slowLatencyMs) {
        this.consecutiveSlow++;
        this.consecutiveHealthy = 0;
        if (this.consecutiveSlow >= 3 && this.pressure === PRESSURE.NORMAL) {
          this._setPressure(PRESSURE.ELEVATED, now + this.elevatedWindowMs);
        }
      } else {
        this.consecutiveSlow = 0;
        this.consecutiveHealthy++;
        if (this.pressure !== PRESSURE.NORMAL && (now >= this.pressureUntil || this.consecutiveHealthy >= 6)) {
          this.pressure = PRESSURE.NORMAL;
          this.pressureUntil = 0;
          this.stats.pressureTransitions++;
        }
      }
    }
    return this.pressure;
  }

  getPressure(now = Date.now()) {
    if (this.pressure !== PRESSURE.NORMAL && this.pressureUntil > 0 && now >= this.pressureUntil) {
      this.pressure = PRESSURE.NORMAL;
      this.pressureUntil = 0;
      this.consecutiveErrors = 0;
      this.consecutiveSlow = 0;
    }
    return this.pressure;
  }

  /** Returns whether a request of the given priority tier should run right now. */
  canRun(tier = PRIORITY.SEARCH_METADATA, { now = Date.now(), respectFlag = true } = {}) {
    if (respectFlag && !isFeatureEnabled('sPlusGracefulDegradation')) return true;
    const level = this.getPressure(now);
    const active = this.inFlightByTier.get(tier) || 0;
    const cap = this.maxConcurrentByTier[tier] || 2;

    // Tiers 1-4 (playing audio, user track changes, recovery, search) are NEVER shed due to pressure.
    if (tier <= PRIORITY.SEARCH_METADATA) return true;

    if (level === PRESSURE.CRITICAL && tier >= PRIORITY.RECOMMENDATIONS) return false;
    if (level === PRESSURE.ELEVATED && tier >= PRIORITY.DECORATIVE) return false;
    if (active >= cap) return false;
    return true;
  }

  _recordShed(tier) {
    this.stats.shed++;
    this.stats.shedByTier[tier] = (this.stats.shedByTier[tier] || 0) + 1;
    try { this.onShed?.(tier, this.pressure); } catch { /* ignore */ }
  }

  /**
   * Execute an async task under priority gating and optional single-flight coalescing.
   * When shed under pressure, resolves cleanly to `fallbackValue` (never throwing noisy errors).
   */
  async schedule(tier, task, { key = '', fallbackValue = null, now = Date.now() } = {}) {
    if (!this.canRun(tier, { now })) {
      this._recordShed(tier);
      return fallbackValue;
    }
    if (key && this.coalesced.has(key)) {
      this.stats.coalesced++;
      return this.coalesced.get(key);
    }
    this.stats.admitted++;
    this.inFlightByTier.set(tier, (this.inFlightByTier.get(tier) || 0) + 1);
    const run = Promise.resolve()
      .then(() => task())
      .finally(() => {
        const nextCount = Math.max(0, (this.inFlightByTier.get(tier) || 1) - 1);
        if (nextCount === 0) this.inFlightByTier.delete(tier);
        else this.inFlightByTier.set(tier, nextCount);
        if (key && this.coalesced.get(key) === run) this.coalesced.delete(key);
      });
    if (key) {
      this.coalesced.set(key, run);
      run.catch(() => {});
    }
    return run;
  }

  snapshot(now = Date.now()) {
    return {
      pressure: this.getPressure(now),
      admitted: this.stats.admitted,
      shed: this.stats.shed,
      coalesced: this.stats.coalesced,
      shedByTier: { ...this.stats.shedByTier },
      pressureTransitions: this.stats.pressureTransitions,
      negativeCacheSize: this.negativeCache.size,
    };
  }
}

export const scheduler = new RequestScheduler();
