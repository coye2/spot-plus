// Sound effects: speed, pitch, reverb, room size, bass, lo-fi and 8D, live on the device.
// Speed works on any song. The rest uses the Web Audio graph below.
import {corsOK, knownCors} from './cors-probe.js';
import * as dsp from './dsp.js';
import {buildGainCurve} from './automix.js';
export {knownCors};
const KEY = 'spotplus.fx';
export const DEFAULTS = {preset: 'off', speed: 1, keepPitch: true, pitch: 0, reverb: 0, room: 'hall', bass: 0, lofi: false, eightD: false, vocals: 0};
export const ROOMS = {
  room: {label: 'Room', seconds: 0.9, decay: 3.2, tone: 9000, predelay: 0.008},
  hall: {label: 'Hall', seconds: 2.6, decay: 2.6, tone: 6500, predelay: 0.02},
  cathedral: {label: 'Cathedral', seconds: 4.8, decay: 2.1, tone: 5200, predelay: 0.035},
  space: {label: 'Space', seconds: 8, decay: 1.6, tone: 3800, predelay: 0.06},
};
export const PRESETS = {
  off: {label: 'Off'},
  slowed: {label: 'Slowed + Reverb', speed: 0.82, keepPitch: false, reverb: 0.5, room: 'hall', bass: 2},
  sped: {label: 'Sped Up', speed: 1.25, keepPitch: false},
  nightcore: {label: 'Nightcore', speed: 1.3, keepPitch: false, bass: 3},
  daycore: {label: 'Daycore', speed: 0.75, keepPitch: false, reverb: 0.3, room: 'room'},
  eightD: {label: '8D Audio', eightD: true, reverb: 0.25, room: 'room'},
  concert: {label: 'Concert Hall', reverb: 0.45, room: 'cathedral'},
  space: {label: 'Outer Space', reverb: 0.75, room: 'space', pitch: -2, keepPitch: true},
  lofi: {label: 'Lo-fi', speed: 0.94, keepPitch: false, lofi: true, reverb: 0.2, room: 'room'},
  bass: {label: 'Bass Boost', bass: 9},
  chipmunk: {label: 'Chipmunk', pitch: 7, keepPitch: true},
  deep: {label: 'Deep Voice', pitch: -5, keepPitch: true},
  karaoke: {label: 'Sing-along', vocals: 0.9, reverb: 0.15, room: 'room'},
};

export function load(storage = globalThis.localStorage) {
  try { return {...DEFAULTS, ...JSON.parse(storage.getItem(KEY) || '{}')}; } catch { return {...DEFAULTS}; }
}
export const fromPreset = name => { const {label: _label, ...values} = PRESETS[name] || {}; return {...DEFAULTS, ...values, preset: name}; };
export const needsGraph = s => s.reverb > 0 || s.pitch !== 0 || s.bass !== 0 || s.lofi || s.eightD || s.vocals > 0;
export const isActive = s => needsGraph(s) || s.speed !== 1;

/** Stereo impulse response: decaying noise with a soft pre-delay. */
export function impulse(ctx, room) {
  const r = ROOMS[room] || ROOMS.hall, rate = ctx.sampleRate, length = Math.floor(rate * r.seconds), pre = Math.floor(rate * r.predelay);
  const buffer = ctx.createBuffer(2, length + pre, rate);
  const smooth = Math.exp(-2 * Math.PI * r.tone / rate), keep = 1 - smooth;
  // Exponential tail by repeated multiplication: same shape, a fraction of the work of pow() per sample.
  const step = Math.exp(-r.decay * 2.3 / length);
  let seed = 22222;
  const rand = () => ((seed = (seed * 1103515245 + 12345) >>> 0) / 2147483648) - 1;
  for (let c = 0; c < 2; c++) {
    const data = buffer.getChannelData(c);
    let last = 0, env = 2.2;
    for (let i = 0; i < length; i++) { last = rand() * env * keep + last * smooth; data[i + pre] = last; env *= step; }
    // Fade the last 5% so long rooms end without a click.
    const fade = Math.floor(length * 0.05);
    for (let i = 0; i < fade; i++) data[pre + length - 1 - i] *= i / fade;
  }
  return buffer;
}
const impulses = new Map();
function roomBuffer(room) {
  if (!impulses.has(room)) impulses.set(room, impulse(ctx, room));
  return impulses.get(room);
}

