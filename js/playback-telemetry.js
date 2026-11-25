// playback-telemetry.js — Stage-level playback instrumentation and rolling percentile analytics.
// Distinguishes play() Promise resolution from confirmed audible output proxies
// (playing event with decoded frame/headroom or YouTube active playing state).

const MAX_SAMPLES = 200;

function now() {
  return typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now();
}

function safeMark(name) {
  try { performance?.mark?.(name); } catch { /* unsupported */ }
}

function safeMeasure(name, startMark, endMark) {
  try { performance?.measure?.(name, startMark, endMark); } catch { /* unsupported */ }
}

function percentile(arr, p) {
  if (!arr.length) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return Math.round(sorted[idx] * 100) / 100;
}

function pushSample(arr, value) {
  if (!Number.isFinite(value) || value < 0) return;
  arr.push(value);
  if (arr.length > MAX_SAMPLES) arr.shift();
}

export class PlaybackTelemetry {
  constructor() {
    this.generations = new Map();
    this.activeSeek = null;
    this.activeStall = null;
    this.samples = {
      coldStartupMs: [],
      warmStartupMs: [],
      localStartupMs: [],
      preparedTransitionMs: [],
      resolutionMs: [],
      mediaInitToAudibleMs: [],
      seekMs: [],
      recoveryMs: [],
    };
    this.counters = {
      startsAttempted: 0,
      startsSucceeded: 0,
      startsFailed: 0,
      cacheHits: 0,
      cacheMisses: 0,
      preparedTransitions: 0,
      stalls: 0,
      totalStallMs: 0,
      recoveriesAttempted: 0,
      recoveriesSucceeded: 0,
      listeningMs: 0,
      relayMatchRequests: 0,
      relayHeadRequests: 0,
      relayStreamRequests: 0,
      relayHealthRequests: 0,
      coalescedRequests: 0,
      continuityRecoveries: 0,
    };
    this.lastAudit = null;
    this._listeningSince = 0;
  }

  recordRelayRequest(kind = 'match') {
    if (kind === 'match') this.counters.relayMatchRequests++;
    else if (kind === 'yta-head') this.counters.relayHeadRequests++;
    else if (kind === 'yta-get') this.counters.relayStreamRequests++;
    else if (kind === 'health') this.counters.relayHealthRequests++;
  }

  recordCoalescedRequest() {
    this.counters.coalescedRequests++;
  }

  recordContinuityRecovery() {
    this.counters.continuityRecoveries++;
  }

  reset() {
    this.generations.clear();
    this.activeSeek = null;
    this.activeStall = null;
    for (const key of Object.keys(this.samples)) this.samples[key] = [];
    for (const key of Object.keys(this.counters)) this.counters[key] = 0;
    this.lastAudit = null;
    this._listeningSince = 0;
  }

  beginGeneration(gen, { trackId = '', trigger = 'play', prepared = false, cold = true } = {}) {
    const t0 = now();
    const record = {
      gen,
      trackId,
      trigger,
      prepared,
      cold,
      cacheLayer: 'network',
      sourceKind: '',
      instance: '',
      stages: { tapAt: t0 },
      completed: false,
      failed: false,
    };
    this.generations.set(gen, record);
    if (this.generations.size > 40) {
      const oldest = this.generations.keys().next().value;
      this.generations.delete(oldest);
    }
    this.counters.startsAttempted++;
    safeMark(`sp:gen:${gen}:tap`);
    return t0;
  }

  markStage(gen, stage, meta = {}) {
    const rec = this.generations.get(gen);
    if (!rec) return null;
    const t = now();
    if (rec.stages[stage] == null) {
      rec.stages[stage] = t;
      safeMark(`sp:gen:${gen}:${stage}`);
    }
    if (meta.cacheLayer) rec.cacheLayer = meta.cacheLayer;
    if (meta.sourceKind) rec.sourceKind = meta.sourceKind;
    if (meta.instance) rec.instance = meta.instance;
    if (typeof meta.cold === 'boolean') rec.cold = meta.cold;
    if (typeof meta.prepared === 'boolean') rec.prepared = meta.prepared;

    if (stage === 'resolveEnd' && rec.stages.resolveStart != null) {
      const resMs = t - rec.stages.resolveStart;
      pushSample(this.samples.resolutionMs, resMs);
      safeMeasure(`sp:resolve:${gen}`, `sp:gen:${gen}:resolveStart`, `sp:gen:${gen}:resolveEnd`);
    }
    if (stage === 'firstAudible' && !rec.completed) {
      rec.completed = true;
      this.counters.startsSucceeded++;
      if (rec.cacheLayer === 'network') this.counters.cacheMisses++;
      else this.counters.cacheHits++;

      const totalMs = t - rec.stages.tapAt;
      if (rec.cacheLayer === 'offline-cache') pushSample(this.samples.localStartupMs, totalMs);
      else if (rec.prepared) {
        this.counters.preparedTransitions++;
        pushSample(this.samples.preparedTransitionMs, totalMs);
      } else if (rec.cold) pushSample(this.samples.coldStartupMs, totalMs);
      else pushSample(this.samples.warmStartupMs, totalMs);

      if (rec.stages.mediaInit != null) {
        pushSample(this.samples.mediaInitToAudibleMs, t - rec.stages.mediaInit);
      }
      safeMeasure(`sp:startup:${gen}`, `sp:gen:${gen}:tap`, `sp:gen:${gen}:firstAudible`);
      this.lastAudit = this.formatAudit(rec, t);
      this.noteListeningStart(t);
    } else if (stage === 'playResolved' && rec.completed && this.lastAudit?.gen === gen) {
      this.lastAudit = this.formatAudit(rec, rec.stages.firstAudible);
    }
    return t;
  }

