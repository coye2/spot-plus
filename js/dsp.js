// dsp.js — Advanced Audio DSP & Parametric Equalizer Engine.
// Modular Web Audio processing stage that plugs cleanly into fx.js.
// Zero latency/overhead when disabled; real-time parameter updates without restarting playback.

import { findProfile } from './autoeq.js';

const STORAGE_KEY = 'spotplus.dsp';
const PRESETS_KEY = 'spotplus.dsp.presets';

export const EQ_FREQUENCIES = Object.freeze([32, 64, 125, 250, 500, 1000, 2000, 4000, 8000, 16000]);

export function defaultBands() {
  return EQ_FREQUENCIES.map((freq, idx) => ({
    type: idx === 0 ? 'lowshelf' : idx === EQ_FREQUENCIES.length - 1 ? 'highshelf' : 'peaking',
    freq,
    gain: 0,
    q: idx === 0 || idx === EQ_FREQUENCIES.length - 1 ? 0.71 : 1.41,
  }));
}

export const EQ_PRESETS = Object.freeze({
  flat: { label: 'Flat', gains: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0] },
  bass: { label: 'Deep Bass', gains: [6, 5, 3, 1, 0, 0, 0, 0.5, 1, 1] },
  vocal: { label: 'Vocal Clarity', gains: [-1.5, -1, 0, 1, 2.5, 3.5, 3, 2, 0.5, 0] },
  electronic: { label: 'Electronic', gains: [4.5, 3.5, 1, -1, -1.5, 0.5, 2, 3, 4, 3.5] },
  hiphop: { label: 'Hip-Hop', gains: [5, 4.5, 2.5, 1, -1, -0.5, 1, 2, 2.5, 2] },
  rock: { label: 'Rock', gains: [3.5, 2.5, 1, -1, -1.5, 0.5, 2.5, 3.5, 3, 2] },
  acoustic: { label: 'Acoustic', gains: [2, 1.5, 1, 0.5, 1, 1.5, 2, 2.5, 2, 1.5] },
  jazz: { label: 'Jazz', gains: [2.5, 2, 1, 1.5, -1, -1, 0, 1.5, 2.5, 3] },
  classical: { label: 'Classical', gains: [3, 2, 1, 0, -0.5, -0.5, 0.5, 2, 3, 3.5] },
  lateNight: { label: 'Late Night', gains: [3.5, 2.5, 1, 0.5, 0, 0, 0.5, 1.5, 2, 1.5] },
  treble: { label: 'Air & Detail', gains: [0, 0, 0, 0, 0, 0.5, 1.5, 3, 4.5, 5] },
  loudness: { label: 'Loudness', gains: [4.5, 3, 0.5, -1, -1.5, -1, 0, 1.5, 3.5, 4] },
});

export const DSP_DEFAULTS = Object.freeze({
  enabled: false,
  eqEnabled: false,
  eqPreset: 'flat',
  bands: defaultBands(),
  autoEqEnabled: false,
  autoEqId: '',
  preampDb: 0,
  loudnessNorm: false,
  compressorEnabled: false,
  compressorThreshold: -18, // dB
  compressorRatio: 4,       // 1..20
  limiterEnabled: true,     // Safety limiter when DSP is active
  bassEnhanceDb: 0,         // 0..10 dB sub-bass warmth
  stereoWidth: 100,         // 0 (mono) .. 100 (normal) .. 180 (wide)
  crossfeedEnabled: false,
  crossfeedLevel: 35,       // 0..100%
  balance: 0,               // -1 (L) .. 0 .. +1 (R)
});

const clamp = (v, lo, hi, fallback) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : fallback;
};

export function normalizeBands(bands) {
  const base = defaultBands();
  if (!Array.isArray(bands) || !bands.length) return base;
  return base.map((def, i) => {
    const b = bands[i] || def;
    return {
      type: ['lowshelf', 'peaking', 'highshelf'].includes(b.type) ? b.type : def.type,
      freq: clamp(b.freq, 20, 20000, def.freq),
      gain: clamp(b.gain, -12, 12, 0),
      q: clamp(b.q, 0.25, 10, def.q),
    };
  });
}

