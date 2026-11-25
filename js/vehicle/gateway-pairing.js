// js/vehicle/gateway-pairing.js — Path 2: Account-Free Encrypted Pairing & Snapshot Packaging
// Bridges Spot+'s existing client-side encrypted sync key (js/relay-sync.js + js/library-sync.js)
// to an isolated OpenSubsonic Universal Media Gateway (workers/media-gateway/) without requiring
// user accounts, passwords, or service impersonation.

import { validSyncKey, newSyncKey } from '../relay-sync.js';

const enc = new TextEncoder();
const dec = new TextDecoder();

function toHex(buf) {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function fromHex(hex) {
  const clean = String(hex || '');
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  return out;
}

function toBase64Url(bytes) {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function fromBase64Url(text) {
  const padded = String(text || '').replace(/-/g, '+').replace(/_/g, '/');
  const pad = padded.length % 4 === 0 ? '' : '='.repeat(4 - (padded.length % 4));
  const raw = atob(padded + pad);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

async function sha256Bytes(text) {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(text)));
}

/**
 * Derives isolated OpenSubsonic gateway credentials from Spot+'s existing 64-hex sync secret.
 * Domain-separated so compromising a gateway API key NEVER reveals the root sync key or Nostr signing key.
 */
export async function deriveGatewayCredentials(syncSecret, { serverUrl = '' } = {}) {
  const secret = String(syncSecret || '').trim();
  if (!validSyncKey(secret)) {
    throw new Error('A valid 64-character hex Spot+ sync secret is required');
  }

  const userBytes = await sha256Bytes(`spotplus:gateway-user:v1:${secret}`);
  const keyBytes = await sha256Bytes(`spotplus:gateway-apikey:v1:${secret}`);
  const encBytes = await sha256Bytes(`spotplus:gateway-seal:v1:${secret}`);

  const username = `sp_${toHex(userBytes).slice(0, 12)}`;
  const apiKey = toBase64Url(keyBytes);
  const sealKeyHex = toHex(encBytes);

  let normalizedServerUrl = '';
  if (serverUrl) {
    const parsed = new URL(serverUrl);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      throw new Error('Gateway server URL must use http or https');
    }
    normalizedServerUrl = parsed.origin + parsed.pathname.replace(/\/+$/, '');
  }

  return {
    protocol: 'opensubsonic-1.16.1',
    serverUrl: normalizedServerUrl,
    username,
    apiKey,
    // Subsonic legacy clients that don't yet send apiKey can use apiKey as password with md5(password + salt).
    legacyPassword: apiKey,
    sealKeyHex,
    trustModel: {
      accountFree: true,
      rootSyncSecretExposed: false,
      gatewaySeesPlaintextLibrary: true,
      note: 'OpenSubsonic clients (Amperfy, Symfonium, Tempo, Substreamer) require plaintext REST metadata. Use a self-owned Cloudflare Worker or local LAN gateway to keep library indexing private.',
    },
  };
}

export function createGatewayPairingSecret() {
  return newSyncKey();
}

/**
 * Packages only vehicle-relevant library entities (Liked Songs, Playlists, Albums, Artists)
 * into a bounded, sanitized manifest for OpenSubsonic browsing — never settings, cookies, or secrets.
 */
export function buildGatewaySnapshot(library = {}, { maxPlaylists = 100, maxTracksPerPlaylist = 500, maxLikes = 2000 } = {}) {
  const cleanTrack = (t) => {
    if (!t || !t.id || !t.title) return null;
    const safeUrl = (u) => {
      if (!u || typeof u !== 'string') return '';
      try {
        const p = new URL(u);
        return p.protocol === 'https:' ? p.href : '';
      } catch {
        return '';
      }
    };
    return {
      id: String(t.id).slice(0, 80),
      title: String(t.title).slice(0, 200),
      artist: String(t.artist || 'Unknown Artist').slice(0, 160),
      album: String(t.album || 'Spot+').slice(0, 200),
      duration: Math.max(0, Math.min(36000, Math.round(Number(t.duration) || 0))),
      cover: safeUrl(t.cover || t.coverXl),
      streamUrl: safeUrl(t.streamUrl),
      starred: !!t.starred,
    };
  };

  const likes = (library.likes || [])
    .slice(0, maxLikes)
    .map((t) => cleanTrack({ ...t, starred: true }))
    .filter(Boolean);

  const playlists = (library.playlists || [])
    .slice(0, maxPlaylists)
    .filter((p) => p && p.id && p.name)
    .map((p) => ({
      id: String(p.id).slice(0, 80),
      name: String(p.name).slice(0, 160),
      updated: Number(p.updated) || Date.now(),
      tracks: (p.tracks || []).slice(0, maxTracksPerPlaylist).map(cleanTrack).filter(Boolean),
    }));

  return {
    schema: 'spotplus.gateway.snapshot.v1',
    generatedAt: Date.now(),
    likes,
    playlists,
  };
}

/**
 * Encrypts a gateway library snapshot with AES-256-GCM using the derived gateway seal key
 * so pairing payloads never travel in plaintext over relay channels or QR/link handoffs.
 */
export async function sealGatewaySnapshot(sealKeyHex, snapshot) {
  if (!validSyncKey(sealKeyHex)) throw new Error('Invalid gateway seal key');
  const key = await crypto.subtle.importKey('raw', fromHex(sealKeyHex), 'AES-GCM', false, ['encrypt']);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(JSON.stringify(snapshot))),
  );
  return `${toBase64Url(iv)}.${toBase64Url(ciphertext)}`;
}

export async function openGatewaySnapshot(sealKeyHex, envelope) {
  if (!validSyncKey(sealKeyHex)) throw new Error('Invalid gateway seal key');
  const parts = String(envelope || '').split('.');
  if (parts.length !== 2) throw new Error('Malformed encrypted gateway snapshot');
  const key = await crypto.subtle.importKey('raw', fromHex(sealKeyHex), 'AES-GCM', false, ['decrypt']);
  const plaintext = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: fromBase64Url(parts[0]) },
    key,
    fromBase64Url(parts[1]),
  );
  const text = dec.decode(plaintext);
  if (text.length > 4_000_000) throw new Error('Gateway snapshot exceeds size limit');
  return JSON.parse(text);
}
