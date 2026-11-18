// player.js — InstantPlay playback engine: state machine, generation control,
// dual-element predictive buffering, adaptive stall recovery, lock-screen controls, and offline downloads.
import * as api from './api.js';
import * as store from './store.js';
import { NextAudioBuffer } from './audio-buffer.js';
import {
  audioHasHeadroom,
  mediaWarmHeadroom,
  KEEP_WARM_AFTER_PAUSE_MS,
  seamlessHandoffWindow,
  stallBudget,
} from './playback-policy.js';
import { YouTubeEmbedPlayer } from './yt-embed.js';
import { telemetry } from './playback-telemetry.js';
import { bufferEngine, classifyFailure, inspectSeek } from './buffer-engine.js';
import { predictUpcoming, SkipTracker, ActivationTracker } from './predictive-pipeline.js';
import { router, isVerifiedEquivalent } from './source-router.js';
import { memoryEngine } from './memory-engine.js';

export const AUDIO_CACHE = 'spotplus-audio-v1';

export const STATES = Object.freeze({
  IDLE: 'IDLE',
  RESOLVING: 'RESOLVING',
  PREPARING: 'PREPARING',
  BUFFERING: 'BUFFERING',
  PLAYING: 'PLAYING',
  STALLED: 'STALLED',
  RECOVERING: 'RECOVERING',
  ENDED: 'ENDED',
  FAILED: 'FAILED',
});

let audio = new Audio();
audio.preload = 'auto';
audio.playsInline = true;
audio.setAttribute?.('playsinline', '');
export let el = audio;

const listeners = { state: new Set(), time: new Set(), error: new Set(), 'effects-skipped': new Set() };
export const on = (ev, fn) => listeners[ev].add(fn);
/** Every media element the player uses (current + preloaded next). */
export const mediaElements = () => [audio, nextBuffer.spare];
/* Effects hooks (set by fx.js): which elements are routed through effects, and whether effects are on. */
let effectsOn = () => false, isCaptured = () => false, prepareElement = async () => {}, corsKnown = () => undefined;
export function setEffectsHooks(hooks) { ({ effectsOn, isCaptured, prepareElement, corsKnown } = { effectsOn, isCaptured, prepareElement, corsKnown, ...hooks }); }
// A plain element held in reserve (unlocked on the first tap, never routed through effects) for songs whose
// server doesn't allow effects. A routed element would play them silently.
let plainSpare = null;
/* Smart Radio + learning hooks (set by the app). */
let continueQueue = null, onSkip = () => {}, onFinish = () => {}, resumeAt = () => 0;
export function setQueueHooks(hooks) { ({ continueQueue = continueQueue, onSkip = onSkip, onFinish = onFinish, resumeAt = resumeAt } = hooks); }
/* AutoMix: crossfade into the next song. Needs adjustable element volume (not on iPhone) and effects off. */
let mixSeconds = 0, mixing = false;
export const crossfadeSupported = (() => { try { const a = new Audio(); a.volume = 0.5; return a.volume === 0.5; } catch { return false; } })();
export function setAutoMix(seconds) { mixSeconds = crossfadeSupported ? Math.max(0, Math.min(12, Number(seconds) || 0)) : 0; }
const emit = (ev, d) => listeners[ev].forEach((fn) => { try { fn(d); } catch (e) { console.error(e); } });

export const state = {
  queue: [],
  index: -1,
  original: null,
  shuffle: false,
  repeat: 'off',
  loading: false,
  phase: STATES.IDLE,
  source: null,
  offline: false,
  needsTap: false,
  ytHidden: false,
};

function setPhase(phase) {
  state.phase = phase;
  state.loading = phase === STATES.RESOLVING || phase === STATES.PREPARING || phase === STATES.BUFFERING || phase === STATES.RECOVERING;
}

export const current = () => state.queue[state.index] || null;
export const isEmbed = () => state.source?.kind === 'youtube-embed' && yt.active;
export const isPlaying = () => (yt.active ? !yt.paused : (!audio.paused && isRealSrc())) && !!current();
export const duration = () => (yt.active ? (isFinite(yt.duration) && yt.duration > 0 ? yt.duration : current()?.duration || 0) : (isRealSrc() && isFinite(audio.duration) && audio.duration > 0 ? audio.duration : current()?.duration || 0));
export const position = () => (yt.active ? yt.currentTime : (audio.currentTime || 0));
export const isPaused = () => (yt.active ? yt.paused : audio.paused);
export const canSeek = () => !state.loading && !state.error && (yt.active ? yt.ready : isRealSrc());
export function pause() {
  userPaused = true;
  pendingPlay = false;
  if (state.loading) {
    cancelLoad?.abort();
    ++token;
    clearStall();
    setPhase(STATES.IDLE);
  }
  if (yt.active) yt.pause(); else audio.pause();
}
export function hideEmbed(hidden = true) { state.ytHidden = !!hidden; emit('state'); }
export const getMetrics = () => ({
  phase: state.phase,
  telemetry: telemetry.snapshot(),
  memory: memoryEngine.stats(),
  router: router.report(),
  buffer: bufferEngine.profile(),
});

let token = 0;
let errRetries = 0;
let startupSwaps = 0;
let failStreak = 0;
let skipList = [];
let objUrl = null;
let restorePos = 0;
let cancelLoad = null;
let pendingPlay = true;
let userPaused = false;
const nextBuffer = new NextAudioBuffer();
const skipTracker = new SkipTracker();
const activation = new ActivationTracker();
let unlockedPrimary = audio;
let prefetchTimer = 0, warmGeneration = 0, startedAt = 0, activeGen = 0, pauseClearTimer = 0;
let volumeLevel = 1;
let stallTimer = null;
let liveAttempt = 0;
let mediaTicket = 0;
let suppressError = false;
let previewUpgradeTimer = null, previewUpgradeControl = null, previewUpgradeTries = 0;

function clearStall() {
  clearTimeout(stallTimer);
  stallTimer = null;
  telemetry.endStall();
}

function failAttempt(ticket, mediaErr = null) {
  if (ticket !== liveAttempt) return;
  liveAttempt++;
  recoverMedia(mediaErr);
}

function assignSrc(url) {
  const ticket = ++liveAttempt;
  mediaTicket = ticket;
  // The media element can still fire an asynchronous error queued from its previous src.
  suppressError = true;
  audio.src = url;
  const release = () => { if (mediaTicket === ticket) suppressError = false; };
  if (typeof setImmediate === 'function') setImmediate(release);
  const timer = setTimeout(release, 0);
  timer.unref?.();
  return ticket;
}