export function normalizeDSP(raw = {}) {
  return {
    enabled: !!raw.enabled,
    eqEnabled: !!raw.eqEnabled,
    eqPreset: typeof raw.eqPreset === 'string' ? raw.eqPreset : 'flat',
    bands: normalizeBands(raw.bands),
    autoEqEnabled: !!raw.autoEqEnabled,
    autoEqId: typeof raw.autoEqId === 'string' ? raw.autoEqId : '',
    preampDb: clamp(raw.preampDb, -12, 6, 0),
    loudnessNorm: !!raw.loudnessNorm,
    compressorEnabled: !!raw.compressorEnabled,
    compressorThreshold: clamp(raw.compressorThreshold, -40, -4, -18),
    compressorRatio: clamp(raw.compressorRatio, 1.5, 16, 4),
    limiterEnabled: raw.limiterEnabled !== false,
    bassEnhanceDb: clamp(raw.bassEnhanceDb, 0, 10, 0),
    stereoWidth: clamp(raw.stereoWidth, 0, 180, 100),
    crossfeedEnabled: !!raw.crossfeedEnabled,
    crossfeedLevel: clamp(raw.crossfeedLevel, 0, 100, 35),
    balance: clamp(raw.balance, -1, 1, 0),
  };
}

export function isDSPActive(s = state) {
  if (!s?.enabled) return false;
  const hasEq = s.eqEnabled && s.bands.some((b) => Math.abs(b.gain) >= 0.05);
  const hasAutoEq = s.autoEqEnabled && !!s.autoEqId;
  return hasEq
    || hasAutoEq
    || Math.abs(s.preampDb) >= 0.05
    || s.loudnessNorm
    || s.compressorEnabled
    || s.bassEnhanceDb >= 0.1
    || Math.abs(s.stereoWidth - 100) >= 1
    || (s.crossfeedEnabled && s.crossfeedLevel > 0)
    || Math.abs(s.balance) >= 0.02;
}

export function loadDSP(storage = globalThis.localStorage) {
  try {
    return normalizeDSP(JSON.parse(storage?.getItem?.(STORAGE_KEY) || '{}'));
  } catch {
    return normalizeDSP(DSP_DEFAULTS);
  }
}

export function loadUserEQPresets(storage = globalThis.localStorage) {
  try {
    const arr = JSON.parse(storage?.getItem?.(PRESETS_KEY) || '[]');
    return Array.isArray(arr) ? arr.filter((p) => p && p.id && p.name && Array.isArray(p.bands)) : [];
  } catch {
    return [];
  }
}

export function saveUserEQPreset(name, bands, storage = globalThis.localStorage) {
  const cleanName = String(name || '').trim().slice(0, 48);
  if (!cleanName) throw new Error('Enter a preset name.');
  const list = loadUserEQPresets(storage).filter((p) => p.name.toLowerCase() !== cleanName.toLowerCase());
  const item = { id: 'eq-' + Date.now().toString(36), name: cleanName, bands: normalizeBands(bands) };
  list.unshift(item);
  try { storage?.setItem?.(PRESETS_KEY, JSON.stringify(list.slice(0, 30))); } catch { /* private mode */ }
  return item;
}

export function deleteUserEQPreset(id, storage = globalThis.localStorage) {
  const list = loadUserEQPresets(storage).filter((p) => p.id !== id);
  try { storage?.setItem?.(PRESETS_KEY, JSON.stringify(list)); } catch { /* private mode */ }
  return list;
}

/**
 * Compute frequency response curve (dB at each logarithmic frequency point)
 * for accurate real-time SVG curve visualization.
 */
