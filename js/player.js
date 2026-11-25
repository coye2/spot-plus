// player.js — InstantPlay playback engine: state machine, generation control,
// dual-element predictive buffering, adaptive stall recovery, lock-screen controls, and offline downloads.
import * as api from './api.js';
import * as store from './store.js';
import { NextAudioBuffer } from './audio-buffer.js';
import {
  audioHasHeadroom,
  bufferedAhead,
  mediaWarmHeadroom,
  KEEP_WARM_AFTER_PAUSE_MS,
  prefersAac,
  seamlessHandoffWindow,
  stallBudget,
} from './playback-policy.js';
import { YouTubeEmbedPlayer } from './yt-embed.js';
import * as sponsor from './sponsorblock.js';
import { telemetry } from './playback-telemetry.js';
import { bufferEngine, classifyFailure, inspectSeek } from './buffer-engine.js';
import { predictUpcoming, SkipTracker, ActivationTracker } from './predictive-pipeline.js';
import { router, isVerifiedEquivalent } from './source-router.js';
import { memoryEngine } from './memory-engine.js';
import { effectiveMixSeconds, orderForMix, runCrossfade, MIX_STYLE_IDS, MIX_CURVES } from './automix.js';
import { SpotifyPlaybackProvider } from './playback/spotify-provider.js';
import { connectivity } from './connectivity.js';

export { connectivity };

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

function configureAudioElement(media) {
  if (!media) return media;
  media.playsInline = true;
  media.setAttribute?.('playsinline', '');
  media.setAttribute?.('webkit-playsinline', '');
  media.setAttribute?.('x-webkit-airplay', 'allow');
  try { media.disableRemotePlayback = false; } catch { /* read-only in some environments */ }
  return media;
}

let audioHost = null;
function ensureAudioAttached(media) {
  if (!media || typeof globalThis.document === 'undefined' || !globalThis.document.body?.appendChild) return;
  try {
    if (!audioHost || !audioHost.isConnected) {
      audioHost = globalThis.document.getElementById?.('spotplusAudioHost') || globalThis.document.createElement?.('div');
      if (!audioHost) return;
      audioHost.id = 'spotplusAudioHost';
      audioHost.setAttribute?.('aria-hidden', 'true');
      if (audioHost.style) {
        audioHost.style.position = 'fixed';
        audioHost.style.width = '1px';
        audioHost.style.height = '1px';
        audioHost.style.opacity = '0';
        audioHost.style.pointerEvents = 'none';
        audioHost.style.overflow = 'hidden';
        audioHost.style.left = '-9999px';
        audioHost.style.top = '0';
      }
      globalThis.document.body.appendChild(audioHost);
    }
    if (media.parentNode !== audioHost && typeof audioHost.appendChild === 'function') {
      audioHost.appendChild(media);
    }
  } catch { /* mocked DOM in tests */ }
}

let audio = configureAudioElement(new Audio());
audio.preload = 'auto';
ensureAudioAttached(audio);
export let el = audio;
connectivity.bindMedia(audio);

let airPlayActive = false;
export const isAirPlayActive = () => airPlayActive || !!audio?.webkitCurrentPlaybackTargetIsWireless || connectivity.state.airPlayActive;
export const isWirelessOutputActive = () => isAirPlayActive() || connectivity.state.wirelessActive;
export const canAirPlay = () => typeof audio?.webkitShowPlaybackTargetPicker === 'function';
export function showAirPlayPicker() {
  if (!canAirPlay()) return false;
  configureAudioElement(audio);
  ensureAudioAttached(audio);
  connectivity.bindMedia(audio);
  try {
    audio.webkitShowPlaybackTargetPicker();
    return true;
  } catch {
    return false;
  }
}
export async function showWirelessOutputPicker() {
  configureAudioElement(audio);
  ensureAudioAttached(audio);
  connectivity.bindMedia(audio);
  return connectivity.openWirelessPicker();
}