function watchStall() {
  // One timer per attempt: repeated 'waiting' events must not extend or reset recovery.
  if (stallTimer) return;
  const generation = token;
  const ticket = mediaTicket;
  const adaptiveMs = bufferEngine.profile().stallTimeoutMs;
  const budgetMs = stallBudget(audio.currentTime);
  const ms = (state.source?.fast || state.source?.alternatives?.length)
    ? Math.max(2500, Math.min(budgetMs, adaptiveMs + 1500))
    : Math.max(budgetMs, adaptiveMs);
  stallTimer = setTimeout(() => {
    stallTimer = null;
    if (generation !== token || !pendingPlay || !isRealSrc()) return;
    if ((audio.readyState || 0) >= 2 && (audio.currentTime || 0) > 0.35) { clearStall(); return; }
    failAttempt(ticket);
  }, ms);
  stallTimer.unref?.();
}

function playAssigned(nextSource) {
  state.source = nextSource;
  state.error = null;
  // A preview (or non-effects failover) must not inherit a restrictive CORS mode from a failed link.
  if (nextSource.preview || !effectsOn()) audio.removeAttribute('crossorigin');
  const ticket = assignSrc(nextSource.url);
  if (nextSource.preview) { try { audio.currentTime = 0; } catch {} }
  if (!pendingPlay || userPaused) {
    setPhase(STATES.IDLE);
    emit('state');
    return;
  }
  setPhase(STATES.BUFFERING);
  emit('state');
  clearStall();
  watchStall();
  if (nextSource.preview) schedulePreviewUpgrade(1600);
  audio.play().then(() => {
    if (ticket !== mediaTicket) return;
    activation.markUnlocked(audio);
    unlockedPrimary = audio;
    telemetry.markStage(activeGen, 'playResolved');
  }).catch((e) => {
    if (ticket !== liveAttempt) return;
    if (e?.name === 'NotAllowedError') {
      if (unlockedPrimary && unlockedPrimary !== audio && activation.isUnlocked(unlockedPrimary)) {
        const previous = audio;
        previous.pause();
        previous.removeAttribute('src');
        previous.load();
        audio = unlockedPrimary;
        el = audio;
        bindAudio(audio);
        audio.volume = volumeLevel * (ducks.size ? .18 : 1);
        playAssigned(nextSource);
        return;
      }
      clearStall();
      activation.noteAutoAdvanceBlocked();
      setPhase(STATES.IDLE);
      emit('state');
    } else if (e?.name === 'AbortError') {
      clearStall();
      setPhase(STATES.IDLE);
      emit('state');
    } else {
      failAttempt(ticket, e);
    }
  });
}

// Full-song recovery continues behind a playing preview. It never silently swaps
// to an untested 403 link, and it cancels when the listener skips the song.
function verifyFullAudio(source, signal, expectedDuration) {
  return new Promise(resolve => {
    if (!source?.url || source.preview || source.kind === 'youtube-embed' || signal?.aborted) return resolve(false);
    const probe = new Audio();
    probe.preload = 'auto';
    probe.playsInline = true;
    let finished = false;
    const done = ok => {
      if (finished) return;
      finished = true;
      clearTimeout(timeout);
      signal?.removeEventListener('abort', abort);
      probe.removeEventListener?.('canplay', ready);
      probe.removeEventListener?.('error', failed);
      probe.pause();
      probe.removeAttribute('src');
      probe.load();
      resolve(ok);
    };
    const abort = () => done(false);
    const ready = () => {
      const seconds = probe.duration;
      const tooShort = Number.isFinite(seconds) && seconds > 0 && expectedDuration > 45 && seconds < expectedDuration * 0.65;
      done(!tooShort);
    };
    const failed = () => done(false);
    const timeout = setTimeout(() => done(false), 5200);
    timeout.unref?.();
    probe.addEventListener('canplay', ready, {once:true});
    probe.addEventListener('error', failed, {once:true});
    signal?.addEventListener('abort', abort, {once:true});
    try { probe.src = source.url; probe.load(); }
    catch { done(false); }
  });
}
function schedulePreviewUpgrade(delay = 1200) {
  clearTimeout(previewUpgradeTimer);
  const t = current(), generation = token;
  if (!t || !state.source?.preview || state.offline || store.getSettings().source === 'preview' || previewUpgradeTries >= 2) return;
  previewUpgradeTimer = setTimeout(async () => {
    if (generation !== token || current() !== t || !state.source?.preview || !pendingPlay) return;
    previewUpgradeTries++;
    const control = new AbortController();
    previewUpgradeControl = control;
    try {
      // Do not use the normal resolver: it may return a cached preview or iframe.
      const found = await api.resolveFull(t, {signal:control.signal});
      if (generation !== token || current() !== t || !state.source?.preview || !found) return;
      const options = [found, ...(found.alternatives || []).map(alt => ({...found,...alt, alternatives:[]}))];
      for (const candidate of options.slice(0,4)) {
        if (control.signal.aborted || generation !== token) return;
        if (!(await verifyFullAudio(candidate, control.signal, t.duration || 0))) continue;
        if (generation !== token || !state.source?.preview || !pendingPlay) return;
        const at = audio.currentTime || 0;
        // Preserve what was already heard, and keep the queue on this same recording.
        load({keepSkip:true, startAt:at, sourceOverride:candidate, upgradingPreview:true}).catch(()=>{});
        return;
      }
    } catch { /* The preview continues uninterrupted when no real audio is available. */ }
    finally {
      if (previewUpgradeControl === control) previewUpgradeControl = null;
      if (generation === token && state.source?.preview && previewUpgradeTries < 2)
        schedulePreviewUpgrade(9500);
    }
  }, delay);
  previewUpgradeTimer.unref?.();
}
function recoverMedia(mediaErr = null) {
  clearStall();
  if (!isRealSrc() || !current()) return;
  const recStart = telemetry.beginRecovery();
  setPhase(STATES.RECOVERING);
  const diagnosis = classifyFailure({
    mediaError: mediaErr || audio.error,
    userPaused: !pendingPlay,
    hidden: globalThis.document?.hidden,
    url: state.source?.url || '',
    online: globalThis.navigator?.onLine !== false,
    readyState: audio.readyState || 0,
  });

  if (diagnosis.retryMode === 'resume' && audio.readyState >= 2 && pendingPlay) {
    setPhase(STATES.BUFFERING);
    audio.play().then(() => telemetry.endRecovery(recStart, true)).catch(() => telemetry.endRecovery(recStart, false));
    emit('state');
    return;
  }

  const cur = current();
  const failed = state.source;
  const alternatives = failed?.alternatives || [];
  const started = (audio.currentTime || 0) > 0.35;

  // Before audible output, swap valid full-length alternatives in place to avoid full reload glitches.
  if (!state.offline && !started && !failed?.preview && alternatives.length && startupSwaps < 3) {
    for (let idx = 0; idx < alternatives.length; idx++) {
      const variant = alternatives[idx];
      if (!variant?.url) continue;
      if (variant.videoId === failed?.videoId || isVerifiedEquivalent(cur, { ...failed, ...variant })) {
        api.reportPlaybackSource(failed, false);
        startupSwaps++;
        telemetry.endRecovery(recStart, true);
        playAssigned({ ...failed, ...variant, alternatives: alternatives.slice(idx + 1) });
        return;
      }
    }
  }

  if (!state.offline && alternatives.length) {
    const [variant, ...rest] = alternatives;
    if (variant?.url && (variant.videoId === failed?.videoId || isVerifiedEquivalent(cur, { ...failed, ...variant }))) {
      api.reportPlaybackSource(failed, false);
      telemetry.endRecovery(recStart, true);
      load({ keepSkip: true, startAt: audio.currentTime || 0, sourceOverride: { ...failed, ...variant, alternatives: rest } });
      return;
    }
  }

  api.reportPlaybackSource(failed, false);
  if (diagnosis.retryMode === 'refresh-url') {
    memoryEngine.forgetStream(api.streamKey(cur));
  }
  if (!state.offline && !cur.local && failed && !failed.preview && errRetries < 2) {
    errRetries++;
    if (failed.instance) skipList.push(failed.instance);
    telemetry.endRecovery(recStart, true);
    load({ keepSkip: true, startAt: audio.currentTime || 0 });
    return;
  }

  // 30s catalog preview fallback only after full-track servers + alternatives are exhausted in auto mode.
  const previewUrl = cur?.preview;
  if (!state.offline && !failed?.preview && store.getSettings().source === 'auto') {
    if (/^https:\/\//.test(previewUrl || '')) {
      startupSwaps = 0;
      telemetry.endRecovery(recStart, true);
      playAssigned({
        url: previewUrl,
        mime: 'audio/mpeg',
        bitrate: 128000,
        kind: 'preview',
        instance: 'https://api.deezer.com',
        preview: true,
        alternatives: [],
      });
      return;
    }
    if (!cur.local) {
      telemetry.endRecovery(recStart, true);
      fallbackToPreview('', { allowPreview: true });
      return;
    }
  }

  telemetry.endRecovery(recStart, false);
  telemetry.markFailed(activeGen);
  setPhase(STATES.FAILED);
  const message = `Playback failed for “${cur.title}”. Retry or choose another audio source in Settings.`;
  if (state.error === message) {
    audio.pause();
    emit('state');
    return;
  }
  state.error = message;
  audio.pause();
  emit('error', state.error);
  emit('state');
}

