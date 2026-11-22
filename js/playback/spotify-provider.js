// js/playback/spotify-provider.js
// Unified Spot+ Spotify Official Playback provider.
// Coordinates PKCE auth, capability detection, Web Playback SDK (desktop/supported browsers),
// Spotify Connect remote fallback, track URI resolution, real playback verification, and clean fallback.

import { detectSpotifyCapabilities } from './spotify-capabilities.js';
import {
  SPOTIFY_API_BASE,
  createAuthorizationRequest,
  exchangeCodeForTokens,
  fetchSpotifyProfile,
  getValidAccessToken,
  loadSession,
  clearSession,
  readCallbackParamsFromUrl,
  resolveRedirectUri,
} from './spotify-auth.js';
import {
  SpotifyDeviceController,
  listConnectDevices,
  startTrackOnDevice,
  queueTrackOnDevice,
  controlConnectDevice,
} from './spotify-device.js';

export const SPOTIFY_STATUS_LABELS = Object.freeze({
  disconnected: 'Not connected',
  connected: 'Connected',
  'premium-required': 'Premium required',
  'browser-unsupported': 'Browser unsupported',
  'auth-expired': 'Authentication expired',
  ready: 'Connected (awaiting verified playback)',
  'playback-ready': 'Playback ready',
});

/** Extract a canonical spotify:track:<id> URI when a Spot+ track already carries a Spotify ID (0 network calls). */
export function extractDirectSpotifyUri(track) {
  if (!track || typeof track !== 'object') return null;
  if (typeof track.spotifyUri === 'string' && /^spotify:track:[A-Za-z0-9]{22}$/.test(track.spotifyUri)) {
    return track.spotifyUri;
  }
  const candidates = [
    track.spotifyId,
    typeof track.id === 'string' && track.id.startsWith('sp:') ? track.id.slice(3) : null,
    typeof track.id === 'string' && track.id.startsWith('spotify:track:') ? track.id.slice(14) : null,
  ];
  for (const raw of candidates) {
    if (typeof raw === 'string' && /^[A-Za-z0-9]{22}$/.test(raw)) {
      return `spotify:track:${raw}`;
    }
  }
  return null;
}

export class SpotifyPlaybackProvider {
  constructor({
    storage = globalThis.localStorage,
    fetcher = globalThis.fetch,
    getSettings = () => ({}),
    capabilitiesDetector = detectSpotifyCapabilities,
    sdkLoader,
    onPlay = () => {},
    onPause = () => {},
    onTime = () => {},
    onEnded = () => {},
    onError = () => {},
    onStatusChange = () => {},
  } = {}) {
    this.storage = storage;
    this.fetcher = fetcher;
    this.getSettings = getSettings;
    this.capabilitiesDetector = capabilitiesDetector;
    this.sdkLoader = sdkLoader;

    this.onPlay = onPlay;
    this.onPause = onPause;
    this.onTime = onTime;
    this.onEnded = onEnded;
    this.onError = onError;
    this.onStatusChange = onStatusChange;

    this.capabilities = null;
    this.status = 'disconnected';
    this.statusDetail = '';
    this.profile = null;
    this.mode = 'none'; // 'sdk' | 'connect-remote' | 'none'
    this.activeDeviceId = null;
    this.activeDeviceName = '';
    this.verifiedPlayback = false;
    this.active = false;
    this.paused = true;
    this.currentTime = 0;
    this.duration = 0;
    this.volume = 0.85;
    this.currentUri = '';
    this.lastTrackPositionMs = 0;
    this.uriMemo = new Map();
    this.tickTimer = null;
    this.lastStateAt = 0;
    this.endedEmittedForUri = '';
    this.metrics = {
      workerRequests: 0,
      spotifyApiRequests: 0,
      lastTimeToFirstAudioMs: 0,
      tracksPlayed: 0,
      failures: 0,
    };

    this.device = new SpotifyDeviceController({
      volume: this.volume,
      getToken: () => this.getToken(),
      onEvent: (kind, payload) => this.handleDeviceEvent(kind, payload),
    });
  }

