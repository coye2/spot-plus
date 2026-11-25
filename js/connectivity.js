// connectivity.js — Unified, capability-aware playback connectivity layer.
// Supports Apple AirPlay (WebKit Playback Target API), W3C Remote Playback API (Cast/wireless),
// Web Audio output selection (setSinkId), System Media Session (Lock Screen / Bluetooth AVRCP),
// and truthful platform compatibility reporting for Apple CarPlay and Android Auto.

function detectPlatform(nav = globalThis.navigator) {
  const ua = String(nav?.userAgent || '');
  const platform = String(nav?.platform || '');
  const touches = Number(nav?.maxTouchPoints || 0);
  const isIOS = /iPhone|iPad|iPod/i.test(ua) || (platform === 'MacIntel' && touches > 1);
  const isMacSafari = /Macintosh/i.test(ua) && /Safari/i.test(ua) && !/Chrome|Chromium|Edg|Firefox/i.test(ua);
  const isAndroid = /Android/i.test(ua);
  const isStandalone = Boolean(
    globalThis.matchMedia?.('(display-mode: standalone)')?.matches ||
    nav?.standalone === true,
  );
  return { isIOS, isMacSafari, isAndroid, isStandalone };
}

export class ConnectivityManager {
  constructor() {
    this._media = null;
    this._cleanups = [];
    this._remoteWatchId = null;
    this._listeners = new Set();
    this._onWirelessActive = null;

    this.state = {
      airPlaySupported: false,
      airPlayAvailable: false,
      airPlayActive: false,
      remotePlaybackSupported: false,
      remotePlaybackAvailable: false,
      remotePlaybackState: 'disconnected', // 'disconnected' | 'connecting' | 'connected'
      audioOutputSelectSupported: false,
      mediaSessionSupported: false,
      wirelessActive: false,
      activeTransport: 'local', // 'local' | 'airplay' | 'remote-playback'
    };
  }

  onChange(fn) {
    if (typeof fn === 'function') this._listeners.add(fn);
    return () => this._listeners.delete(fn);
  }

  setOnWirelessActive(fn) {
    this._onWirelessActive = typeof fn === 'function' ? fn : null;
  }

  _emit() {
    const snap = this.getSnapshot();
    for (const fn of this._listeners) {
      try { fn(snap); } catch { /* listener error */ }
    }
  }

  _recomputeTransport() {
    const wasWireless = this.state.wirelessActive;
    const isAirPlay = !!this.state.airPlayActive;
    const isRemote = this.state.remotePlaybackState === 'connected' || this.state.remotePlaybackState === 'connecting';
    this.state.wirelessActive = isAirPlay || isRemote;
    this.state.activeTransport = isAirPlay ? 'airplay' : isRemote ? 'remote-playback' : 'local';
    if (!wasWireless && this.state.wirelessActive) {
      try { this._onWirelessActive?.(this.state.activeTransport); } catch { /* ignore */ }
    }
  }

  _unbindCurrent() {
    for (const fn of this._cleanups) {
      try { fn(); } catch { /* ignore */ }
    }
    this._cleanups = [];
    if (this._media?.remote && this._remoteWatchId != null) {
      try { this._media.remote.cancelWatchAvailability(this._remoteWatchId).catch?.(() => {}); } catch { /* ignore */ }
    }
    this._remoteWatchId = null;
  }

