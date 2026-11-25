// js/vehicle/microbridge-client.js — Path 3: PWA-side Native Microbridge Adapter.
// Connects Spot+ PWA to either iOS WKWebView (`window.webkit.messageHandlers.spotplusBridge`),
// Android TWA (`MessagePort` / `WebMessageChannel`), or an in-memory loopback transport in tests.
// Always disabled unless `featureFlags.isEnabled('vehicleNativeMicrobridge')` is true.

import {
  ALLOWED_BRIDGE_ORIGINS,
  EngineAuthorityLock,
  MESSAGE_TYPES,
  createEnvelope,
  isAllowedBridgeOrigin,
  isSafeMediaUrl,
  validateEnvelope,
} from './microbridge-protocol.js';

export class NativeMicrobridgeClient {
  constructor({
    transport = null,
    allowedOrigins = ALLOWED_BRIDGE_ORIGINS,
    resolveTrack = null,
    getLibrarySnapshot = null,
    onStateSync = null,
    onAuthorityChange = null,
  } = {}) {
    this._transport = transport;
    this._allowedOrigins = allowedOrigins;
    this._resolveTrack = resolveTrack;
    this._getLibrarySnapshot = getLibrarySnapshot;
    this._onStateSync = onStateSync;
    this._onAuthorityChange = onAuthorityChange;

    this.authority = new EngineAuthorityLock();
    this.connected = false;
    this.lastNativeState = null;
    this._pending = new Map();
    this._cleanup = null;
  }

  /** Detects whether a native iOS WKWebView or Android TWA bridge handle exists in the current window. */
  static detectTransport(win = globalThis.window) {
    if (!win) return null;
    if (win.webkit?.messageHandlers?.spotplusBridge?.postMessage) {
      return {
        kind: 'ios-wkwebview',
        send(envelope) {
          win.webkit.messageHandlers.spotplusBridge.postMessage(JSON.stringify(envelope));
        },
        listen(onMessage) {
          const prev = win.__spotplusNativeDispatch;
          win.__spotplusNativeDispatch = (raw) => {
            const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
            onMessage(parsed, win.location?.origin || 'https://coye2.github.io');
          };
          return () => {
            if (prev) win.__spotplusNativeDispatch = prev;
            else delete win.__spotplusNativeDispatch;
          };
        },
      };
    }
    if (win.__spotplusTwaPort && typeof win.__spotplusTwaPort.postMessage === 'function') {
      const port = win.__spotplusTwaPort;
      return {
        kind: 'android-twa-port',
        send(envelope) {
          port.postMessage(JSON.stringify(envelope));
        },
        listen(onMessage) {
          const handler = (event) => {
            const parsed = typeof event.data === 'string' ? JSON.parse(event.data) : event.data;
            onMessage(parsed, event.origin || win.location?.origin || '');
          };
          port.addEventListener?.('message', handler);
          port.start?.();
          return () => port.removeEventListener?.('message', handler);
        },
      };
    }
    return null;
  }

  connect({ timeoutMs = 2500 } = {}) {
    const transport = this._transport || NativeMicrobridgeClient.detectTransport();
    if (!transport) {
      return Promise.resolve({ ok: false, reason: 'no-native-transport', authority: this.authority.snapshot() });
    }
    this._transport = transport;
    this._cleanup?.();
    this._cleanup = transport.listen((msg, origin) => this._handleIncoming(msg, origin));

    return this.request(MESSAGE_TYPES.HELLO, {
      client: 'spotplus-pwa',
      capabilities: ['resolve', 'queue', 'library', 'pairing'],
    }, timeoutMs).then((ack) => {
      this.connected = true;
      const snap = this.authority.claimNative({
        platform: ack?.payload?.platform || transport.kind,
        version: ack?.payload?.version || '0.1.0',
      });
      this._onAuthorityChange?.(snap);
      return { ok: true, authority: snap, features: ack?.payload?.features || [] };
    }).catch((err) => {
      this.disconnect();
      return { ok: false, reason: err?.message || 'handshake-timeout', authority: this.authority.snapshot() };
    });
  }