export function computeEQCurve(bands = [], autoEqBands = [], points = 48) {
  const minLog = Math.log10(20);
  const maxLog = Math.log10(20000);
  const all = [...(bands || []), ...(autoEqBands || [])].filter((b) => Math.abs(Number(b?.gain) || 0) > 0.01);
  const out = [];
  for (let i = 0; i < points; i++) {
    const f = Math.pow(10, minLog + (i / (points - 1)) * (maxLog - minLog));
    let db = 0;
    for (const b of all) {
      const fc = Math.max(20, Number(b.freq) || 1000);
      const g = Number(b.gain) || 0;
      const q = Math.max(0.25, Number(b.q) || 1.4);
      if (b.type === 'lowshelf') {
        const ratio = f / fc;
        db += g / (1 + Math.pow(ratio, 2 * Math.max(0.5, q)));
      } else if (b.type === 'highshelf') {
        const ratio = fc / f;
        db += g / (1 + Math.pow(ratio, 2 * Math.max(0.5, q)));
      } else {
        const oct = Math.log2(f / fc);
        const bw = 1 / q;
        db += g * Math.exp(-0.5 * Math.pow(oct / (bw * 0.65), 2));
      }
    }
    out.push({ freq: f, db: Math.max(-18, Math.min(18, db)) });
  }
  return out;
}

const dbToGain = (db) => Math.pow(10, db / 20);

let state = loadDSP();
const listeners = new Set();
let saveTimer = 0;
let chain = null;

export const getDSP = () => normalizeDSP(state);
export const onDSPChange = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };

/**
 * Create the Web Audio DSP chain for a given AudioContext.
 * Signal path:
 *   input -> preamp -> bassEnhance -> 10-band Parametric EQ -> 8-band AutoEq bank
 *         -> Stereo Width (M/S) -> Crossfeed -> Balance -> Compressor -> Safety Limiter -> output
 */