  /**
   * Bind the connectivity manager to the active <audio> element.
   * Re-called automatically whenever player.js swaps media elements so AirPlay and
   * Remote Playback availability never go stale after a handoff or crossfade.
   */
  bindMedia(media) {
    if (!media || media === this._media) {
      this._refreshStaticCapabilities(media);
      return;
    }
    this._unbindCurrent();
    this._media = media;
    this._refreshStaticCapabilities(media);

    // 1) Apple AirPlay (WebKit Playback Target API)
    if (this.state.airPlaySupported) {
      const onAvailability = (event) => {
        const available = event?.availability === 'available';
        if (this.state.airPlayAvailable !== available) {
          this.state.airPlayAvailable = available;
          this._emit();
        }
      };
      const onWireless = () => {
        const wireless = !!media.webkitCurrentPlaybackTargetIsWireless;
        if (this.state.airPlayActive !== wireless) {
          this.state.airPlayActive = wireless;
          if (wireless) this.state.airPlayAvailable = true;
          this._recomputeTransport();
          this._emit();
        }
      };
      media.addEventListener?.('webkitplaybacktargetavailabilitychanged', onAvailability);
      media.addEventListener?.('webkitcurrentplaybacktargetiswirelesschanged', onWireless);
      this._cleanups.push(() => {
        media.removeEventListener?.('webkitplaybacktargetavailabilitychanged', onAvailability);
        media.removeEventListener?.('webkitcurrentplaybacktargetiswirelesschanged', onWireless);
      });
      this.state.airPlayActive = !!media.webkitCurrentPlaybackTargetIsWireless;
      if (this.state.airPlayActive) this.state.airPlayAvailable = true;
    } else {
      this.state.airPlayAvailable = false;
      this.state.airPlayActive = false;
    }

    // 2) W3C Remote Playback API (Chrome/Android Cast & wireless sinks)
    const remote = media.remote;
    if (this.state.remotePlaybackSupported && remote) {
      const syncRemoteState = () => {
        const next = remote.state || 'disconnected';
        if (this.state.remotePlaybackState !== next) {
          this.state.remotePlaybackState = next;
          if (next === 'connected' || next === 'connecting') this.state.remotePlaybackAvailable = true;
          this._recomputeTransport();
          this._emit();
        }
      };
      const onConnecting = () => syncRemoteState();
      const onConnect = () => syncRemoteState();
      const onDisconnect = () => syncRemoteState();
      remote.addEventListener?.('connecting', onConnecting);
      remote.addEventListener?.('connect', onConnect);
      remote.addEventListener?.('disconnect', onDisconnect);
      this._cleanups.push(() => {
        remote.removeEventListener?.('connecting', onConnecting);
        remote.removeEventListener?.('connect', onConnect);
        remote.removeEventListener?.('disconnect', onDisconnect);
      });
      if (typeof remote.watchAvailability === 'function') {
        try {
          Promise.resolve(remote.watchAvailability((available) => {
            const next = !!available;
            if (this.state.remotePlaybackAvailable !== next) {
              this.state.remotePlaybackAvailable = next;
              this._emit();
            }
          }))
            .then((id) => { this._remoteWatchId = id; })
            .catch(() => {
              // Safari/some browsers reject watchAvailability even when prompt() works; treat prompt as selectable only when AirPlay isn't primary.
            });
        } catch { /* ignore */ }
      }
      syncRemoteState();
    } else {
      this.state.remotePlaybackAvailable = false;
      this.state.remotePlaybackState = 'disconnected';
    }

    this._recomputeTransport();
    this._emit();
  }

  _refreshStaticCapabilities(media = this._media) {
    const nav = globalThis.navigator;
    const airPlay = typeof media?.webkitShowPlaybackTargetPicker === 'function';
    const remote = !!(media?.remote && typeof media.remote.prompt === 'function' && !media.disableRemotePlayback);
    const sinkSelect = !!(typeof media?.setSinkId === 'function' && typeof nav?.mediaDevices?.selectAudioOutput === 'function');
    const mediaSession = typeof nav !== 'undefined' && 'mediaSession' in nav && !!nav.mediaSession;

    this.state.airPlaySupported = airPlay;
    this.state.remotePlaybackSupported = remote;
    this.state.audioOutputSelectSupported = sinkSelect;
    this.state.mediaSessionSupported = mediaSession;
  }

  /** True when the browser genuinely supports an in-app wireless target picker (AirPlay or Remote Playback). */
  canPickWirelessTarget() {
    if (this.state.airPlaySupported) return true;
    if (this.state.remotePlaybackSupported && (this.state.remotePlaybackAvailable || this.state.remotePlaybackState !== 'disconnected')) {
      return true;
    }
    return false;
  }

