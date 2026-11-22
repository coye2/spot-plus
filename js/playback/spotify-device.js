// js/playback/spotify-device.js
// Official Spotify Web Playback SDK device controller + Spotify Connect remote device API.

import { SPOTIFY_API_BASE } from './spotify-auth.js';

export const SPOTIFY_SDK_URL = 'https://sdk.scdn.co/spotify-player.js';

let sdkLoadPromise = null;

/** Load the official Spotify Web Playback SDK script once. */
export function loadSpotifyWebPlaybackSDK(doc = globalThis.document, win = globalThis.window) {
  if (win?.Spotify?.Player) return Promise.resolve(win.Spotify);
  if (sdkLoadPromise) return sdkLoadPromise;
  if (!doc || !win) return Promise.reject(new Error('Browser DOM unavailable for Spotify Web Playback SDK.'));

  sdkLoadPromise = new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      sdkLoadPromise = null;
      reject(new Error('Spotify Web Playback SDK timed out while loading.'));
    }, 15_000);

    const prevReady = win.onSpotifyWebPlaybackSDKReady;
    win.onSpotifyWebPlaybackSDKReady = () => {
      clearTimeout(timeout);
      if (typeof prevReady === 'function') {
        try { prevReady(); } catch { /* ignore */ }
      }
      if (win.Spotify?.Player) resolve(win.Spotify);
      else {
        sdkLoadPromise = null;
        reject(new Error('Spotify SDK loaded without Player constructor.'));
      }
    };

    const existing = doc.querySelector(`script[src="${SPOTIFY_SDK_URL}"]`);
    if (!existing) {
      const script = doc.createElement('script');
      script.src = SPOTIFY_SDK_URL;
      script.async = true;
      script.onerror = () => {
        clearTimeout(timeout);
        sdkLoadPromise = null;
        reject(new Error('Failed to load Spotify Web Playback SDK script.'));
      };
      (doc.head || doc.body).appendChild(script);
    }
  });
  return sdkLoadPromise;
}

/** Query the user's active Spotify Connect devices via Web API. */
export async function listConnectDevices(accessToken, { fetcher = globalThis.fetch } = {}) {
  const res = await fetcher(`${SPOTIFY_API_BASE}/me/player/devices`, {
    headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' },
  });
  if (res.status === 401) {
    const err = new Error('Spotify authentication expired.');
    err.code = 'AUTH_EXPIRED';
    throw err;
  }
  if (!res.ok) return [];
  const data = await res.json().catch(() => ({}));
  return Array.isArray(data.devices) ? data.devices : [];
}

/** Start playback of a canonical Spotify track URI on the target device ID via Spotify Web API. */
export async function startTrackOnDevice({
  accessToken,
  deviceId,
  uri,
  positionMs = 0,
  fetcher = globalThis.fetch,
}) {
  const qs = deviceId ? `?device_id=${encodeURIComponent(deviceId)}` : '';
  const res = await fetcher(`${SPOTIFY_API_BASE}/me/player/play${qs}`, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({
      uris: [uri],
      position_ms: Math.max(0, Math.floor(Number(positionMs) || 0)),
    }),
  });
  if (res.status === 204 || res.status === 200 || res.status === 202) return true;
  if (res.status === 401) {
    const err = new Error('Spotify authentication expired.');
    err.code = 'AUTH_EXPIRED';
    throw err;
  }
  if (res.status === 403) {
    const err = new Error('Spotify Premium is required for official playback.');
    err.code = 'PREMIUM_REQUIRED';
    throw err;
  }
  if (res.status === 404) {
    const err = new Error('No active Spotify playback device found.');
    err.code = 'NO_DEVICE';
    throw err;
  }
  const detail = await res.json().catch(() => null);
  throw new Error(detail?.error?.message || `Spotify playback start failed (HTTP ${res.status}).`);
}

