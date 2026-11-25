// Referral install check. The bridge compares two installs and rejects a second
// browser, a VPN, or the same phone wearing a new profile. A friend on their own
// device still passes, including one sharing a home network when the device differs.
import { DISCORD } from './access-policy.js';

export const HOLD_MS = 60_000;
export const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const MARK_KEY = 'spotplus.installMark';

export function normalizeCode(input) {
  const code = String(input || '').toUpperCase().replace(/[^A-Z2-9]/g, '').replace(/[OIL01]/g, '');
  if (!/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{8}$/.test(code)) return '';
  return code;
}

export function platformFamily(ua = '', platform = '') {
  const blob = `${ua} ${platform}`.toLowerCase();
  if (/iphone|ipad|ipod/.test(blob)) return 'ios';
  if (/android/.test(blob)) return 'android';
  if (/windows|win32|win64/.test(blob)) return 'windows';
  if (/mac/.test(blob)) return 'mac';
  if (/linux|cros|chromebook/.test(blob)) return 'linux';
  return 'other';
}

export function screenBucket(width, height, dpr) {
  const w = Math.round((Number(width) || 0) / 40) * 40;
  const h = Math.round((Number(height) || 0) / 40) * 40;
  const d = Math.round((Number(dpr) || 1) * 2) / 2;
  return `${w}x${h}@${d}`;
}

export function touchClass(touch) {
  const n = Number(touch) || 0;
  if (n <= 0) return 'none';
  if (n < 5) return 'few';
  return 'many';
}

export function browserKey(signals = {}) {
  const ua = String(signals.ua || '');
  const family = /edg\//i.test(ua) ? 'edge'
    : /chrome|crios/i.test(ua) ? 'chrome'
    : /firefox|fxios/i.test(ua) ? 'firefox'
    : /safari/i.test(ua) ? 'safari'
    : 'other';
  return hardwareKey(signals) + '|' + family + '|' + String(signals.language || '').slice(0, 12);
}

/** Stable description of the physical device. A new browser or VPN does not change it. */
export function hardwareKey(signals = {}) {
  return [
    platformFamily(signals.ua, signals.platform),
    screenBucket(signals.width, signals.height, signals.dpr),
    Number(signals.cores) || 0,
    Number(signals.memory) || 0,
    touchClass(signals.touch),
    Number(signals.color) || 0,
    String(signals.timezone || '').slice(0, 64),
  ].join('|');
}

export function isInstalledApp() {
  try {
    if (globalThis.navigator?.standalone === true) return true;
    return globalThis.matchMedia?.('(display-mode: standalone)')?.matches === true;
  } catch {
    return false;
  }
}

export function signalsFromHere() {
  const nav = globalThis.navigator || {};
  const scr = globalThis.screen || {};
  let timezone = '';
  try { timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || ''; } catch { /* ignore */ }
  return {
    ua: String(nav.userAgent || '').slice(0, 180),
    platform: String(nav.platform || '').slice(0, 40),
    timezone: timezone.slice(0, 64),
    language: String(nav.language || '').slice(0, 20),
    cores: Number(nav.hardwareConcurrency) || 0,
    memory: Number(nav.deviceMemory) || 0,
    touch: Number(nav.maxTouchPoints) || 0,
    width: Number(scr.width) || 0,
    height: Number(scr.height) || 0,
    dpr: Number(globalThis.devicePixelRatio) || 1,
    color: Number(scr.colorDepth) || 0,
    standalone: isInstalledApp(),
  };
}

function randomMark() {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function openKv() {
  return new Promise((resolve, reject) => {
    if (!globalThis.indexedDB) { reject(new Error('no idb')); return; }
    const req = indexedDB.open('spotplus-support', 1);
    req.onupgradeneeded = () => { if (!req.result.objectStoreNames.contains('kv')) req.result.createObjectStore('kv'); };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbMark(value) {
  const db = await openKv();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('kv', value ? 'readwrite' : 'readonly');
    const store = tx.objectStore('kv');
    const req = value ? store.put(value, MARK_KEY) : store.get(MARK_KEY);
    req.onsuccess = () => resolve(req.result || '');
    req.onerror = () => reject(req.error);
  });
}

/** Install id kept in localStorage and IndexedDB, so clearing one store is not a new person. */
export async function installMark(storage = globalThis.localStorage) {
  let mark = '';
  try { mark = storage?.getItem?.(MARK_KEY) || ''; } catch { /* private mode */ }
  if (!/^[a-f0-9]{32}$/.test(mark)) {
    try { mark = await idbMark(); } catch { mark = ''; }
  }
  if (!/^[a-f0-9]{32}$/.test(mark)) mark = randomMark();
  try { storage?.setItem?.(MARK_KEY, mark); } catch { /* ignore */ }
  try { await idbMark(mark); } catch { /* ignore */ }
  return mark;
}

/**
 * Decide whether the friend install is someone else.
 * `hardware`, `mark`, and `browser` are already hashes when the bridge calls this.
 */
export function judgeReferral({ referrer = {}, friend = {}, codeCreatedAt = 0, friendFirstSeen = 0, standalone = false } = {}) {
  if (!standalone) return { ok: false, reason: 'install' };
  if (!friend.device || !referrer.device) return { ok: false, reason: 'invalid' };
  if (friend.device === referrer.device) return { ok: false, reason: 'self' };
  if (friend.mark && referrer.mark && friend.mark === referrer.mark) return { ok: false, reason: 'self' };
  if (friendFirstSeen > 0 && codeCreatedAt > 0 && friendFirstSeen + 1500 < codeCreatedAt) return { ok: false, reason: 'not-new' };
  if (friend.hardware && referrer.hardware && friend.hardware === referrer.hardware) return { ok: false, reason: 'same-device' };
  if (friend.browser && referrer.browser && friend.browser === referrer.browser) return { ok: false, reason: 'same-browser' };
  if (friend.ip && referrer.ip && friend.ip === referrer.ip && friend.family && friend.family === referrer.family && friend.screen && friend.screen === referrer.screen) {
    return { ok: false, reason: 'same-network' };
  }
  return { ok: true, reason: 'ok' };
}

export function isGuildMember(guilds, guildId) {
  const want = String(guildId || '');
  return !!want && Array.isArray(guilds) && guilds.some((guild) => String(guild?.id || '') === want);
}

export const SUPPORT_LINKS = Object.freeze({
  discord: DISCORD.invite,
});