function maybeMix() {
  if (!mixSeconds || mixing || effectsOn() || state.repeat === 'one' || audio.paused || !isFinite(audio.duration)) return;
  const left = audio.duration - audio.currentTime;
  if (left > mixSeconds || left < 1 || state.index >= state.queue.length - 1) return;
  const nextTrack = state.queue[state.index + 1];
  if (!nextBuffer.entry || nextBuffer.entry.key !== api.streamKey(nextTrack) || nextBuffer.entry.media.readyState < 3) return;
  mixing = true;
  onFinish(current());
  state.index++;
  errRetries = 0;
  load({ mixSeconds: Math.max(1, left), trigger: 'automix' }).finally(() => { mixing = false; });
}

/** InstantPlay: when AutoMix is off (e.g. iOS), hand off cleanly to a ready Player B right before 'ended'. */
function maybeSeamless() {
  if (mixSeconds || mixing || effectsOn() || state.repeat === 'one' || state.index >= state.queue.length - 1) return;
  const nextTrack = state.queue[state.index + 1];
  const key = nextTrack && api.streamKey(nextTrack);
  if (!key || !nextBuffer.isReady(key, 2) || !seamlessHandoffWindow(audio)) return;
  mixing = true;
  onFinish(current());
  state.index++;
  errRetries = 0;
  load({ trigger: 'seamless-handoff' }).finally(() => { mixing = false; });
}

function fade(media, from, to, seconds) {
  return new Promise((resolve) => {
    const start = performance.now(), ms = seconds * 1000;
    const step = () => {
      const k = Math.min(1, (performance.now() - start) / ms);
      media.volume = Math.max(0, Math.min(1, from + (to - from) * k));
      if (k < 1) setTimeout(step, 50);
      else resolve();
    };
    step();
  });
}

let ytToken = 0;
const yt = new YouTubeEmbedPlayer({
  onReady: () => {
    if (ytToken !== token) return;
    if (state.phase === STATES.RESOLVING || state.phase === STATES.PREPARING) setPhase(STATES.BUFFERING);
    state.loading = false;
    emit('state');
  },
  onNeedsTap: (needed) => {
    if (ytToken !== token) return;
    state.loading = false;
    state.needsTap = store.getSettings().source === 'youtube' && !!needed;
    if (state.needsTap) state.ytHidden = false;
    emit('state');
  },
  onPlaying: () => {
    if (ytToken !== token) return;
    setPhase(STATES.PLAYING);
    state.needsTap = false;
    telemetry.markStage(ytToken, 'firstAudible', { sourceKind: 'youtube-embed', instance: 'youtube.com' });
    if (state.startupMs == null && startedAt) state.startupMs = Math.round(performance.now() - startedAt);
    if ('mediaSession' in navigator) { navigator.mediaSession.playbackState = 'playing'; updateSession(current()); }
    window.dispatchEvent?.(new Event('spotplus:music-play'));
    emit('state');
  },
  onPause: () => {
    if (ytToken !== token) return;
    telemetry.noteListeningStop();
    if ('mediaSession' in navigator) navigator.mediaSession.playbackState = 'paused';
    emit('state');
    save();
  },
  onTime: (t) => {
    if (ytToken !== token) return;
    if (t > 0) restorePos = 0;
    emit('time');
    const now = Date.now();
    if (now - lastPos > 1000) { lastPos = now; positionState(); }
    if (now - lastSave > 10000) { lastSave = now; save(); }
  },
  onEnded: () => {
    if (ytToken !== token) return;
    telemetry.noteListeningStop();
    if (userPaused) {
      setPhase(STATES.IDLE);
      emit('state');
      return;
    }
    if (state.repeat === 'one') {
      state.playbackId = (state.playbackId || 0) + 1;
      pendingPlay = true;
      userPaused = false;
      yt.seek(0);
      yt.play();
      emit('state');
    } else {
      onFinish(current());
      next(false);
    }
  },
  onError: (msg) => {
    if (ytToken !== token) return;
    fallbackToPreview(msg);
  },
});

