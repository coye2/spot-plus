// workers/spotify-relay/src/auth.js
// Origin validation, PKCE token exchange / refresh helpers, and privacy-safe per-user key derivation.
// Never logs, stores, or echoes Spotify access tokens or refresh tokens.

export const DEFAULT_ALLOWED_ORIGINS = Object.freeze([
  'https://coye2.github.io',
  'https://open.spotify.com',
  'http://localhost:3000',
  'http://127.0.0.1:3000',
  'http://localhost:8080',
  'http://127.0.0.1:8080',
]);

export function isOriginAllowed(origin, env = {}) {
  if (!origin) return true;
  if (DEFAULT_ALLOWED_ORIGINS.includes(origin)) return true;
  if (env?.ALLOW_PREVIEW_ORIGINS === 'true' && /^https:\/\/[a-z0-9-]+\.run\.app$/i.test(origin)) {
    return true;
  }
  const extra = String(env?.EXTRA_ALLOWED_ORIGINS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  return extra.includes(origin);
}

/** Extract a structurally valid Bearer token from Authorization header without ever logging it. */
export function extractBearerToken(request) {
  const raw = request.headers.get('Authorization') || '';
  const match = /^Bearer\s+([A-Za-z0-9._~+/=-]{20,2048})$/.exec(raw.trim());
  return match ? match[1] : null;
}

/** Derive an anonymized per-user rate-limit key (SHA-256 prefix) from the bearer token. */
export async function deriveUserKey(token) {
  if (!token) return 'anon';
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('spotplus-sp:' + token));
  return [...new Uint8Array(digest)]
    .slice(0, 10)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/** Validate HTTPS redirect URI (or RFC 8252 loopback 127.0.0.1 for local dev). */
export function isValidRedirectUri(uri) {
  try {
    const parsed = new URL(String(uri || ''));
    if (parsed.protocol === 'https:') return true;
    if (parsed.protocol === 'http:' && parsed.hostname === '127.0.0.1') return true;
    return false;
  } catch {
    return false;
  }
}

export function validatePkceTokenPayload(body) {
  if (!body || typeof body !== 'object') return { ok: false, error: 'Invalid JSON payload' };
  const clientId = String(body.client_id || '').trim();
  const code = String(body.code || '').trim();
  const codeVerifier = String(body.code_verifier || '').trim();
  const redirectUri = String(body.redirect_uri || '').trim();
  if (!/^[a-f0-9]{20,64}$/i.test(clientId)) return { ok: false, error: 'Invalid client_id' };
  if (code.length < 8 || code.length > 2048) return { ok: false, error: 'Invalid authorization code' };
  if (codeVerifier.length < 43 || codeVerifier.length > 128) return { ok: false, error: 'Invalid PKCE code_verifier' };
  if (!isValidRedirectUri(redirectUri)) return { ok: false, error: 'Redirect URI must use HTTPS (or 127.0.0.1 loopback)' };
  return { ok: true, clientId, code, codeVerifier, redirectUri };
}

export function validateRefreshPayload(body) {
  if (!body || typeof body !== 'object') return { ok: false, error: 'Invalid JSON payload' };
  const clientId = String(body.client_id || '').trim();
  const refreshToken = String(body.refresh_token || '').trim();
  if (!/^[a-f0-9]{20,64}$/i.test(clientId)) return { ok: false, error: 'Invalid client_id' };
  if (refreshToken.length < 16 || refreshToken.length > 2048) return { ok: false, error: 'Invalid refresh_token' };
  return { ok: true, clientId, refreshToken };
}
