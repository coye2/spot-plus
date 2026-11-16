// Sound effects: speed, pitch, reverb, room size, bass, lo-fi and 8D, live on the device.
// Speed works on any song. The rest uses the Web Audio graph below.
const KEY = 'spotplus.fx';
export const DEFAULTS = {preset: 'off', speed: 1, keepPitch: true, pitch: 0, reverb: 0, room: 'hall', bass: 0, lofi: false, eightD: false};
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
};

export function load(storage = globalThis.localStorage) {
  try { return {...DEFAULTS, ...JSON.parse(storage.getItem(KEY) || '{}')}; } catch { return {...DEFAULTS}; }
}
export const fromPreset = name => { const {label: _label, ...values} = PRESETS[name] || {}; return {...DEFAULTS, ...values, preset: name}; };
export const needsGraph = s => s.reverb > 0 || s.pitch !== 0 || s.bass !== 0 || s.lofi || s.eightD;
export const isActive = s => needsGraph(s) || s.speed !== 1;

/** Stereo impulse response: decaying noise with a soft pre-delay. */
export function impulse(ctx, room) {
  const r = ROOMS[room] || ROOMS.hall, rate = ctx.sampleRate, length = Math.floor(rate * r.seconds), pre = Math.floor(rate * r.predelay);
  const buffer = ctx.createBuffer(2, length + pre, rate);
  for (let c = 0; c < 2; c++) {
    const data = buffer.getChannelData(c);
    let last = 0; const smooth = Math.exp(-2 * Math.PI * r.tone / rate);
    for (let i = 0; i < length; i++) {
      const noise = (Math.random() * 2 - 1) * Math.pow(1 - i / length, r.decay);
      last = noise * (1 - smooth) + last * smooth; // darker tail for bigger rooms
      data[i + pre] = last * 2.2;
    }
  }
  return buffer;
}

let settings = load(), ctx = null, nodes = null, workletReady = null;
const sources = new WeakMap();
let current = null;
const listeners = new Set();
export const onChange = fn => listeners.add(fn);
export const get = () => ({...settings});

function build() {
  ctx = new (globalThis.AudioContext || globalThis.webkitAudioContext)({latencyHint: 'playback'});
  const input = ctx.createGain(), bass = ctx.createBiquadFilter(), lofi = ctx.createBiquadFilter(), dry = ctx.createGain(), wet = ctx.createGain(), convolver = ctx.createConvolver(), pan = ctx.createStereoPanner(), lfo = ctx.createOscillator(), depth = ctx.createGain(), out = ctx.createGain();
  bass.type = 'lowshelf'; bass.frequency.value = 110;
  lofi.type = 'lowpass'; lofi.frequency.value = 20000; lofi.Q.value = 0.4;
  lfo.frequency.value = 0.11; depth.gain.value = 0; lfo.connect(depth).connect(pan.pan); lfo.start();
  input.connect(bass).connect(lofi);
  lofi.connect(dry).connect(pan); lofi.connect(convolver).connect(wet).connect(pan);
  pan.connect(out).connect(ctx.destination);
  nodes = {input, bass, lofi, dry, wet, convolver, pan, depth, out, room: null, pitch: null};
  workletReady = ctx.audioWorklet?.addModule(new URL('./pitch-worklet.js', import.meta.url)).then(() => {
    nodes.pitch = new AudioWorkletNode(ctx, 'spotplus-pitch', {outputChannelCount: [2]});
    input.disconnect(); input.connect(nodes.pitch).connect(bass);
    applyGraph();
  }).catch(() => {});
}

function attach(media) {
  if (!media || sources.has(media)) return;
  if (!media.crossOrigin) {
    // Web Audio needs CORS. Reload once at the same spot so the sound isn't muted.
    const at = media.currentTime, playing = !media.paused, src = media.src;
    media.crossOrigin = 'anonymous';
    if (src && !src.startsWith('blob:') && !src.startsWith('data:')) { media.src = src; media.currentTime = at; if (playing) media.play().catch(() => {}); }
  }
  const source = ctx.createMediaElementSource(media);
  source.connect(nodes.input);
  sources.set(media, source);
}

function applyGraph() {
  if (!nodes) return;
  const t = ctx.currentTime, s = settings, ramp = (param, value) => param.setTargetAtTime(value, t, 0.05);
  ramp(nodes.bass.gain, s.bass);
  ramp(nodes.lofi.frequency, s.lofi ? 3200 : 20000);
  ramp(nodes.wet.gain, s.reverb * 1.1);
  ramp(nodes.dry.gain, 1 - s.reverb * 0.45);
  ramp(nodes.depth.gain, s.eightD ? 0.95 : 0);
  if (nodes.room !== s.room) { nodes.convolver.buffer = impulse(ctx, s.room); nodes.room = s.room; }
  nodes.pitch?.parameters.get('ratio').setValueAtTime(Math.pow(2, s.pitch / 12), t);
}

function applyRate(media) {
  if (!media) return;
  const rate = Math.max(0.5, Math.min(1.5, settings.speed));
  media.defaultPlaybackRate = rate; media.playbackRate = rate;
  media.preservesPitch = settings.keepPitch; media.webkitPreservesPitch = settings.keepPitch;
}

/** Point effects at the element that is playing now (the player swaps elements between songs). */
let others = [];
export function bind(media, spares = []) {
  current = media; others = spares;
  applyRate(media);
  if (needsGraph(settings) || sources.size) ensureGraph(media);
}
function ensureGraph(media) {
  if (!ctx) build();
  for (const el of [media, ...others]) { try { attach(el); } catch { /* Already connected or blocked; plain playback continues. */ } }
  applyGraph();
  if (ctx.state !== 'running') ctx.resume().catch(() => {});
}

export function set(patch, storage = globalThis.localStorage) {
  settings = {...settings, ...patch};
  if (!('preset' in patch)) settings.preset = 'custom';
  try { storage.setItem(KEY, JSON.stringify(settings)); } catch { /* Private mode. */ }
  if (current) { applyRate(current); if (needsGraph(settings) || ctx) ensureGraph(current); }
  listeners.forEach(fn => fn(get()));
}
export const usePreset = name => set(fromPreset(name));
export const resume = () => { if (ctx && ctx.state !== 'running') ctx.resume().catch(() => {}); };
