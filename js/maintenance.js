// Mandatory development gate.
// Keep MAINTENANCE_MODE = true (and MAINTENANCE = true in js/boot.js) while
// developing on main. Only turn off when the maintainer explicitly marks the build stable.
export const MAINTENANCE_MODE = true;
export const ALLOWED_SPOTIFY_IDS = Object.freeze(['coye-9']);
export const DEV_ACCESS_STORAGE_KEY = 'spotplus.devAccess';
export const DEV_ACCOUNT_CACHE_KEY = 'spotplus.devAccount';

export function normalizeDeveloperHandle(input) {
  const raw = String(input || '').trim();
  if (!raw) return '';
  const urlMatch = raw.match(/open\.spotify\.com\/(?:intl-[a-z-]+\/)?user\/([A-Za-z0-9._-]{1,64})/i);
  if (urlMatch) return urlMatch[1].toLowerCase();
  const uriMatch = raw.match(/^spotify:user:([A-Za-z0-9._-]{1,64})$/i);
  if (uriMatch) return uriMatch[1].toLowerCase();
  return raw.replace(/^@+/, '').toLowerCase();
}

export function isAllowedSpotifyId(id) {
  const normalized = normalizeDeveloperHandle(id);
  return !!normalized && ALLOWED_SPOTIFY_IDS.includes(normalized);
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

export function canBypassMaintenance({
  spotifyAccount = null,
  spotifyStats = null,
  links = null,
  storage = globalThis.localStorage,
  search = '',
  hash = '',
} = {}) {
  if (!MAINTENANCE_MODE) return { allowed: true, reason: 'disabled', persistAccount: false };

  const param = readAccessParam(search, hash);
  if (isAllowedSpotifyId(param)) {
    const id = normalizeDeveloperHandle(param);
    try { storage?.setItem?.(DEV_ACCESS_STORAGE_KEY, id); } catch { /* private mode */ }
    return { allowed: true, reason: 'dev-param', persistAccount: false, stripParam: true };
  }

  let savedAccess = '';
  try { savedAccess = storage?.getItem?.(DEV_ACCESS_STORAGE_KEY) || ''; } catch { /* private mode */ }
  if (isAllowedSpotifyId(savedAccess)) {
    return { allowed: true, reason: 'device-unlock', persistAccount: false };
  }

  const accountIds = [
    spotifyAccount?.account?.id,
    spotifyStats?.account?.id,
    links?.profile?.id,
  ];
  const matched = accountIds.find((id) => isAllowedSpotifyId(id));
  if (matched) {
    return {
      allowed: true,
      reason: 'spotify-account',
      id: normalizeDeveloperHandle(matched),
      persistAccount: true,
    };
  }

  return { allowed: false, reason: 'maintenance', persistAccount: false };
}

export function unlockDeveloperAccess(input, storage = globalThis.localStorage) {
  const id = normalizeDeveloperHandle(input);
  if (!isAllowedSpotifyId(id)) return false;
  try { storage?.setItem?.(DEV_ACCESS_STORAGE_KEY, id); } catch { /* private mode */ }
  return true;
}