export const hasWebAudioSupport = !!(globalThis.AudioContext || globalThis.webkitAudioContext);

let settings = load(), ctx = null, nodes = null;
const sources = new WeakMap();
const channels = new WeakMap();
let current = null;
let analyserWanted = false;
const listeners = new Set();
export const onChange = fn => listeners.add(fn);
export const get = () => ({...settings});
export const needsAudioGraph = (s = settings) => needsGraph(s) || dsp.isDSPActive();
export const isAnyAudioActive = (s = settings) => isActive(s) || dsp.isDSPActive();
export const getAnalyser = () => nodes?.analyser || null;
const hasCors = (m) => m?.crossOrigin === 'anonymous' || m?.crossOrigin === 'use-credentials';
export function requestAnalyser(want) {
  const next = !!want;
  if (analyserWanted === next) return;
  analyserWanted = next;
  // Never force a disruptive mid-song reload just for a visualizer unless effects/DSP
  // are already active or the element is already CORS-enabled/captured.
  if (next && current && (sources.has(current) || hasCors(current) || needsAudioGraph(settings))) {
    route(current);
  }
}

const capturedSet = new Set();
let suspendTimer = 0;
let pitchLoading = false;
const isWirelessAirPlay = (media) => !!media?.webkitCurrentPlaybackTargetIsWireless;

function hasAnyPlayingCaptured() {
  for (const ref of capturedSet) {
    const m = ref.deref?.() ?? ref;
    if (!m) { capturedSet.delete(ref); continue; }
    if (!m.paused && !m.ended && m.src && !String(m.src).startsWith('data:')) return true;
  }
  return false;
}

/**
 * Hard-gate & suspend Web Audio whenever playback pauses or stops.
 * Eliminates the Android Chrome / WebKit MediaElementAudioSourceNode humming/buzzing drone
 * where a running AudioContext loops the last ~128/256-sample PCM frame on pause.
 */
export function syncPlaybackState(playing = null) {
  if (!ctx || !nodes?.masterGate) return;
  const active = playing === null ? hasAnyPlayingCaptured() : !!playing;
  const now = ctx.currentTime;
  if (active) {
    clearTimeout(suspendTimer);
    suspendTimer = 0;
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    try {
      nodes.masterGate.gain.cancelScheduledValues(now);
      nodes.masterGate.gain.setTargetAtTime(1, now, 0.008);
    } catch { /* ignore */ }
  } else {
    try {
      nodes.masterGate.gain.cancelScheduledValues(now);
      nodes.masterGate.gain.setTargetAtTime(0, now, 0.004);
    } catch { /* ignore */ }
    clearTimeout(suspendTimer);
    suspendTimer = setTimeout(() => {
      suspendTimer = 0;
      if (!ctx || hasAnyPlayingCaptured()) return;
      try { nodes?.pitch?.port?.postMessage?.('reset'); } catch { /* ignore */ }
      if (ctx.state === 'running') ctx.suspend().catch(() => {});
    }, 65);
    suspendTimer.unref?.();
  }
}

function ensurePitchWorklet() {
  if (!ctx || !nodes || nodes.pitch || pitchLoading || !ctx.audioWorklet) return;
  pitchLoading = true;
  ctx.audioWorklet.addModule(new URL('./pitch-worklet.js', import.meta.url)).then(() => {
    if (!ctx || !nodes) return;
    nodes.pitch = new AudioWorkletNode(ctx, 'spotplus-pitch', {outputChannelCount: [2]});
    nodes.input.disconnect();
    nodes.input.connect(nodes.pitch).connect(nodes.bass);
    nodes.input.connect(nodes.bypass);
    applyGraph();
  }).catch(() => {}).finally(() => { pitchLoading = false; });
}

