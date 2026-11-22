// automix.js — Spotify Premium-style Mix & DJ transition engine.
// Equal-power crossfade math, adaptive Smart Mix timing, DJ Blend bass-swap coordination,
// smooth 60fps element fades, and smart artist-spaced queue mixing.

export const MIX_MODES = Object.freeze({
  off: {
    id: 'off',
    label: 'Off',
    short: 'Off',
    desc: 'Play songs back to back with no overlap.',
  },
  smart: {
    id: 'smart',
    label: 'Smart Mix',
    short: 'Smart',
    desc: 'Adapts transition length to each song and blends smoothly with equal-power audio.',
  },
  blend: {
    id: 'blend',
    label: 'DJ Blend',
    short: 'DJ Blend',
    desc: 'Equal-power crossfade with a bass-swap EQ sweep so kick drums never clash.',
  },
  fade: {
    id: 'fade',
    label: 'Smooth Fade',
    short: 'Fade',
    desc: 'Classic equal-power crossfade at your exact chosen duration.',
  },
});

export const MIX_STYLE_IDS = Object.freeze(['smart', 'blend', 'fade']);
export const MIX_CURVES = Object.freeze([
  { id: 'equal-power', label: 'Equal Power', desc: 'Constant perceived loudness throughout the blend.' },
  { id: 'smooth-s', label: 'Smooth S-Curve', desc: 'Gentle ease-in and ease-out for calm phrasing.' },
  { id: 'linear', label: 'Linear', desc: 'Steady straight-line crossfade.' },
]);

export function normalizeMixSettings(settings = {}) {
  const rawSeconds = Math.max(0, Math.min(12, Math.round(Number(settings.automix) || 0)));
  const rawStyle = typeof settings.mixStyle === 'string' ? settings.mixStyle.toLowerCase() : 'smart';
  const style = MIX_STYLE_IDS.includes(rawStyle) ? rawStyle : 'smart';
  const rawCurve = typeof settings.mixCurve === 'string' ? settings.mixCurve.toLowerCase() : 'equal-power';
  const curve = MIX_CURVES.some((c) => c.id === rawCurve) ? rawCurve : 'equal-power';
  return {
    enabled: rawSeconds > 0,
    seconds: rawSeconds,
    style: rawSeconds > 0 ? style : 'off',
    preferredStyle: style,
    curve,
  };
}

/** Equal-power crossfade gains: out^2 + in^2 === 1 so volume never dips mid-transition. */
export function equalPowerGains(progress) {
  const p = Math.max(0, Math.min(1, Number(progress) || 0));
  const angle = p * (Math.PI / 2);
  return {
    outGain: Math.cos(angle),
    inGain: Math.sin(angle),
  };
}

/** Compute outgoing/incoming gain pair for the selected transition curve shape. */
export function curveGains(progress, curve = 'equal-power') {
  const p = Math.max(0, Math.min(1, Number(progress) || 0));
  if (curve === 'linear') return { outGain: 1 - p, inGain: p };
  if (curve === 'smooth-s') {
    const s = p * p * (3 - 2 * p);
    return equalPowerGains(s);
  }
  return equalPowerGains(p);
}

/** Generate a Float32Array gain curve for Web Audio setValueCurveAtTime. */
export function buildGainCurve(direction, steps = 64, targetVolume = 1, curveShape = 'equal-power') {
  const n = Math.max(4, Math.min(256, Math.round(steps) || 64));
  const curve = new Float32Array(n);
  const vol = Math.max(0, Math.min(1, Number(targetVolume) || 0));
  for (let i = 0; i < n; i++) {
    const p = i / (n - 1);
    const { outGain, inGain } = curveGains(p, curveShape);
    curve[i] = (direction === 'in' ? inGain : outGain) * vol;
  }
  return curve;
}

/** Compute the ideal overlap length in seconds for the current -> next transition. */
export function effectiveMixSeconds({
  seconds = 0,
  style = 'smart',
  currentDuration = 0,
  nextDuration = 0,
  spoken = false,
} = {}) {
  const base = Math.max(0, Math.min(12, Number(seconds) || 0));
  if (!base || style === 'off' || spoken) return 0;
  const curDur = Number.isFinite(currentDuration) && currentDuration > 0 ? currentDuration : 180;
  const nxtDur = Number.isFinite(nextDuration) && nextDuration > 0 ? nextDuration : 180;
  const shortest = Math.min(curDur, nxtDur);
  // Don't crossfade ultra-short skits, interludes, or clips under 20s.
  if (shortest < 20) return 0;
  const maxSafe = Math.max(1, Math.min(12, Math.floor(shortest * 0.25)));
  if (style === 'smart') {
    if (shortest < 55) return Math.min(base, 2, maxSafe);
    if (shortest < 120) return Math.min(base, 4, maxSafe);
    // Standard songs: smooth 4-8s DJ blend capped by the user's chosen duration.
    const adaptive = Math.max(3, Math.min(8, Math.round(shortest * 0.032)));
    return Math.max(2, Math.min(base, adaptive, maxSafe));
  }
  return Math.max(1, Math.min(base, maxSafe));
}

/**
 * Smartly reorder upcoming tracks for a Mix session:
 * keeps tracks up through currentIndex untouched, then interleaves upcoming songs so the
 * same artist never plays back-to-back (unless unavoidable) with gentle pacing flow.
 */