  /** Opens the native AirPlay target picker (Safari/WebKit) or W3C Remote Playback picker. */
  async openWirelessPicker() {
    const media = this._media;
    if (!media) return { ok: false, transport: 'none', reason: 'no-media' };
    try { media.disableRemotePlayback = false; } catch { /* ignore */ }
    media.setAttribute?.('x-webkit-airplay', 'allow');

    if (typeof media.webkitShowPlaybackTargetPicker === 'function') {
      try {
        media.webkitShowPlaybackTargetPicker();
        return { ok: true, transport: 'airplay' };
      } catch (err) {
        return { ok: false, transport: 'airplay', reason: err?.message || 'picker-failed' };
      }
    }

    if (media.remote && typeof media.remote.prompt === 'function') {
      try {
        await media.remote.prompt();
        return { ok: true, transport: 'remote-playback' };
      } catch (err) {
        return { ok: false, transport: 'remote-playback', reason: err?.name === 'NotAllowedError' ? 'cancelled' : (err?.message || 'picker-failed') };
      }
    }

    return { ok: false, transport: 'none', reason: 'unsupported' };
  }

  /** Opens Web Audio output device picker when supported by Chromium desktop browsers. */
  async selectAudioOutput() {
    const media = this._media;
    if (!media || typeof media.setSinkId !== 'function' || !globalThis.navigator?.mediaDevices?.selectAudioOutput) {
      return { ok: false, reason: 'unsupported' };
    }
    try {
      const device = await globalThis.navigator.mediaDevices.selectAudioOutput();
      await media.setSinkId(device.deviceId);
      this._emit();
      return { ok: true, label: device.label || 'Selected audio output' };
    } catch (err) {
      return { ok: false, reason: err?.name === 'NotAllowedError' ? 'cancelled' : (err?.message || 'output-error') };
    }
  }

  /**
   * Returns a complete, truthful snapshot of detected playback connectivity capabilities.
   * Never fabricates CarPlay or Android Auto dashboard app support in a web PWA.
   */
  getSnapshot() {
    this._refreshStaticCapabilities(this._media);
    const platform = detectPlatform();
    const s = this.state;
    const wirelessKind = s.airPlaySupported ? 'airplay' : (s.remotePlaybackSupported ? 'remote-playback' : 'none');

    return {
      ...s,
      platform,
      wirelessKind,
      canPickWireless: this.canPickWirelessTarget(),
      airPlay: {
        supported: s.airPlaySupported,
        available: s.airPlayAvailable,
        active: s.airPlayActive,
        label: s.airPlayActive
          ? 'Connected via AirPlay'
          : s.airPlaySupported
            ? (s.airPlayAvailable ? 'AirPlay speakers available' : 'Supported (use picker or Control Center)')
            : 'Requires Safari on iPhone, iPad, or Mac',
      },
      remotePlayback: {
        supported: s.remotePlaybackSupported,
        available: s.remotePlaybackAvailable,
        state: s.remotePlaybackState,
        label: s.remotePlaybackState === 'connected'
          ? 'Connected to wireless speaker'
          : s.remotePlaybackState === 'connecting'
            ? 'Connecting…'
            : s.remotePlaybackAvailable
              ? 'Wireless output available'
              : s.remotePlaybackSupported
                ? 'Supported when receivers are nearby'
                : 'Not supported in this browser',
      },
      mediaSession: {
        supported: s.mediaSessionSupported,
        label: s.mediaSessionSupported
          ? 'Active — Lock Screen, Control Center & Bluetooth controls'
          : 'Unavailable in this browser',
      },
      carPlay: {
        nativeDashboardSupported: false,
        nowPlayingBridgeSupported: platform.isIOS && s.mediaSessionSupported,
        label: platform.isIOS && s.mediaSessionSupported
          ? 'System Now Playing & Bluetooth controls'
          : 'Native CarPlay app requires iOS companion',
        detail: 'Apple CarPlay dashboard apps require a native iOS app with Apple’s CarPlay Audio entitlement. While connected to CarPlay or car Bluetooth, Spot+ plays through the car audio system and displays track info and steering-wheel controls in iOS Now Playing.',
      },
      androidAuto: {
        nativeDashboardSupported: false,
        bluetoothMediaSupported: platform.isAndroid && s.mediaSessionSupported,
        label: platform.isAndroid && s.mediaSessionSupported
          ? 'Bluetooth AVRCP & Android media controls'
          : 'Native Android Auto requires Android companion',
        detail: 'Android Auto dashboard browsing requires a native Android Media3 MediaLibraryService. Over car Bluetooth (AVRCP) and Android media controls, Spot+ streams audio with track metadata and steering-wheel controls.',
      },
    };
  }
}

export const connectivity = new ConnectivityManager();