function build() {
  ctx = new (globalThis.AudioContext || globalThis.webkitAudioContext)({latencyHint: 'playback'});
  const input = ctx.createGain(), bass = ctx.createBiquadFilter(), lofi = ctx.createBiquadFilter(), dry = ctx.createGain(), wet = ctx.createGain(), convA = ctx.createConvolver(), convB = ctx.createConvolver(), gainA = ctx.createGain(), gainB = ctx.createGain(), pan = ctx.createStereoPanner(), lfo = ctx.createOscillator(), depth = ctx.createGain(), out = ctx.createGain();
  const masterGate = ctx.createGain();
  masterGate.gain.value = 1;
  bass.type = 'lowshelf'; bass.frequency.value = 110;
  lofi.type = 'lowpass'; lofi.frequency.value = ctx.sampleRate / 2 - 100; lofi.Q.value = 0.707;
  lfo.frequency.value = 0.11; depth.gain.value = 0; lfo.connect(depth).connect(pan.pan); lfo.start();
  input.connect(bass).connect(lofi);
  // Vocal remover (mid/side): lead vocals sit in the middle of the stereo mix. Keep the sides and the
  // low end of the middle (bass, kick), and turn down the rest of the middle.
  const split = ctx.createChannelSplitter(2), merge = ctx.createChannelMerger(2), voxOut = ctx.createGain();
  const lToMid = ctx.createGain(), rToMid = ctx.createGain(), lToSide = ctx.createGain(), rToSide = ctx.createGain();
  lToMid.gain.value = 0.5; rToMid.gain.value = 0.5; lToSide.gain.value = 0.5; rToSide.gain.value = -0.5;
  const mid = ctx.createGain(), side = ctx.createGain(), sideInv = ctx.createGain(), midLow = ctx.createBiquadFilter(), midHigh = ctx.createBiquadFilter(), midHighGain = ctx.createGain(), midSum = ctx.createGain(), dryVox = ctx.createGain(), wetVox = ctx.createGain();
  sideInv.gain.value = -1; midLow.type = 'lowpass'; midLow.frequency.value = 180; midHigh.type = 'highpass'; midHigh.frequency.value = 180;
  lofi.connect(split);
  split.connect(lToMid, 0); split.connect(rToMid, 1); split.connect(lToSide, 0); split.connect(rToSide, 1);
  lToMid.connect(mid); rToMid.connect(mid); lToSide.connect(side); rToSide.connect(side);
  mid.connect(midLow).connect(midSum); mid.connect(midHigh).connect(midHighGain).connect(midSum);
  midSum.connect(merge, 0, 0); midSum.connect(merge, 0, 1); side.connect(merge, 0, 0); side.connect(sideInv).connect(merge, 0, 1);
  merge.connect(wetVox).connect(voxOut); lofi.connect(dryVox).connect(voxOut);
  wetVox.gain.value = 0; dryVox.gain.value = 1;
  gainB.gain.value = 0;
  voxOut.connect(dry).connect(pan); voxOut.connect(convA).connect(gainA).connect(wet); voxOut.connect(convB).connect(gainB).connect(wet); wet.connect(pan);
  const dspChain = dsp.buildDSPChain(ctx);
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 512;
  analyser.smoothingTimeConstant = 0.78;
  pan.connect(dspChain.input);
  dspChain.output.connect(out).connect(analyser).connect(masterGate).connect(ctx.destination);
  // With every effect & DSP off, sound skips processing completely (bit-for-bit the original) while still feeding the analyser tap.
  const bypass = ctx.createGain(); input.connect(bypass).connect(analyser); bypass.gain.value = 1; out.gain.value = 0;
  nodes = {bypass, input, bass, lofi, dryVox, wetVox, midHighGain, dry, wet, convs: [convA, convB], gains: [gainA, gainB], active: 0, pan, depth, out, dspChain, analyser, masterGate, room: null, pitch: null};
  // Only load pitch AudioWorklet when pitch shifting is actually requested (zero overhead & zero buffer-loop risk otherwise).
  if (Math.abs(settings.pitch) > 0.01) ensurePitchWorklet();
}

