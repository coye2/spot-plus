// Mandatory development gate.
// Keep MAINTENANCE_MODE = true (and MAINTENANCE = true in js/boot.js) while
// developing on main. Only turn off when the maintainer explicitly marks the build stable.
export const MAINTENANCE_MODE = true;
export const OWNER_SALT = 'spotplus-gate-v2:';
export const ALLOWED_ID_HASHES = Object.freeze([
  '79c4cfae747eb72c8024860365cad93fb4cc243b91ab0b4c787ed1d2687c8a38',
]);
export const DEV_ACCESS_STORAGE_KEY = 'spotplus.devAccess';
export const DEV_ACCOUNT_CACHE_KEY = 'spotplus.devAccount';
export const DEV_ATTEMPTS_STORAGE_KEY = 'spotplus.devAttempts';
const SESSION_TTL_MS = 30 * 24 * 3600 * 1000;
const MAX_ATTEMPTS = 5;
const LOCKOUT_BASE_MS = 60 * 1000;
const LOCKOUT_MAX_MS = 15 * 60 * 1000;

const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

export function sha256Hex(message) {
  const utf8 = unescape(encodeURIComponent(String(message ?? '')));
  const len = utf8.length;
  const bitLen = len * 8;
  const withOne = len + 1;
  const paddedLen = Math.ceil((withOne + 8) / 64) * 64;
  const bytes = new Uint8Array(paddedLen);
  for (let i = 0; i < len; i++) bytes[i] = utf8.charCodeAt(i);
  bytes[len] = 0x80;
  const view = new DataView(bytes.buffer);
  view.setUint32(paddedLen - 8, Math.floor(bitLen / 0x100000000), false);
  view.setUint32(paddedLen - 4, bitLen >>> 0, false);

  let h0 = 0x6a09e667, h1 = 0xbb67ae85, h2 = 0x3c6ef372, h3 = 0xa54ff53a;
  let h4 = 0x510e527f, h5 = 0x9b05688c, h6 = 0x1f83d9ab, h7 = 0x5be0cd19;
  const w = new Uint32Array(64);

  for (let off = 0; off < paddedLen; off += 64) {
    for (let i = 0; i < 16; i++) w[i] = view.getUint32(off + i * 4, false);
    for (let i = 16; i < 64; i++) {
      const s0 = ((w[i - 15] >>> 7) | (w[i - 15] << 25)) ^ ((w[i - 15] >>> 18) | (w[i - 15] << 14)) ^ (w[i - 15] >>> 3);
      const s1 = ((w[i - 2] >>> 17) | (w[i - 2] << 15)) ^ ((w[i - 2] >>> 19) | (w[i - 2] << 13)) ^ (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
    }
    let a = h0, b = h1, c = h2, d = h3, e = h4, f = h5, g = h6, h = h7;
    for (let i = 0; i < 64; i++) {
      const S1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7));
      const ch = (e & f) ^ (~e & g);
      const temp1 = (h + S1 + ch + K[i] + w[i]) >>> 0;
      const S0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10));
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (S0 + maj) >>> 0;
      h = g; g = f; f = e; e = (d + temp1) >>> 0;
      d = c; c = b; b = a; a = (temp1 + temp2) >>> 0;
    }
    h0 = (h0 + a) >>> 0; h1 = (h1 + b) >>> 0; h2 = (h2 + c) >>> 0; h3 = (h3 + d) >>> 0;
    h4 = (h4 + e) >>> 0; h5 = (h5 + f) >>> 0; h6 = (h6 + g) >>> 0; h7 = (h7 + h) >>> 0;
  }
  return [h0, h1, h2, h3, h4, h5, h6, h7].map((x) => x.toString(16).padStart(8, '0')).join('');
}

function safeEqual(a, b) {
  const s1 = String(a || ''), s2 = String(b || '');
  if (s1.length !== s2.length) return false;
  let diff = 0;
  for (let i = 0; i < s1.length; i++) diff |= s1.charCodeAt(i) ^ s2.charCodeAt(i);
  return diff === 0;
}