  getRelayUrl() {
    const configured = String(this.getSettings()?.spotifyRelayUrl || '').trim();
    if (configured) return configured.replace(/\/$/, '');
    // In local/preview dev server, use the local control-plane worker route if present.
    const host = globalThis.location?.hostname || '';
    if (host.endsWith('.run.app') || host === 'localhost' || host === '127.0.0.1') {
      return `${globalThis.location.origin}/__spotify_relay`;
    }
    return '';
  }

  setStatus(next, detail = '') {
    // Enforce truthfulness: never advertise 'playback-ready' until an actual track has played.
    const safeNext = next === 'playback-ready' && !this.verifiedPlayback ? 'ready' : next;
    const changed = this.status !== safeNext || this.statusDetail !== detail;
    this.status = safeNext;
    this.statusDetail = detail;
    if (changed) this.onStatusChange(this.getStatusSnapshot());
  }

  getStatusSnapshot() {
    return {
      status: this.status,
      label: SPOTIFY_STATUS_LABELS[this.status] || 'Not connected',
      detail: this.statusDetail,
      verifiedPlayback: this.verifiedPlayback,
      mode: this.mode,
      deviceName: this.activeDeviceName,
      profile: this.profile,
      capabilities: this.capabilities,
      redirectUri: resolveRedirectUri(),
      metrics: { ...this.metrics },
    };
  }

  async init() {
    if (!this.capabilities) {
      this.capabilities = await this.capabilitiesDetector();
    }
    // Check if returning from a redirect-based PKCE flow.
    const cb = readCallbackParamsFromUrl();
    if (cb?.error) {
      this.setStatus('disconnected', `Spotify sign-in cancelled (${cb.error}).`);
    } else if (cb?.code) {
      try {
        await this.completeOAuthCallback(cb.code, cb.state);
      } catch (err) {
        this.setStatus('disconnected', err.message || 'Spotify sign-in failed.');
      }
      return this.getStatusSnapshot();
    }

    const session = loadSession(this.storage);
    if (!session) {
      this.setStatus('disconnected', this.capabilities.sdkCaveat || '');
      return this.getStatusSnapshot();
    }
    if (session.expired) {
      this.setStatus('auth-expired', 'Reconnect your Spotify account to continue.');
      return this.getStatusSnapshot();
    }

    this.profile = session.profile || null;
    try {
      const token = await this.getToken();
      if (!token) {
        this.setStatus('auth-expired', 'Spotify session expired.');
        return this.getStatusSnapshot();
      }
      if (!this.profile) {
        this.profile = await fetchSpotifyProfile({
          accessToken: token,
          storage: this.storage,
          fetcher: this.fetcher,
        });
      }
      this.evaluateAccountAndCapabilities();
    } catch (err) {
      if (err?.code === 'AUTH_EXPIRED') {
        this.setStatus('auth-expired', 'Spotify session expired. Sign in again.');
      } else {
        this.setStatus('connected', err?.message || '');
      }
    }
    return this.getStatusSnapshot();
  }

  evaluateAccountAndCapabilities() {
    if (!this.profile) {
      this.setStatus('connected', 'Account connected.');
      return;
    }
    if (!this.profile.isPremium) {
      this.setStatus('premium-required', 'Spotify Premium is required for official full-track playback.');
      return;
    }
    if (this.capabilities && !this.capabilities.sdkSupported) {
      this.setStatus('browser-unsupported', this.capabilities.sdkCaveat || 'Web Playback SDK unsupported in this browser.');
      return;
    }
    this.setStatus(this.verifiedPlayback ? 'playback-ready' : 'ready', 'Ready to initialize playback device.');
  }

  async getToken() {
    return getValidAccessToken({
      relayUrl: this.getRelayUrl(),
      storage: this.storage,
      fetcher: this.fetcher,
    });
  }

