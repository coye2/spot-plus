// js/vehicle/drive-bridge.js — Path 1: Browser-Native Vehicle Media Bridge (Spot+ Drive).
// Maximizes W3C Media Session API propagation into WebKit (MediaSessionManagerCocoa /
// MPNowPlayingInfoCenter / MPRemoteCommandCenter / CarPlay Now Playing) and Chromium
// (MediaSessionImpl / MediaSessionAndroid / MediaSessionCompat / Bluetooth AVRCP).
//
// Design guarantees:
//  - Event-driven only: zero polling timers, zero <audio> teardown/rebuilds, zero extra network calls.
//  - Protects against OEM Bluetooth AVRCP duplicate steering-wheel pulses and iOS ±10s button regression.
//  - Truthful capability detection separating confirmed browser APIs from native-only dashboard trees.

const DEFAULT_ARTWORK_SIZES = Object.freeze(['96x96', '192x192', '256x256', '512x512']);
const AVRCP_DEBOUNCE_MS = 220;
const POSITION_SYNC_MIN_GAP_MS = 900;
const HEAD_UNIT_MAX_CHARS = 128;

/**
 * Normalize track metadata strings for car head-unit displays (AVRCP 1.4-1.6, CarPlay Now Playing).
 * Strips control characters, collapses whitespace/newlines that break older OEM displays, and caps length.
 */