function resolveOrigin(origin) {
  if (origin) return String(origin);
  try {
    return globalThis.location?.origin && globalThis.location.origin !== 'null'
      ? globalThis.location.origin
      : 'https://spotplus.local';
  } catch {
    return 'https://spotplus.local';
  }
}

export function normalizeDeveloperHandle(input) {
  const raw = String(input || '').trim();
  if (!raw) return '';
  const urlMatch = raw.match(/open\.spotify\.com\/(?:intl-[a-z-]+\/)?user\/([A-Za-z0-9._-]{1,64})/i);
  if (urlMatch) return urlMatch[1].toLowerCase();
  const uriMatch = raw.match(/^spotify:user:([A-Za-z0-9._-]{1,64})$/i);
  if (uriMatch) return uriMatch[1].toLowerCase();
  return raw.replace(/^@+/, '').toLowerCase();
}

export function hashDeveloperHandle(id) {
  const normalized = normalizeDeveloperHandle(id);
  return normalized ? sha256Hex(OWNER_SALT + normalized) : '';
}

export function isAllowedSpotifyId(id) {
  const digest = hashDeveloperHandle(id);
  return !!digest && ALLOWED_ID_HASHES.some((allowed) => safeEqual(digest, allowed));
}

function randomNonce() {
  try {
    if (globalThis.crypto?.getRandomValues) {
      const buf = new Uint8Array(12);
      globalThis.crypto.getRandomValues(buf);
      return [...buf].map((b) => b.toString(16).padStart(2, '0')).join('');
    }
  } catch { /* fallback */ }
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

export function createSessionToken(idDigest, { origin, now = Date.now(), nonce = randomNonce() } = {}) {
  if (!ALLOWED_ID_HASHES.some((allowed) => safeEqual(idDigest, allowed))) return null;
  const resolvedOrigin = resolveOrigin(origin);
  const exp = now + SESSION_TTL_MS;
  const sig = sha256Hex(`spotplus-session-v2:${resolvedOrigin}:${idDigest}:${nonce}:${exp}`);
  return JSON.stringify({ v: 2, h: idDigest, n: nonce, exp, s: sig });
}

export function verifySessionToken(raw, { origin, now = Date.now() } = {}) {
  if (!raw || typeof raw !== 'string') return false;
  try {
    const data = JSON.parse(raw);
    if (!data || data.v !== 2 || !data.h || !data.n || !data.s) return false;
    if (!Number.isFinite(data.exp) || data.exp <= now) return false;
    if (!ALLOWED_ID_HASHES.some((allowed) => safeEqual(data.h, allowed))) return false;
    const expected = sha256Hex(`spotplus-session-v2:${resolveOrigin(origin)}:${data.h}:${data.n}:${data.exp}`);
    return safeEqual(data.s, expected);
  } catch {
    return false;
  }
}

export function getUnlockCooldown(storage = globalThis.localStorage, now = Date.now()) {
  try {
    const data = JSON.parse(storage?.getItem?.(DEV_ATTEMPTS_STORAGE_KEY) || 'null');
    if (data && Number.isFinite(data.until) && data.until > now) {
      return Math.max(1, Math.ceil((data.until - now) / 1000));
    }
  } catch { /* ignore */ }
  return 0;
}

function readAccessParam(search = '', hash = '') {
  try {
    const q = new URLSearchParams(String(search || '').replace(/^\?/, ''));
    const direct = q.get('dev') || q.get('owner') || q.get('access');
    if (direct) return direct;
  } catch { /* ignore malformed query */ }
  const h = String(hash || '').replace(/^#/, '');
  const hashMatch = h.match(/(?:^|[?&/])(?:dev|owner|access)=([^&/]+)/i);
  if (hashMatch) {
    try { return decodeURIComponent(hashMatch[1]); } catch { return hashMatch[1]; }
  }
  return '';
}

export function clearDeveloperAccess(storage = globalThis.localStorage) {
  try {
    storage?.removeItem?.(DEV_ACCESS_STORAGE_KEY);
    storage?.removeItem?.(DEV_ACCOUNT_CACHE_KEY);
  } catch { /* private mode */ }
}

export function canBypassMaintenance({
  spotifyAccount = null,
  spotifyStats = null,
  links = null,
  storage = globalThis.localStorage,
  search = '',
  hash = '',
  origin,
  now = Date.now(),
} = {}) {
  if (!MAINTENANCE_MODE) return { allowed: true, reason: 'disabled', persistAccount: false };

  const param = readAccessParam(search, hash);
  if (param && !getUnlockCooldown(storage, now) && isAllowedSpotifyId(param)) {
    const token = createSessionToken(hashDeveloperHandle(param), { origin, now });
    if (token) {
      try {
        storage?.setItem?.(DEV_ACCESS_STORAGE_KEY, token);
        storage?.removeItem?.(DEV_ATTEMPTS_STORAGE_KEY);
      } catch { /* private mode */ }
      return { allowed: true, reason: 'dev-param', persistAccount: false, stripParam: true };
    }
  }

  let savedAccess = '';
  try { savedAccess = storage?.getItem?.(DEV_ACCESS_STORAGE_KEY) || ''; } catch { /* private mode */ }
  if (verifySessionToken(savedAccess, { origin, now })) {
    return { allowed: true, reason: 'device-unlock', persistAccount: false };
  }
  if (savedAccess) {
    try { storage?.removeItem?.(DEV_ACCESS_STORAGE_KEY); } catch { /* private mode */ }
  }

  let cachedAccountToken = '';
  try { cachedAccountToken = storage?.getItem?.(DEV_ACCOUNT_CACHE_KEY) || ''; } catch { /* private mode */ }

  const accountIds = [
    spotifyAccount?.account?.id,
    spotifyStats?.account?.id,
    links?.profile?.id,
  ];
  const matched = accountIds.find((id) => isAllowedSpotifyId(id));
  if (matched) {
    const token = createSessionToken(hashDeveloperHandle(matched), { origin, now });
    return {
      allowed: true,
      reason: 'spotify-account',
      token,
      persistAccount: true,
    };
  }

  if (verifySessionToken(cachedAccountToken, { origin, now })) {
    return { allowed: true, reason: 'spotify-account-cache', persistAccount: false };
  }

  return { allowed: false, reason: 'maintenance', persistAccount: false };
}

export function unlockDeveloperAccess(input, storage = globalThis.localStorage, { origin, now = Date.now() } = {}) {
  if (getUnlockCooldown(storage, now) > 0) return false;
  if (!isAllowedSpotifyId(input)) {
    try {
      const prev = JSON.parse(storage?.getItem?.(DEV_ATTEMPTS_STORAGE_KEY) || 'null') || { count: 0, strikes: 0, until: 0 };
      const count = (Number(prev.count) || 0) + 1;
      let strikes = Number(prev.strikes) || 0;
      let until = 0;
      if (count >= MAX_ATTEMPTS) {
        const waitMs = Math.min(LOCKOUT_MAX_MS, LOCKOUT_BASE_MS * (2 ** strikes));
        until = now + waitMs;
        strikes = Math.min(4, strikes + 1);
      }
      storage?.setItem?.(DEV_ATTEMPTS_STORAGE_KEY, JSON.stringify({ count: count >= MAX_ATTEMPTS ? 0 : count, strikes, until }));
    } catch { /* private mode */ }
    return false;
  }
  const token = createSessionToken(hashDeveloperHandle(input), { origin, now });
  if (!token) return false;
  try {
    storage?.setItem?.(DEV_ACCESS_STORAGE_KEY, token);
    storage?.removeItem?.(DEV_ATTEMPTS_STORAGE_KEY);
  } catch { /* private mode */ }
  return true;
}
