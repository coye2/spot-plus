// Background work yields whenever the current song needs network data.
// InstantPlay: codec preference, adaptive warm thresholds, stall budgets, and seamless handoff windows.
export function bufferedAhead(media) {
  const time = media.currentTime || 0;
  for (let i = 0; i < (media.buffered?.length || 0); i++) {
    if (media.buffered.start(i) <= time + 0.1 && media.buffered.end(i) > time) return media.buffered.end(i) - time;
  }
  return 0;
}

export function audioHasHeadroom(media, seconds = 8) {
  if (media.paused || !media.src || media.src.startsWith('data:')) return false;
  if (media.src.startsWith('blob:')) return true;
  const ahead = bufferedAhead(media);
  if (ahead >= seconds || (ahead > 0.5 && Number.isFinite(media.duration) && media.duration - media.currentTime <= ahead + 0.25)) return true;
  // iPhone Safari sometimes omits buffered ranges while audio is already flowing;
  // only fall back to readyState when no buffered ranges are reported.
  return !(media.buffered?.length > 0) && (media.readyState || 0) >= 3 && (media.currentTime || 0) > 0.35;
}

export function loopQuality(connection) {
  if (connection?.saveData || /(^|-)2g$/.test(connection?.effectiveType || '')) return 360;
  if (connection?.effectiveType === '3g' || (connection?.downlink > 0 && connection.downlink < 2)) return 480;
  // Fullscreen portrait crops a 16:9 video, so fast connections get 1080p for sharpness.
  if (connection?.downlink > 0 && connection.downlink < 6) return 720;
  return 1080;
}

/** iPhone/iPad Safari play Opus unreliably; InstantPlay always uses AAC there. */
export function prefersAac(
  ua = globalThis.navigator?.userAgent || '',
  platform = globalThis.navigator?.platform || '',
  touches = globalThis.navigator?.maxTouchPoints || 0,
) {
  return /iPhone|iPad|iPod/i.test(ua) || (platform === 'MacIntel' && touches > 1);
}

/** Seconds of current-track buffer before attaching the next media element. */
export function mediaWarmHeadroom(connection = globalThis.navigator?.connection) {
  if (connection?.saveData || /(^|-)2g$/.test(connection?.effectiveType || '')) return 16;
  if (connection?.effectiveType === '3g' || (connection?.downlink > 0 && connection.downlink < 1.5)) return 10;
  return 3;
}

/** Keep a prepared next track across short pauses so skip/next stays instant. */
export const KEEP_WARM_AFTER_PAUSE_MS = 90_000;

/** How long a stream may sit without audio before Spot+ tries another link.
 *  The first samples on iPhone often take several seconds. Switching sooner
 *  restarts the song (the glitch) and burns backup links that were still connecting. */
export function stallBudget(currentTime = 0) {
  return (Number(currentTime) || 0) > 0.35 ? 4500 : 7000;
}

/** Near the end, hand off a ready next element without waiting for 'ended' (iOS has no volume crossfade). */
export function seamlessHandoffWindow(media, length = media?.duration) {
  if (!media || media.paused || !Number.isFinite(length) || length <= 0) return false;
  const left = length - media.currentTime;
  return left > 0.04 && left <= 0.35;
}

/**
 * Network-aware timeout budgets (ms) scaled by effective connection type, RTT, and Save-Data.
 * Prevents premature aborts on slow cellular while keeping fast Wi-Fi snappy.
 */
export function networkTimeoutMs(kind = 'resolve', connection = globalThis.navigator?.connection) {
  const base = {
    match: 3500,
    head: 9500,
    resolve: 12000,
    metadata: 8000,
    backup: 6000,
  }[kind] || 8000;

  if (!connection) return base;
  const eff = String(connection.effectiveType || '').toLowerCase();
  const rtt = Number(connection.rtt) || 0;
  const downlink = Number(connection.downlink) || 0;

  let factor = 1;
  if (eff === 'slow-2g' || eff === '2g') factor = 1.65;
  else if (eff === '3g' || (downlink > 0 && downlink < 1.5)) factor = 1.35;
  else if (rtt >= 400) factor = 1.3;
  else if (rtt >= 200) factor = 1.15;
  if (connection.saveData) factor = Math.max(factor, 1.25);

  const scaled = Math.round(base * factor);
  const maxByKind = { match: 7000, head: 16000, resolve: 22000, metadata: 15000, backup: 11000 }[kind] || 18000;
  return Math.max(base, Math.min(maxByKind, scaled));
}