export function orderForMix(tracks, currentIndex = 0) {
  if (!Array.isArray(tracks) || tracks.length <= 2) return Array.isArray(tracks) ? tracks.slice() : [];
  const pivot = Math.max(0, Math.min(tracks.length - 1, Number(currentIndex) || 0));
  const head = tracks.slice(0, pivot + 1);
  const pool = tracks.slice(pivot + 1);
  if (pool.length <= 1) return tracks.slice();

  const artistKey = (t) => String(t?.artist || '').toLowerCase().split(/[,&]|feat\.|ft\./i)[0].trim() || String(t?.id || '');

  // Group remaining songs by primary artist, lightly shuffled within each artist bucket.
  const buckets = new Map();
  for (const track of pool) {
    const key = artistKey(track);
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(track);
  }
  for (const list of buckets.values()) {
    for (let i = list.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [list[i], list[j]] = [list[j], list[i]];
    }
  }

  const ordered = [];
  let lastArtist = artistKey(head[head.length - 1]);
  let lastDur = Number(head[head.length - 1]?.duration) || 200;

  while (ordered.length < pool.length) {
    // Prefer largest remaining artist buckets that don't repeat lastArtist; tie-break by smooth duration proximity.
    let bestKey = '';
    let bestScore = -Infinity;
    for (const [key, list] of buckets.entries()) {
      if (!list.length) continue;
      const candidate = list[0];
      const dur = Number(candidate?.duration) || 200;
      const durDiff = Math.abs(dur - lastDur);
      const samePenalty = key === lastArtist ? -1000 : 0;
      const spreadBonus = list.length * 4;
      const flowBonus = Math.max(0, 60 - durDiff) * 0.05;
      const jitter = Math.random() * 1.5;
      const score = samePenalty + spreadBonus + flowBonus + jitter;
      if (score > bestScore) {
        bestScore = score;
        bestKey = key;
      }
    }
    if (!bestKey) break;
    const picked = buckets.get(bestKey).shift();
    ordered.push(picked);
    lastArtist = bestKey;
    lastDur = Number(picked?.duration) || 200;
  }

  return [...head, ...ordered];
}

/**
 * Execute an equal-power crossfade between outgoing and incoming <audio> elements.
 * Uses hardware-timed Web Audio GainNodes (works on iPhone & iPad Safari!) when available,
 * and smooth 60fps requestAnimationFrame equal-power ramps otherwise.
 */
export function runCrossfade({
  outgoing,
  incoming,
  targetVolume = 1,
  seconds = 4,
  style = 'smart',
  curve = 'equal-power',
  elementVolumeSupported = true,
  webAudioFade = null,
  onCleanupOutgoing = () => {},
} = {}) {
  const dur = Math.max(0.5, Math.min(12, Number(seconds) || 0));
  const target = Math.max(0, Math.min(1, Number(targetVolume) || 1));
  let cancelled = false;
  let cleaned = false;

  const cleanupOut = () => {
    if (cleaned) return;
    cleaned = true;
    try { onCleanupOutgoing(outgoing); } catch { /* ignore */ }
  };

  // Path 1: Sample-accurate Web Audio GainNode (+ DJ bass-swap EQ) crossfade — works on iOS Safari too!
  if (typeof webAudioFade === 'function') {
    try {
      const handle = webAudioFade(outgoing, incoming, { seconds: dur, style, curve, targetVolume: target });
      if (handle?.done) {
        const done = handle.done.then(() => { cleanupOut(); }).catch(() => { cleanupOut(); });
        return {
          mode: 'webaudio',
          done,
          cancel() {
            if (cancelled) return;
            cancelled = true;
            try { handle.cancel?.(); } catch { /* ignore */ }
            cleanupOut();
          },
        };
      }
    } catch { /* fall through to element ramp */ }
  }

  // Path 2: Smooth 60fps HTMLMediaElement.volume crossfade (Desktop / Android).
  if (elementVolumeSupported && outgoing && incoming) {
    const outStart = Math.max(0, Math.min(1, Number(outgoing.volume ?? target)));
    try { incoming.volume = 0; } catch { /* ignore */ }
    let rafId = 0;
    let timerId = 0;
    const raf = typeof globalThis.requestAnimationFrame === 'function'
      ? (fn) => { rafId = globalThis.requestAnimationFrame(fn); }
      : (fn) => { timerId = setTimeout(() => fn(performance.now()), 16); timerId.unref?.(); };
    const cancelFrame = () => {
      if (rafId && typeof globalThis.cancelAnimationFrame === 'function') globalThis.cancelAnimationFrame(rafId);
      clearTimeout(timerId);
    };

    let finishResolve = () => {};
    const done = new Promise((resolve) => {
      finishResolve = resolve;
      const start = performance.now();
      const ms = dur * 1000;
      const tick = (now) => {
        if (cancelled) { resolve(); return; }
        const p = Math.min(1, Math.max(0, (now - start) / ms));
        const { outGain, inGain } = curveGains(p, curve);
        try { outgoing.volume = Math.max(0, Math.min(1, outStart * outGain)); } catch { /* ignore */ }
        try { incoming.volume = Math.max(0, Math.min(1, target * inGain)); } catch { /* ignore */ }
        if (p < 1) {
          raf(tick);
        } else {
          cleanupOut();
          resolve();
        }
      };
      raf(tick);
    });

    return {
      mode: 'element',
      done,
      cancel() {
        if (cancelled) return;
        cancelled = true;
        cancelFrame();
        try { incoming.volume = target; } catch { /* ignore */ }
        cleanupOut();
        finishResolve();
      },
    };
  }

  // Path 3: No volume control and no CORS Web Audio -> clean instant handoff.
  try { if (incoming) incoming.volume = target; } catch { /* ignore */ }
  cleanupOut();
  return {
    mode: 'instant',
    done: Promise.resolve(),
    cancel() { cancelled = true; cleanupOut(); },
  };
}