export function sanitizeHeadUnitText(value, maxLen = HEAD_UNIT_MAX_CHARS) {
  if (value == null) return '';
  const cleaned = String(value)
    .replace(/[\u0000-\u001f\u007f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!cleaned) return '';
  return cleaned.length > maxLen ? `${cleaned.slice(0, Math.max(1, maxLen - 1)).trimEnd()}…` : cleaned;
}

function resolveHttpsArtwork(raw, baseHref) {
  if (!raw || typeof raw !== 'string') return '';
  const trimmed = raw.trim();
  if (!trimmed || /^(javascript|data|vbscript):/i.test(trimmed)) return '';
  try {
    const resolved = new URL(trimmed, baseHref || 'https://coye2.github.io/spot-plus/');
    if (resolved.protocol !== 'https:' && resolved.protocol !== 'http:') return '';
    return resolved.href;
  } catch {
    return '';
  }
}

function inferImageMime(url) {
  if (/\.png(\?|$)/i.test(url)) return 'image/png';
  if (/\.webp(\?|$)/i.test(url)) return 'image/webp';
  return 'image/jpeg';
}

/**
 * Builds head-unit-safe MediaMetadata fields and multi-size absolute artwork entries.
 * Ensures non-empty album fallback so strict AVRCP / CarPlay dashboards never hide track info.
 */
export function buildVehicleMetadata(track, { baseHref = globalThis.location?.href } = {}) {
  if (!track) return null;
  const title = sanitizeHeadUnitText(track.title) || 'Spot+';
  const artist = sanitizeHeadUnitText(track.artist) || 'Spot+';
  const album = sanitizeHeadUnitText(track.album) || artist || 'Spot+';

  const artwork = [];
  const seen = new Set();
  const addArt = (rawUrl, sizes) => {
    const src = resolveHttpsArtwork(rawUrl, baseHref);
    if (!src) return;
    const key = `${src}|${sizes}`;
    if (seen.has(key)) return;
    seen.add(key);
    artwork.push({ src, sizes, type: inferImageMime(src) });
  };

  if (track.cover) {
    addArt(track.cover, '96x96');
    addArt(track.cover, '192x192');
    addArt(track.cover, '256x256');
  }
  if (track.coverXl) {
    addArt(track.coverXl, '512x512');
    addArt(track.coverXl, '1000x1000');
  }
  if (!artwork.length) {
    for (const size of DEFAULT_ARTWORK_SIZES) {
      const icon = size === '96x96' || size === '192x192' ? 'icons/icon-192.png' : 'icons/icon-512.png';
      addArt(icon, size);
    }
  }

  return {
    title,
    artist,
    album,
    artwork,
    fingerprint: `${track.id || ''}|${title}|${artist}|${album}|${artwork[0]?.src || ''}`,
  };
}

/**
 * Detects exact vehicle integration capabilities exposed by the current browser engine.
 * Explicitly separates confirmed browser-native capabilities from native-only platform gates.
 */
export function detectVehicleCapabilities(env = {}) {
  const nav = env.navigator ?? globalThis.navigator;
  const win = env.window ?? globalThis;
  const ua = String(nav?.userAgent || '');
  const platform = String(nav?.platform || '');
  const touches = Number(nav?.maxTouchPoints || 0);

  const isIOS = /iPhone|iPad|iPod/i.test(ua) || (platform === 'MacIntel' && touches > 1);
  const isAndroid = /Android/i.test(ua);
  const isChromium = /Chrome|Chromium|Edg|CriOS/i.test(ua) && !/OPR/i.test(ua);
  const isWebKit = isIOS || (/Safari/i.test(ua) && !isChromium && !/Firefox/i.test(ua));
  const isStandalone = Boolean(
    win?.matchMedia?.('(display-mode: standalone)')?.matches ||
    nav?.standalone === true,
  );

  const mediaSession = !!(nav && 'mediaSession' in nav && nav.mediaSession);
  const positionState = !!(mediaSession && typeof nav.mediaSession.setPositionState === 'function');
  const audioDevicesApi = !!(nav?.mediaDevices && typeof nav.mediaDevices.addEventListener === 'function');
  const airPlayPicker = typeof env.media?.webkitShowPlaybackTargetPicker === 'function';
  const remotePlayback = !!(env.media?.remote && typeof env.media.remote.prompt === 'function');

  return {
    engine: isWebKit ? 'webkit' : isChromium ? 'chromium' : 'other',
    os: isIOS ? 'ios' : isAndroid ? 'android' : 'desktop',
    standalonePwa: isStandalone,
    confirmed: {
      mediaSession,
      positionState,
      carPlayNowPlaying: isIOS && mediaSession,
      bluetoothAvrcp: mediaSession,
      steeringWheelControls: mediaSession,
      routeChangeObservation: audioDevicesApi || airPlayPicker || remotePlayback,
      airPlayRouting: airPlayPicker,
      remotePlaybackRouting: remotePlayback,
    },
    platformBlockedInPwa: {
      carPlayLauncherApp: true, // Requires Apple com.apple.developer.carplay-audio entitlement
      carPlayTemplateBrowse: true, // Requires CPTemplateApplicationSceneDelegate
      androidAutoLauncherApp: true, // Requires native MediaLibraryService + automotive_app_desc.xml
      androidAutoLibraryTree: true, // Browser MediaSessionCompat has no MediaBrowserService tree
    },
    signalPath: isIOS
      ? 'HTMLAudioElement + navigator.mediaSession -> WebKit MediaSessionManagerCocoa / NowPlayingManager -> MPNowPlayingInfoCenter & MPRemoteCommandCenter -> CarPlay Now Playing / Lock Screen / Bluetooth AVRCP'
      : isAndroid
        ? 'HTMLAudioElement + navigator.mediaSession -> Chromium MediaSessionImpl / MediaSessionAndroid -> MediaSessionCompat -> Android Media Notification / Bluetooth AVRCP / Car Head Unit'
        : 'HTMLAudioElement + navigator.mediaSession -> OS Now Playing (MediaPlayer / SMTC / MPRIS) -> Hardware Media Keys & Bluetooth AVRCP',
  };
}

/**
 * Classifies pause/interruption transitions so vehicle disconnect (audio becoming noisy)
 * never resumes audio through phone speakers, while brief OS interruptions are tracked honestly.
 */
export function classifyVehicleInterruption({
  reason = 'unknown',
  wasWireless = false,
  isWireless = false,
  documentHidden = false,
  online = true,
} = {}) {
  if (reason === 'user') return { kind: 'user-pause', autoResumeSafe: false };
  if (wasWireless && !isWireless) return { kind: 'route-disconnect', autoResumeSafe: false };
  if (!online) return { kind: 'network-loss', autoResumeSafe: false };
  if (reason === 'visibility' && documentHidden) return { kind: 'visibility-glitch', autoResumeSafe: true };
  if (reason === 'os-interruption') return { kind: 'os-interruption', autoResumeSafe: false };
  return { kind: 'other', autoResumeSafe: false };
}

export class DriveMediaBridge {
  constructor(options = {}) {
    this._nav = options.navigator ?? globalThis.navigator;
    this._media = options.media ?? null;
    this._commands = options.commands ?? {};
    this._enabled = false;
    this._lastMetaFingerprint = '';
    this._lastPositionSyncAt = 0;
    this._lastCommandAt = new Map();
    this._wasWireless = false;
    this._cleanups = [];
    this._stats = {
      metadataUpdates: 0,
      metadataSkippedDedup: 0,
      positionUpdates: 0,
      commandsHandled: 0,
      commandsDebounced: 0,
      handlerRebinds: 0,
      routeChanges: 0,
      lastInterruption: null,
    };
  }

  isEnabled() {
    return this._enabled;
  }

  enable({ media = this._media, commands = this._commands } = {}) {
    this._media = media ?? this._media;
    this._commands = { ...this._commands, ...commands };
    if (this._enabled) return this.getSnapshot();
    this._enabled = true;
    this._attachListeners();
    this.rebindActionHandlers();
    return this.getSnapshot();
  }

  disable() {
    if (!this._enabled) return;
    this._enabled = false;
    for (const fn of this._cleanups) {
      try { fn(); } catch { /* ignore cleanup errors */ }
    }
    this._cleanups = [];
  }

  setMedia(media) {
    if (!media || media === this._media) return;
    this._media = media;
    if (this._enabled) {
      this._detachListeners();
      this._attachListeners();
      this.rebindActionHandlers();
    }
  }

  _detachListeners() {
    for (const fn of this._cleanups) {
      try { fn(); } catch { /* ignore */ }
    }
    this._cleanups = [];
  }

  _attachListeners() {
    const devices = this._nav?.mediaDevices;
    if (devices && typeof devices.addEventListener === 'function') {
      const onDeviceChange = () => {
        this._stats.routeChanges += 1;
        this.rebindActionHandlers();
      };
      devices.addEventListener('devicechange', onDeviceChange);
      this._cleanups.push(() => devices.removeEventListener?.('devicechange', onDeviceChange));
    }

    const media = this._media;
    if (media && typeof media.addEventListener === 'function') {
      const onWirelessChange = () => {
        const nowWireless = !!media.webkitCurrentPlaybackTargetIsWireless;
        if (this._wasWireless !== nowWireless) {
          this._stats.routeChanges += 1;
          this._wasWireless = nowWireless;
          this.rebindActionHandlers();
        }
      };
      media.addEventListener('webkitcurrentplaybacktargetiswirelesschanged', onWirelessChange);
      this._cleanups.push(() => media.removeEventListener?.('webkitcurrentplaybacktargetiswirelesschanged', onWirelessChange));
      this._wasWireless = !!media.webkitCurrentPlaybackTargetIsWireless;
    }
  }

  _shouldRunDebounced(action, now = Date.now()) {
    if (action !== 'nexttrack' && action !== 'previoustrack') return true;
    const prev = this._lastCommandAt.get(action) || 0;
    if (now - prev < AVRCP_DEBOUNCE_MS) {
      this._stats.commandsDebounced += 1;
      return false;
    }
    this._lastCommandAt.set(action, now);
    return true;
  }

  /**
   * Registers W3C Media Session action handlers tuned for CarPlay Now Playing & Bluetooth AVRCP.
   * Explicitly nulls seekbackward/seekforward so iOS keeps Previous/Next track buttons visible.
   */
  rebindActionHandlers() {
    const ms = this._nav?.mediaSession;
    if (!this._enabled || !ms || typeof ms.setActionHandler !== 'function') return false;
    const set = (action, fn) => {
      try { ms.setActionHandler(action, fn); } catch { /* unsupported action in this engine */ }
    };
    const wrap = (action, fn) => {
      if (typeof fn !== 'function') return null;
      return (details) => {
        if (!this._shouldRunDebounced(action)) return;
        this._stats.commandsHandled += 1;
        fn(details);
      };
    };

    set('play', wrap('play', this._commands.play));
    set('pause', wrap('pause', this._commands.pause));
    set('previoustrack', wrap('previoustrack', this._commands.previous));
    set('nexttrack', wrap('nexttrack', this._commands.next));
    set('seekto', wrap('seekto', (details) => {
      if (details && typeof details.seekTime === 'number' && Number.isFinite(details.seekTime)) {
        this._commands.seekTo?.(details.seekTime, !!details.fastSeek);
      }
    }));
    set('stop', wrap('stop', this._commands.stop || this._commands.pause));
    // Keep ±10s skip handlers explicitly cleared so iOS CarPlay/Lock Screen shows track skip buttons.
    set('seekbackward', null);
    set('seekforward', null);

    this._stats.handlerRebinds += 1;
    return true;
  }

  syncMetadata(track, { force = false, baseHref } = {}) {
    const ms = this._nav?.mediaSession;
    if (!this._enabled || !ms || !track) return false;
    const meta = buildVehicleMetadata(track, { baseHref });
    if (!meta) return false;
    if (!force && meta.fingerprint === this._lastMetaFingerprint && ms.metadata) {
      this._stats.metadataSkippedDedup += 1;
      return false;
    }
    this._lastMetaFingerprint = meta.fingerprint;
    const MetaCtor = globalThis.MediaMetadata;
    try {
      ms.metadata = typeof MetaCtor === 'function'
        ? new MetaCtor({ title: meta.title, artist: meta.artist, album: meta.album, artwork: meta.artwork })
        : { title: meta.title, artist: meta.artist, album: meta.album, artwork: meta.artwork };
      this._stats.metadataUpdates += 1;
      return true;
    } catch {
      return false;
    }
  }

  syncPlaybackState(playbackState) {
    const ms = this._nav?.mediaSession;
    if (!this._enabled || !ms) return false;
    const valid = playbackState === 'playing' || playbackState === 'paused' ? playbackState : 'none';
    try {
      ms.playbackState = valid;
      return true;
    } catch {
      return false;
    }
  }

  syncPosition({ duration, position, playbackRate = 1, force = false, now = Date.now() } = {}) {
    const ms = this._nav?.mediaSession;
    if (!this._enabled || !ms || typeof ms.setPositionState !== 'function') return false;
    if (!Number.isFinite(duration) || duration <= 0) return false;
    if (!force && now - this._lastPositionSyncAt < POSITION_SYNC_MIN_GAP_MS) return false;
    const safePos = Math.max(0, Math.min(Number.isFinite(position) ? position : 0, duration));
    const safeRate = Number.isFinite(playbackRate) && playbackRate > 0 ? playbackRate : 1;
    try {
      ms.setPositionState({ duration, playbackRate: safeRate, position: safePos });
      this._lastPositionSyncAt = now;
      this._stats.positionUpdates += 1;
      return true;
    } catch {
      return false;
    }
  }

  noteInterruption(context) {
    const result = classifyVehicleInterruption({
      ...context,
      wasWireless: context?.wasWireless ?? this._wasWireless,
    });
    this._stats.lastInterruption = { ...result, at: Date.now() };
    return result;
  }

  getSnapshot() {
    return {
      enabled: this._enabled,
      capabilities: detectVehicleCapabilities({ navigator: this._nav, media: this._media }),
      stats: { ...this._stats },
    };
  }
}

export const driveBridge = new DriveMediaBridge();
