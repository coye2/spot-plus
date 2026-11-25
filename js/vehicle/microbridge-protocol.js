// js/vehicle/microbridge-protocol.js — Path 3: Spot+ Native Microbridge Shared Wire Protocol.
// Defines the versioned message contract between the Spot+ PWA and an optional thin native
// companion (Android Media3 MediaLibraryService + TWA, or iOS AVPlayer + CarPlay + WKWebView).
//
// Invariant: Only ONE authoritative playback engine produces sound per device.
// When the native microbridge completes handshake, the native engine becomes authoritative
// (persisting playback independently when the web UI is suspended) and the PWA acts as UI + resolver.

export const MICROBRIDGE_PROTOCOL = 'spotplus.microbridge.v1';

export const ALLOWED_BRIDGE_ORIGINS = Object.freeze([
  'https://coye2.github.io',
  'http://localhost:3000',
  'http://localhost:8080',
  'http://127.0.0.1:8080',
]);

export const MESSAGE_TYPES = Object.freeze({
  // Handshake & single-engine authority lock
  HELLO: 'bridge.hello',
  HELLO_ACK: 'bridge.hello_ack',
  HEARTBEAT: 'bridge.heartbeat',

  // 1. Track resolution (PWA resolves authorized stream URLs -> native engine plays)
  RESOLVE_TRACK: 'resolve.track',
  RESOLVE_RESULT: 'resolve.result',

  // 2. Queue management (authoritative queue lives in native engine so background advance survives suspension)
  QUEUE_SET: 'queue.set',
  QUEUE_APPEND: 'queue.append',
  QUEUE_REMOVE: 'queue.remove',
  QUEUE_MOVE: 'queue.move',
  QUEUE_CLEAR: 'queue.clear',
  QUEUE_SNAPSHOT: 'queue.snapshot',

  // 3. Playback state (native -> PWA authoritative updates)
  STATE_SYNC: 'state.sync',

  // 4. Playback commands (PWA or vehicle head unit -> native engine)
  CMD_PLAY: 'cmd.play',
  CMD_PAUSE: 'cmd.pause',
  CMD_TOGGLE: 'cmd.toggle',
  CMD_SEEK: 'cmd.seek',
  CMD_NEXT: 'cmd.next',
  CMD_PREVIOUS: 'cmd.previous',
  CMD_SET_RATE: 'cmd.setRate',
  CMD_SET_REPEAT: 'cmd.setRepeat',
  CMD_SET_SHUFFLE: 'cmd.setShuffle',

  // 5. Metadata (including SponsorBlock segments & multi-size artwork)
  METADATA_UPDATE: 'metadata.update',

  // 6. Library browsing (Android Auto MediaLibraryService & CarPlay CPListTemplate)
  LIBRARY_SYNC_SNAPSHOT: 'library.syncSnapshot',
  LIBRARY_GET_ROOT: 'library.getRoot',
  LIBRARY_GET_CHILDREN: 'library.getChildren',
  LIBRARY_SEARCH: 'library.search',
  LIBRARY_RESPONSE: 'library.response',

  // 7. Error recovery
  ERROR_REPORT: 'error.report',
  ERROR_REQUEST_FRESH_STREAM: 'error.requestFreshStream',

  // 8. Account-free encrypted device pairing (reuses Spot+ 64-hex sync secret on device)
  PAIRING_CHALLENGE: 'pairing.challenge',
  PAIRING_CONFIRM: 'pairing.confirm',
  PAIRING_SYNC_KEY: 'pairing.syncKey',
});

const KNOWN_TYPES = new Set(Object.values(MESSAGE_TYPES));
const ALLOWED_PLAYBACK_STATES = new Set(['IDLE', 'BUFFERING', 'PLAYING', 'PAUSED', 'ENDED', 'ERROR']);
const ALLOWED_ROUTES = new Set(['speaker', 'headphones', 'bluetooth', 'carplay', 'android-auto', 'airplay', 'unknown']);

let seqCounter = 0;

export function nextMessageId(prefix = 'mb') {
  seqCounter = (seqCounter + 1) % 1_000_000_000;
  return `${prefix}-${Date.now().toString(36)}-${seqCounter.toString(36)}`;
}

export function isAllowedBridgeOrigin(origin, allowlist = ALLOWED_BRIDGE_ORIGINS) {
  if (!origin || typeof origin !== 'string') return false;
  return allowlist.includes(origin);
}

/**
 * Validates that a resolved media or artwork URL uses HTTPS (or localhost HTTP in dev)
 * and rejects dangerous schemes (`javascript:`, `data:`, `file:`) or private metadata IPs.
 */