export async function fallbackToPreview(reason = '', { allowPreview = store.getSettings().source === 'auto' } = {}) {
  const t = current();
  const gen = token;
  if (!t) return;
  if (allowPreview) {
    try {
      const preview = await api.previewStream(t);
      if (gen !== token || current()?.id !== t.id) return;
      await load({ keepSkip: true, startAt: 0, sourceOverride: preview });
      return;
    } catch { /* fall through to error state */ }
  }
  if (gen !== token) return;
  yt.stop();
  ytToken = 0;
  setPhase(STATES.FAILED);
  state.needsTap = false;
  telemetry.markFailed(gen);
  state.error = `Playback failed for “${t.title}”. ${reason || 'Retry or choose another audio source in Settings.'}`;
  emit('error', state.error);
  emit('state');
}

const ducks = new Set();
export function duck(reason, enabled) {
  if (enabled) ducks.add(reason); else ducks.delete(reason);
  const v = volumeLevel * (ducks.size ? .18 : 1);
  audio.volume = v;
  yt.setVolume(v);
}

/* ---------- iOS/Safari: unlock audio on the first tap ---------- */
function silentWav() {
  const n = 800, b = new ArrayBuffer(44 + n), v = new DataView(b);
  const w = (o, s) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  w(0, 'RIFF'); v.setUint32(4, 36 + n, true); w(8, 'WAVE'); w(12, 'fmt ');
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, 8000, true); v.setUint32(28, 8000, true); v.setUint16(32, 1, true); v.setUint16(34, 8, true);
  w(36, 'data'); v.setUint32(40, n, true);
  for (let i = 0; i < n; i++) v.setUint8(44 + i, 128);
  let s = '';
  new Uint8Array(b).forEach((x) => (s += String.fromCharCode(x)));
  return 'data:audio/wav;base64,' + btoa(s);
}
const SILENT = silentWav();
export function unlockElement(element) {
  if (!element) return;
  element.playsInline = true;
  element.setAttribute?.('playsinline', '');
  if (element.src) return;
  element.src = SILENT;
  element.play().then(() => {
    activation.markUnlocked(element);
    if (element.src === SILENT) element.pause();
  }).catch(() => {});
}
function unlock() {
  api.warmConnections();
  unlockElement(nextBuffer.spare);
  if (!plainSpare) {
    plainSpare = new Audio();
    plainSpare.preload = 'auto';
    plainSpare.playsInline = true;
    plainSpare.setAttribute?.('playsinline', '');
    bindAudio(plainSpare);
    unlockElement(plainSpare);
  } else {
    unlockElement(plainSpare);
  }
  if (audio.src) return;
  audio.src = SILENT;
  audio.play().then(() => {
    activation.markUnlocked(audio);
    unlockedPrimary = audio;
    if (audio.src === SILENT) audio.pause();
  }).catch(() => {});
}
window.addEventListener('pointerdown', unlock, { capture: true, passive: true });
const isRealSrc = () => audio.src && !audio.src.startsWith('data:');
/** Stop every Spot+ sound when the app is closed for good (iOS can keep a closed web app's audio alive). */
window.addEventListener('pagehide', (e) => {
  if (!e.persisted) {
    clearTimeout(pauseClearTimer);
    telemetry.noteListeningStop();
    audio.pause();
    yt.stop();
    nextBuffer.spare.pause();
  }
});