export function buildDSPChain(ctx) {
  const input = ctx.createGain();
  const output = ctx.createGain();

  // 1. Preamp / AutoEq headroom compensation
  const preamp = ctx.createGain();
  preamp.gain.value = 1;

  // 2. Sub-bass warmth enhancer
  const bassEnhance = ctx.createBiquadFilter();
  bassEnhance.type = 'lowshelf';
  bassEnhance.frequency.value = 85;
  bassEnhance.gain.value = 0;

  // 3. 10-band Parametric Equalizer
  const eqFilters = EQ_FREQUENCIES.map((freq, idx) => {
    const f = ctx.createBiquadFilter();
    f.type = idx === 0 ? 'lowshelf' : idx === EQ_FREQUENCIES.length - 1 ? 'highshelf' : 'peaking';
    f.frequency.value = freq;
    f.Q.value = idx === 0 || idx === EQ_FREQUENCIES.length - 1 ? 0.71 : 1.41;
    f.gain.value = 0;
    return f;
  });

  // 4. 8-band AutoEq filter bank (handles up to 8 parametric headphone bands)
  const autoEqFilters = Array.from({ length: 8 }, () => {
    const f = ctx.createBiquadFilter();
    f.type = 'peaking';
    f.frequency.value = 1000;
    f.Q.value = 1.4;
    f.gain.value = 0;
    return f;
  });

  // Connect serial filter bank
  let tail = input;
  tail.connect(preamp);
  tail = preamp;
  tail.connect(bassEnhance);
  tail = bassEnhance;
  for (const f of eqFilters) { tail.connect(f); tail = f; }
  for (const f of autoEqFilters) { tail.connect(f); tail = f; }

  // 5. Stereo Width (Mid / Side matrix)
  const msSplit = ctx.createChannelSplitter(2);
  const msMerge = ctx.createChannelMerger(2);
  const lToM = ctx.createGain(), rToM = ctx.createGain();
  const lToS = ctx.createGain(), rToS = ctx.createGain();
  lToM.gain.value = 0.5; rToM.gain.value = 0.5;
  lToS.gain.value = 0.5; rToS.gain.value = -0.5;
  const midGain = ctx.createGain();
  const sideGain = ctx.createGain();
  const sideInv = ctx.createGain();
  midGain.gain.value = 1;
  sideGain.gain.value = 1;
  sideInv.gain.value = -1;

  tail.connect(msSplit);
  msSplit.connect(lToM, 0); msSplit.connect(rToM, 1);
  msSplit.connect(lToS, 0); msSplit.connect(rToS, 1);
  lToM.connect(midGain); rToM.connect(midGain);
  lToS.connect(sideGain); rToS.connect(sideGain);
  midGain.connect(msMerge, 0, 0);
  midGain.connect(msMerge, 0, 1);
  sideGain.connect(msMerge, 0, 0);
  sideGain.connect(sideInv).connect(msMerge, 0, 1);

  // 6. Headphone Crossfeed (subtle low-pass delayed L->R and R->L blend)
  const cfSplit = ctx.createChannelSplitter(2);
  const cfMerge = ctx.createChannelMerger(2);
  const cfDryL = ctx.createGain(), cfDryR = ctx.createGain();
  const cfCrossLtoR = ctx.createGain(), cfCrossRtoL = ctx.createGain();
  const cfDelayL = ctx.createDelay(0.01), cfDelayR = ctx.createDelay(0.01);
  const cfLpL = ctx.createBiquadFilter(), cfLpR = ctx.createBiquadFilter();
  cfDelayL.delayTime.value = 0.00028; // ~280us interaural time difference
  cfDelayR.delayTime.value = 0.00028;
  cfLpL.type = 'lowpass'; cfLpL.frequency.value = 700;
  cfLpR.type = 'lowpass'; cfLpR.frequency.value = 700;
  cfDryL.gain.value = 1; cfDryR.gain.value = 1;
  cfCrossLtoR.gain.value = 0; cfCrossRtoL.gain.value = 0;

  msMerge.connect(cfSplit);
  cfSplit.connect(cfDryL, 0).connect(cfMerge, 0, 0);
  cfSplit.connect(cfDryR, 1).connect(cfMerge, 0, 1);
  cfSplit.connect(cfLpL, 0).connect(cfDelayL).connect(cfCrossLtoR).connect(cfMerge, 0, 1);
  cfSplit.connect(cfLpR, 1).connect(cfDelayR).connect(cfCrossRtoL).connect(cfMerge, 0, 0);

  // 7. Channel Balance
  const balance = typeof ctx.createStereoPanner === 'function' ? ctx.createStereoPanner() : ctx.createGain();

  // 8. Dynamic Range Compressor
  const compressor = ctx.createDynamicsCompressor();
  compressor.threshold.value = 0;
  compressor.knee.value = 12;
  compressor.ratio.value = 1;
  compressor.attack.value = 0.008;
  compressor.release.value = 0.16;

  // 9. True-Peak Safety Limiter (prevents clipping when EQ/bass boost is active)
  const limiter = ctx.createDynamicsCompressor();
  limiter.threshold.value = -1.0;
  limiter.knee.value = 0;
  limiter.ratio.value = 20;
  limiter.attack.value = 0.001;
  limiter.release.value = 0.06;

  cfMerge.connect(balance).connect(compressor).connect(limiter).connect(output);

  chain = {
    ctx, input, output, preamp, bassEnhance, eqFilters, autoEqFilters,
    midGain, sideGain, cfDryL, cfDryR, cfCrossLtoR, cfCrossRtoL,
    balance, compressor, limiter,
  };
  applyDSPChain();
  return chain;
}