function ensureChannel(media) {
  if (!media) return null;
  if (channels.has(media)) return channels.get(media);
  const source = ctx.createMediaElementSource(media);
  // Lightweight per-element channel strip: high-pass filter (bypassed at 10 Hz unless DJ Blend sweeps bass) + gain.
  const eq = ctx.createBiquadFilter();
  eq.type = 'highpass';
  eq.frequency.value = 10;
  eq.Q.value = 0.707;
  const gain = ctx.createGain();
  gain.gain.value = 1;
  source.connect(eq).connect(gain).connect(nodes.input);
  sources.set(media, source);
  capturedSet.add(globalThis.WeakRef ? new WeakRef(media) : media);
  // Automatically gate & suspend AudioContext whenever captured media pauses/ends so no hum can ever play.
  const onStop = () => syncPlaybackState();
  const onGo = () => syncPlaybackState(true);
  media.addEventListener?.('play', onGo);
  media.addEventListener?.('playing', onGo);
  media.addEventListener?.('pause', onStop);
  media.addEventListener?.('ended', onStop);
  media.addEventListener?.('emptied', onStop);
  const ch = {source, eq, gain};
  channels.set(media, ch);
  syncPlaybackState();
  return ch;
}

function attach(media, reload) {
  if (!media || sources.has(media)) return channels.get(media) || null;
  if (isWirelessAirPlay(media)) return null;
  if (reload) {
    // Switching on mid-song: reload once at the same spot, now with cross-origin access.
    const at = media.currentTime, playing = !media.paused, src = media.src;
    media.crossOrigin = 'anonymous'; media.src = src;
    const seek = () => { try { media.currentTime = at; } catch { /* not seekable yet */ } };
    media.addEventListener('loadedmetadata', seek, {once: true});
    if (playing) media.play().catch(() => {});
  }
  return ensureChannel(media);
}
export const isCaptured = media => sources.has(media);
let blocked = false;
export const isBlocked = () => blocked && (needsAudioGraph(settings) || analyserWanted);
function setBlocked(value) { if (blocked !== value) { blocked = value; listeners.forEach(fn => fn(get())); } }

/** Called by the player before a new song is loaded. Returns false if this element can't play it. */
export async function prepare(media, url) {
  const wantGraph = needsAudioGraph(settings) || analyserWanted;
  // Never force CORS or Web Audio capture during AirPlay wireless routing or background iOS playback.
  if (isWirelessAirPlay(media)) { media.removeAttribute('crossorigin'); return !sources.has(media); }
  if (inBackground() && !sources.has(media)) { media.removeAttribute('crossorigin'); return true; }
  const ok = await corsOK(url);
  if (sources.has(media)) { setBlocked(!ok); return ok; }
  if (ok && wantGraph) media.crossOrigin = 'anonymous'; else media.removeAttribute('crossorigin');
  setBlocked(!ok && wantGraph);
  return true;
}

function applyGraph() {
  if (!nodes) return;
  const t = ctx.currentTime, s = settings, ramp = (param, value) => param.setTargetAtTime(value, t, 0.03);
  ramp(nodes.bass.gain, s.bass);
  ramp(nodes.lofi.frequency, s.lofi ? 3200 : ctx.sampleRate / 2 - 100);
  const neutral = !needsAudioGraph(s); ramp(nodes.bypass.gain, neutral ? 1 : 0); ramp(nodes.out.gain, neutral ? 0 : 1);
  dsp.applyDSPChain();
  ramp(nodes.wet.gain, s.reverb * 1.1);
  ramp(nodes.dry.gain, 1 - s.reverb * 0.45);
  ramp(nodes.depth.gain, s.eightD ? 0.95 : 0);
  // Sing-along: blend from the original to the vocal-reduced mix.
  const v = Math.max(0, Math.min(1, s.vocals || 0));
  ramp(nodes.dryVox.gain, v > 0 ? 0 : 1); ramp(nodes.wetVox.gain, v > 0 ? 1 : 0); ramp(nodes.midHighGain.gain, 1 - v);
  // Only generate the reverb impulse buffer when reverb is actually turned on (prevents main-thread stutters).
  if (s.reverb > 0 && nodes.room !== s.room) {
    if (nodes.room === null) { nodes.convs[0].buffer = roomBuffer(s.room); }
    else { // Load the new room into the idle reverb, then crossfade (no click, no gap).
      const next = 1 - nodes.active; nodes.convs[next].buffer = roomBuffer(s.room);
      nodes.gains[next].gain.setTargetAtTime(1, t, 0.06); nodes.gains[nodes.active].gain.setTargetAtTime(0, t, 0.06); nodes.active = next;
    }
    nodes.room = s.room;
  }
  if (Math.abs(s.pitch) > 0.01 && !nodes.pitch) ensurePitchWorklet();
  nodes.pitch?.parameters.get('ratio').setTargetAtTime(Math.pow(2, s.pitch / 12), t, 0.02);
}

