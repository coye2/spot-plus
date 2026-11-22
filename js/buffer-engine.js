// buffer-engine.js — Adaptive Buffer Engine: network/throughput estimation,
// failure classification, buffered-range seek inspection, and transport selection.
import { bufferedAhead } from './playback-policy.js';
import { isUrlExpired } from './source-router.js';

export const FAILURE_CATEGORY = Object.freeze({
  USER_PAUSED: 'USER_PAUSED',
  BROWSER_SUSPENDED: 'BROWSER_SUSPENDED',
  URL_EXPIRED: 'URL_EXPIRED',
  DECODER_ERROR: 'DECODER_ERROR',
  UNSUPPORTED_CODEC: 'UNSUPPORTED_CODEC',
  NETWORK_STARVATION: 'NETWORK_STARVATION',
  MEDIA_ERROR: 'MEDIA_ERROR',
});

export function isTimeBuffered(media, sec, margin = 0.05) {
  if (!media?.buffered || !Number.isFinite(sec)) return false;
  for (let i = 0; i < media.buffered.length; i++) {
    if (media.buffered.start(i) - margin <= sec && media.buffered.end(i) + margin >= sec) return true;
  }
  return false;
}

export function inspectSeek(media, targetSec, durationFallback = 0) {
  const dur = Number.isFinite(media?.duration) && media.duration > 0 ? media.duration : durationFallback;
  const clamped = Math.max(0, dur > 0 ? Math.min(targetSec, dur) : Math.max(0, targetSec));
  const inBuffer = isTimeBuffered(media, clamped);
  let seekable = true;
  if (media?.seekable?.length) {
    seekable = false;
    for (let i = 0; i < media.seekable.length; i++) {
      if (media.seekable.start(i) <= clamped + 0.5 && media.seekable.end(i) >= clamped - 0.5) {
        seekable = true;
        break;
      }
    }
  }
  return {
    targetSec: clamped,
    inBuffer,
    seekable,
    aheadAfterSeekSec: inBuffer ? Math.max(0, bufferedAheadAt(media, clamped)) : 0,
  };
}

function bufferedAheadAt(media, sec) {
  if (!media?.buffered) return 0;
  for (let i = 0; i < media.buffered.length; i++) {
    if (media.buffered.start(i) <= sec + 0.1 && media.buffered.end(i) > sec) return media.buffered.end(i) - sec;
  }
  return 0;
}

export function selectTransport(source, { probe = null } = {}) {
  if (!source) return { mode: 'none', native: true };
  if (source.kind === 'youtube-embed') return { mode: 'youtube-embed', native: false };
  const url = String(source.url || '');
  const mime = String(source.mime || '');
  if (url.startsWith('blob:') || url.startsWith('data:')) return { mode: 'cached-blob', native: true };
  if (/\.m3u8(\?|$)/i.test(url) || /mpegurl/i.test(mime)) {
    const nativeHls = !!probe?.canPlayType?.('application/vnd.apple.mpegurl');
    return { mode: nativeHls ? 'native-hls' : 'hls-unsupported', native: nativeHls };
  }
  return { mode: 'progressive-http', native: true, rangeSupported: true };
}

export function classifyFailure({
  mediaError = null,
  userPaused = false,
  hidden = false,
  url = '',
  online = true,
  readyState = 0,
  httpStatus = 0,
} = {}) {
  if (userPaused) {
    return { category: FAILURE_CATEGORY.USER_PAUSED, recoverable: true, preservePosition: true, retryMode: 'resume' };
  }
  if ((url && isUrlExpired(url)) || httpStatus === 403 || httpStatus === 410) {
    return { category: FAILURE_CATEGORY.URL_EXPIRED, recoverable: true, preservePosition: true, retryMode: 'refresh-url' };
  }
  const code = mediaError?.code || 0;
  if (code === 4) {
    return { category: FAILURE_CATEGORY.UNSUPPORTED_CODEC, recoverable: true, preservePosition: true, retryMode: 'switch-source' };
  }
  if (code === 3) {
    return { category: FAILURE_CATEGORY.DECODER_ERROR, recoverable: true, preservePosition: true, retryMode: 'switch-source' };
  }
  if (hidden && !mediaError && readyState >= 2) {
    return { category: FAILURE_CATEGORY.BROWSER_SUSPENDED, recoverable: true, preservePosition: true, retryMode: 'resume' };
  }
  if (code === 2 || !online || readyState <= 2) {
    return { category: FAILURE_CATEGORY.NETWORK_STARVATION, recoverable: true, preservePosition: true, retryMode: 'switch-source' };
  }
  return { category: FAILURE_CATEGORY.MEDIA_ERROR, recoverable: true, preservePosition: true, retryMode: 'switch-source' };
}