export function isSafeMediaUrl(rawUrl, { allowLocalhostHttp = false } = {}) {
  if (!rawUrl || typeof rawUrl !== 'string' || rawUrl.length > 4096) return false;
  try {
    const parsed = new URL(rawUrl);
    if (parsed.username || parsed.password) return false;
    if (parsed.protocol === 'https:') {
      return !isBlockedHost(parsed.hostname);
    }
    if (allowLocalhostHttp && parsed.protocol === 'http:') {
      return parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1';
    }
    return false;
  } catch {
    return false;
  }
}

function isBlockedHost(hostname) {
  const h = String(hostname || '').toLowerCase().replace(/^\[|\]$/g, '');
  if (!h) return true;
  if (h === 'localhost' || h === '127.0.0.1' || h === '::1' || h === '0.0.0.0' || h.endsWith('.local')) return true;
  if (h === '169.254.169.254' || h.startsWith('169.254.')) return true;
  if (h.startsWith('10.') || h.startsWith('192.168.') || h.startsWith('127.')) return true;
  if (/^172\.(1[6-9]|2\d|3[0-1])\./.test(h)) return true;
  if (/^(::ffff:|fe80:|fc[0-9a-f]{2}:|fd[0-9a-f]{2}:)/.test(h)) return true;
  return false;
}

export function createEnvelope(type, payload = {}, { id = nextMessageId(), replyTo = null } = {}) {
  if (!KNOWN_TYPES.has(type)) {
    throw new Error(`Unknown microbridge message type: ${type}`);
  }
  return {
    protocol: MICROBRIDGE_PROTOCOL,
    id,
    type,
    ts: Date.now(),
    ...(replyTo ? { replyTo } : {}),
    payload: payload && typeof payload === 'object' ? payload : {},
  };
}

export function validateEnvelope(msg) {
  if (!msg || typeof msg !== 'object' || Array.isArray(msg)) {
    return { ok: false, error: 'Envelope must be an object' };
  }
  if (msg.protocol !== MICROBRIDGE_PROTOCOL) {
    return { ok: false, error: 'Unsupported protocol version' };
  }
  if (typeof msg.id !== 'string' || msg.id.length < 2 || msg.id.length > 96) {
    return { ok: false, error: 'Invalid envelope id' };
  }
  if (!KNOWN_TYPES.has(msg.type)) {
    return { ok: false, error: `Unknown message type: ${String(msg.type)}` };
  }
  if (!msg.payload || typeof msg.payload !== 'object' || Array.isArray(msg.payload)) {
    return { ok: false, error: 'Payload must be an object' };
  }

  // Domain-specific safety validation on high-risk payloads
  if (msg.type === MESSAGE_TYPES.RESOLVE_RESULT && msg.payload.streamUrl) {
    if (!isSafeMediaUrl(msg.payload.streamUrl, { allowLocalhostHttp: !!msg.payload.devLocal })) {
      return { ok: false, error: 'Unsafe resolved stream URL' };
    }
  }
  if (msg.type === MESSAGE_TYPES.STATE_SYNC) {
    if (msg.payload.state && !ALLOWED_PLAYBACK_STATES.has(msg.payload.state)) {
      return { ok: false, error: 'Invalid playback state' };
    }
    if (msg.payload.route && !ALLOWED_ROUTES.has(msg.payload.route)) {
      return { ok: false, error: 'Invalid audio route' };
    }
  }
  if (msg.type === MESSAGE_TYPES.CMD_SEEK) {
    const pos = Number(msg.payload.positionSec);
    if (!Number.isFinite(pos) || pos < 0 || pos > 86400) {
      return { ok: false, error: 'Invalid seek position' };
    }
  }
  return { ok: true, envelope: msg };
}

/**
 * Enforces the single-authoritative-playback-engine invariant on a device.
 * When native authority is active, HTML5 web audio MUST stay silenced/delegated.
 */
export class EngineAuthorityLock {
  constructor() {
    this.authority = 'web'; // 'web' | 'native'
    this.nativePlatform = null; // 'android-media3' | 'ios-avplayer' | null
    this.nativeVersion = null;
    this.acquiredAt = 0;
  }

  claimNative({ platform, version } = {}) {
    this.authority = 'native';
    this.nativePlatform = String(platform || 'native');
    this.nativeVersion = String(version || '0.1.0');
    this.acquiredAt = Date.now();
    return this.snapshot();
  }

  releaseToWeb() {
    this.authority = 'web';
    this.nativePlatform = null;
    this.nativeVersion = null;
    this.acquiredAt = 0;
    return this.snapshot();
  }

  canWebAudioPlay() {
    return this.authority === 'web';
  }

  snapshot() {
    return {
      authority: this.authority,
      webAudioMutedByBridge: this.authority === 'native',
      nativePlatform: this.nativePlatform,
      nativeVersion: this.nativeVersion,
      acquiredAt: this.acquiredAt,
    };
  }
}