/**
 * Capability- and condition-driven next-track preloading policy.
 * Balances instant transitions against cellular data, memory, skip storms, and Worker load.
 */
export function shouldPreloadNext({
  remainingSec = Infinity,
  durationSec = 180,
  bufferedSec = 0,
  connection = globalThis.navigator?.connection,
  relayLatencyMs = 400,
  isRapidSkipping = false,
  deviceMemoryGb = globalThis.navigator?.deviceMemory || 4,
  queueStable = true,
  pressureLevel = 'normal',
  preloadSetting = true,
} = {}) {
  if (preloadSetting === false) {
    return { stageA: false, stageB: false, delayMs: 0, reason: 'disabled-by-setting' };
  }
  if (pressureLevel === 'critical') {
    return { stageA: false, stageB: false, delayMs: 0, reason: 'infra-critical' };
  }
  const eff = String(connection?.effectiveType || '').toLowerCase();
  if (connection?.saveData || eff === 'slow-2g' || eff === '2g') {
    return { stageA: false, stageB: false, delayMs: 0, reason: 'constrained-network' };
  }
  if (!queueStable) {
    return { stageA: false, stageB: false, delayMs: 800, reason: 'queue-unstable' };
  }

  const lowMem = Number.isFinite(deviceMemoryGb) && deviceMemoryGb > 0 && deviceMemoryGb <= 1;
  const slowNet = eff === '3g' || (Number(connection?.downlink) > 0 && Number(connection.downlink) < 1.5);
  const highLatency = Number(relayLatencyMs) > 1800;

  // Dynamic Stage B window: start buffering Player B later on constrained/elevated conditions,
  // or earlier when relay latency is higher so transitions stay seamless without wasting data.
  const leadSec = Math.max(18, Math.min(48, Math.round(22 + (Math.min(4000, Number(relayLatencyMs) || 400) / 250))));
  const minHeadroom = slowNet ? 10 : 3;

  if (isRapidSkipping) {
    return { stageA: true, stageB: false, delayMs: 950, reason: 'rapid-skip-defer-stage-b' };
  }
  if (pressureLevel === 'elevated') {
    // Under elevated Worker load, only warm when near the end of the track (last 25s) and skip speculative Stage B.
    const nearEnd = !Number.isFinite(remainingSec) || remainingSec <= 25 || durationSec <= 35;
    return {
      stageA: nearEnd,
      stageB: false,
      delayMs: nearEnd ? 400 : 1200,
      reason: nearEnd ? 'elevated-near-end' : 'elevated-wait-near-end',
    };
  }

  const allowStageB = !lowMem && !slowNet && (bufferedSec >= minHeadroom || remainingSec <= leadSec);
  const delayMs = highLatency ? 150 : 240;
  return {
    stageA: true,
    stageB: allowStageB,
    delayMs,
    reason: lowMem ? 'low-memory-stage-a-only' : slowNet ? 'slow-net-stage-a-only' : 'ready',
  };
}

/**
 * Capability-driven crossfade guard.
 * On iOS backgrounded PWAs or wireless AirPlay routes, uninterrupted native playback strictly outranks
 * dual-element crossfade because iOS suspends Web Audio / secondary audio pipelines in those contexts.
 */
export function canSafelyCrossfade({
  isIOS = false,
  documentHidden = false,
  wirelessActive = false,
  effectsActive = false,
  mixSeconds = 0,
  elementVolumeSupported = false,
  canWebAudio = false,
} = {}) {
  if (!mixSeconds || mixSeconds <= 0) {
    return { allowed: false, mode: 'disabled', reason: 'mix-off' };
  }
  if (documentHidden) {
    return { allowed: false, mode: 'disabled', reason: isIOS ? 'ios-background-protection' : 'document-hidden' };
  }
  if (wirelessActive) {
    return { allowed: false, mode: 'disabled', reason: 'wireless-airplay-protection' };
  }
  if (canWebAudio) {
    return { allowed: true, mode: 'webaudio', reason: 'webaudio-equal-power' };
  }
  if (elementVolumeSupported && !effectsActive && !isIOS) {
    return { allowed: true, mode: 'element', reason: 'element-volume-ramp' };
  }
  return { allowed: false, mode: 'disabled', reason: isIOS ? 'ios-requires-webaudio' : 'no-volume-control' };
}