const listeners = { state: new Set(), time: new Set(), error: new Set(), notice: new Set(), 'effects-skipped': new Set() };
export const on = (ev, fn) => listeners[ev].add(fn);
/** Every media element the player uses (current + preloaded next). */
export const mediaElements = () => [audio, nextBuffer.spare];
/* Effects hooks (set by fx.js): which elements are routed through effects, and whether effects are on. */
let effectsOn = () => false, isCaptured = () => false, prepareElement = async () => {}, corsKnown = () => undefined;
let canWebAudioCrossfade = () => false, crossfadeElements = () => null, syncPlaybackState = () => {};
export function setEffectsHooks(hooks) {
  ({
    effectsOn,
    isCaptured,
    prepareElement,
    corsKnown,
    canWebAudioCrossfade,
    crossfadeElements,
    syncPlaybackState,
  } = { effectsOn, isCaptured, prepareElement, corsKnown, canWebAudioCrossfade, crossfadeElements, syncPlaybackState, ...hooks });
}
// A plain element held in reserve (unlocked on the first tap, never routed through effects) for songs whose
// server doesn't allow effects. A routed element would play them silently.
let plainSpare = null;
/* Smart Radio + learning hooks (set by the app). */
let continueQueue = null, onSkip = () => {}, onFinish = () => {}, resumeAt = () => 0;
export function setQueueHooks(hooks) { ({ continueQueue = continueQueue, onSkip = onSkip, onFinish = onFinish, resumeAt = resumeAt } = hooks); }
/* Mix / AutoMix: equal-power DJ transitions via Web Audio (works on iPhone/iPad!) or 60fps element volume. */
let mixSeconds = 0, mixStyle = 'smart', mixCurve = 'equal-power', mixing = false, activeCrossfade = null;
const elementVolumeSupported = (() => { try { const a = new Audio(); a.volume = 0.5; return a.volume === 0.5; } catch { return false; } })();
const webAudioSupported = !!(globalThis.AudioContext || globalThis.webkitAudioContext);
export const crossfadeSupported = elementVolumeSupported || webAudioSupported;
export function setAutoMix(seconds, style, curve) {
  mixSeconds = crossfadeSupported ? Math.max(0, Math.min(12, Number(seconds) || 0)) : 0;
  if (typeof style === 'string' && MIX_STYLE_IDS.includes(style)) mixStyle = style;
  if (typeof curve === 'string' && MIX_CURVES.some((c) => c.id === curve)) mixCurve = curve;
  emit('state');
}
export function mixConfig() {
  return {
    enabled: mixSeconds > 0,
    seconds: mixSeconds,
    style: mixSeconds > 0 ? mixStyle : 'off',
    preferredStyle: mixStyle,
    curve: mixCurve,
    supported: crossfadeSupported,
    elementVolume: elementVolumeSupported,
    webAudio: webAudioSupported,
    active: mixing,
  };
}
/** Returns true when a stream source is known to serve CORS headers suitable for zero-reload Web Audio mixing. */
function sourceAllowsCors(source) {
  if (!source?.url) return false;
  if (corsKnown(source.url) === true) return true;
  if (source.url.startsWith('blob:')) return true;
  return ['ytrelay', 'offline-blob', 'jiosaavn', 'audius'].includes(source.kind);
}
function cancelActiveCrossfade() {
  if (!activeCrossfade) return;
  const cf = activeCrossfade;
  activeCrossfade = null;
  try { cf.cancel(); } catch { /* ignore */ }
}
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
export const isSpotifyOfficial = () => state.source?.kind === 'spotify-official' && spotifyPlayback.active;
export const isPlaying = () => (isSpotifyOfficial() ? !spotifyPlayback.paused : yt.active ? !yt.paused : (!audio.paused && isRealSrc())) && !!current();
// YouTube's audio files are built for streaming (fragmented MP4/WebM), and Safari guesses their length from the
// file size: 6-9 minutes for a 3-minute song. For relay songs YouTube already told us the real length, so the
// progress bar, the lock screen, SponsorBlock and crossfade use that. The song still ends when its audio does.
const knownLength = () => (state.source?.kind === 'ytrelay' && Number(state.source.duration) > 0 ? Number(state.source.duration) : 0);
const mediaLength = () => knownLength() || (isFinite(audio.duration) && audio.duration > 0 ? audio.duration : 0);
export const duration = () => (isSpotifyOfficial() ? (spotifyPlayback.duration > 0 ? spotifyPlayback.duration : current()?.duration || 0) : yt.active ? (isFinite(yt.duration) && yt.duration > 0 ? yt.duration : current()?.duration || 0) : (isRealSrc() && mediaLength() ? mediaLength() : current()?.duration || 0));
export const position = () => (isSpotifyOfficial() ? spotifyPlayback.currentTime : yt.active ? yt.currentTime : (audio.currentTime || 0));
export const isPaused = () => (isSpotifyOfficial() ? spotifyPlayback.paused : yt.active ? yt.paused : audio.paused);
export const canSeek = () => !state.loading && !state.error && (isSpotifyOfficial() ? spotifyPlayback.active : yt.active ? yt.ready : isRealSrc());
export function pause() {
  userPaused = true;
  pendingPlay = false;
  continuity.intent = 'paused';
  continuity.pauseReason = 'user';
  cancelActiveCrossfade();
  if (state.loading) {
    cancelLoad?.abort();
    ++token;
    clearStall();
    setPhase(STATES.IDLE);
  }
  if (isSpotifyOfficial()) spotifyPlayback.pause();
  else if (yt.active) yt.pause();
  else audio.pause();
  syncPlaybackState(false);
  silenceOthers();
}
export function hideEmbed(hidden = true) { state.ytHidden = !!hidden; emit('state'); }
export const getContinuityState = () => ({
  ...continuity,
  playing: isPlaying(),
  phase: state.phase,
  loading: state.loading,
  wireless: isWirelessOutputActive(),
});
export const getMetrics = () => ({
  phase: state.phase,
  continuity: getContinuityState(),
  connectivity: connectivity.getSnapshot(),
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
const continuity = {
  intent: 'idle', // 'idle' | 'playing' | 'paused'
  pauseReason: 'none', // 'none' | 'user' | 'visibility' | 'os-interruption' | 'route-change' | 'loading' | 'ended' | 'error' | 'offline'
  lastLifecycleEvent: '',
};
const nextBuffer = new NextAudioBuffer();
const skipTracker = new SkipTracker();
const activation = new ActivationTracker();
let unlockedPrimary = audio;
let prefetchTimer = 0, warmGeneration = 0, startedAt = 0, activeGen = 0, pauseClearTimer = 0;
let volumeLevel = 1;
let stallTimer = null;
let stallUiTimer = null;
let liveAttempt = 0;
let mediaTicket = 0;
let suppressError = false;
let previewUpgradeTimer = null, previewUpgradeControl = null, previewUpgradeTries = 0;

/** Bounded exponential backoff with ±20% jitter for transient playback retries. */
export function retryBackoffMs(attempt = 1, { baseMs = 650, maxMs = 3500, rng = Math.random } = {}) {
  const exp = Math.min(maxMs, baseMs * (2 ** Math.max(0, attempt - 1)));
  const jitter = 0.8 + (Math.max(0, Math.min(1, rng())) * 0.4);
  return Math.round(Math.min(maxMs, exp * jitter));
}

function clearStall() {
  clearTimeout(stallTimer);
  stallTimer = null;
  clearTimeout(stallUiTimer);
  stallUiTimer = null;
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
  if (typeof url === 'string' && url.includes('/yta?')) telemetry.recordRelayRequest('yta-get');
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
  const netProfile = bufferEngine.profile(navigator.connection);
  const adaptiveMs = netProfile.stallTimeoutMs;
  const startPos = audio.currentTime || 0;
  const startBuf = bufferedAhead(audio);
  const midSong = startPos > 0.35;
  const budgetMs = stallBudget(startPos);
  let ms = (state.source?.fast || state.source?.alternatives?.length)
    ? Math.max(2500, Math.min(budgetMs, adaptiveMs + 1500))
    : Math.max(budgetMs, adaptiveMs);
  // Mid-song stalls should give cellular & backgrounded networks time to recover natively instead of tearing down <audio>.
  if (midSong) {
    ms = Math.max(ms, netProfile.condition === 'unstable' ? 8500 : 7000);
    if (globalThis.document?.hidden) ms = Math.max(ms, 9500);
  }
  // The relay may try up to four uploads of the song before the first byte (each refusal takes about two
  // seconds), so its first start gets longer before it counts as stuck.
  // A region that already had the song ready (warmed) should answer at once, so it gets less time.
  const wait = state.source?.kind === 'ytrelay' && !midSong ? (state.source.warm ? 5000 : Math.max(ms, 12000)) : ms;
  stallTimer = setTimeout(() => {
    stallTimer = null;
    if (generation !== token || !pendingPlay || userPaused || !isRealSrc()) return;
    const nowPos = audio.currentTime || 0;
    const nowBuf = bufferedAhead(audio);
    // If playback position moved or buffer actively grew during the wait, data is flowing — don't kill the song.
    if (midSong && (nowPos > startPos + 0.1 || nowBuf > startBuf + 1.0)) {
      if (!audio.paused && (audio.readyState || 0) >= 2) { clearStall(); return; }
      watchStall();
      return;
    }
    if ((audio.readyState || 0) >= 2 && nowPos > 0.35 && !audio.paused) { clearStall(); return; }
    failAttempt(ticket);
  }, wait);
  stallTimer.unref?.();
}

function playAssigned(nextSource) {
  state.source = nextSource;
  state.error = null;
  // A preview, AirPlay stream, or non-effects failover must not inherit a restrictive CORS mode from a failed link.
  if (nextSource.preview || !effectsOn() || isAirPlayActive()) audio.removeAttribute('crossorigin');
  ensureAudioAttached(audio);
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
        connectivity.bindMedia(audio);
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
  if (!t || !state.source?.preview || state.offline || ['preview', 'deezer'].includes(store.getSettings().source) || previewUpgradeTries >= 2) return;
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
        if (!(await verifyFullAudio(candidate, control.signal, t.duration || 0))) {
          api.reportPlaybackSource(candidate, false);
          continue;
        }
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

  // When offline on a remote stream, pause retries and wait cleanly for the 'online' recovery event.
  if (!state.offline && !cur.local && globalThis.navigator?.onLine === false) {
    continuity.pauseReason = 'offline';
    telemetry.endRecovery(recStart, false);
    setPhase(STATES.STALLED);
    emit('state');
    return;
  }

  api.reportPlaybackSource(failed, false);
  if (diagnosis.retryMode === 'refresh-url') {
    memoryEngine.forgetStream(api.streamKey(cur));
  }
  const relayFailed = failed?.kind === 'ytrelay';
  // Automatic: when every region has just refused the song (all asked at once, each with every upload), more
  // relay tries would only add seconds of silence, so the backup plays it now.
  if (relayFailed) api.checkWorkerLimit?.();
  const refusedEverywhere = relayFailed && store.getSettings().source === 'auto' && api.relayRefusedEverywhere?.(cur.id);
  if (!state.offline && !cur.local && failed && !failed.preview && !refusedEverywhere && !api.workerLimited?.() && errRetries < (relayFailed ? (store.getSettings().source === 'auto' ? api.relayRegionsUp().length : 6) : 2)) {
    errRetries++;
    // A relay stream that drops is usually YouTube refusing that one upload for a moment: try again from the
    // same spot, preferring another upload of the song, instead of giving up on the relay for this song.
    const retryRelay = relayFailed;
    // Rest the region that was refused (the next try goes through another one); once every region has been
    // tried for this song, also move on to another upload.
    if (retryRelay) { api.refuseRelayRegion?.(cur.id, failed.relayRegion); api.restRelayRegion(failed.relayRegion, 15e3); api.noteRelayRegion(failed.relayRegion, false); if (errRetries >= api.relayRegionsUp().length) api.avoidRelayVideo(failed.videoId); memoryEngine.forgetStream(api.streamKey(cur)); }
    else if (failed.instance) skipList.push(failed.instance);
    telemetry.endRecovery(recStart, true);
    // Asking YouTube again for an upload it just refused: use bounded exponential backoff with jitter.
    const again = retryRelay && api.relayAllAvoided((failed.candidates || [failed.videoId]).map((id) => ({id})));
    const at = audio.currentTime || 0, mine = token;
    if (again) {
      const waitMs = retryBackoffMs(errRetries, { baseMs: 900, maxMs: 3500 });
      const retryTimer = setTimeout(() => { if (mine === token && current() === cur && !userPaused) load({ keepSkip: true, startAt: at }); }, waitMs);
      retryTimer.unref?.();
    } else load({ keepSkip: true, startAt: at });
    return;
  }

  // Automatic: YouTube refused every upload tried, so let the other full-song sources have a go.
  if (relayFailed && !state.offline && !cur.local && failed.instance && !skipList.includes(failed.instance) && store.getSettings().source === 'auto') {
    skipList.push(failed.instance);
    telemetry.endRecovery(recStart, true);
    load({ keepSkip: true, startAt: audio.currentTime || 0 });
    return;
  }

  // No 30-second clips in Automatic: when no full song can be found, say so and move on to the next song.
  if (!state.offline && !cur.local && store.getSettings().source === 'auto') {
    telemetry.endRecovery(recStart, true);
    skipUnavailable(cur);
    return;
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
  // Never run dual-element crossfade while backgrounded/locked so iOS keeps the single-element audio session intact.
  if (!mixSeconds || mixing || globalThis.document?.hidden || state.repeat === 'one' || audio.paused || !mediaLength()) return;
  const curTrack = current();
  const nextTrack = state.queue[state.index + 1];
  if (!curTrack || !nextTrack || state.index >= state.queue.length - 1) return;
  const spokenTrack = !!(curTrack.direct || nextTrack.direct);
  const overlap = effectiveMixSeconds({
    seconds: mixSeconds,
    style: mixStyle,
    currentDuration: mediaLength(),
    nextDuration: nextTrack.duration || 0,
    spoken: spokenTrack,
  });
  if (!overlap) return;
  const left = mediaLength() - audio.currentTime;
  if (left > overlap || left < 0.75) return;
  const entry = nextBuffer.entry;
  const minReady = left <= 3 ? 2 : 3;
  if (!entry || entry.key !== api.streamKey(nextTrack) || (entry.media.readyState || 0) < minReady) return;
  // Require either hardware-timed Web Audio crossfade (works on iPhone/iPad!) or writable element volume (with effects off).
  const canWebAudio = canWebAudioCrossfade(audio, entry.media);
  if (!canWebAudio && (!elementVolumeSupported || effectsOn())) return;
  mixing = true;
  onFinish(curTrack);
  state.index++;
  errRetries = 0;
  load({ mixSeconds: Math.max(1, Math.min(overlap, left)), mixStyle, trigger: 'automix' }).finally(() => { mixing = false; });
}

/** InstantPlay: when AutoMix is off or couldn't blend, hand off cleanly to a ready Player B right before 'ended'. */
function maybeSeamless() {
  if (mixing || effectsOn() || globalThis.document?.hidden || state.repeat === 'one' || state.index >= state.queue.length - 1) return;
  const nextTrack = state.queue[state.index + 1];
  const key = nextTrack && api.streamKey(nextTrack);
  if (!key || !nextBuffer.isReady(key, 2) || !seamlessHandoffWindow(audio, mediaLength())) return;
  mixing = true;
  onFinish(current());
  state.index++;
  errRetries = 0;
  load({ trigger: 'seamless-handoff' }).finally(() => { mixing = false; });
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
    state.needsTap = ['youtube', 'auto'].includes(store.getSettings().source) && !!needed;
    if (state.needsTap) state.ytHidden = false;
    emit('state');
  },
  onCandidateError: (id, code) => {
    // 101/150: the label blocked this upload outside YouTube. 100: removed.
    if ([100, 101, 150].includes(code)) api.markEmbedBlocked?.(id);
  },
  onPlaying: () => {
    if (ytToken !== token) return;
    api.rememberEmbed?.(current(), yt.videoId);
    api.setEmbedUnlocked?.(true);
    setPhase(STATES.PLAYING);
    state.needsTap = false;
    telemetry.markStage(ytToken, 'firstAudible', { sourceKind: 'youtube-embed', instance: 'youtube.com' });
    if (state.startupMs == null && startedAt) state.startupMs = Math.round(performance.now() - startedAt);
    if ('mediaSession' in navigator) { navigator.mediaSession.playbackState = 'playing'; updateSession(current()); }
    window.dispatchEvent?.(new Event('spotplus:music-play'));
    emit('state');
    // Get the next song ready in the hidden player while this one plays.
    prefetch();
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
  onError: async (msg) => {
    if (ytToken !== token) return;
    // Every upload we had was blocked: look wider (lyric videos, music videos, live) before any clip.
    const t = current(), my = token;
    if (t && !embedExtended && api.moreEmbedCandidates) {
      embedExtended = true;
      const more = await api.moreEmbedCandidates(t, yt.candidates).catch(() => []);
      if (my !== token || ytToken !== my) return;
      if (more.length && yt.load(more, { startAt: 0, autoplay: pendingPlay, volume: volumeLevel * (ducks.size ? .18 : 1) })) return;
    }
    fallbackToPreview(msg);
  },
});
let embedExtended = false;

let unavailableRun = 0;
/** The full song could not be found anywhere: tell the listener and play the next song instead of a clip. */
function skipUnavailable(t) {
  const gen = token;
  yt.stop();
  ytToken = 0;
  telemetry.markFailed(gen);
  emit('notice', `Couldn’t find the full version of “${t.title}”. Skipping.`);
  // Stop after a few in a row (likely offline or every server down) instead of racing through the queue.
  if (++unavailableRun <= 3 && state.index < state.queue.length - 1) { next(false); return; }
  unavailableRun = 0;
  setPhase(STATES.FAILED);
  state.needsTap = false;
  state.error = `Couldn’t find the full version of “${t.title}”. Try again in a moment.`;
  emit('error', state.error);
  emit('state');
}
export async function fallbackToPreview(reason = '', { allowPreview = false } = {}) {
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

let spotifyToken = 0;
export const spotifyPlayback = new SpotifyPlaybackProvider({
  getSettings: () => store.getSettings(),
  onPlay: () => {
    if (spotifyToken !== token) return;
    setPhase(STATES.PLAYING);
    if ('mediaSession' in navigator) navigator.mediaSession.playbackState = 'playing';
    emit('state');
    positionState();
  },
  onPause: () => {
    if (spotifyToken !== token) return;
    if ('mediaSession' in navigator) navigator.mediaSession.playbackState = 'paused';
    emit('state');
    save();
  },
  onTime: (t) => {
    if (spotifyToken !== token) return;
    if (t > 0) restorePos = 0;
    emit('time');
    const now = Date.now();
    if (now - lastPos > 1000) { lastPos = now; positionState(); }
    if (now - lastSave > 10000) { lastSave = now; save(); }
  },
  onEnded: () => {
    if (spotifyToken !== token) return;
    if (userPaused) {
      setPhase(STATES.IDLE);
      emit('state');
      return;
    }
    if (state.repeat === 'one') {
      state.playbackId = (state.playbackId || 0) + 1;
      pendingPlay = true;
      userPaused = false;
      spotifyPlayback.seek(0);
      spotifyPlayback.play();
      emit('state');
    } else {
      onFinish(current());
      next(false);
    }
  },
  onError: (msg) => {
    if (spotifyToken !== token) return;
    spotifyPlayback.stop();
    spotifyToken = 0;
    const t = current();
    if (t) {
      emit('notice', `Spotify playback interrupted (${msg || 'error'}) — switching to Spot+ YouTube Relay.`);
      load({ keepSkip: true, startAt: position() || 0, skipSpotify: true, trigger: 'spotify-fallback' });
    }
  },
});

const ducks = new Set();
export function duck(reason, enabled) {
  if (enabled) ducks.add(reason); else ducks.delete(reason);
  const v = volumeLevel * (ducks.size ? .18 : 1);
  audio.volume = v;
  yt.setVolume(v);
  spotifyPlayback.setVolume(v);
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
  configureAudioElement(element);
  if (element.src) return;
  element.src = SILENT;
  element.play().then(() => {
    activation.markUnlocked(element);
    if (element.src === SILENT) element.pause();
  }).catch(() => {});
}
let connectionsWarmed = false;
function unlock() {
  if (!connectionsWarmed) {
    connectionsWarmed = true;
    api.warmConnections();
  }
  ensureAudioAttached(audio);
  unlockElement(nextBuffer.spare);
  if (!plainSpare) {
    plainSpare = configureAudioElement(new Audio());
    plainSpare.preload = 'auto';
    bindAudio(plainSpare);
    unlockElement(plainSpare);
  } else {
    unlockElement(plainSpare);
  }
  const sparesReady = activation.isUnlocked(nextBuffer.spare) && activation.isUnlocked(plainSpare);
  if (audio.src) {
    if (sparesReady) window.removeEventListener?.('pointerdown', unlock, { capture: true });
    return;
  }
  audio.src = SILENT;
  audio.play().then(() => {
    activation.markUnlocked(audio);
    unlockedPrimary = audio;
    if (audio.src === SILENT) audio.pause();
    if (activation.isUnlocked(nextBuffer.spare) && activation.isUnlocked(plainSpare)) {
      window.removeEventListener?.('pointerdown', unlock, { capture: true });
    }
  }).catch(() => {});
}
window.addEventListener('pointerdown', unlock, { capture: true, passive: true });
const isRealSrc = () => audio.src && !audio.src.startsWith('data:');
// Leaving the app must never stop the music. (iPhone fires 'pagehide' when a home-screen app is only
// switched away from, so pausing there cut songs off. A truly closed app is ended by iOS itself.)
window.addEventListener('pagehide', () => {
  continuity.lastLifecycleEvent = 'pagehide';
  telemetry.noteListeningStop();
});

let lastVisibilityChangeAt = 0;
let visibilityResumeAttempted = false;

/**
 * Hand playback from a Web Audio-captured element (or CORS-tagged element) to a plain, uncaptured element
 * while overlapping briefly so exiting the app on iOS or switching to AirPlay never causes a silence gap.
 */
function handOffToPlainElement(old, plain) {
  const at = old.currentTime || 0;
  const wasPlaying = !old.paused;
  const src = old.currentSrc || old.src;
  configureAudioElement(plain);
  plain.removeAttribute('crossorigin');
  plain.preload = 'auto';
  plain.volume = old.volume;
  ensureAudioAttached(plain);
  // A media fragment starts the new element at the same second without waiting for metadata.
  plain.src = `${src.split('#')[0]}#t=${Math.max(0, at + 0.05).toFixed(2)}`;
  audio = plain;
  el = audio;
  bindAudio(audio);
  connectivity.bindMedia(audio);
  let retired = false;
  const retireOld = () => {
    if (retired) return;
    retired = true;
    clearTimeout(retireTimer);
    plain.removeEventListener?.('playing', retireOld);
    plain.removeEventListener?.('canplay', retireOld);
    try { old.pause(); } catch { /* ignore */ }
    old.removeAttribute?.('src');
    try { old.load?.(); } catch { /* ignore */ }
    syncPlaybackState(false);
  };
  const retireTimer = setTimeout(retireOld, 260);
  retireTimer.unref?.();
  if (wasPlaying) {
    plain.addEventListener?.('playing', retireOld, { once: true });
    plain.addEventListener?.('canplay', retireOld, { once: true });
    const started = audio.play();
    started?.catch?.(() => retireOld());
  } else {
    retireOld();
  }
  emit('state');
  return true;
}

/**
 * iPhone pauses Web Audio (the effects engine) when the app goes to the background, which silences a song
 * routed through effects. When that is about to happen on iOS, hand the song to a plain, already-unlocked
 * element at the same spot so it keeps playing seamlessly. Android & desktop keep Web Audio alive in the
 * background, so they do not hand off and avoid any brief audio dip when switching apps.
 */
export function handOffForBackground() {
  if (!isCaptured(audio) || audio.paused || !isRealSrc() || isEmbed() || !plainSpare) return false;
  const old = audio, plain = plainSpare;
  plainSpare = null;
  return handOffToPlainElement(old, plain);
}

/**
 * iOS AirPlay 2 outputs silence when audio is captured by Web Audio or carries a restrictive crossOrigin
 * attribute on a non-AirPlay-friendly pipeline. Automatically switch to an uncaptured plain DOM element.
 */
export function handOffForAirPlay() {
  if (!isRealSrc() || isEmbed() || isSpotifyOfficial()) return false;
  if (!isCaptured(audio) && !audio.crossOrigin) {
    configureAudioElement(audio);
    ensureAudioAttached(audio);
    connectivity.bindMedia(audio);
    return false;
  }
  const old = audio;
  const plain = plainSpare || configureAudioElement(new Audio());
  plainSpare = null;
  return handOffToPlainElement(old, plain);
}
connectivity.setOnWirelessActive(() => handOffForAirPlay());
connectivity.onChange(() => emit('state'));

function recoverAfterNetworkOrResume(trigger) {
  if (continuity.intent !== 'playing' || userPaused || !current() || isEmbed() || isSpotifyOfficial()) return;
  if (state.offline || current()?.local) {
    if (audio.paused && !audio.ended && isRealSrc()) {
      telemetry.recordContinuityRecovery();
      audio.play().catch(() => {});
    }
    return;
  }
  const needsReload = state.phase === STATES.FAILED || state.phase === STATES.STALLED || continuity.pauseReason === 'offline' || (isRealSrc() && linkExpired());
  if (needsReload && !state.loading) {
    telemetry.recordContinuityRecovery();
    const at = position() || restorePos || 0;
    memoryEngine.forgetStream(api.streamKey(current()));
    errRetries = 0;
    load({ keepSkip: true, startAt: at, trigger });
  } else if (audio.paused && !audio.ended && isRealSrc() && !state.loading && (continuity.pauseReason === 'visibility' || continuity.pauseReason === 'os-interruption')) {
    telemetry.recordContinuityRecovery();
    audio.play().catch(() => {});
  }
}

globalThis.document?.addEventListener?.('visibilitychange', () => {
  lastVisibilityChangeAt = performance.now();
  visibilityResumeAttempted = false;
  continuity.lastLifecycleEvent = globalThis.document.hidden ? 'hidden' : 'visible';
  if (globalThis.document.hidden) {
    // Only iOS suspends Web Audio in the background; avoid unnecessary app-switch hiccups on Android/Desktop.
    if (prefersAac()) handOffForBackground();
    // Make sure the next song is prewarmed before the current song ends while screen is locked.
    if (isPlaying() && !state.loading && !nextBuffer.entry) prefetch();
  } else {
    // Reconcile Media Session, connectivity, and UI with true audio state without restarting playback.
    sessionHandlers();
    positionState();
    if (continuity.intent === 'playing' && !userPaused && continuity.pauseReason === 'visibility' && audio.paused && !audio.ended && isRealSrc() && !state.loading) {
      telemetry.recordContinuityRecovery();
      audio.play().catch(() => {});
    }
    emit('state');
  }
});

globalThis.window?.addEventListener?.('pageshow', (e) => {
  continuity.lastLifecycleEvent = e?.persisted ? 'pageshow-bfcache' : 'pageshow';
  connectivity.bindMedia(audio);
  sessionHandlers();
  positionState();
  emit('state');
});

globalThis.document?.addEventListener?.('freeze', () => {
  continuity.lastLifecycleEvent = 'freeze';
  if (continuity.intent === 'playing' && !userPaused) continuity.pauseReason = 'os-interruption';
});

globalThis.document?.addEventListener?.('resume', () => {
  continuity.lastLifecycleEvent = 'resume';
  recoverAfterNetworkOrResume('lifecycle-resume');
});

globalThis.window?.addEventListener?.('offline', () => {
  continuity.lastLifecycleEvent = 'offline';
  if (continuity.intent === 'playing' && !state.offline && !current()?.local) {
    continuity.pauseReason = 'offline';
  }
});

globalThis.window?.addEventListener?.('online', () => {
  continuity.lastLifecycleEvent = 'online';
  recoverAfterNetworkOrResume('network-online');
});

try {
  globalThis.navigator?.connection?.addEventListener?.('change', () => {
    if (globalThis.navigator?.onLine !== false) recoverAfterNetworkOrResume('network-change');
  });
} catch { /* unsupported */ }

/* ---------- Loading a track ---------- */
async function load(opts = {}) {
  const t = current();
  if (!t) return;
  // Look the song up on the backup while YouTube is being asked, so a refusal switches over without waiting.
  if (store.getSettings().source === 'auto') api.prefetchBackup(t);
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
  spotifyPlayback.stop();
  spotifyToken = 0;
  state.needsTap = false;
  state.ytHidden = false;
  startedAt = performance.now();
  state.startupMs = null;
  cancelLoad?.abort();
  cancelLoad = new AbortController();
  const controller = cancelLoad;
  pendingPlay = opts.autoplay !== false;
  userPaused = false;
  continuity.intent = pendingPlay ? 'playing' : 'paused';
  continuity.pauseReason = 'none';
  ++warmGeneration;
  clearTimeout(prefetchTimer);
  api.cancelPrewarm(t);

  const inBackground = !!globalThis.document?.hidden;
  const isIOS = prefersAac();
  const allowWarmTake = !opts.keepSkip && (!effectsOn() || !!opts.mixSeconds || inBackground) && !isAirPlayActive();
  const streamKeyForTrack = allowWarmTake ? api.streamKey(t) : '';
  const warmed = streamKeyForTrack ? nextBuffer.take(streamKeyForTrack) : null;
  // On iOS Safari, secondary <audio> elements often stay at readyState 0 until played; swapping to a cold
  // element spins up a brand new AVPlayer (+300-600ms lag). Reuse the hot active element with the warmed URL instead.
  const reuseHotOnIOS = isIOS && !!warmed && !opts.mixSeconds && (warmed.media.readyState || 0) < 2 && !isCaptured(audio);
  const bgSource = (inBackground || reuseHotOnIOS) && !isCaptured(audio)
    ? (warmed?.source || (streamKeyForTrack && !t.local ? memoryEngine.getStream(streamKeyForTrack) : null))
    : null;
  const reuseActiveElement = (inBackground || reuseHotOnIOS) && !isCaptured(audio);
  telemetry.beginGeneration(my, {
    trackId: t.id,
    trigger: opts.keepSkip ? 'recover' : (opts.trigger || 'play'),
    prepared: !!(warmed || bgSource),
    cold: !warmed && !bgSource && !t.local,
  });

  // Always cancel any earlier in-flight crossfade before starting a new transition or skip.
  cancelActiveCrossfade();

  if (reuseActiveElement) {
    // Keep the hot active <audio> element alive so iOS AVAudioSession & Lock Screen stay uninterrupted.
    if (warmed?.media && warmed.media !== audio) nextBuffer.recycle(warmed.media);
    else nextBuffer.clear();
  } else {
    if (!(opts.mixSeconds && warmed)) audio.pause();
    if (warmed) {
      const previous = audio, target = volumeLevel * (ducks.size ? .18 : 1);
      audio = configureAudioElement(warmed.media);
      el = audio;
      ensureAudioAttached(audio);
      bindAudio(audio);
      connectivity.bindMedia(audio);
      if (opts.mixSeconds) {
        // Spotify-style equal-power crossfade: uses hardware-timed Web Audio GainNodes (+ DJ bass-swap EQ)
        // on iPhone/iPad & CORS streams, or smooth 60fps requestAnimationFrame volume ramps otherwise.
        const useWebAudio = !isAirPlayActive() && canWebAudioCrossfade(previous, audio);
        if (useWebAudio) {
          audio.volume = target;
        }
        const cleanupOut = (outEl) => {
          if (!outEl) return;
          outEl.pause();
          outEl.removeAttribute('src');
          outEl.load();
        };
        activeCrossfade = runCrossfade({
          outgoing: previous,
          incoming: audio,
          targetVolume: target,
          seconds: opts.mixSeconds,
          style: opts.mixStyle || mixStyle,
          curve: mixCurve,
          elementVolumeSupported,
          webAudioFade: useWebAudio ? crossfadeElements : null,
          onCleanupOutgoing: cleanupOut,
        });
        activeCrossfade.done.finally(() => { activeCrossfade = null; });
        const spare = configureAudioElement(new Audio());
        spare.preload = 'none';
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
          const freshSpare = configureAudioElement(new Audio());
          freshSpare.preload = 'none';
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
      // If effects were turned off (or AirPlay is active) while holding a Web Audio-captured element,
      // swap cleanly back to a plain element on track change so normal playback stays lightweight & AirPlay-safe.
      if (isCaptured(audio) && (!effectsOn() || isAirPlayActive())) {
        const previous = audio;
        previous.pause();
        previous.removeAttribute('src');
        previous.load();
        syncPlaybackState(false);
        audio = configureAudioElement(plainSpare || new Audio());
        plainSpare = null;
        el = audio;
        audio.preload = 'auto';
        audio.volume = volumeLevel * (ducks.size ? .18 : 1);
        ensureAudioAttached(audio);
        bindAudio(audio);
        connectivity.bindMedia(audio);
      }
      // Do NOT run removeAttribute('src') + audio.load() between normal track skips:
      // blanking src tears down iOS AVAudioSession and causes Lock Screen/Control Center flicker & skip lag.
    }
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
  setPhase((warmed || bgSource) ? STATES.PREPARING : STATES.RESOLVING);
  emit('state');
  emit('time');
  updateSession(t);
  sessionHandlers();
  if ('mediaSession' in navigator) {
    navigator.mediaSession.playbackState = (pendingPlay && !userPaused) ? 'playing' : 'paused';
  }
  positionState(restorePos);

  try {
    let src;
    const shouldCheckOffline = !warmed && !bgSource && (t.local || store.getDownloads().some((d) => d.id === t.id));
    const blob = shouldCheckOffline ? await offlineBlob(t.id) : null;
    if (my !== token) return;

    if (bgSource) {
      if (objUrl) { URL.revokeObjectURL(objUrl); objUrl = null; }
      state.source = bgSource;
      src = bgSource.url;
      telemetry.markStage(my, 'resolveEnd', { cacheLayer: warmed ? 'warmed-buffer' : 'memory-cache', sourceKind: bgSource.kind, instance: bgSource.instance, cold: false, prepared: true });
    } else if (warmed) {
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
      // Official Spotify Playback path when selected by the listener; failures fall back cleanly to YouTube Relay.
      if (!t.local && !t.direct && store.getSettings().source === 'spotify' && !opts.sourceOverride && !opts.skipSpotify) {
        try {
          const spSource = await spotifyPlayback.loadAndPlay(t, {
            startAt: opts.startAt || 0,
            autoplay: pendingPlay,
            volume: volumeLevel * (ducks.size ? .18 : 1),
          });
          if (my !== token) { spotifyPlayback.stop(); return; }
          audio.pause();
          audio.removeAttribute('src');
          audio.load();
          spotifyToken = my;
          state.source = spSource;
          setPhase(pendingPlay ? STATES.PLAYING : STATES.IDLE);
          failStreak = 0;
          store.addRecent(t);
          emit('state');
          emit('time');
          positionState();
          save();
          return;
        } catch (spErr) {
          if (my !== token) return;
          spotifyPlayback.stop();
          spotifyToken = 0;
          emit('notice', `Spotify Official Playback unavailable (${spErr?.message || 'check Settings'}) — playing via Spot+ YouTube Relay.`);
        }
      }
      telemetry.markStage(my, 'resolveStart');
      // Auto may fall back to YouTube's official player (full songs) before a 30-second preview.
      // No ads: YouTube's player (which plays the uploader's ads) is used only when chosen in Settings.
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
        embedExtended = false;
        telemetry.markStage(my, 'mediaInit', { sourceKind: 'youtube-embed', instance: 'youtube.com' });
        yt.load(r.videoIds || [r.videoId], { startAt: opts.startAt || 0, autoplay: pendingPlay, volume: volumeLevel * (ducks.size ? .18 : 1) });
        if (!pendingPlay) { setPhase(STATES.IDLE); }
        if (effectsOn()) emit('effects-skipped');
        upgradeFromEmbed(t, my, controller.signal);
        failStreak = 0;
        store.addRecent(t);
        emit('state');
        save();
        return;
      }
    }

    setPhase(STATES.PREPARING);
    if (!warmed || reuseActiveElement) {
      const airPlay = isAirPlayActive();
      if (isCaptured(audio) && (airPlay || globalThis.document?.hidden || !(await prepareElement(audio, src)))) {
        // This song's server doesn't allow effects (or AirPlay/background requires plain playback): switch to plain element.
        if (my !== token) return;
        const plain = configureAudioElement(plainSpare || new Audio());
        plainSpare = null;
        audio.removeAttribute('src');
        audio.load();
        syncPlaybackState(false);
        audio = plain;
        el = audio;
        ensureAudioAttached(audio);
        bindAudio(audio);
        connectivity.bindMedia(audio);
        audio.preload = 'auto';
        audio.volume = volumeLevel * (ducks.size ? .18 : 1);
        if (!airPlay) emit('effects-skipped');
      } else if (!isCaptured(audio) && !airPlay && effectsOn() && !inBackground) {
        await prepareElement(audio, src);
      } else if (!isCaptured(audio) && !airPlay && !inBackground && (corsKnown(src) === true || (mixSeconds > 0 && sourceAllowsCors(state.source)))) {
        // Pre-enable CORS on relay/offline/CORS streams when Mix is on so iOS Web Audio crossfades never reload mid-song.
        audio.crossOrigin = 'anonymous';
      } else if (!isCaptured(audio)) {
        audio.removeAttribute('crossorigin');
      }
      if (my !== token) return;
      ensureAudioAttached(audio);
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
            connectivity.bindMedia(audio);
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
    // Automatic never settles for a clip: a song with no full version anywhere is skipped, with a note.
    if (!state.offline && !t.local && !t.direct && store.getSettings().source === 'auto' && !opts.sourceOverride) { skipUnavailable(t); save(); return; }
    telemetry.markFailed(my);
    setPhase(STATES.FAILED);
    state.error = `Couldn’t play “${t.title}”. ${e.message}`;
    emit('state');
    emit('error', `Couldn't play “${t.title}”: ${e.message}`);
    failStreak++;
  }
  save();
}

/**
 * InstantPlay: a song may start on YouTube's player within a second. Meanwhile the lossless servers keep
 * looking; if one answers with the same recording, Spot+ crossfades to it at the same spot, mid-song.
 */
export const UPGRADE_FADE_MS = 900;
async function upgradeFromEmbed(t, my, signal) {
  if (store.getSettings().source !== 'auto' || !t || t.local || t.direct) return;
  let s = null;
  try { s = await api.resolveFull(t, { signal, cors: effectsOn() }); } catch { return; }
  if (!s || s.preview || my !== token || !isEmbed() || signal?.aborted) return;
  // Wait until YouTube has told us its length, then refuse a different cut (it would jump).
  for (let i = 0; i < 20 && !yt.duration && my === token && isEmbed(); i++) await new Promise(r => setTimeout(r, 250));
  const want = Number(t.duration) || 0;
  const len = Number(s.duration) || want;
  if (my !== token || !isEmbed() || !yt.duration || (len && Math.abs(len - yt.duration) > 2.5)) return;
  if (isCaptured(audio) && !(await prepareElement(audio, s.url))) return;
  if (!isCaptured(audio) && effectsOn()) await prepareElement(audio, s.url);
  if (my !== token || !isEmbed()) return;
  suppressError = true;
  audio.volume = 0;
  audio.preload = 'auto';
  audio.src = s.url;
  const ready = await new Promise(ok => {
    const done = v => { clearTimeout(timer); audio.removeEventListener('canplay', yes); audio.removeEventListener('error', no); ok(v); };
    const yes = () => done(true), no = () => done(false);
    const timer = setTimeout(() => done(false), 10000);
    audio.addEventListener('canplay', yes);
    audio.addEventListener('error', no);
  });
  if (!ready || my !== token || !isEmbed()) {
    if (my === token && isEmbed()) { audio.removeAttribute('src'); audio.load(); suppressError = false; }
    return;
  }
  const wasPlaying = !yt.paused;
  // Seek a hair ahead to cover the time the element needs to start.
  try { audio.currentTime = Math.max(0, Math.min((yt.currentTime || 0) + (wasPlaying ? 0.12 : 0), (mediaLength() || len) - 1)); } catch { /* keep 0 */ }
  mediaTicket = ++liveAttempt;
  suppressError = false;
  const level = () => volumeLevel * (ducks.size ? .18 : 1);
  const before = state.source;
  state.source = { ...s, cacheLayer: 'upgrade' };
  if (wasPlaying) {
    try { await audio.play(); } catch { state.source = before; audio.removeAttribute('src'); audio.load(); audio.volume = level(); return; }
  }
  if (my !== token) { audio.volume = level(); return; }
  const steps = 18;
  for (let i = 1; i <= steps && wasPlaying; i++) {
    await new Promise(r => setTimeout(r, UPGRADE_FADE_MS / steps));
    if (my !== token) break;
    const k = Math.sin((i / steps) * Math.PI / 2);
    audio.volume = level() * k;
    yt.setVolume(level() * Math.cos((i / steps) * Math.PI / 2));
  }
  audio.volume = level();
  yt.stop();
  if (my !== token) return;
  if (!wasPlaying) { pendingPlay = false; setPhase(STATES.IDLE); }
  api.reportPlaybackSource(state.source, true, { startupMs: state.startupMs || 0 });
  emit('state');
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
  // Use Math.max (never Math.min!) so unstable/normal connections build real buffered headroom before opening Player B.
  const needHeadroom = Math.max(netProfile.headroomSec, mediaWarmHeadroom(navigator.connection));
  const stageADelay = skipTracker.isRapidSkipping() ? 900 : Math.min(skipTracker.stageBDelayMs(), 260);

  const scheduleStageB = (source) => {
    const attemptStageB = () => {
      if (generation !== warmGeneration || !isPlaying() || state.loading || !source) return;
      if (source.kind === 'youtube-embed') { yt.preload(source.videoId); return; }
      const allowStageB = netProfile.preloadStageB && (!effectsOn() || mixSeconds > 0) && !isAirPlayActive() && !skipTracker.isRapidSkipping();
      if (!allowStageB) return;
      if (!isEmbed() && !audioHasHeadroom(audio, Math.max(3, needHeadroom - 1))) {
        prefetchTimer = setTimeout(attemptStageB, 1000);
        prefetchTimer.unref?.();
        return;
      }
      const wantCors = corsKnown(source.url) === true || (mixSeconds > 0 && sourceAllowsCors(source));
      nextBuffer.warm(api.streamKey(next), source, { cors: wantCors });
    };
    attemptStageB();
  };

  prefetchTimer = setTimeout(async () => {
    try {
      if (generation !== warmGeneration || !isPlaying() || state.loading) return;
      // Fast Stage A (especially critical on iPhone where navigator.connection is absent):
      // Pre-resolve and warm ONLY the immediate next track once the current song has >= 2s buffer or >= 0.4s playback.
      const stageAReady = isEmbed() || audioHasHeadroom(audio, 2) || (audio.currentTime || 0) >= 0.4;
      if (!stageAReady) {
        prefetchTimer = setTimeout(() => { if (generation === warmGeneration && isPlaying() && !state.loading) prefetch(); }, 650);
        prefetchTimer.unref?.();
        return;
      }

      if (next && !next.local && store.getSettings().source === 'auto') api.prefetchBackup(next);

      // Stage A: resolve candidate sources for next track and warm 1 relay edge early (bounded to 1 track).
      let source = await (api.prewarm(next) || api.resolve(next));
      if (source?.kind === 'ytrelay') source = await api.warmRelaySource(next, source, { regions: 1 });

      if (generation !== warmGeneration || !isPlaying() || state.loading) return;
      // Stage B: prepare Player B once full buffer headroom is met.
      scheduleStageB(source);
    } catch { /* Foreground playback retains its own retry path. */ }
  }, stageADelay);
  prefetchTimer.unref?.();
}

// Cold start on the relay: while the first region is still asking YouTube, other regions are asked too. When one of
// those has the song first and nothing has played yet, switch to it at once instead of waiting for the slow one.
api.onRelayReady?.((trackId, region) => {
  const cur = current(), src = state.source;
  if (!cur || String(cur.id) !== String(trackId) || src?.kind !== 'ytrelay' || src.relayRegion === region) return;
  if (!pendingPlay || userPaused || (audio.currentTime || 0) > 0 || (audio.readyState || 0) >= 2) return;
  const path = src.url.slice(src.url.indexOf('/yta'));
  playAssigned({...src, url: region + path, relayRegion: region, warm: true});
});

// Boot YouTube's player in the background as soon as a likely song's video is known.
// While a song plays, the next likely one is cued in the hidden player instead.
api.onEmbedFound?.((id) => {
  const cur = current();
  if (cur && store.getVideoCache(cur.id)?.id === id && (state.loading || isEmbed())) return; // that's the song already starting
  if (store.getSettings().source !== 'youtube') return;
  if (!yt.active && !yt.live) yt.warm(id); else if (yt.live) yt.preload(id);
});
// Boot YouTube's player shortly after the app opens, so the first song swaps in instead of loading a player.
(() => {
  const boot = () => {
    if (yt.active || yt.live || navigator.connection?.saveData || store.getSettings().source !== 'youtube') return;
    const id = (current() && store.getVideoCache?.(current().id)?.id) || store.lastPlayableVideo?.() || 'dQw4w9WgXcQ';
    yt.warm(id);
  };
  if (typeof globalThis.document === 'undefined' || typeof globalThis.setTimeout !== 'function') return;
  const later = globalThis.requestIdleCallback || ((fn) => setTimeout(fn, 1200));
  later(() => boot(), { timeout: 2500 });
})();

/* ---------- Audio element events ---------- */
let lastSave = 0, lastPos = 0;
const boundAudio = new WeakSet();
// Every element the player has used. Only the current one may make sound: an earlier one that kept playing
// after a swap (background handoff, effects, preloading) can't be reached by the play button any more,
// so pausing and starting a song stop all the others. Returns how many were stopped.
const allMedia = new Set();
function silenceOthers() {
  let stopped = 0;
  for (const ref of allMedia) {
    const media = ref.deref?.() ?? ref;
    if (!media) { allMedia.delete(ref); continue; }
    if (media !== audio && !media.paused && media.src && !String(media.src).startsWith('data:')) { media.pause(); stopped++; }
  }
  return stopped;
}
// SponsorBlock, as in Spotube: skip parts of a YouTube upload marked as not music (spoken intros, skits, outros).
let sbVideo = '', sbSegments = [];
function skipNonMusic() {
  const vid = state.source?.kind === 'ytrelay' ? state.source.videoId || '' : '';
  if (vid !== sbVideo) {
    sbVideo = vid; sbSegments = [];
    if (vid) sponsor.segmentsFor(vid).then((list) => { if (sbVideo === vid) sbSegments = list; }).catch(() => {});
  }
  if (!sbSegments.length || audio.paused || state.loading) return;
  const to = sponsor.skipTarget(sbSegments, audio.currentTime || 0, mediaLength());
  if (to === null) return;
  // An outro that runs to the end finishes the song, which moves the queue on as usual.
  // Safari may think the file runs longer than it does, so an outro to the end is skipped by moving on.
  if (!Number.isFinite(to) && knownLength()) { songFinished(); return; }
  try { audio.currentTime = Number.isFinite(to) ? to : Math.max(0, (audio.duration || 0) - 0.05); } catch { /* not seekable yet */ }
}

// A song reached its end (or a SponsorBlock outro that runs to the end was skipped).
function songFinished() {
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
}

function bindAudio(media) {
  if (boundAudio.has(media)) return;
  boundAudio.add(media);
  configureAudioElement(media);
  allMedia.add(globalThis.WeakRef ? new WeakRef(media) : media);
  const listen = (event, fn) => media.addEventListener(event, () => { if (media === audio) fn(); });
  // Only the current track may make sound: a spare/preloaded element that starts on its own is stopped at once.
  media.addEventListener('play', () => {
    if (media !== audio && media.src && !media.src.startsWith('data:')) media.pause();
    else if (media === audio) window.dispatchEvent?.(new Event('spotplus:music-play'));
  });
  // Native AirPlay 2 wireless target detection: switch off Web Audio / crossOrigin immediately so AirPlay has sound.
  media.addEventListener('webkitcurrentplaybacktargetiswirelesschanged', () => {
    if (media !== audio) return;
    const wireless = !!media.webkitCurrentPlaybackTargetIsWireless;
    airPlayActive = wireless;
    if (wireless) handOffForAirPlay();
    emit('state');
  });
  listen('loadedmetadata', () => {
    telemetry.markStage(activeGen, 'metadataLoaded');
    sessionHandlers();
    positionState();
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
    sessionHandlers();
    syncPlaybackState(true);
    visibilityResumeAttempted = false;
    continuity.intent = 'playing';
    continuity.pauseReason = 'none';
    if (state.source?.kind === 'ytrelay') { api.noteRelaySong(true); api.noteRelayRegion(state.source.relayRegion, true); }
    if (!mixing) silenceOthers(); // one song at a time (AutoMix overlaps on purpose)
    unavailableRun = 0;
    suppressError = false;
    clearStall();
    startupSwaps = 0;
    clearTimeout(pauseClearTimer);
    setPhase(STATES.PLAYING);
    const first = telemetry.markStage(activeGen, 'firstAudible');
    if (state.startupMs == null && startedAt && isRealSrc()) state.startupMs = Math.round((first || performance.now()) - startedAt);
    telemetry.noteListeningStart();
    api.reportPlaybackSource(state.source, true, { startupMs: state.startupMs || 0 });
    positionState();
    emit('state');
    prefetch();
  });
  listen('play', () => {
    clearTimeout(pauseClearTimer);
    continuity.intent = 'playing';
    continuity.pauseReason = 'none';
    if (isRealSrc()) syncPlaybackState(true);
    sessionHandlers();
    if ('mediaSession' in navigator) { navigator.mediaSession.playbackState = 'playing'; updateSession(current()); }
    positionState();
    emit('state');
  });
  listen('pause', () => {
    clearStall();
    syncPlaybackState(false);
    telemetry.noteListeningStop();
    // Classify pause cause cleanly: user action vs visibility glitch vs OS interruption vs loading/ended.
    const nearVisibilitySwitch = lastVisibilityChangeAt > 0 && (performance.now() - lastVisibilityChangeAt) < 1800;
    if (userPaused) continuity.pauseReason = 'user';
    else if (state.loading) continuity.pauseReason = 'loading';
    else if (audio.ended) continuity.pauseReason = 'ended';
    else if (globalThis.navigator?.onLine === false && !state.offline) continuity.pauseReason = 'offline';
    else if (nearVisibilitySwitch) continuity.pauseReason = 'visibility';
    else continuity.pauseReason = 'os-interruption';

    if (nearVisibilitySwitch && !userPaused && pendingPlay && !audio.ended && isRealSrc() && !state.loading && !visibilityResumeAttempted) {
      visibilityResumeAttempted = true;
      const myGen = token;
      const t = setTimeout(() => {
        if (myGen !== token || userPaused || !pendingPlay || !audio.paused || audio.ended || !isRealSrc()) return;
        telemetry.recordContinuityRecovery();
        audio.play().catch(() => {});
      }, 120);
      t.unref?.();
    }
    if (state.phase === STATES.PLAYING || state.phase === STATES.STALLED) setPhase(STATES.IDLE);
    if ('mediaSession' in navigator) {
      // Keep Lock Screen showing 'playing' during active track loads/skips so controls never drop out.
      navigator.mediaSession.playbackState = (state.loading && pendingPlay && !userPaused) ? 'playing' : 'paused';
    }
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
    watchStall();
    ++warmGeneration;
    clearTimeout(prefetchTimer);
    if ((audio.currentTime || 0) < 0.35) {
      setPhase(STATES.BUFFERING);
      emit('state');
    } else if (!stallUiTimer) {
      // Debounce brief mid-song buffering so micro-hiccups don't thrash DOM layout while decoding.
      const gen = token;
      stallUiTimer = setTimeout(() => {
        stallUiTimer = null;
        if (gen !== token || audio.paused || !isRealSrc()) return;
        setPhase(STATES.STALLED);
        emit('state');
      }, 350);
      stallUiTimer.unref?.();
    }
  });
  listen('seeked', () => {
    telemetry.endSeek();
  });
  listen('progress', () => {
    // Track buffer throughput quietly — emitting full UI state on every HTTP chunk caused main-thread stutter.
    bufferEngine.recordBufferProgress(audio, state.source?.bitrate || 128_000);
  });
  listen('timeupdate', () => {
    skipNonMusic();
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
  listen('ended', songFinished);
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
export function playList(tracks, i = 0, { shuffle = null, mix = false } = {}) {
  if (!tracks || !tracks.length) return;
  if (shuffle !== null) state.shuffle = shuffle;
  skipTracker.clear();
  const list = tracks.map(store.slim);
  i = Math.max(0, Math.min(i, list.length - 1));
  if (mix) {
    state.original = list;
    const startIdx = shuffle && i === 0 ? Math.floor(Math.random() * list.length) : i;
    const arranged = [list[startIdx], ...list.filter((_, idx) => idx !== startIdx)];
    state.queue = orderForMix(arranged, 0);
    state.index = 0;
  } else if (state.shuffle) {
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
  // Do NOT prewarm queue[index + 1] before load() — load() immediately cancels non-current prewarms!
  // Let prefetch() prepare the immediate next track cleanly once the current song is playing with headroom.
  load({ trigger: mix ? 'mix-list' : 'play-list' });
}
/** Smoothly reorder upcoming queue items for a Mix session (no back-to-back same artist). */
export function mixQueue() {
  if (state.queue.length - state.index <= 2) return false;
  state.queue = orderForMix(state.queue, Math.max(0, state.index));
  emit('state');
  save();
  prefetch();
  return true;
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
  // The screen said paused but music was still playing from an older element: this tap stops it.
  if (audio.paused && silenceOthers()) { userPaused = true; pendingPlay = false; syncPlaybackState(false); emit('state'); return; }
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
    syncPlaybackState(false);
    audio.removeAttribute('src');
    audio.load();
    emit('state');
    return;
  }
  if (isSpotifyOfficial()) {
    if (spotifyPlayback.paused) { userPaused = false; pendingPlay = true; spotifyPlayback.play(); }
    else { userPaused = true; pendingPlay = false; spotifyPlayback.pause(); }
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
      continuity.intent = 'playing';
      continuity.pauseReason = 'none';
      syncPlaybackState(true);
      audio.play().then(() => {
        activation.markUnlocked(audio);
        unlockedPrimary = audio;
      }).catch(() => {});
    }
  } else {
    userPaused = true;
    pendingPlay = false;
    continuity.intent = 'paused';
    continuity.pauseReason = 'user';
    audio.pause();
    syncPlaybackState(false);
    silenceOthers();
  }
}
export function next(fromUser = true) {
  lastPrevAt = 0;
  if (fromUser && current() && (isRealSrc() || isEmbed() || isSpotifyOfficial())) {
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
let lastPrevAt = 0;
export function prev() {
  const now = performance.now();
  const doubleTapped = lastPrevAt > 0 && (now - lastPrevAt) <= 1800;
  // First tap past 3s cleanly restarts the current song; a second tap within 1.8s (or <= 3s) skips to previous track.
  if ((!doubleTapped && position() > 3) || state.index <= 0) {
    lastPrevAt = now;
    seek(0);
    if (pendingPlay && !userPaused && !isEmbed() && !isSpotifyOfficial() && isRealSrc() && audio.paused) {
      audio.play().catch(() => {});
    }
    return;
  }
  lastPrevAt = 0;
  skipTracker.record();
  state.index--;
  errRetries = 0;
  load({ trigger: 'skip-prev' });
}
export function seek(sec) {
  if (!isFinite(sec)) return;
  if (isSpotifyOfficial()) {
    const target = Math.max(0, Math.min(sec, duration()));
    spotifyPlayback.seek(target);
    emit('time');
    positionState(target);
    return;
  }
  if (isEmbed()) {
    const target = Math.max(0, Math.min(sec, duration()));
    yt.seek(target);
    emit('time');
    positionState(target);
    return;
  }
  if (!isRealSrc()) return;
  const info = inspectSeek(audio, sec, duration());
  telemetry.beginSeek(info.targetSec);
  audio.currentTime = info.targetSec;
  if (info.inBuffer) telemetry.endSeek();
  emit('time');
  positionState(info.targetSec);
}
export function setVolume(v) {
  volumeLevel = Math.max(0, Math.min(1, v));
  const scaled = volumeLevel * (ducks.size ? .18 : 1);
  audio.volume = scaled;
  yt.setVolume(scaled);
  spotifyPlayback.setVolume(scaled);
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
export function restore({ ifIdle = false } = {}) {
  // Idempotent guard: never overwrite an active playing or loading session when re-entering the app.
  if (ifIdle && (isPlaying() || state.loading)) return;
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

/* ---------- Lock screen / media keys / CarPlay Now Playing / Bluetooth AVRCP ---------- */
function resolveArtworkUrl(src) {
  if (!src || typeof src !== 'string') return '';
  try {
    const base = globalThis.location?.href || 'https://coye2.github.io/spot-plus/';
    return new URL(src, base).href;
  } catch {
    return /^https?:\/\//i.test(src) ? src : '';
  }
}
function inferArtworkType(url) {
  if (/\.png(\?|$)/i.test(url)) return 'image/png';
  if (/\.webp(\?|$)/i.test(url)) return 'image/webp';
  return 'image/jpeg';
}
export function buildSessionArtwork(t) {
  const entries = [];
  const seen = new Set();
  const push = (raw, sizes) => {
    const src = resolveArtworkUrl(raw);
    if (!src || seen.has(`${src}|${sizes}`)) return;
    seen.add(`${src}|${sizes}`);
    entries.push({ src, sizes, type: inferArtworkType(src) });
  };
  if (t?.cover) {
    push(t.cover, '96x96');
    push(t.cover, '192x192');
    push(t.cover, '250x250');
  }
  if (t?.coverXl) {
    push(t.coverXl, '512x512');
    push(t.coverXl, '1000x1000');
  }
  if (!entries.length) {
    push('icons/icon-192.png', '192x192');
    push('icons/icon-512.png', '512x512');
  }
  return entries;
}
let lastSessionMetaKey = '';
function updateSession(t) {
  if (!('mediaSession' in navigator) || !t) return;
  const metaKey = `${t.id || ''}|${t.title || ''}|${t.artist || ''}|${t.album || ''}|${t.cover || ''}|${t.coverXl || ''}`;
  if (metaKey === lastSessionMetaKey && navigator.mediaSession.metadata) return;
  lastSessionMetaKey = metaKey;
  try {
    navigator.mediaSession.metadata = new MediaMetadata({
      title: t.title || 'Spot+',
      artist: t.artist || '',
      album: t.album || '',
      artwork: buildSessionArtwork(t),
    });
  } catch {}
}
function positionState(overridePos = null) {
  if (!('mediaSession' in navigator) || !navigator.mediaSession.setPositionState) return;
  const d = duration();
  if (!Number.isFinite(d) || d <= 0) return;
  const rawPos = typeof overridePos === 'number' && Number.isFinite(overridePos) ? overridePos : position();
  const pos = Math.max(0, Math.min(Number.isFinite(rawPos) ? rawPos : 0, d));
  const rawRate = isEmbed() ? 1 : Number(audio.playbackRate);
  const playbackRate = Number.isFinite(rawRate) && rawRate > 0 ? rawRate : 1;
  try { navigator.mediaSession.setPositionState({ duration: d, playbackRate, position: pos }); } catch {}
}
// Lock screen and Control Center: previous/next song, like Spotify. iOS shows ±10-second buttons instead when
// it has seek handlers, or when it lost ours after the app switched audio elements (preloading, background
// play), so they are registered again every time a song loads or starts playing.
function sessionHandlers() {
  if (!('mediaSession' in navigator)) return;
  const h = (a, fn) => { try { navigator.mediaSession.setActionHandler(a, fn); } catch {} };
  h('play', () => { updateSession(current()); if (isPaused()) toggle(); });
  h('pause', () => { pause(); updateSession(current()); positionState(); });
  h('previoustrack', () => { prev(); updateSession(current()); });
  h('nexttrack', () => { next(true); updateSession(current()); });
  h('seekto', (d) => { if (d && typeof d.seekTime === 'number' && Number.isFinite(d.seekTime)) { seek(d.seekTime); } });
  h('stop', () => { pause(); });
  h('seekbackward', null);
  h('seekforward', null);
}
sessionHandlers();

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
export const __test = {bindAudio: (media) => bindAudio(media), silenceOthers: () => silenceOthers()};