  disconnect() {
    this._cleanup?.();
    this._cleanup = null;
    this.connected = false;
    for (const [, pending] of this._pending) {
      clearTimeout(pending.timer);
      pending.reject(new Error('Microbridge disconnected'));
    }
    this._pending.clear();
    const snap = this.authority.releaseToWeb();
    this._onAuthorityChange?.(snap);
    return snap;
  }

  send(type, payload = {}, opts = {}) {
    if (!this._transport) throw new Error('No native microbridge transport attached');
    const envelope = createEnvelope(type, payload, opts);
    this._transport.send(envelope);
    return envelope;
  }

  request(type, payload = {}, timeoutMs = 4000) {
    return new Promise((resolve, reject) => {
      const envelope = this.send(type, payload);
      const timer = setTimeout(() => {
        this._pending.delete(envelope.id);
        reject(new Error(`Microbridge request timeout: ${type}`));
      }, timeoutMs);
      timer.unref?.();
      this._pending.set(envelope.id, { resolve, reject, timer });
    });
  }

  async _handleIncoming(raw, origin) {
    if (origin && !isAllowedBridgeOrigin(origin, this._allowedOrigins)) {
      return;
    }
    const check = validateEnvelope(raw);
    if (!check.ok) return;
    const msg = check.envelope;

    if (msg.replyTo && this._pending.has(msg.replyTo)) {
      const pending = this._pending.get(msg.replyTo);
      this._pending.delete(msg.replyTo);
      clearTimeout(pending.timer);
      pending.resolve(msg);
      return;
    }

    if (msg.type === MESSAGE_TYPES.STATE_SYNC) {
      this.lastNativeState = { ...msg.payload, receivedAt: Date.now() };
      this._onStateSync?.(this.lastNativeState);
      return;
    }

    if (msg.type === MESSAGE_TYPES.RESOLVE_TRACK || msg.type === MESSAGE_TYPES.ERROR_REQUEST_FRESH_STREAM) {
      if (typeof this._resolveTrack !== 'function') return;
      try {
        const resolved = await this._resolveTrack(msg.payload.track, { fresh: msg.type === MESSAGE_TYPES.ERROR_REQUEST_FRESH_STREAM });
        if (!resolved?.url || !isSafeMediaUrl(resolved.url, { allowLocalhostHttp: !!resolved.devLocal })) {
          this.send(MESSAGE_TYPES.ERROR_REPORT, {
            code: 'INVALID_STREAM_URL',
            trackId: msg.payload.track?.id || '',
          }, { replyTo: msg.id });
          return;
        }
        this.send(MESSAGE_TYPES.RESOLVE_RESULT, {
          trackId: msg.payload.track?.id || '',
          streamUrl: resolved.url,
          mime: resolved.mime || 'audio/mp4',
          durationSec: Number(resolved.duration) || 0,
          sourceKind: resolved.kind || 'ytrelay',
          expiresInSec: Number(resolved.expiresInSec) || 1800,
          devLocal: !!resolved.devLocal,
        }, { replyTo: msg.id });
      } catch (err) {
        this.send(MESSAGE_TYPES.ERROR_REPORT, {
          code: 'RESOLVE_FAILED',
          trackId: msg.payload.track?.id || '',
          message: String(err?.message || 'Track resolution failed').slice(0, 160),
        }, { replyTo: msg.id });
      }
      return;
    }

    if (
      msg.type === MESSAGE_TYPES.LIBRARY_GET_ROOT ||
      msg.type === MESSAGE_TYPES.LIBRARY_GET_CHILDREN ||
      msg.type === MESSAGE_TYPES.LIBRARY_SEARCH
    ) {
      if (typeof this._getLibrarySnapshot !== 'function') return;
      const snapshot = await this._getLibrarySnapshot();
      const items = browseLibrarySnapshot(snapshot, msg.type, msg.payload);
      this.send(MESSAGE_TYPES.LIBRARY_RESPONSE, { parentId: msg.payload.parentId || 'root', items }, { replyTo: msg.id });
    }
  }

