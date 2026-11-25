// Base-tier allowance shared by skips, Insta Play, and Insta Choose.
// The cap is enforced twice: once for the device and once for the network address.
// Full access (a verified GitHub star) is not capped.

export const DAILY_LIMIT = 300;
export const ACTIONS = Object.freeze(['skip', 'insta-play', 'insta-choose']);
export const RESTRICTED_FEATURES = Object.freeze([
  'skip', 'insta-play', 'insta-choose', 'seek', 'download', 'repeat', 'canvas', 'preload',
]);
export const REPO = Object.freeze({
  owner: 'coye2',
  name: 'spot-plus',
  full: 'coye2/spot-plus',
  url: 'https://github.com/coye2/spot-plus',
});
export const DISCORD = Object.freeze({
  code: 'DbhTQD7jW',
  invite: 'https://discord.gg/DbhTQD7jW',
});
export const MAX_DEVICES_PER_LOGIN = 3;
export const ACTION_LABELS = Object.freeze({
  skip: 'Skip',
  'insta-play': 'Insta Play',
  'insta-choose': 'Insta Choose',
  seek: 'Seeking',
  download: 'Downloads',
  repeat: 'Repeat',
  canvas: 'Canvas',
  preload: 'Early loading of the next song',
});

export function utcDay(now = Date.now()) {
  return new Date(now).toISOString().slice(0, 10);
}

/** GitHub usernames: 1–39 chars, alphanumeric or hyphen, no leading or trailing hyphen. */
export function normalizeLogin(input) {
  const login = String(input || '').trim().replace(/^@+/, '');
  if (!/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/.test(login)) return '';
  return login;
}

export function quotaView({ deviceUsed = 0, ipUsed = 0, unlocked = false, limit = DAILY_LIMIT } = {}) {
  const device = clampCount(deviceUsed, limit);
  const ip = clampCount(ipUsed, limit);
  const used = Math.max(device, ip);
  if (unlocked) {
    return { tier: 'full', limited: false, remaining: null, allowed: true, deviceUsed: device, ipUsed: ip, limit, used };
  }
  const remaining = Math.max(0, limit - used);
  const limited = used >= limit;
  return { tier: 'base', limited, remaining, allowed: !limited, deviceUsed: device, ipUsed: ip, limit, used };
}

function clampCount(value, limit) {
  const n = Math.floor(Number(value) || 0);
  if (n < 0) return 0;
  return Math.min(limit, n);
}

/**
 * Add `n` combined actions to both buckets.
 * A request is refused once either bucket is already at the limit, so clearing
 * site data (new device id, same network) or switching networks (same device)
 * does not mint a fresh allowance.
 */
export function addUsage({ deviceUsed = 0, ipUsed = 0, unlocked = false, limit = DAILY_LIMIT, trackIp = true } = {}, n = 1) {
  const before = quotaView({ deviceUsed, ipUsed, unlocked, limit });
  const add = Math.floor(Number(n) || 0);
  if (unlocked || !before.allowed || add <= 0) return { ...before, charged: 0 };
  const amount = Math.min(add, limit);
  const nextDevice = Math.min(limit, before.deviceUsed + amount);
  const nextIp = trackIp ? Math.min(limit, before.ipUsed + amount) : before.ipUsed;
  const changed = nextDevice !== before.deviceUsed || nextIp !== before.ipUsed;
  return { ...quotaView({ deviceUsed: nextDevice, ipUsed: nextIp, unlocked: false, limit }), charged: changed ? amount : 0 };
}

export function isKnownAction(action) {
  return ACTIONS.includes(action);
}