  markFailed(gen) {
    const rec = this.generations.get(gen);
    if (!rec || rec.failed || rec.completed) return;
    rec.failed = true;
    this.counters.startsFailed++;
    this.noteListeningStop();
  }

  noteListeningStart(at = now()) {
    if (!this._listeningSince) this._listeningSince = at;
  }

  noteListeningStop(at = now()) {
    if (this._listeningSince) {
      this.counters.listeningMs += Math.max(0, at - this._listeningSince);
      this._listeningSince = 0;
    }
  }

  beginSeek(targetSec) {
    this.activeSeek = { targetSec, startedAt: now() };
  }

  endSeek() {
    if (!this.activeSeek) return;
    const ms = now() - this.activeSeek.startedAt;
    pushSample(this.samples.seekMs, ms);
    this.activeSeek = null;
  }

  beginStall(reason = 'unknown') {
    if (this.activeStall) return;
    this.counters.stalls++;
    this.activeStall = { reason, startedAt: now() };
  }

  endStall() {
    if (!this.activeStall) return;
    this.counters.totalStallMs += Math.max(0, now() - this.activeStall.startedAt);
    this.activeStall = null;
  }

  beginRecovery() {
    this.counters.recoveriesAttempted++;
    return now();
  }

  endRecovery(startedAt, ok) {
    if (ok) this.counters.recoveriesSucceeded++;
    if (startedAt) pushSample(this.samples.recoveryMs, now() - startedAt);
  }

  formatAudit(rec, endAt = now()) {
    const s = rec.stages;
    const diff = (a, b) => (a != null && b != null ? Math.round((b - a) * 100) / 100 : null);
    return {
      gen: rec.gen,
      trackId: rec.trackId,
      cacheLayer: rec.cacheLayer,
      sourceKind: rec.sourceKind,
      cold: rec.cold,
      prepared: rec.prepared,
      totalMs: diff(s.tapAt, endAt),
      resolveMs: diff(s.resolveStart, s.resolveEnd),
      mediaInitToPlayPromiseMs: diff(s.mediaInit, s.playResolved),
      mediaInitToAudibleMs: diff(s.mediaInit, s.firstAudible),
      audibleProxy: rec.sourceKind === 'youtube-embed' ? 'yt-playerState-1' : 'playing-event-with-decode',
    };
  }

  resourceTiming(url) {
    try {
      const entries = performance?.getEntriesByType?.('resource') || [];
      for (let i = entries.length - 1; i >= 0; i--) {
        const e = entries[i];
        if (e.name === url || e.name.startsWith(String(url).split('?')[0])) {
          return {
            dnsMs: Math.round((e.domainLookupEnd - e.domainLookupStart) * 100) / 100,
            tlsMs: e.secureConnectionStart > 0 ? Math.round((e.connectEnd - e.secureConnectionStart) * 100) / 100 : 0,
            ttfbMs: Math.round((e.responseStart - e.requestStart) * 100) / 100,
            transferBytes: e.transferSize || 0,
          };
        }
      }
    } catch { /* Resource Timing unavailable */ }
    return null;
  }

  snapshot() {
    const totalListeningMs = this.counters.listeningMs + (this._listeningSince ? Math.max(0, now() - this._listeningSince) : 0);
    const hours = totalListeningMs / 3600000;
    const statsFor = (arr) => ({
      n: arr.length,
      p50: percentile(arr, 50),
      p95: percentile(arr, 95),
      p99: percentile(arr, 99),
    });
    const cacheTotal = this.counters.cacheHits + this.counters.cacheMisses;
    return {
      counters: {
        ...this.counters,
        listeningMs: Math.round(totalListeningMs),
        stallsPerHour: hours > 0 ? Math.round((this.counters.stalls / hours) * 100) / 100 : 0,
        cacheHitRate: cacheTotal > 0 ? Math.round((this.counters.cacheHits / cacheTotal) * 1000) / 1000 : 0,
        startSuccessRate: this.counters.startsAttempted > 0
          ? Math.round((this.counters.startsSucceeded / this.counters.startsAttempted) * 1000) / 1000
          : 1,
      },
      latencies: {
        coldStartupMs: statsFor(this.samples.coldStartupMs),
        warmStartupMs: statsFor(this.samples.warmStartupMs),
        localStartupMs: statsFor(this.samples.localStartupMs),
        preparedTransitionMs: statsFor(this.samples.preparedTransitionMs),
        resolutionMs: statsFor(this.samples.resolutionMs),
        mediaInitToAudibleMs: statsFor(this.samples.mediaInitToAudibleMs),
        seekMs: statsFor(this.samples.seekMs),
        recoveryMs: statsFor(this.samples.recoveryMs),
      },
      lastAudit: this.lastAudit,
    };
  }
}

export const telemetry = new PlaybackTelemetry();
