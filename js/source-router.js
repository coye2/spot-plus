// source-router.js — Smart Source Router with EWMA latency, reliability scoring,
// exponential-backoff circuit breakers, compatibility checks, and equivalence guards.
import { rankAudioMatches } from './audio-selection.js';

const STORAGE_KEY = 'spotplus.routerStats.v1';
const MAX_HOSTS = 60;
const BASE_COOLDOWN_MS = 15_000;
const MAX_COOLDOWN_MS = 240_000;

export function extractUrlExpiry(url) {
  const m = String(url || '').match(/[?&]expire=(\d{9,11})/);
  return m ? Number(m[1]) * 1000 : 0;
}

export function isUrlExpired(url, now = Date.now(), marginMs = 60_000) {
  const exp = extractUrlExpiry(url);
  return !!exp && exp - marginMs <= now;
}

export function isValidMediaUrl(url) {
  if (!url || typeof url !== 'string') return false;
  if (/^(blob|data):/i.test(url)) return true;
  try {
    const parsed = new URL(url, globalThis.location?.href || 'https://localhost/');
    if (parsed.protocol === 'https:') return true;
    return parsed.protocol === 'http:' && (parsed.hostname === '127.0.0.1' || parsed.hostname === 'localhost');
  } catch {
    return false;
  }
}

export function validateSourceCandidate(source, { canPlay = () => true, requireCors = false, corsKnown = () => undefined, now = Date.now() } = {}) {
  if (!source || typeof source !== 'object') return { ok: false, reason: 'missing_source' };
  if (source.kind === 'youtube-embed') return { ok: !!source.videoId, reason: source.videoId ? 'ok' : 'missing_video_id' };
  if (!isValidMediaUrl(source.url)) return { ok: false, reason: 'invalid_url' };
  if (isUrlExpired(source.url, now)) return { ok: false, reason: 'expired_url' };
  if (source.mime && /^audio\//.test(source.mime) && canPlay) {
    const codecPart = source.codec && !source.mime.includes('codecs=') ? `; codecs="${source.codec}"` : '';
    if (!canPlay(source.mime + codecPart)) return { ok: false, reason: 'unsupported_codec' };
  }
  if (requireCors && corsKnown(source.url) === false) return { ok: false, reason: 'cors_blocked' };
  return { ok: true, reason: 'ok' };
}

export function isVerifiedEquivalent(track, candidate) {
  if (!track || !candidate) return false;
  if (candidate.videoId && track.videoId && candidate.videoId === track.videoId) return true;
  if (candidate.preview) return false; // Never silently claim a 30s preview equals a full recording.
  const meta = {
    id: candidate.videoId || candidate.catalogId || 'cand',
    title: candidate.title || track.title,
    channel: candidate.channel || candidate.author || candidate.uploader || track.artist,
    duration: candidate.duration || track.duration || 0,
    verified: !!candidate.verified,
  };
  return rankAudioMatches([meta], track).length > 0;
}

export class SourceRouter {
  constructor(storage = globalThis.localStorage) {
    this.storage = storage;
    this.hosts = new Map();
    this._saveTimer = 0;
    this._halfOpenInFlight = new Set();
    this._load();
  }

  _load() {
    try {
      const raw = JSON.parse(this.storage?.getItem?.(STORAGE_KEY) || 'null');
      if (raw && typeof raw === 'object') {
        for (const [base, entry] of Object.entries(raw)) {
          if (!entry || typeof entry !== 'object') continue;
          this.hosts.set(base, {
            latencyMs: Number(entry.latencyMs) || 1800,
            startupMs: Number(entry.startupMs) || 0,
            successes: Number(entry.successes) || 0,
            failures: Number(entry.failures) || 0,
            stalls: Number(entry.stalls) || 0,
            consecutiveFailures: 0,
            circuit: 'closed',
            openedUntil: 0,
            cooldownLevel: 0,
            lastAt: Number(entry.lastAt) || 0,
            cors: typeof entry.cors === 'boolean' ? entry.cors : undefined,
          });
        }
      }
    } catch { /* ignore corrupted storage */ }
  }

  _scheduleSave() {
    if (!this.storage?.setItem) return;
    clearTimeout(this._saveTimer);
    this._saveTimer = setTimeout(() => {
      try {
        const entries = [...this.hosts.entries()]
          .sort((a, b) => (b[1].lastAt || 0) - (a[1].lastAt || 0))
          .slice(0, MAX_HOSTS)
          .map(([base, s]) => [base, {
            latencyMs: Math.round(s.latencyMs),
            startupMs: Math.round(s.startupMs),
            successes: s.successes,
            failures: s.failures,
            stalls: s.stalls,
            lastAt: s.lastAt,
            cors: s.cors,
          }]);
        this.storage.setItem(STORAGE_KEY, JSON.stringify(Object.fromEntries(entries)));
      } catch { /* storage quota or private mode */ }
    }, 1500);
    this._saveTimer.unref?.();
  }

  _entry(base) {
    let e = this.hosts.get(base);
    if (!e) {
      e = {
        latencyMs: 1800,
        startupMs: 0,
        successes: 0,
        failures: 0,
        stalls: 0,
        consecutiveFailures: 0,
        circuit: 'closed',
        openedUntil: 0,
        cooldownLevel: 0,
        lastAt: 0,
        cors: undefined,
      };
      this.hosts.set(base, e);
    }
    return e;
  }