/* ---------- Loading a track ---------- */
async function load(opts = {}) {
  const t = current();
  if (!t) return;
  const my = ++token;
  activeGen = my;
  startupSwaps = 0;
  clearTimeout(previewUpgradeTimer);
  previewUpgradeControl?.abort();
  previewUpgradeControl = null;
  if (!opts.keepSkip) previewUpgradeTries = 0;
  if (!opts.keepSkip) state.playbackId = (state.playbackId || 0) + 1;
  clearStall();
  clearTimeout(pauseClearTimer);
  telemetry.noteListeningStop();
  yt.stop();
  ytToken = 0;
  state.needsTap = false;
  state.ytHidden = false;
  startedAt = performance.now();
  state.startupMs = null;
  cancelLoad?.abort();
  cancelLoad = new AbortController();
  const controller = cancelLoad;
  pendingPlay = opts.autoplay !== false;
  userPaused = false;
  ++warmGeneration;
  clearTimeout(prefetchTimer);
  api.cancelPrewarm(t);

  const streamKeyForTrack = !opts.keepSkip && !effectsOn() ? api.streamKey(t) : '';
  const warmed = streamKeyForTrack ? nextBuffer.take(streamKeyForTrack) : null;
  telemetry.beginGeneration(my, {
    trackId: t.id,
    trigger: opts.keepSkip ? 'recover' : (opts.trigger || 'play'),
    prepared: !!warmed,
    cold: !warmed && !t.local,
  });

  if (!(opts.mixSeconds && warmed)) audio.pause();
  if (warmed) {
    const previous = audio, target = volumeLevel * (ducks.size ? .18 : 1);
    audio = warmed.media;
    el = audio;
    bindAudio(audio);
    if (opts.mixSeconds) {
      // AutoMix: the old song fades out while the new one fades in; a fresh spare preloads the song after.
      audio.volume = 0;
      fade(audio, 0, target, opts.mixSeconds);
      fade(previous, previous.volume, 0, opts.mixSeconds).then(() => {
        previous.pause();
        previous.removeAttribute('src');
        previous.load();
      });
      const spare = new Audio();
      spare.preload = 'none';
      spare.playsInline = true;
      spare.setAttribute?.('playsinline', '');
      bindAudio(spare);
      unlockElement(spare);
      nextBuffer.recycle(spare);
    } else {
      audio.volume = target;
      // Never recycle a Web Audio-captured element into nextBuffer.spare when effects might be toggled off.
      if (isCaptured(previous)) {
        previous.pause();
        previous.removeAttribute('src');
        previous.load();
        const freshSpare = new Audio();
        freshSpare.preload = 'none';
        freshSpare.playsInline = true;
        freshSpare.setAttribute?.('playsinline', '');
        bindAudio(freshSpare);
        unlockElement(freshSpare);
        nextBuffer.recycle(freshSpare);
      } else {
        nextBuffer.recycle(previous);
      }
    }
    mediaTicket = ++liveAttempt;
    suppressError = false;
  } else {
    nextBuffer.clear();
    audio.removeAttribute('src');
    audio.load();
  }

  state.error = null;
  if (opts.startAt == null) {
    const resume = resumeAt(t);
    if (resume) opts = { ...opts, startAt: resume };
  }
  restorePos = opts.startAt || 0;
  if (!opts.keepSkip) skipList = [];
  state.source = null;
  state.offline = false;
  setPhase(warmed ? STATES.PREPARING : STATES.RESOLVING);
  emit('state');
  emit('time');
  updateSession(t);

  try {
    let src;
    const shouldCheckOffline = !warmed && (t.local || store.getDownloads().some((d) => d.id === t.id));
    const blob = shouldCheckOffline ? await offlineBlob(t.id) : null;
    if (my !== token) return;

    if (warmed) {
      if (objUrl) { URL.revokeObjectURL(objUrl); objUrl = null; }
      state.source = warmed.source;
      src = warmed.source.url;
      telemetry.markStage(my, 'resolveEnd', { cacheLayer: 'warmed-buffer', sourceKind: warmed.source.kind, instance: warmed.source.instance, cold: false, prepared: true });
    } else if (blob) {
      if (objUrl) URL.revokeObjectURL(objUrl);
      objUrl = URL.createObjectURL(blob);
      src = objUrl;
      state.offline = true;
      state.source = { url: src, mime: blob.type || 'audio/mpeg', kind: 'offline-blob', instance: 'device', cacheLayer: 'offline-cache' };
      telemetry.markStage(my, 'resolveEnd', { cacheLayer: 'offline-cache', sourceKind: 'offline-blob', instance: 'device', cold: false });
    } else {
      if (objUrl) { URL.revokeObjectURL(objUrl); objUrl = null; }
      telemetry.markStage(my, 'resolveStart');
      const allowEmbed = store.getSettings().source === 'youtube';
      const r = opts.sourceOverride || await api.resolve(t, { skip: skipList, signal: controller.signal, cors: effectsOn(), allowEmbed });
      if (my !== token) return;
      if (r.kind === 'youtube-embed' && !allowEmbed) {
        throw new Error('No audio server answered. Try another source in Settings, a 30-second preview, or a local audio file.');
      }
      state.source = r;
      src = r.url;
      telemetry.markStage(my, 'resolveEnd', {
        cacheLayer: r.cacheLayer || 'network',
        sourceKind: r.kind || '',
        instance: r.instance || '',
        cold: (r.cacheLayer || 'network') === 'network',
      });
      if (r.kind === 'youtube-embed') {
        setPhase(STATES.PREPARING);
        audio.pause();
        audio.removeAttribute('src');
        audio.load();
        ytToken = my;
        telemetry.markStage(my, 'mediaInit', { sourceKind: 'youtube-embed', instance: 'youtube.com' });
        yt.load(r.videoIds || [r.videoId], { startAt: opts.startAt || 0, autoplay: pendingPlay, volume: volumeLevel * (ducks.size ? .18 : 1) });
        if (!pendingPlay) { setPhase(STATES.IDLE); }
        failStreak = 0;
        store.addRecent(t);
        emit('state');
        save();
        return;
      }
    }

    setPhase(STATES.PREPARING);
    if (!warmed) {
      if (isCaptured(audio) && !(await prepareElement(audio, src))) {
        // This song's server doesn't allow effects: switch to the plain element so it still plays.
        if (my !== token) return;
        const plain = plainSpare || new Audio();
        plainSpare = null;
        audio.removeAttribute('src');
        audio.load();
        audio = plain;
        el = audio;
        bindAudio(audio);
        audio.preload = 'auto';
        audio.volume = volumeLevel * (ducks.size ? .18 : 1);
        emit('effects-skipped');
      } else if (!isCaptured(audio) && effectsOn()) {
        await prepareElement(audio, src);
      } else if (!isCaptured(audio) && corsKnown(src) === true) {
        audio.crossOrigin = 'anonymous';
      } else if (!isCaptured(audio)) {
        audio.removeAttribute('crossorigin');
      }
      if (my !== token) return;
      assignSrc(src);
    }

    telemetry.markStage(my, 'mediaInit');
    audio.preload = 'auto';
    if (opts.startAt) {
      // Aborted automatically when cancelLoad aborts (zero leaked listeners on skip!).
      audio.addEventListener('loadedmetadata', () => {
        if (my !== token) return;
        audio.currentTime = Math.min(opts.startAt, duration());
        restorePos = 0;
      }, { once: true, signal: controller.signal });
    } else if (warmed && audio.readyState >= 1) {
      restorePos = 0;
    }

    if (pendingPlay && !userPaused) {
      const ticket = mediaTicket;
      setPhase(STATES.BUFFERING);
      emit('state');
      watchStall();
      await audio.play().then(() => {
        if (my !== token || ticket !== mediaTicket) return;
        activation.markUnlocked(audio);
        unlockedPrimary = audio;
        telemetry.markStage(my, 'playResolved');
        activation.noteAutoAdvanceSuccess();
      }).catch((e) => {
        if (my !== token || ticket !== liveAttempt) return;
        if (e.name === 'NotAllowedError') {
          if (unlockedPrimary && unlockedPrimary !== audio && activation.isUnlocked(unlockedPrimary)) {
            const previous = audio;
            previous.pause();
            previous.removeAttribute('src');
            previous.load();
            audio = unlockedPrimary;
            el = audio;
            bindAudio(audio);
            audio.volume = volumeLevel * (ducks.size ? .18 : 1);
            playAssigned(state.source);
            return;
          }
          clearStall();
          activation.noteAutoAdvanceBlocked();
          setPhase(STATES.IDLE);
          emit('state');
        } else if (e.name === 'AbortError') {
          clearStall();
          setPhase(STATES.IDLE);
          emit('state');
        } else {
          failAttempt(ticket, e);
        }
      });
    } else {
      setPhase(STATES.IDLE);
      emit('state');
    }

    if (my !== token) return;
    failStreak = 0;
    store.addRecent(t);
    if (state.source?.preview) schedulePreviewUpgrade(1600);
    prefetch();
  } catch (e) {
    if (my !== token) return;
    telemetry.markFailed(my);
    setPhase(STATES.FAILED);
    state.error = `Couldn’t play “${t.title}”. ${e.message}`;
    emit('state');
    emit('error', `Couldn't play “${t.title}”: ${e.message}`);
    failStreak++;
  }
  save();
}