let appliedRate = 0, appliedKeep = null, glide = 0;
function glideRate(media, target) {
  cancelAnimationFrame(glide);
  const from = media.playbackRate || 1, start = performance.now(), ms = Math.abs(target - from) > 0.05 ? 220 : 0;
  if (!ms || typeof requestAnimationFrame !== 'function') { media.playbackRate = target; return; }
  const tick = now => { const k = Math.min(1, (now - start) / ms), e = 1 - (1 - k) ** 3; media.playbackRate = from + (target - from) * e; if (k < 1) glide = requestAnimationFrame(tick); };
  glide = requestAnimationFrame(tick);
}
function applyRate(media) {
  if (!media) return;
  const rate = Math.max(0.5, Math.min(1.5, settings.speed));
  if (media.playbackRate !== rate || appliedRate !== rate) { media.defaultPlaybackRate = rate; glideRate(media, rate); appliedRate = rate; }
  if (appliedKeep !== settings.keepPitch || media.preservesPitch !== settings.keepPitch) { media.preservesPitch = settings.keepPitch; media.webkitPreservesPitch = settings.keepPitch; appliedKeep = settings.keepPitch; }
}

/** Point effects at the element that is playing now (the player swaps elements between songs). */
export function bind(media) {
  current = media; appliedRate = 0; appliedKeep = null;
  applyRate(media);
  route(media);
}
let probing = null;
// iPhone pauses Web Audio while the app is in the background, so nothing new is routed through effects then;
// speed and pitch still apply (they live on the element). Effects come back when the app is opened again.
const inBackground = () => !!globalThis.document?.hidden;
async function route(media, warm = false) {
  if (!media) return;
  if (isWirelessAirPlay(media)) return;
  const wantGraph = needsAudioGraph(settings) || analyserWanted;
  // Always sync gate/AudioContext state for an already-captured element so paused audio never hums.
  if (sources.has(media)) {
    syncPlaybackState();
    applyGraph();
    return;
  }
  if (!wantGraph && !warm) { if (nodes) applyGraph(); return; }
  if (inBackground()) return;
  if (!ctx) build();
  if (ctx.state !== 'running' && !media.paused) ctx.resume().catch(() => {});
  const src = media.currentSrc || media.src;
  if (!src || src.startsWith('data:')) return;
  if (hasCors(media)) { try { attach(media, false); } catch { /* already routed */ } applyGraph(); return; }
  if (warm && !wantGraph) { corsOK(src); return; } // Just learn; never restart a song only because the panel opened.
  if (probing === media) return;
  probing = media;
  const ok = await corsOK(src);
  probing = null;
  if (media !== current || isWirelessAirPlay(media)) return;
  setBlocked(!ok);
  if (ok) { try { attach(media, true); } catch { /* already routed */ } applyGraph(); }
}

/** True when both media elements can be crossfaded via hardware-timed Web Audio GainNodes (including iOS Safari). */
export function canWebAudioCrossfade(outgoing, incoming) {
  if (!hasWebAudioSupport || inBackground() || !outgoing || !incoming) return false;
  if (isWirelessAirPlay(outgoing) || isWirelessAirPlay(incoming)) return false;
  const readyForGraph = (m) => {
    const src = m.currentSrc || m.src || '';
    if (!src || src.startsWith('data:')) return false;
    return sources.has(m) || hasCors(m) || src.startsWith('blob:');
  };
  return readyForGraph(outgoing) && readyForGraph(incoming);
}

/**
 * Sample-accurate equal-power Web Audio crossfade (with optional DJ Blend bass-swap EQ).
 * Works on iPhone & iPad Safari where HTMLMediaElement.volume is read-only.
 */