  // Convenience command helpers used by PWA controls when authority === 'native'
  setQueue(tracks, startIndex = 0, autoplay = true) {
    return this.send(MESSAGE_TYPES.QUEUE_SET, { tracks, startIndex, autoplay });
  }
  play() { return this.send(MESSAGE_TYPES.CMD_PLAY); }
  pause() { return this.send(MESSAGE_TYPES.CMD_PAUSE); }
  toggle() { return this.send(MESSAGE_TYPES.CMD_TOGGLE); }
  next() { return this.send(MESSAGE_TYPES.CMD_NEXT); }
  previous() { return this.send(MESSAGE_TYPES.CMD_PREVIOUS); }
  seek(positionSec) { return this.send(MESSAGE_TYPES.CMD_SEEK, { positionSec: Number(positionSec) || 0 }); }
  syncLibrarySnapshot(snapshot) { return this.send(MESSAGE_TYPES.LIBRARY_SYNC_SNAPSHOT, { snapshot }); }
}

/**
 * Pure helper mapping Spot+ library snapshot into driver-safe CarPlay / Android Auto browse trees.
 * Respects Apple CarPlay & Android Auto driver-distraction depth limits (max 2-3 taps to play).
 */
export function browseLibrarySnapshot(snapshot = {}, type, payload = {}) {
  const likes = snapshot.likes || [];
  const playlists = snapshot.playlists || [];

  if (type === MESSAGE_TYPES.LIBRARY_GET_ROOT) {
    return [
      { id: 'spotplus:likes', title: 'Liked Songs', subtitle: `${likes.length} songs`, browsable: true, playable: false },
      { id: 'spotplus:playlists', title: 'Playlists', subtitle: `${playlists.length} playlists`, browsable: true, playable: false },
    ];
  }

  if (type === MESSAGE_TYPES.LIBRARY_GET_CHILDREN) {
    const parentId = String(payload.parentId || 'root');
    if (parentId === 'spotplus:likes') {
      return likes.slice(0, 100).map((t) => ({
        id: `track:${t.id}`,
        trackId: t.id,
        title: t.title,
        artist: t.artist,
        album: t.album,
        artworkUrl: t.cover || t.coverXl || '',
        durationSec: Number(t.duration) || 0,
        browsable: false,
        playable: true,
      }));
    }
    if (parentId === 'spotplus:playlists') {
      return playlists.slice(0, 50).map((p) => ({
        id: `playlist:${p.id}`,
        title: p.name,
        subtitle: `${(p.tracks || []).length} songs`,
        browsable: true,
        playable: false,
      }));
    }
    if (parentId.startsWith('playlist:')) {
      const pid = parentId.slice('playlist:'.length);
      const pl = playlists.find((p) => String(p.id) === pid);
      return (pl?.tracks || []).slice(0, 100).map((t) => ({
        id: `track:${t.id}`,
        trackId: t.id,
        title: t.title,
        artist: t.artist,
        album: t.album,
        artworkUrl: t.cover || t.coverXl || '',
        durationSec: Number(t.duration) || 0,
        browsable: false,
        playable: true,
      }));
    }
    return [];
  }

  if (type === MESSAGE_TYPES.LIBRARY_SEARCH) {
    const q = String(payload.query || '').trim().toLowerCase();
    if (!q) return [];
    const seen = new Set();
    const matches = [];
    const consider = (t) => {
      if (!t || !t.id || seen.has(t.id)) return;
      const hay = `${t.title || ''} ${t.artist || ''} ${t.album || ''}`.toLowerCase();
      if (hay.includes(q)) {
        seen.add(t.id);
        matches.push({
          id: `track:${t.id}`,
          trackId: t.id,
          title: t.title,
          artist: t.artist,
          album: t.album,
          artworkUrl: t.cover || t.coverXl || '',
          durationSec: Number(t.duration) || 0,
          browsable: false,
          playable: true,
        });
      }
    };
    likes.forEach(consider);
    playlists.forEach((p) => (p.tracks || []).forEach(consider));
    return matches.slice(0, 25);
  }

  return [];
}