  /**
   * Launch Spotify OAuth PKCE flow.
   * Uses a popup pointing directly to accounts.spotify.com (for AI Studio preview iframe compatibility)
   * and falls back to full-page redirect when popups are blocked or running as standalone PWA.
   */
  async connectAccount({ clientId, win = globalThis.window } = {}) {
    if (!this.capabilities) this.capabilities = await this.capabilitiesDetector();
    const { url } = await createAuthorizationRequest({
      clientId,
      redirectUri: resolveRedirectUri(),
      storage: this.storage,
    });

    // Standalone iOS PWA cannot reliably share window.opener with a popup; use direct navigation.
    if (this.capabilities.isStandalone || !win?.open) {
      win.location.assign(url);
      return { flow: 'redirect' };
    }

    const popup = win.open(url, 'spotplus_spotify_oauth', 'width=520,height=720,noopener=no');
    if (!popup) {
      win.location.assign(url);
      return { flow: 'redirect' };
    }

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        cleanup();
        reject(new Error('Spotify sign-in timed out.'));
      }, 5 * 60_000);

      const onMessage = async (event) => {
        if (!event?.data || event.data.type !== 'SPOTPLUS_SPOTIFY_OAUTH') return;
        const origin = String(event.origin || '');
        const allowed = origin === win.location.origin
          || origin.endsWith('.run.app')
          || origin.includes('localhost')
          || origin.includes('127.0.0.1');
        if (!allowed) return;
        cleanup();
        if (event.data.error) {
          reject(new Error(`Spotify sign-in denied (${event.data.error}).`));
          return;
        }
        try {
          const snap = await this.completeOAuthCallback(event.data.code, event.data.state);
          resolve(snap);
        } catch (err) {
          reject(err);
        }
      };

      const pollClosed = setInterval(() => {
        if (popup.closed) {
          cleanup();
          reject(new Error('Spotify sign-in window was closed.'));
        }
      }, 600);

      const cleanup = () => {
        clearTimeout(timeout);
        clearInterval(pollClosed);
        win.removeEventListener('message', onMessage);
      };

      win.addEventListener('message', onMessage);
    });
  }

  async completeOAuthCallback(code, state) {
    const relayUrl = this.getRelayUrl();
    if (relayUrl) this.metrics.workerRequests += 1;
    const session = await exchangeCodeForTokens({
      code,
      state,
      relayUrl,
      storage: this.storage,
      fetcher: this.fetcher,
    });
    this.profile = await fetchSpotifyProfile({
      accessToken: session.accessToken,
      storage: this.storage,
      fetcher: this.fetcher,
    });
    if (!this.capabilities) this.capabilities = await this.capabilitiesDetector();
    this.evaluateAccountAndCapabilities();
    return this.getStatusSnapshot();
  }

  disconnectAccount() {
    this.stop();
    this.device.disconnect();
    clearSession(this.storage);
    this.profile = null;
    this.activeDeviceId = null;
    this.activeDeviceName = '';
    this.mode = 'none';
    this.verifiedPlayback = false;
    this.uriMemo.clear();
    this.setStatus('disconnected', 'Spotify account disconnected.');
  }

  /** Resolve any Spot+ track into a canonical spotify:track:<id> URI with 0–1 requests. */
  async resolveTrackUri(track, accessToken) {
    const direct = extractDirectSpotifyUri(track);
    if (direct) return direct;

    const key = `${String(track.artist || '').toLowerCase()}::${String(track.title || '').toLowerCase()}`;
    if (this.uriMemo.has(key)) return this.uriMemo.get(key);

    const relayUrl = this.getRelayUrl();
    if (relayUrl) {
      try {
        const params = new URLSearchParams();
        if (track.isrc) params.set('isrc', track.isrc);
        if (track.title) params.set('title', track.title);
        if (track.artist) params.set('artist', track.artist);
        this.metrics.workerRequests += 1;
        const res = await this.fetcher(`${relayUrl}/resolve?${params.toString()}`, {
          headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' },
        });
        if (res.status === 401) {
          const err = new Error('Spotify authentication expired.');
          err.code = 'AUTH_EXPIRED';
          throw err;
        }
        if (res.ok) {
          const data = await res.json();
          if (data?.uri) {
            this.uriMemo.set(key, data.uri);
            return data.uri;
          }
        }
      } catch (err) {
        if (err?.code === 'AUTH_EXPIRED') throw err;
        // Fall through to direct Spotify Web API search if relay is offline.
      }
    }

    const q = track.isrc ? `isrc:${track.isrc}` : `track:${track.title} artist:${track.artist}`;
    this.metrics.spotifyApiRequests += 1;
    const res = await this.fetcher(`${SPOTIFY_API_BASE}/search?type=track&limit=5&q=${encodeURIComponent(q)}`, {
      headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' },
    });
    if (res.status === 401) {
      const err = new Error('Spotify authentication expired.');
      err.code = 'AUTH_EXPIRED';
      throw err;
    }
    if (!res.ok) throw new Error(`Spotify search failed (HTTP ${res.status}).`);
    const data = await res.json();
    const items = Array.isArray(data?.tracks?.items) ? data.tracks.items : [];
    const best = items.find((i) => i?.uri && i.is_playable !== false) || items[0];
    if (!best?.uri) throw new Error(`Track “${track.title}” not found on Spotify.`);
    this.uriMemo.set(key, best.uri);
    return best.uri;
  }

  async ensurePlaybackTarget(accessToken) {
    if (!this.capabilities) this.capabilities = await this.capabilitiesDetector();

    // 1. Prefer official in-browser Web Playback SDK when EME & browser support it.
    if (this.capabilities.sdkSupported) {
      try {
        const deviceId = await this.device.connect({ sdkLoader: this.sdkLoader });
        this.device.activateElement();
        this.mode = 'sdk';
        this.activeDeviceId = deviceId;
        this.activeDeviceName = 'Spot+ Web Player (Official SDK)';
        return { mode: 'sdk', deviceId };
      } catch (err) {
        if (err?.code === 'PREMIUM_REQUIRED') {
          this.setStatus('premium-required', err.message);
          throw err;
        }
        if (err?.code === 'AUTH_EXPIRED') {
          this.setStatus('auth-expired', err.message);
          throw err;
        }
        // If browser EME rejected SDK initialization, fall through to check Spotify Connect remote devices.
        this.setStatus('browser-unsupported', err?.message || 'Web Playback SDK unsupported in this browser.');
      }
    }

    // 2. On iOS Safari / iOS PWA (or non-EME browsers), check for an active Spotify Connect device.
    this.metrics.spotifyApiRequests += 1;
    const devices = await listConnectDevices(accessToken, { fetcher: this.fetcher });
    const chosen = devices.find((d) => d.is_active && !d.is_restricted) || devices.find((d) => !d.is_restricted);
    if (chosen?.id) {
      this.mode = 'connect-remote';
      this.activeDeviceId = chosen.id;
      this.activeDeviceName = `${chosen.name} (Spotify Connect)`;
      return { mode: 'connect-remote', deviceId: chosen.id };
    }

    const err = new Error(
      this.capabilities.sdkCaveat
      || 'Open Spotify on any device or use a supported desktop browser for official Spotify playback.',
    );
    err.code = this.capabilities.sdkSupported ? 'NO_DEVICE' : 'BROWSER_UNSUPPORTED';
    throw err;
  }

  /** Load and start playing a track through Spotify's official authorized playback path. */
  async loadAndPlay(track, { startAt = 0, autoplay = true, volume = this.volume } = {}) {
    const t0 = Date.now();
    this.volume = volume;
    const token = await this.getToken();
    if (!token) {
      this.setStatus('auth-expired', 'Connect or reconnect your Spotify account.');
      const err = new Error('Spotify account not connected.');
      err.code = 'AUTH_EXPIRED';
      throw err;
    }

    if (!this.profile) {
      this.profile = await fetchSpotifyProfile({
        accessToken: token,
        storage: this.storage,
        fetcher: this.fetcher,
      });
    }
    if (!this.profile.isPremium) {
      this.setStatus('premium-required', 'Spotify Premium is required for official playback.');
      const err = new Error('Spotify Premium is required for official playback.');
      err.code = 'PREMIUM_REQUIRED';
      throw err;
    }

    const target = await this.ensurePlaybackTarget(token);
    const uri = await this.resolveTrackUri(track, token);

    this.currentUri = uri;
    this.endedEmittedForUri = '';
    this.currentTime = startAt || 0;
    this.duration = Number(track.duration) || 0;
    this.active = true;

    if (target.mode === 'sdk') {
      await this.device.setVolume(this.volume);
    } else {
      await controlConnectDevice({
        accessToken: token,
        deviceId: target.deviceId,
        action: 'volume',
        volumePercent: this.volume * 100,
        fetcher: this.fetcher,
      });
    }

    this.metrics.spotifyApiRequests += 1;
    await startTrackOnDevice({
      accessToken: token,
      deviceId: target.deviceId,
      uri,
      positionMs: (startAt || 0) * 1000,
      fetcher: this.fetcher,
    });

    if (!autoplay) {
      await this.pause();
    } else {
      this.paused = false;
      this.lastStateAt = Date.now();
      this.startTick();
      if (target.mode === 'connect-remote') {
        this.verifiedPlayback = true;
        this.metrics.tracksPlayed += 1;
        this.metrics.lastTimeToFirstAudioMs = Date.now() - t0;
        this.setStatus('playback-ready', `Playing on ${this.activeDeviceName}`);
        this.onPlay();
      }
    }

    return {
      kind: 'spotify-official',
      engineLabel: target.mode === 'sdk' ? 'Spotify — Official Playback' : `Spotify Connect · ${this.activeDeviceName}`,
      uri,
      deviceId: target.deviceId,
      duration: this.duration,
      instance: 'spotify.com',
    };
  }

  handleDeviceEvent(kind, payload) {
    if (kind === 'ready') {
      this.activeDeviceId = payload.deviceId;
      this.mode = 'sdk';
      this.setStatus(this.verifiedPlayback ? 'playback-ready' : 'ready', 'Spotify Web Player ready.');
      return;
    }
    if (kind === 'not_ready') {
      this.setStatus('connected', 'Spotify Web Player went offline.');
      return;
    }
    if (kind === 'error') {
      this.metrics.failures += 1;
      if (payload?.code === 'PREMIUM_REQUIRED') this.setStatus('premium-required', payload.message);
      else if (payload?.code === 'AUTH_EXPIRED') this.setStatus('auth-expired', payload.message);
      else if (payload?.code === 'BROWSER_UNSUPPORTED') this.setStatus('browser-unsupported', payload.message);
      if (this.active) this.onError(payload?.message || 'Spotify playback error');
      return;
    }
    if (kind === 'state' && payload) {
      if (!this.active) return;
      const trackWindow = payload.track_window?.current_track;
      const prevPaused = this.paused;
      const posMs = Number(payload.position) || 0;
      const durMs = Number(payload.duration || trackWindow?.duration_ms) || 0;

      // Detect natural track end on Spotify Web Playback SDK (paused at 0 after being near end)
      if (
        payload.paused
        && posMs === 0
        && this.lastTrackPositionMs > 1000
        && durMs > 0
        && this.lastTrackPositionMs >= durMs - 4000
        && this.endedEmittedForUri !== this.currentUri
      ) {
        this.endedEmittedForUri = this.currentUri;
        this.paused = true;
        this.stopTick();
        this.onEnded();
        return;
      }

      this.paused = !!payload.paused;
      this.currentTime = posMs / 1000;
      if (durMs > 0) this.duration = durMs / 1000;
      this.lastTrackPositionMs = posMs;
      this.lastStateAt = Date.now();

      if (!this.paused && posMs > 0 && !this.verifiedPlayback) {
        this.verifiedPlayback = true;
        this.metrics.tracksPlayed += 1;
        this.setStatus('playback-ready', `Playing via ${this.activeDeviceName}`);
      }

      if (prevPaused && !this.paused) {
        this.startTick();
        this.onPlay();
      } else if (!prevPaused && this.paused) {
        this.stopTick();
        this.onPause();
      }
      this.onTime(this.currentTime);
    }
  }

  startTick() {
    this.stopTick();
    this.tickTimer = setInterval(() => {
      if (!this.active || this.paused) return;
      const now = Date.now();
      const dt = (now - this.lastStateAt) / 1000;
      this.lastStateAt = now;
      if (dt > 0 && dt < 2) {
        this.currentTime = this.duration > 0
          ? Math.min(this.duration, this.currentTime + dt)
          : this.currentTime + dt;
        this.onTime(this.currentTime);
      }
    }, 350);
  }

  stopTick() {
    if (this.tickTimer) {
      clearInterval(this.tickTimer);
      this.tickTimer = null;
    }
  }

  async play() {
    if (!this.active) return;
    if (this.mode === 'sdk') {
      await this.device.play();
    } else if (this.mode === 'connect-remote') {
      const token = await this.getToken();
      if (token) {
        await controlConnectDevice({
          accessToken: token,
          deviceId: this.activeDeviceId,
          action: 'play',
          fetcher: this.fetcher,
        });
      }
    }
    this.paused = false;
    this.lastStateAt = Date.now();
    this.startTick();
    this.onPlay();
  }

  async pause() {
    if (!this.active) return;
    this.paused = true;
    this.stopTick();
    if (this.mode === 'sdk') {
      await this.device.pause();
    } else if (this.mode === 'connect-remote') {
      const token = await this.getToken();
      if (token) {
        await controlConnectDevice({
          accessToken: token,
          deviceId: this.activeDeviceId,
          action: 'pause',
          fetcher: this.fetcher,
        });
      }
    }
    this.onPause();
  }

  async seek(sec) {
    if (!this.active) return;
    const clamped = Math.max(0, Math.min(this.duration || sec, Number(sec) || 0));
    this.currentTime = clamped;
    this.lastStateAt = Date.now();
    if (this.mode === 'sdk') {
      await this.device.seek(clamped * 1000);
    } else if (this.mode === 'connect-remote') {
      const token = await this.getToken();
      if (token) {
        await controlConnectDevice({
          accessToken: token,
          deviceId: this.activeDeviceId,
          action: 'seek',
          positionMs: clamped * 1000,
          fetcher: this.fetcher,
        });
      }
    }
    this.onTime(this.currentTime);
  }

  async setVolume(v) {
    this.volume = Math.max(0, Math.min(1, Number(v) || 0));
    if (!this.active) return;
    if (this.mode === 'sdk') {
      await this.device.setVolume(this.volume);
    } else if (this.mode === 'connect-remote') {
      const token = await this.getToken();
      if (token) {
        await controlConnectDevice({
          accessToken: token,
          deviceId: this.activeDeviceId,
          action: 'volume',
          volumePercent: this.volume * 100,
          fetcher: this.fetcher,
        });
      }
    }
  }

  async enqueue(track) {
    if (!this.active || !this.activeDeviceId) return false;
    const token = await this.getToken();
    if (!token) return false;
    const uri = await this.resolveTrackUri(track, token);
    return queueTrackOnDevice({
      accessToken: token,
      deviceId: this.activeDeviceId,
      uri,
      fetcher: this.fetcher,
    });
  }

  stop() {
    this.stopTick();
    if (this.active && !this.paused && this.mode === 'sdk') {
      this.device.pause().catch(() => {});
    }
    this.active = false;
    this.paused = true;
    this.currentUri = '';
    this.lastTrackPositionMs = 0;
  }
}