export function crossfadeElements(outgoing, incoming, {seconds = 4, style = 'smart', curve = 'equal-power'} = {}) {
  if (!canWebAudioCrossfade(outgoing, incoming)) return null;
  if (!ctx) build();
  if (ctx.state !== 'running') ctx.resume().catch(() => {});
  const outCh = attach(outgoing, false);
  const inCh = attach(incoming, false);
  if (!outCh || !inCh) return null;
  applyGraph();

  const dur = Math.max(0.5, Math.min(12, Number(seconds) || 4));
  const now = ctx.currentTime;
  const outCurve = buildGainCurve('out', 64, 1, curve);
  const inCurve = buildGainCurve('in', 64, 1, curve);

  outCh.gain.gain.cancelScheduledValues(now);
  inCh.gain.gain.cancelScheduledValues(now);
  outCh.eq.frequency.cancelScheduledValues(now);
  inCh.eq.frequency.cancelScheduledValues(now);

  outCh.gain.gain.setValueAtTime(1, now);
  inCh.gain.gain.setValueAtTime(0.0001, now);
  outCh.gain.gain.setValueCurveAtTime(outCurve, now, dur);
  inCh.gain.gain.setValueCurveAtTime(inCurve, now, dur);

  // DJ Blend: smoothly high-pass outgoing low end while bringing in incoming bass cleanly.
  if (style === 'blend') {
    outCh.eq.frequency.setValueAtTime(20, now);
    outCh.eq.frequency.exponentialRampToValueAtTime(220, now + dur * 0.65);
    inCh.eq.frequency.setValueAtTime(160, now);
    inCh.eq.frequency.exponentialRampToValueAtTime(10, now + dur * 0.55);
  } else {
    outCh.eq.frequency.setValueAtTime(10, now);
    inCh.eq.frequency.setValueAtTime(10, now);
  }

  let finished = false;
  let timer = 0;
  let resolveDone = () => {};
  const resetChannels = () => {
    if (!ctx) return;
    const t = ctx.currentTime;
    try {
      outCh.gain.gain.cancelScheduledValues(t);
      outCh.gain.gain.setValueAtTime(1, t);
      outCh.eq.frequency.cancelScheduledValues(t);
      outCh.eq.frequency.setValueAtTime(10, t);
      inCh.gain.gain.cancelScheduledValues(t);
      inCh.gain.gain.setValueAtTime(1, t);
      inCh.eq.frequency.cancelScheduledValues(t);
      inCh.eq.frequency.setValueAtTime(10, t);
    } catch { /* ignore */ }
  };

  const done = new Promise((resolve) => {
    resolveDone = resolve;
    timer = setTimeout(() => {
      if (finished) return;
      finished = true;
      resetChannels();
      resolve();
    }, Math.round(dur * 1000) + 40);
    timer.unref?.();
  });

  return {
    done,
    cancel() {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      resetChannels();
      resolveDone();
    },
  };
}

let saveTimer = 0;
export function set(patch, storage = globalThis.localStorage) {
  settings = {...settings, ...patch};
  if (!('preset' in patch)) settings.preset = 'custom';
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => { try { storage.setItem(KEY, JSON.stringify(settings)); } catch { /* Private mode. */ } }, 300);
  if (current) { applyRate(current); route(current); }
  listeners.forEach(fn => fn(get()));
}
export const usePreset = name => set(fromPreset(name));
/** Back in the app after background play: never force a mid-song reload; attach silently only if already CORS-ready. */
export function restoreAfterBackground(media) {
  if (!media || isWirelessAirPlay(media)) return;
  if (sources.has(media)) { syncPlaybackState(); return; }
  if ((needsAudioGraph(settings) || analyserWanted) && hasCors(media)) {
    current = media;
    route(media);
  }
}
/** Called when the effects panel opens: builds the sound engine without waking paused audio. */
export function warmUp() {
  if (!ctx) build();
  syncPlaybackState();
  if (current) route(current, true);
}
export const resume = () => {
  if (!ctx) return;
  if (hasAnyPlayingCaptured()) syncPlaybackState(true);
};

// Keep Web Audio routing synchronized whenever EQ / AutoEq / DSP settings change live.
dsp.onDSPChange(() => {
  if (current) route(current);
  else if (nodes) applyGraph();
  listeners.forEach(fn => fn(get()));
});
