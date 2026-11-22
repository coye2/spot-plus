// js/playback/spotify-auth.js
// Official Spotify OAuth 2.0 Authorization Code with PKCE (S256).
// Zero client secrets in browser bundles; never logs access or refresh tokens.

const AUTH_STORAGE_KEY = 'spotplus.spotify.pkce.session';
const PENDING_STORAGE_KEY = 'spotplus.spotify.pkce.pending';

export const SPOTIFY_AUTHORIZE_URL = 'https://accounts.spotify.com/authorize';
export const SPOTIFY_TOKEN_URL = 'https://accounts.spotify.com/api/token';
export const SPOTIFY_API_BASE = 'https://api.spotify.com/v1';

export const SPOTIFY_SCOPES = Object.freeze([
  'streaming',
  'user-read-email',
  'user-read-private',
  'user-read-playback-state',
  'user-modify-playback-state',
]);

function base64UrlEncode(bytes) {
  let str = '';
  for (let i = 0; i < bytes.length; i += 1) str += String.fromCharCode(bytes[i]);
  return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Generate an RFC 7636 PKCE code verifier (64 url-safe characters). */
export function generateCodeVerifier(length = 64, cryptoObj = globalThis.crypto) {
  const charset = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~';
  const bytes = new Uint8Array(Math.max(43, Math.min(128, length)));
  cryptoObj.getRandomValues(bytes);
  let out = '';
  for (let i = 0; i < bytes.length; i += 1) out += charset[bytes[i] % charset.length];
  return out;
}

/** Derive an RFC 7636 S256 PKCE code challenge from a verifier. */
export async function generateCodeChallenge(verifier, cryptoObj = globalThis.crypto) {
  const data = new TextEncoder().encode(verifier);
  const digest = await cryptoObj.subtle.digest('SHA-256', data);
  return base64UrlEncode(new Uint8Array(digest));
}

export function generateState(cryptoObj = globalThis.crypto) {
  const bytes = new Uint8Array(18);
  cryptoObj.getRandomValues(bytes);
  return base64UrlEncode(bytes);
}

/**
 * Determine the exact OAuth Redirect URI for the current deployment:
 * - On preview/dev servers running /auth/spotify/callback: `${origin}/auth/spotify/callback`
 * - On GitHub Pages static deployment: `${origin}${basePath}` (e.g. https://coye2.github.io/spot-plus/)
 */
export function resolveRedirectUri(loc = globalThis.location) {
  if (!loc?.origin) return 'https://coye2.github.io/spot-plus/';
  const host = String(loc.hostname || '');
  if (host.endsWith('.run.app') || host === 'localhost' || host === '127.0.0.1') {
    const origin = host === 'localhost' ? loc.origin.replace('localhost', '127.0.0.1') : loc.origin;
    return `${origin}/auth/spotify/callback`;
  }
  const basePath = loc.pathname.endsWith('/') ? loc.pathname : loc.pathname.replace(/[^/]*$/, '');
  return `${loc.origin}${basePath}`;
}

export function loadSession(storage = globalThis.localStorage) {
  try {
    const raw = JSON.parse(storage?.getItem?.(AUTH_STORAGE_KEY) || 'null');
    if (!raw || typeof raw !== 'object' || !raw.accessToken) return null;
    return raw;
  } catch {
    return null;
  }
}

export function saveSession(session, storage = globalThis.localStorage) {
  try {
    if (!session) storage?.removeItem?.(AUTH_STORAGE_KEY);
    else storage?.setItem?.(AUTH_STORAGE_KEY, JSON.stringify(session));
  } catch {
    /* private mode or quota full */
  }
}

export function clearSession(storage = globalThis.localStorage) {
  try {
    storage?.removeItem?.(AUTH_STORAGE_KEY);
    storage?.removeItem?.(PENDING_STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

function savePending(pending, storage = globalThis.localStorage) {
  try {
    if (!pending) storage?.removeItem?.(PENDING_STORAGE_KEY);
    else storage?.setItem?.(PENDING_STORAGE_KEY, JSON.stringify(pending));
  } catch {
    /* ignore */
  }
}

function loadPending(storage = globalThis.localStorage) {
  try {
    const raw = JSON.parse(storage?.getItem?.(PENDING_STORAGE_KEY) || 'null');
    if (!raw || Date.now() - Number(raw.createdAt || 0) > 15 * 60_000) return null;
    return raw;
  } catch {
    return null;
  }
}

export async function createAuthorizationRequest({
  clientId,
  redirectUri = resolveRedirectUri(),
  scopes = SPOTIFY_SCOPES,
  storage = globalThis.localStorage,
  cryptoObj = globalThis.crypto,
}) {
  const cleanId = String(clientId || '').trim();
  if (!/^[a-f0-9]{20,64}$/i.test(cleanId)) {
    throw new Error('Enter a valid Spotify Developer Client ID first.');
  }
  const verifier = generateCodeVerifier(64, cryptoObj);
  const challenge = await generateCodeChallenge(verifier, cryptoObj);
  const state = generateState(cryptoObj);
  savePending({ clientId: cleanId, verifier, state, redirectUri, createdAt: Date.now() }, storage);

  const params = new URLSearchParams({
    client_id: cleanId,
    response_type: 'code',
    redirect_uri: redirectUri,
    code_challenge_method: 'S256',
    code_challenge: challenge,
    state,
    scope: scopes.join(' '),
    show_dialog: 'false',
  });
  return {
    url: `${SPOTIFY_AUTHORIZE_URL}?${params.toString()}`,
    state,
    redirectUri,
  };
}

/** Exchange PKCE authorization code directly with Spotify (or via optional control-plane worker). */
export async function exchangeCodeForTokens({
  code,
  state,
  relayUrl = '',
  storage = globalThis.localStorage,
  fetcher = globalThis.fetch,
}) {
  const pending = loadPending(storage);
  if (!pending) throw new Error('Spotify sign-in expired. Start connecting again.');
  if (!state || state !== pending.state) {
    savePending(null, storage);
    throw new Error('Spotify OAuth state mismatch. Please retry sign-in.');
  }
  savePending(null, storage);

  let response;
  if (relayUrl) {
    response = await fetcher(`${relayUrl.replace(/\/$/, '')}/auth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        client_id: pending.clientId,
        code,
        redirect_uri: pending.redirectUri,
        code_verifier: pending.verifier,
      }),
    });
  } else {
    const form = new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: pending.clientId,
      code,
      redirect_uri: pending.redirectUri,
      code_verifier: pending.verifier,
    });
    response = await fetcher(SPOTIFY_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body: form.toString(),
    });
  }

  const data = await response.json().catch(() => null);
  if (!response.ok || !data?.access_token) {
    throw new Error(data?.error_description || data?.error || 'Spotify authorization exchange failed.');
  }

  const session = {
    clientId: pending.clientId,
    accessToken: data.access_token,
    refreshToken: data.refresh_token || '',
    tokenType: data.token_type || 'Bearer',
    scope: data.scope || SPOTIFY_SCOPES.join(' '),
    expiresAt: Date.now() + Math.max(60, Number(data.expires_in) || 3600) * 1000,
    profile: null,
  };
  saveSession(session, storage);
  return session;
}

/** Refresh an expiring PKCE access token without exposing any secret or logging tokens. */
export async function refreshAccessToken({
  relayUrl = '',
  storage = globalThis.localStorage,
  fetcher = globalThis.fetch,
} = {}) {
  const current = loadSession(storage);
  if (!current?.refreshToken || !current?.clientId) {
    throw new Error('Spotify session expired. Reconnect your Spotify account.');
  }

  let response;
  if (relayUrl) {
    response = await fetcher(`${relayUrl.replace(/\/$/, '')}/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        client_id: current.clientId,
        refresh_token: current.refreshToken,
      }),
    });
  } else {
    const form = new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: current.clientId,
      refresh_token: current.refreshToken,
    });
    response = await fetcher(SPOTIFY_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body: form.toString(),
    });
  }

  const data = await response.json().catch(() => null);
  if (!response.ok || !data?.access_token) {
    const expired = { ...current, expired: true };
    saveSession(expired, storage);
    throw new Error(data?.error_description || 'Spotify session expired. Reconnect your account.');
  }

  const updated = {
    ...current,
    accessToken: data.access_token,
    refreshToken: data.refresh_token || current.refreshToken,
    expiresAt: Date.now() + Math.max(60, Number(data.expires_in) || 3600) * 1000,
    expired: false,
  };
  saveSession(updated, storage);
  return updated;
}