export async function queueTrackOnDevice({
  accessToken,
  deviceId,
  uri,
  fetcher = globalThis.fetch,
}) {
  const params = new URLSearchParams({ uri });
  if (deviceId) params.set('device_id', deviceId);
  const res = await fetcher(`${SPOTIFY_API_BASE}/me/player/queue?${params.toString()}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' },
  });
  return res.ok || res.status === 204;
}

export async function controlConnectDevice({
  accessToken,
  deviceId,
  action,
  positionMs,
  volumePercent,
  fetcher = globalThis.fetch,
}) {
  const params = new URLSearchParams();
  if (deviceId) params.set('device_id', deviceId);
  let endpoint = '';
  let method = 'PUT';
  if (action === 'play') endpoint = '/me/player/play';
  else if (action === 'pause') endpoint = '/me/player/pause';
  else if (action === 'seek') {
    endpoint = '/me/player/seek';
    params.set('position_ms', String(Math.max(0, Math.floor(Number(positionMs) || 0))));
  } else if (action === 'volume') {
    endpoint = '/me/player/volume';
    params.set('volume_percent', String(Math.max(0, Math.min(100, Math.round(Number(volumePercent) || 0)))));
  } else return false;

  const qs = params.toString() ? `?${params.toString()}` : '';
  const res = await fetcher(`${SPOTIFY_API_BASE}${endpoint}${qs}`, {
    method,
    headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' },
  });
  return res.ok || res.status === 204;
}

export class SpotifyDeviceController {
  constructor({ name = 'Spot+ Web Player', volume = 0.85, getToken, onEvent = () => {} } = {}) {
    this.name = name;
    this.volume = volume;
    this.getToken = getToken;
    this.onEvent = onEvent;
    this.player = null;
    this.deviceId = null;
    this.ready = false;
    this.connecting = null;
  }

  async connect({ sdkLoader = loadSpotifyWebPlaybackSDK } = {}) {
    if (this.ready && this.deviceId && this.player) return this.deviceId;
    if (this.connecting) return this.connecting;

    this.connecting = (async () => {
      const SpotifySDK = await sdkLoader();
      if (this.player) {
        try { this.player.disconnect(); } catch { /* ignore */ }
      }
      const player = new SpotifySDK.Player({
        name: this.name,
        volume: this.volume,
        getOAuthToken: (cb) => {
          Promise.resolve(this.getToken?.())
            .then((tok) => cb(tok || ''))
            .catch(() => cb(''));
        },
      });
      this.player = player;

      const readyPromise = new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          reject(new Error('Spotify Web Playback device registration timed out.'));
        }, 12_000);

        player.addListener('ready', ({ device_id }) => {
          clearTimeout(timer);
          this.deviceId = device_id;
          this.ready = true;
          this.onEvent('ready', { deviceId: device_id });
          resolve(device_id);
        });
        player.addListener('not_ready', ({ device_id }) => {
          this.ready = false;
          this.onEvent('not_ready', { deviceId: device_id });
        });
        player.addListener('initialization_error', ({ message }) => {
          clearTimeout(timer);
          this.ready = false;
          const err = new Error(message || 'Browser does not support Spotify Web Playback SDK.');
          err.code = 'BROWSER_UNSUPPORTED';
          this.onEvent('error', err);
          reject(err);
        });
        player.addListener('authentication_error', ({ message }) => {
          clearTimeout(timer);
          this.ready = false;
          const err = new Error(message || 'Spotify authentication expired.');
          err.code = 'AUTH_EXPIRED';
          this.onEvent('error', err);
          reject(err);
        });
        player.addListener('account_error', ({ message }) => {
          clearTimeout(timer);
          this.ready = false;
          const err = new Error(message || 'Spotify Premium is required.');
          err.code = 'PREMIUM_REQUIRED';
          this.onEvent('error', err);
          reject(err);
        });
        player.addListener('playback_error', ({ message }) => {
          const err = new Error(message || 'Spotify playback error.');
          err.code = 'PLAYBACK_ERROR';
          this.onEvent('error', err);
        });
        player.addListener('player_state_changed', (sdkState) => {
          this.onEvent('state', sdkState);
        });
      });

      const ok = await player.connect();
      if (!ok) throw new Error('Spotify Web Playback SDK failed to connect.');
      return readyPromise;
    })().finally(() => {
      this.connecting = null;
    });

    return this.connecting;
  }

  activateElement() {
    if (typeof this.player?.activateElement === 'function') {
      try { this.player.activateElement(); } catch { /* ignore */ }
    }
  }

  async play() { return this.player?.resume?.(); }
  async pause() { return this.player?.pause?.(); }
  async toggle() { return this.player?.togglePlay?.(); }
  async seek(ms) { return this.player?.seek?.(Math.max(0, Math.floor(ms))); }
  async setVolume(v) {
    this.volume = Math.max(0, Math.min(1, Number(v) || 0));
    return this.player?.setVolume?.(this.volume);
  }

  disconnect() {
    this.ready = false;
    this.deviceId = null;
    if (this.player) {
      try { this.player.disconnect(); } catch { /* ignore */ }
      this.player = null;
    }
  }
}
