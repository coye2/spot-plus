// Sound effects: speed, pitch, reverb, room size, bass, lo-fi and 8D, live on the device.
// Speed works on any song. The rest uses the Web Audio graph below.
import {corsOK, knownCors} from './cors-probe.js';
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
/** Build every room in idle moments so switching rooms never stalls. */
function prewarmRooms() {
  const queue = Object.keys(ROOMS).filter(room => !impulses.has(room));
  const next = () => { const room = queue.shift(); if (!room || !ctx) return; roomBuffer(room); (globalThis.requestIdleCallback || setTimeout)(next, {timeout: 400}); };
  (globalThis.requestIdleCallback || setTimeout)(next, {timeout: 400});
}

let settings = load(), ctx = null, nodes = null;
const sources = new WeakMap();
let current = null;
const listeners = new Set();
export const onChange = fn => listeners.add(fn);
export const get = () => ({...settings});

function build() {
  ctx = new (globalThis.AudioContext || globalThis.webkitAudioContext)({latencyHint: 'playback'});
  const input = ctx.createGain(), bass = ctx.createBiquadFilter(), lofi = ctx.createBiquadFilter(), dry = ctx.createGain(), wet = ctx.createGain(), convA = ctx.createConvolver(), convB = ctx.createConvolver(), gainA = ctx.createGain(), gainB = ctx.createGain(), pan = ctx.createStereoPanner(), lfo = ctx.createOscillator(), depth = ctx.createGain(), out = ctx.createGain();
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
  pan.connect(out).connect(ctx.destination);
  // With every effect off, sound skips the effects completely (bit-for-bit the original).
  const bypass = ctx.createGain(); input.connect(bypass).connect(ctx.destination); bypass.gain.value = 0;
  nodes = {bypass, input, bass, lofi, dryVox, wetVox, midHighGain, dry, wet, convs: [convA, convB], gains: [gainA, gainB], active: 0, pan, depth, out, room: null, pitch: null};
  prewarmRooms();
  ctx.audioWorklet?.addModule(new URL('./pitch-worklet.js', import.meta.url)).then(() => {
    nodes.pitch = new AudioWorkletNode(ctx, 'spotplus-pitch', {outputChannelCount: [2]});
    input.disconnect(); input.connect(nodes.pitch).connect(bass);
    applyGraph();
  }).catch(() => {});
}

function attach(media, reload) {
  if (!media || sources.has(media)) return;
  if (reload) {
    // Switching on mid-song: reload once at the same spot, now with cross-origin access.
    const at = media.currentTime, playing = !media.paused, src = media.src;
    media.crossOrigin = 'anonymous'; media.src = src;
    const seek = () => { try { media.currentTime = at; } catch { /* not seekable yet */ } };
    media.addEventListener('loadedmetadata', seek, {once: true});
    if (playing) media.play().catch(() => {});
  }
  const source = ctx.createMediaElementSource(media);
  source.connect(nodes.input);
  sources.set(media, source);
}
export const isCaptured = media => sources.has(media);
let blocked = false;
export const isBlocked = () => blocked && needsGraph(settings);
function setBlocked(value) { if (blocked !== value) { blocked = value; listeners.forEach(fn => fn(get())); } }

/** Called by the player before a new song is loaded. Returns false if this element can't play it. */
export async function prepare(media, url) {
  const ok = await corsOK(url);
  if (sources.has(media)) { setBlocked(!ok); return ok; }
  if (ok && needsGraph(settings)) media.crossOrigin = 'anonymous'; else media.removeAttribute('crossorigin');
  setBlocked(!ok && needsGraph(settings));
  return true;
}

function applyGraph() {
  if (!nodes) return;
  const t = ctx.currentTime, s = settings, ramp = (param, value) => param.setTargetAtTime(value, t, 0.03);
  ramp(nodes.bass.gain, s.bass);
  ramp(nodes.lofi.frequency, s.lofi ? 3200 : ctx.sampleRate / 2 - 100);
  const neutral = !needsGraph(s); ramp(nodes.bypass.gain, neutral ? 1 : 0); ramp(nodes.out.gain, neutral ? 0 : 1);
  ramp(nodes.wet.gain, s.reverb * 1.1);
  ramp(nodes.dry.gain, 1 - s.reverb * 0.45);
  ramp(nodes.depth.gain, s.eightD ? 0.95 : 0);
  // Sing-along: blend from the original to the vocal-reduced mix.
  const v = Math.max(0, Math.min(1, s.vocals || 0));
  ramp(nodes.dryVox.gain, v > 0 ? 0 : 1); ramp(nodes.wetVox.gain, v > 0 ? 1 : 0); ramp(nodes.midHighGain.gain, 1 - v);
  if (nodes.room !== s.room) {
    if (nodes.room === null) { nodes.convs[0].buffer = roomBuffer(s.room); }
    else { // Load the new room into the idle reverb, then crossfade (no click, no gap).
      const next = 1 - nodes.active; nodes.convs[next].buffer = roomBuffer(s.room);
      nodes.gains[next].gain.setTargetAtTime(1, t, 0.06); nodes.gains[nodes.active].gain.setTargetAtTime(0, t, 0.06); nodes.active = next;
    }
    nodes.room = s.room;
  }
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
async function route(media, warm = false) {
  if (!media || (!needsGraph(settings) && !warm)) { if (nodes) applyGraph(); return; }
  if (!ctx) build();
  if (ctx.state !== 'running') ctx.resume().catch(() => {});
  if (sources.has(media)) { applyGraph(); return; }
  const src = media.currentSrc || media.src;
  if (!src || src.startsWith('data:')) return;
  if (media.crossOrigin === 'anonymous') { try { attach(media, false); } catch { /* already routed */ } applyGraph(); return; }
  if (warm && !needsGraph(settings)) { corsOK(src); return; } // Just learn; never restart a song only because the panel opened.
  if (probing === media) return;
  probing = media;
  const ok = await corsOK(src);
  probing = null;
  if (media !== current) return;
  setBlocked(!ok);
  if (ok) { try { attach(media, true); } catch { /* already routed */ } applyGraph(); }
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
/** Called when the effects panel opens: builds the sound engine and every reverb room ahead of time. */
export function warmUp() {
  if (!ctx) build();
  if (ctx.state !== 'running') ctx.resume().catch(() => {});
  if (current) route(current, true);
}
export const resume = () => { if (ctx && ctx.state !== 'running') ctx.resume().catch(() => {}); };