function prefetch() {
  const generation = ++warmGeneration;
  clearTimeout(prefetchTimer);
  const netProfile = bufferEngine.profile(navigator.connection);
  const upcoming = predictUpcoming({ queue: state.queue, index: state.index, repeat: state.repeat });
  const next = upcoming[0]?.track || null;
  if (store.getSettings().preloadNext === false || !netProfile.preloadStageA || !next || !isPlaying() || state.loading) {
    nextBuffer.clear();
    return;
  }
  const needHeadroom = Math.min(netProfile.headroomSec, mediaWarmHeadroom(navigator.connection));
  if (!skipTracker.isRapidSkipping() && netProfile.maxPreloadAhead >= 2) {
    api.prewarmAhead(upcoming.slice(0, 2).map((u) => u.track));
  }
  const delay = skipTracker.stageBDelayMs();
  prefetchTimer = setTimeout(async () => {
    try {
      if (generation !== warmGeneration || !isPlaying() || state.loading) return;
      if (!audioHasHeadroom(audio, needHeadroom)) {
        prefetchTimer = setTimeout(() => { if (generation === warmGeneration && isPlaying() && !state.loading) prefetch(); }, 150);
        prefetchTimer.unref?.();
        return;
      }

      // Stage A: resolve candidate sources for next track (and subsequent track on fast connections).
      const source = await (api.prewarm(next) || api.resolve(next));
      if (netProfile.maxPreloadAhead >= 2 && upcoming[1]?.track && !skipTracker.isRapidSkipping()) {
        api.prewarm(upcoming[1].track);
      }

      if (generation !== warmGeneration || !isPlaying() || state.loading) return;
      if (!audioHasHeadroom(audio, Math.max(3, needHeadroom - 2))) return;

      // Stage B: prepare Player B when permitted, non-embed, and not rapid-skipping.
      if (netProfile.preloadStageB && !effectsOn() && source.kind !== 'youtube-embed' && !skipTracker.isRapidSkipping()) {
        nextBuffer.warm(api.streamKey(next), source, { cors: corsKnown(source.url) === true });
      }
    } catch { /* Foreground playback retains its own retry path. */ }
  }, delay);
  prefetchTimer.unref?.();
}

/* ---------- Audio element events ---------- */
let lastSave = 0, lastPos = 0;
const boundAudio = new WeakSet();
function bindAudio(media) {
  if (boundAudio.has(media)) return;
  boundAudio.add(media);
  const listen = (event, fn) => media.addEventListener(event, () => { if (media === audio) fn(); });
  // Only the current track may make sound: a spare/preloaded element that starts on its own is stopped at once.
  media.addEventListener('play', () => {
    if (media !== audio && media.src && !media.src.startsWith('data:')) media.pause();
    else if (media === audio) window.dispatchEvent?.(new Event('spotplus:music-play'));
  });
  listen('loadedmetadata', () => {
    telemetry.markStage(activeGen, 'metadataLoaded');
  });
  listen('canplay', () => {
    telemetry.markStage(activeGen, 'canPlay');
    if (state.loading && !audio.paused) {
      setPhase(STATES.PLAYING);
      emit('state');
      prefetch();
    }
  });
  listen('playing', () => {
    suppressError = false;
    clearStall();
    startupSwaps = 0;
    clearTimeout(pauseClearTimer);
    setPhase(STATES.PLAYING);
    const first = telemetry.markStage(activeGen, 'firstAudible');
    if (state.startupMs == null && startedAt && isRealSrc()) state.startupMs = Math.round((first || performance.now()) - startedAt);
    telemetry.noteListeningStart();
    api.reportPlaybackSource(state.source, true, { startupMs: state.startupMs || 0 });
    emit('state');
    prefetch();
  });
  listen('play', () => {
    clearTimeout(pauseClearTimer);
    if ('mediaSession' in navigator) { navigator.mediaSession.playbackState = 'playing'; updateSession(current()); }
    emit('state');
  });
  listen('pause', () => {
    clearStall();
    telemetry.noteListeningStop();
    if (state.phase === STATES.PLAYING || state.phase === STATES.STALLED) setPhase(STATES.IDLE);
    if ('mediaSession' in navigator) navigator.mediaSession.playbackState = 'paused';
    emit('state');
    save();
    ++warmGeneration;
    clearTimeout(prefetchTimer);
    // Keep prepared Player B warm across short pauses so skip/next remains instant.
    clearTimeout(pauseClearTimer);
    pauseClearTimer = setTimeout(() => { if (nextBuffer.entry) nextBuffer.clear(); }, KEEP_WARM_AFTER_PAUSE_MS);
    pauseClearTimer.unref?.();
  });
  listen('waiting', () => {
    // Buffering is normal, even on a fast link. Only a hard error or a full stall budget changes source.
    if (!isRealSrc()) return;
    bufferEngine.recordStall();
    telemetry.beginStall('waiting');
    if ((audio.currentTime || 0) < 0.35) setPhase(STATES.BUFFERING);
    else setPhase(STATES.STALLED);
    watchStall();
    ++warmGeneration;
    clearTimeout(prefetchTimer);
    emit('state');
  });
  listen('seeked', () => {
    telemetry.endSeek();
  });
  listen('progress', () => {
    bufferEngine.recordBufferProgress(audio, state.source?.bitrate || 128_000);
    emit('state');
  });
  listen('timeupdate', () => {
    if (isRealSrc() && (audio.currentTime || 0) > 0.35 && !audio.paused) clearStall();
    if (isRealSrc() && audio.currentTime > 0) restorePos = 0;
    bufferEngine.recordBufferProgress(audio, state.source?.bitrate || 128_000);
    emit('time');
    const now = Date.now();
    if (now - lastPos > 1000) { lastPos = now; positionState(); }
    if (now - lastSave > 10000) { lastSave = now; save(); }
    maybeMix();
    maybeSeamless();
  });
  listen('ended', () => {
    clearStall();
    telemetry.noteListeningStop();
    if (userPaused) {
      setPhase(STATES.IDLE);
      emit('state');
      return;
    }
    setPhase(STATES.ENDED);
    if (state.repeat === 'one') {
      state.playbackId = (state.playbackId || 0) + 1;
      pendingPlay = true;
      userPaused = false;
      if (linkExpired()) {
        load({ startAt: 0, trigger: 'repeat-one' });
        return;
      }
      audio.currentTime = 0;
      setPhase(STATES.PLAYING);
      emit('state');
      audio.play().catch(() => load({ startAt: 0, trigger: 'repeat-one' }));
    } else {
      onFinish(current());
      if (!mixing) next(false);
    }
  });
  listen('error', () => {
    if (isRealSrc() && !suppressError) failAttempt(mediaTicket, audio.error);
  });
}
bindAudio(audio);
bindAudio(nextBuffer.spare);