/** Return a valid access token, transparently refreshing if within 90 s of expiry. */
export async function getValidAccessToken({
  relayUrl = '',
  storage = globalThis.localStorage,
  fetcher = globalThis.fetch,
  now = Date.now(),
} = {}) {
  const current = loadSession(storage);
  if (!current?.accessToken) return null;
  if (current.expired) return null;
  if (now + 90_000 < Number(current.expiresAt || 0)) return current.accessToken;
  if (!current.refreshToken) {
    saveSession({ ...current, expired: true }, storage);
    return null;
  }
  const refreshed = await refreshAccessToken({ relayUrl, storage, fetcher });
  return refreshed.accessToken;
}

/** Query Spotify /v1/me to detect account identity and Premium subscription eligibility. */
export async function fetchSpotifyProfile({
  accessToken,
  storage = globalThis.localStorage,
  fetcher = globalThis.fetch,
}) {
  if (!accessToken) throw new Error('Not signed in to Spotify.');
  const response = await fetcher(`${SPOTIFY_API_BASE}/me`, {
    headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' },
  });
  if (response.status === 401) {
    const current = loadSession(storage);
    if (current) saveSession({ ...current, expired: true }, storage);
    const err = new Error('Spotify authentication expired.');
    err.code = 'AUTH_EXPIRED';
    throw err;
  }
  if (!response.ok) throw new Error(`Spotify profile check failed (HTTP ${response.status}).`);
  const data = await response.json();
  const profile = {
    id: String(data.id || ''),
    displayName: String(data.display_name || data.id || 'Spotify listener'),
    product: String(data.product || 'unknown').toLowerCase(),
    isPremium: String(data.product || '').toLowerCase() === 'premium',
    country: String(data.country || ''),
  };
  const current = loadSession(storage);
  if (current) saveSession({ ...current, profile, expired: false }, storage);
  return profile;
}

/**
 * Inspect current URL search params on boot to complete redirect-based PKCE sign-in
 * (used on static GitHub Pages or iOS standalone PWA when popups aren't used).
 */
export function readCallbackParamsFromUrl(loc = globalThis.location, hist = globalThis.history) {
  if (!loc?.search) return null;
  const params = new URLSearchParams(loc.search);
  const code = params.get('spotify_code') || params.get('code');
  const state = params.get('spotify_state') || params.get('state');
  const error = params.get('spotify_error') || params.get('error');
  if (!code && !error) return null;
  // Clean sensitive authorization code from the URL immediately.
  if (hist?.replaceState) {
    params.delete('code');
    params.delete('state');
    params.delete('error');
    params.delete('spotify_code');
    params.delete('spotify_state');
    params.delete('spotify_error');
    const cleanSearch = params.toString() ? `?${params.toString()}` : '';
    hist.replaceState(null, '', `${loc.pathname}${cleanSearch}${loc.hash || ''}`);
  }
  return { code: code || '', state: state || '', error: error || '' };
}