export function applyDSPChain(s = state) {
  if (!chain) return;
  const { ctx } = chain;
  const t = ctx.currentTime;
  const ramp = (param, val) => param?.setTargetAtTime?.(val, t, 0.025);
  const active = isDSPActive(s);

  // AutoEq profile lookup
  const autoProfile = active && s.autoEqEnabled && s.autoEqId ? findProfile(s.autoEqId) : null;
  const autoPreamp = autoProfile ? autoProfile.preamp : 0;

  // Prevent clipping: compute automatic headroom if total positive EQ gain is high
  let maxBoost = 0;
  if (active && s.eqEnabled) {
    for (const b of s.bands) maxBoost = Math.max(maxBoost, b.gain);
  }
  const normOffset = active && s.loudnessNorm ? -2.0 : 0;
  const safetyHeadroom = active && maxBoost > 3 ? -(maxBoost - 3) * 0.55 : 0;
  const totalPreampDb = active ? Math.max(-18, Math.min(6, s.preampDb + autoPreamp + normOffset + safetyHeadroom)) : 0;
  ramp(chain.preamp.gain, dbToGain(totalPreampDb));

  // Sub-bass enhancement
  ramp(chain.bassEnhance.gain, active ? s.bassEnhanceDb : 0);

  // 10-band Parametric EQ
  chain.eqFilters.forEach((f, idx) => {
    const b = s.bands[idx] || defaultBands()[idx];
    if (f.type !== b.type) f.type = b.type;
    ramp(f.frequency, b.freq);
    ramp(f.Q, b.q);
    ramp(f.gain, active && s.eqEnabled ? b.gain : 0);
  });

  // AutoEq parametric bank
  const aBands = autoProfile?.bands || [];
  chain.autoEqFilters.forEach((f, idx) => {
    const b = aBands[idx];
    if (b) {
      if (f.type !== b.type) f.type = b.type;
      ramp(f.frequency, b.freq);
      ramp(f.Q, b.q);
      ramp(f.gain, b.gain);
    } else {
      ramp(f.gain, 0);
    }
  });

  // Stereo Width (0..180% -> side multiplier 0..1.8)
  const widthFactor = active ? s.stereoWidth / 100 : 1;
  ramp(chain.midGain.gain, 1);
  ramp(chain.sideGain.gain, widthFactor);

  // Crossfeed
  const cf = active && s.crossfeedEnabled ? (s.crossfeedLevel / 100) * 0.34 : 0;
  ramp(chain.cfDryL.gain, 1 - cf * 0.35);
  ramp(chain.cfDryR.gain, 1 - cf * 0.35);
  ramp(chain.cfCrossLtoR.gain, cf);
  ramp(chain.cfCrossRtoL.gain, cf);

  // Balance
  if ('pan' in chain.balance) ramp(chain.balance.pan, active ? s.balance : 0);

  // Compressor (also gently engages when loudnessNorm is on)
  const compOn = active && (s.compressorEnabled || s.loudnessNorm);
  ramp(chain.compressor.threshold, compOn ? (s.compressorEnabled ? s.compressorThreshold : -20) : 0);
  ramp(chain.compressor.ratio, compOn ? (s.compressorEnabled ? s.compressorRatio : 2.5) : 1);

  // Safety Limiter
  const limOn = active && s.limiterEnabled;
  ramp(chain.limiter.threshold, limOn ? -0.8 : 0);
  ramp(chain.limiter.ratio, limOn ? 20 : 1);
}

export function setDSP(patch, storage = globalThis.localStorage) {
  const next = normalizeDSP({ ...state, ...patch });
  state = next;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try { storage?.setItem?.(STORAGE_KEY, JSON.stringify(state)); } catch { /* private mode */ }
  }, 220);
  applyDSPChain(state);
  listeners.forEach((fn) => { try { fn(getDSP()); } catch (e) { console.error(e); } });
  return getDSP();
}

export function applyEQPreset(presetId, storage = globalThis.localStorage) {
  const builtIn = EQ_PRESETS[presetId];
  if (builtIn) {
    const bands = defaultBands().map((b, i) => ({ ...b, gain: builtIn.gains[i] ?? 0 }));
    return setDSP({ enabled: true, eqEnabled: presetId !== 'flat', eqPreset: presetId, bands }, storage);
  }
  const user = loadUserEQPresets(storage).find((p) => p.id === presetId);
  if (user) {
    return setDSP({ enabled: true, eqEnabled: true, eqPreset: user.id, bands: user.bands }, storage);
  }
  return getDSP();
}

export function applyAutoEqProfile(profileId, storage = globalThis.localStorage) {
  if (!profileId) return setDSP({ autoEqEnabled: false, autoEqId: '' }, storage);
  const found = findProfile(profileId, storage);
  if (!found) return getDSP();
  return setDSP({ enabled: true, autoEqEnabled: true, autoEqId: found.id }, storage);
}

export function resetDSP(storage = globalThis.localStorage) {
  return setDSP({ ...DSP_DEFAULTS, bands: defaultBands() }, storage);
}