export class AdaptiveBufferEngine {
  constructor() {
    this.rttEwmaMs = 120;
    this.throughputBps = 0;
    this.recentStalls = [];
    this.recentFailures = [];
    this._lastSample = null;
  }

  recordLatency(ms) {
    if (!Number.isFinite(ms) || ms <= 0) return;
    this.rttEwmaMs = this.rttEwmaMs * 0.7 + Math.min(10_000, ms) * 0.3;
  }

  recordBytes(bytes, durationMs) {
    if (!Number.isFinite(bytes) || bytes <= 0 || !Number.isFinite(durationMs) || durationMs <= 0) return;
    const bps = (bytes * 8 * 1000) / durationMs;
    this.throughputBps = this.throughputBps ? this.throughputBps * 0.65 + bps * 0.35 : bps;
  }

  recordBufferProgress(media, bitrate = 128_000, now = Date.now()) {
    if (!media || media.paused) { this._lastSample = null; return; }
    const ahead = bufferedAhead(media);
    if (this._lastSample && this._lastSample.src === media.src && now > this._lastSample.at) {
      const wallSec = (now - this._lastSample.at) / 1000;
      const playDelta = Math.max(0, (media.currentTime || 0) - this._lastSample.time);
      const bufferDelta = ahead - this._lastSample.ahead + playDelta;
      if (bufferDelta > 0.25 && wallSec >= 0.4) {
        const estBps = (bufferDelta * (bitrate || 128_000)) / wallSec;
        this.throughputBps = this.throughputBps ? this.throughputBps * 0.7 + estBps * 0.3 : estBps;
      }
    }
    this._lastSample = { src: media.src, at: now, ahead, time: media.currentTime || 0 };
  }

  recordStall(now = Date.now()) {
    this.recentStalls.push(now);
    const cutoff = now - 5 * 60_000;
    this.recentStalls = this.recentStalls.filter(t => t >= cutoff);
  }

  recordFailure(now = Date.now()) {
    this.recentFailures.push(now);
    const cutoff = now - 3 * 60_000;
    this.recentFailures = this.recentFailures.filter(t => t >= cutoff);
  }

  profile(connection = globalThis.navigator?.connection, now = Date.now()) {
    const cutoff = now - 5 * 60_000;
    const stalls5m = this.recentStalls.filter(t => t >= cutoff).length;
    const failures3m = this.recentFailures.filter(t => t >= now - 3 * 60_000).length;
    const eff = connection?.effectiveType || '';
    const saveData = !!connection?.saveData;
    const downlinkMbps = Number(connection?.downlink) || 0;

    let condition = 'normal';
    if (saveData || /(^|-)2g$/.test(eff)) {
      condition = 'constrained';
    } else if (stalls5m >= 2 || failures3m >= 4 || this.rttEwmaMs >= 650 || (this.throughputBps > 0 && this.throughputBps < 200_000)) {
      condition = 'unstable';
    } else if ((this.rttEwmaMs < 160 && stalls5m === 0) || downlinkMbps >= 6 || (!connection && stalls5m === 0 && failures3m <= 1 && this.rttEwmaMs < 450)) {
      condition = 'fast';
    }

    if (condition === 'constrained') {
      return { condition, headroomSec: 12, preloadStageA: false, preloadStageB: false, maxPreloadAhead: 0, stallTimeoutMs: 6000 };
    }
    if (condition === 'unstable') {
      return { condition, headroomSec: 14, preloadStageA: true, preloadStageB: true, maxPreloadAhead: 1, stallTimeoutMs: 4800 };
    }
    if (condition === 'fast') {
      return { condition, headroomSec: 5, preloadStageA: true, preloadStageB: true, maxPreloadAhead: 2, stallTimeoutMs: 2600 };
    }
    return { condition, headroomSec: 7, preloadStageA: true, preloadStageB: true, maxPreloadAhead: 2, stallTimeoutMs: 3400 };
  }

  reset() {
    this.rttEwmaMs = 120;
    this.throughputBps = 0;
    this.recentStalls = [];
    this.recentFailures = [];
    this._lastSample = null;
  }
}

export const bufferEngine = new AdaptiveBufferEngine();