/* ---------- Controls ---------- */
function shuffled(a) {
  const r = a.slice();
  for (let i = r.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [r[i], r[j]] = [r[j], r[i]]; }
  return r;
}
export function playList(tracks, i = 0, { shuffle = null } = {}) {
  if (!tracks || !tracks.length) return;
  if (shuffle !== null) state.shuffle = shuffle;
  skipTracker.clear();
  const list = tracks.map(store.slim);
  i = Math.max(0, Math.min(i, list.length - 1));
  if (state.shuffle) {
    state.original = list;
    const first = shuffle && i === 0 ? list[Math.floor(Math.random() * list.length)] : list[i];
    state.queue = [first, ...shuffled(list.filter((x) => x !== first))];
    state.index = 0;
  } else {
    state.original = null;
    state.queue = list;
    state.index = i;
  }
  errRetries = 0; failStreak = 0; restorePos = 0;
  api.prewarmAhead([state.queue[state.index], state.queue[state.index + 1]].filter((t) => t && !t.local));
  load({ trigger: 'play-list' });
}
export function playIndex(i) {
  if (i >= 0 && i < state.queue.length) {
    skipTracker.record();
    state.index = i;
    errRetries = 0;
    load({ trigger: 'queue-jump' });
  }
}
// Audio links from YouTube servers expire after a few hours; a paused song may need a fresh one.
const linkExpired = () => { const exp = Number(String(state.source?.url || '').match(/[?&]expire=(\d{9,11})/)?.[1] || 0) * 1000; return !!exp && exp - 60e3 < Date.now(); };
export function toggle() {
  if (!current()) return;
  if (state.loading) {
    cancelLoad?.abort();
    ++token;
    yt.stop();
    ytToken = 0;
    clearStall();
    setPhase(STATES.IDLE);
    state.needsTap = false;
    pendingPlay = false;
    userPaused = true;
    audio.pause();
    audio.removeAttribute('src');
    audio.load();
    emit('state');
    return;
  }
  if (isEmbed()) {
    if (yt.paused) { userPaused = false; pendingPlay = true; yt.play(); }
    else { userPaused = true; pendingPlay = false; yt.pause(); }
    return;
  }
  if (!isRealSrc()) { const at = restorePos; restorePos = 0; load({ startAt: at, trigger: 'resume' }); return; }
  if (audio.paused) {
    if (!isRealSrc()) { const at = restorePos; restorePos = 0; load({ startAt: at, trigger: 'resume' }); }
    else if (linkExpired()) load({ startAt: audio.currentTime || 0, trigger: 'refresh-expired' });
    else {
      userPaused = false;
      pendingPlay = true;
      audio.play().then(() => {
        activation.markUnlocked(audio);
        unlockedPrimary = audio;
      }).catch(() => {});
    }
  } else {
    userPaused = true;
    pendingPlay = false;
    audio.pause();
  }
}
export function next(fromUser = true) {
  if (fromUser && current() && (isRealSrc() || isEmbed())) {
    skipTracker.record();
    onSkip(current(), position());
  }
  if (state.index < state.queue.length - 1) state.index++;
  else if (state.repeat === 'all' && state.queue.length) state.index = 0;
  else if (continueQueue && !current()?.direct) { radioContinue(); return; }
  else { pause(); emit('state'); return; }
  errRetries = 0;
  load({ trigger: fromUser ? 'skip-next' : 'auto-advance' });
}
let radioBusy = false;
async function radioContinue() {
  if (radioBusy) return;
  radioBusy = true;
  setPhase(STATES.RESOLVING);
  emit('state');
  try {
    const more = await continueQueue(state.queue.slice());
    if (more?.length) { state.queue.push(...more); state.index++; state.radio = true; errRetries = 0; save(); load({ trigger: 'radio' }); return; }
  } catch { /* fall through */ } finally { radioBusy = false; }
  setPhase(STATES.IDLE);
  pause();
  emit('state');
}
export function prev() {
  if (position() > 3 || state.index <= 0) { seek(0); return; }
  skipTracker.record();
  state.index--;
  errRetries = 0;
  load({ trigger: 'skip-prev' });
}
export function seek(sec) {
  if (!isFinite(sec)) return;
  if (isEmbed()) {
    const target = Math.max(0, Math.min(sec, duration()));
    yt.seek(target);
    return;
  }
  if (!isRealSrc()) return;
  const info = inspectSeek(audio, sec, duration());
  telemetry.beginSeek(info.targetSec);
  audio.currentTime = info.targetSec;
  if (info.inBuffer) telemetry.endSeek();
}
export function setVolume(v) {
  volumeLevel = Math.max(0, Math.min(1, v));
  const scaled = volumeLevel * (ducks.size ? .18 : 1);
  audio.volume = scaled;
  yt.setVolume(scaled);
  save();
}
export function playNext(t) {
  if (!current()) return playList([t]);
  const track = store.slim(t);
  state.queue.splice(state.index + 1, 0, track);
  if (state.original) state.original.push(track);
  emit('state'); save(); prefetch();
}
export function addToQueue(tracks) {
  const arr = (Array.isArray(tracks) ? tracks : [tracks]).map(store.slim);
  if (!current()) return playList(arr);
  state.queue.push(...arr);
  if (state.original) state.original.push(...arr);
  emit('state'); save(); prefetch();
}
export function removeAt(i) {
  if (i === state.index || i < 0 || i >= state.queue.length) return;
  const [removed] = state.queue.splice(i, 1);
  if (state.original) { const originalIndex = state.original.indexOf(removed); if (originalIndex >= 0) state.original.splice(originalIndex, 1); }
  if (i < state.index) state.index--;
  emit('state'); save(); prefetch();
}
export function clearUpNext() { state.queue = state.queue.slice(0, state.index + 1); if (state.original) state.original = state.queue.slice(); emit('state'); save(); prefetch(); }
export function moveQueue(from, to) {
  if (from <= state.index || to <= state.index || from >= state.queue.length || to >= state.queue.length) return;
  const [track] = state.queue.splice(from, 1);
  state.queue.splice(to, 0, track);
  if (state.original) state.original = state.queue.slice();
  emit('state'); save(); prefetch();
}
export function retry() { if (current()) load({ startAt: audio.currentTime || restorePos, trigger: 'retry' }); }
export function toggleShuffle() {
  state.shuffle = !state.shuffle;
  const cur = current();
  if (state.shuffle) {
    state.original = state.queue.slice();
    const rest = state.queue.filter((_, j) => j !== state.index);
    state.queue = cur ? [cur, ...shuffled(rest)] : shuffled(rest);
    state.index = cur ? 0 : -1;
  } else if (state.original) {
    const idx = state.original.findIndex((x) => x.id === cur?.id);
    state.queue = state.original;
    state.index = idx >= 0 ? idx : 0;
    state.original = null;
  }
  emit('state'); save(); prefetch();
}
export function cycleRepeat() {
  state.repeat = state.repeat === 'off' ? 'all' : state.repeat === 'all' ? 'one' : 'off';
  emit('state'); save(); prefetch();
}
/** Use a different YouTube video for the current track (when the auto-match is wrong). */
export function useMatch(videoId) {
  const t = current();
  if (!t) return;
  store.setVideoCache(t.id, { id: videoId, manual: true });
  api.clearStreamCache();
  load({ trigger: 'rematch' });
}