  recordResolution(base, ms, ok, { now = Date.now(), fatal = false } = {}) {
    if (!base) return;
    const e = this._entry(base);
    e.lastAt = now;
    this._halfOpenInFlight.delete(base);
    const clampedMs = Math.max(10, Math.min(20_000, Number(ms) || 1500));
    if (ok) {
      e.latencyMs = e.successes ? e.latencyMs * 0.65 + clampedMs * 0.35 : clampedMs;
      e.successes++;
      e.consecutiveFailures = 0;
      e.cooldownLevel = 0;
      e.circuit = 'closed';
      e.openedUntil = 0;
    } else {
      // Only let slow/timeout failures raise latency; fast 403/503s must stay penalized via reliability & breaker.
      if (clampedMs > e.latencyMs) e.latencyMs = e.latencyMs * 0.7 + clampedMs * 0.3;
      e.failures++;
      e.consecutiveFailures++;
      if (fatal || e.consecutiveFailures >= 2 || e.circuit === 'half-open') {
        const lvl = e.circuit === 'half-open' ? Math.min(4, e.cooldownLevel + 1) : Math.min(4, e.cooldownLevel);
        const cooldown = Math.min(MAX_COOLDOWN_MS, BASE_COOLDOWN_MS * (2 ** lvl));
        e.circuit = 'open';
        e.openedUntil = now + cooldown;
        e.cooldownLevel = lvl;
      }
    }
    this._scheduleSave();
  }

  recordPlayback(base, { ok = true, startupMs = 0, stalled = false, cors } = {}, now = Date.now()) {
    if (!base) return;
    const e = this._entry(base);
    e.lastAt = now;
    if (typeof cors === 'boolean') e.cors = cors;
    if (stalled) {
      e.stalls++;
      if (e.stalls % 2 === 0) {
        e.circuit = 'open';
        e.openedUntil = now + BASE_COOLDOWN_MS;
      }
      this._scheduleSave();
      return;
    }
    if (ok) {
      e.successes++;
      e.consecutiveFailures = 0;
      e.circuit = 'closed';
      e.openedUntil = 0;
      if (startupMs > 0) e.startupMs = e.startupMs ? e.startupMs * 0.6 + startupMs * 0.4 : startupMs;
    } else {
      this.recordResolution(base, 6000, false, { now });
      return;
    }
    this._scheduleSave();
  }

  isAvailable(base, now = Date.now()) {
    const e = this.hosts.get(base);
    if (!e || e.circuit === 'closed') return true;
    if (now >= e.openedUntil) {
      if (this._halfOpenInFlight.has(base)) return false;
      e.circuit = 'half-open';
      return true;
    }
    return false;
  }

  claimHalfOpen(base, now = Date.now()) {
    const e = this.hosts.get(base);
    if (e && e.circuit !== 'closed' && now >= e.openedUntil) {
      e.circuit = 'half-open';
      this._halfOpenInFlight.add(base);
    }
  }

  score(base, { custom = [], now = Date.now() } = {}) {
    const e = this.hosts.get(base);
    const isCustom = custom.includes(base);
    if (!e) return isCustom ? -100 : 1800;
    const reliability = (e.successes + 2) / (e.successes + e.failures + 3);
    const stallFactor = 1 / (1 + e.stalls * 0.35);
    const available = this.isAvailable(base, now);
    const baseCost = (e.latencyMs + (e.startupMs ? e.startupMs * 0.25 : 0)) / ((reliability * reliability) * stallFactor);
    if (!available) return 1e9 + (e.openedUntil - now);
    return isCustom ? Math.min(-1, baseCost * 0.1 - 50) : Math.round(baseCost);
  }

  rank(list, { custom = [], now = Date.now(), includeOpenFallback = false } = {}) {
    const scored = list.map((base, idx) => ({
      base,
      idx,
      available: this.isAvailable(base, now),
      cost: this.score(base, { custom, now }),
    }));
    const healthy = scored.filter(x => x.available).sort((a, b) => a.cost - b.cost || a.idx - b.idx);
    if (healthy.length || includeOpenFallback) {
      const rest = includeOpenFallback
        ? scored.filter(x => !x.available).sort((a, b) => a.cost - b.cost || a.idx - b.idx)
        : [];
      return [...healthy, ...rest].map(x => x.base);
    }
    // If every single server has an open breaker, fall back to sorting by earliest expiry rather than returning [].
    return scored.sort((a, b) => a.cost - b.cost || a.idx - b.idx).map(x => x.base);
  }

  reset() {
    this.hosts.clear();
    this._halfOpenInFlight.clear();
    clearTimeout(this._saveTimer);
    try { this.storage?.removeItem?.(STORAGE_KEY); } catch { /* ignore */ }
  }

  report() {
    const out = {};
    for (const [base, e] of this.hosts) {
      const total = e.successes + e.failures;
      out[base] = {
        latencyMs: Math.round(e.latencyMs),
        startupMs: Math.round(e.startupMs),
        successRate: total ? Math.round((e.successes / total) * 1000) / 1000 : 1,
        stalls: e.stalls,
        circuit: e.circuit,
      };
    }
    return out;
  }
}

export const router = new SourceRouter();