/* ---------- Persist queue between visits ---------- */
function save() {
  store.savePlayer({
    queue: state.queue.slice(Math.max(0, state.index - 50), state.index + 250),
    index: Math.min(state.index, 50),
    shuffle: state.shuffle, repeat: state.repeat, original: state.original, pos: position() || restorePos || 0, vol: volumeLevel,
  });
}
export function restore() {
  const s = store.loadPlayer();
  if (!s) return;
  if (typeof s.vol === 'number') { volumeLevel = Math.max(0, Math.min(1, s.vol)); audio.volume = volumeLevel; yt.setVolume(volumeLevel); }
  state.shuffle = !!s.shuffle;
  state.repeat = ['off', 'all', 'one'].includes(s.repeat) ? s.repeat : 'off';
  state.original = null;
  if (Array.isArray(s.queue) && s.queue.length) {
    state.queue = s.queue;
    if (state.shuffle && Array.isArray(s.original)) {
      const byId = new Map(state.queue.map(t => [String(t.id), t]));
      state.original = s.original.map(t => byId.get(String(t.id))).filter(Boolean);
    }
    state.index = Math.max(0, Math.min(s.index || 0, s.queue.length - 1));
    restorePos = s.pos || 0;
    updateSession(current());
    const t0 = setTimeout(() => {
      if (current() && !isRealSrc()) {
        api.warmConnections();
        api.prewarm(current());
      }
    }, 300);
    t0.unref?.();
  }
  emit('state');
}
export const restoredPosition = () => restorePos;

/* ---------- Lock screen / media keys ---------- */
function updateSession(t) {
  if (!('mediaSession' in navigator) || !t) return;
  try {
    navigator.mediaSession.metadata = new MediaMetadata({
      title: t.title, artist: t.artist, album: t.album,
      artwork: [t.cover && { src: t.cover, sizes: '250x250', type: 'image/jpeg' }, t.coverXl && { src: t.coverXl, sizes: '1000x1000', type: 'image/jpeg' }].filter(Boolean),
    });
  } catch {}
}
function positionState() {
  if (!('mediaSession' in navigator) || !navigator.mediaSession.setPositionState) return;
  const d = duration();
  if (!d) return;
  try { navigator.mediaSession.setPositionState({ duration: d, playbackRate: isEmbed() ? 1 : (audio.playbackRate || 1), position: Math.min(position(), d) }); } catch {}
}
if ('mediaSession' in navigator) {
  const h = (a, fn) => { try { navigator.mediaSession.setActionHandler(a, fn); } catch {} };
  h('play', () => { updateSession(current()); if (isPaused()) toggle(); });
  h('pause', () => { pause(); updateSession(current()); });
  h('previoustrack', prev);
  h('nexttrack', () => next(true));
  h('seekto', (d) => seek(d.seekTime));
  h('seekbackward', (d) => seek(position() - (d.seekOffset || 10)));
  h('seekforward', (d) => seek(position() + (d.seekOffset || 10)));
}

/* ---------- Offline downloads ---------- */
const offKey = (id) => new URL(`./__offline/${encodeURIComponent(id)}`, location.href).href;
export async function offlineBlob(id) {
  if (!('caches' in window)) return null;
  try {
    const c = await caches.open(AUDIO_CACHE);
    const r = await c.match(offKey(id));
    return r ? await r.blob() : null;
  } catch { return null; }
}
export async function download(t, onProgress = () => {}, signal) {
  if (!('caches' in window)) throw new Error('This browser can’t store offline audio');
  navigator.storage?.persist?.().catch(() => {});
  // Downloads read the audio directly, which needs a server that allows it: prefer those.
  const r = await api.resolve(t, { cors: true, signal });
  if (r.preview) throw new Error('Preview mode provides short samples, not full-song downloads. Choose a full audio source in Settings.');
  const res = await fetch(r.url, { signal });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const total = Number(res.headers.get('content-length')) || 0;
  const chunks = [];
  let got = 0;
  if (res.body && res.body.getReader) {
    const reader = res.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      got += value.length;
      if (total) onProgress(got / total);
    }
  } else chunks.push(new Uint8Array(await res.arrayBuffer()));
  const type = (r.mime || 'audio/mp4').split(';')[0];
  const blob = new Blob(chunks, { type });
  if (blob.size < 50000) throw new Error('download came back incomplete');
  const c = await caches.open(AUDIO_CACHE);
  await c.put(offKey(t.id), new Response(blob, { headers: { 'Content-Type': type } }));
  store.addDownload(t);
}
export async function removeDownload(id) {
  try { const c = await caches.open(AUDIO_CACHE); await c.delete(offKey(id)); } catch {}
  store.removeDownloadMeta(id);
}
export async function clearDownloads() {
  for (const t of store.getDownloads()) await removeDownload(t.id);
}

export async function removeLocalFile(id) {
  const c = await caches.open(AUDIO_CACHE);
  await c.delete(offKey(id));
  store.removeLocalFile(id);
}

export async function importLocalFile(file) {
  if (!('caches' in window)) throw new Error('Local files need a secure browser with offline storage.');
  if (!/^audio\//.test(file.type) && !/\.(mp3|m4a|flac|wav|ogg|opus|aac)$/i.test(file.name)) throw new Error('Choose an audio file.');
  if (file.size > 250 * 1024 * 1024) throw new Error('Choose a file smaller than 250 MB.');
  const hash = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
  const id = 'local-' + Array.from(new Uint8Array(hash), b => b.toString(16).padStart(2, '0')).join('');
  const track = { id, title: file.name.replace(/\.[^.]+$/, ''), artist: 'Local file', album: 'On this device', local: true, duration: 0 };
  const c = await caches.open(AUDIO_CACHE);
  await c.put(offKey(id), new Response(file, { headers: { 'Content-Type': file.type || 'audio/mpeg' } }));
  store.addLocalFile(track);
  return track;
}
