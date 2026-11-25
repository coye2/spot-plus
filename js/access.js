// Device-side copy of the base-tier allowance. The bridge is the source of truth
// for the network-address counter; this ledger keeps the app honest while offline
// and between those checks. Playback calls allowPlaybackAction / allowRestricted.
import { STATS_URL, deviceId } from './live-stats.js';
import { DEV_ACCESS_STORAGE_KEY, DEV_ACCOUNT_CACHE_KEY, isAllowedSpotifyId, sha256Hex, verifySessionToken } from './maintenance.js';
import * as store from './store.js';
import { installMark, signalsFromHere } from './referral.js';
import {
  ACTIONS, DAILY_LIMIT, RESTRICTED_FEATURES, addUsage, isKnownAction, quotaView, utcDay,
} from './access-policy.js';

const KEY = 'spotplus.access.v1';
const WARN_AT = [50, 25, 10];

function memoryStorage() {
  const values = new Map();
  return {
    getItem: (k) => values.has(k) ? values.get(k) : null,
    setItem: (k, v) => values.set(k, String(v)),
    removeItem: (k) => values.delete(k),
  };
}

function browserStorage() {
  try {
    if (globalThis.localStorage?.getItem && globalThis.localStorage?.setItem) return globalThis.localStorage;
  } catch { /* private mode */ }
  return memoryStorage();
}

function fresh(day, keep = {}) {
  return {
    day,
    deviceUsed: 0,
    ipUsed: 0,
    unlocked: !!keep.unlocked || !!keep.exempt,
    exempt: !!keep.exempt,
    login: keep.login || '',
    oauth: !!keep.oauth,
    discord: !!keep.discord,
    synced: false,
    counts: { skip: 0, 'insta-play': 0, 'insta-choose': 0 },
    warned: [],
    pending: null,
  };
}

function read(storage) {
  const day = utcDay();
  try {
    const parsed = JSON.parse(storage.getItem(KEY) || '');
    if (!parsed || typeof parsed !== 'object' || parsed.day !== day) {
      return fresh(day, parsed?.unlocked || parsed?.exempt ? { unlocked: true, exempt: !!parsed.exempt, login: parsed.login, oauth: parsed.oauth, discord: parsed.discord } : {});
    }
    const base = fresh(day);
    base.deviceUsed = Math.max(0, Math.floor(Number(parsed.deviceUsed) || 0));
    base.ipUsed = Math.max(0, Math.floor(Number(parsed.ipUsed) || 0));
    base.unlocked = !!parsed.unlocked || !!parsed.exempt;
    base.exempt = !!parsed.exempt;
    base.login = typeof parsed.login === 'string' ? parsed.login.slice(0, 80) : '';
    base.oauth = !!parsed.oauth;
    base.discord = !!parsed.discord;
    base.synced = !!parsed.synced;
    for (const action of ACTIONS) base.counts[action] = Math.max(0, Math.floor(Number(parsed.counts?.[action]) || 0));
    base.warned = Array.isArray(parsed.warned) ? parsed.warned.filter((n) => WARN_AT.includes(n)) : [];
    if (parsed.pending && /^[a-f0-9]{16,32}$/.test(parsed.pending.nonce) && parsed.pending.n > 0) {
      base.pending = { nonce: parsed.pending.nonce, n: Math.min(DAILY_LIMIT, Math.floor(parsed.pending.n)), action: parsed.pending.action };
    }
    return base;
  } catch {
    return fresh(day);
  }
}

export function createLedger(storage = browserStorage(), clock = () => Date.now()) {
  const today = () => utcDay(clock());
  let state = read(storage);
  if (state.day !== today() && state.unlocked) state = fresh(today(), state);
  else if (state.day !== today()) state = fresh(today());
  const listeners = new Set();
  const save = () => {
    try { storage.setItem(KEY, JSON.stringify(state)); } catch { /* storage full or blocked */ }
  };
  const roll = () => {
    const day = today();
    if (state.day === day) return;
    state = fresh(day, state.unlocked ? state : {});
    save();
  };
  const view = () => {
    roll();
    const exempt = !!state.exempt || !!ownerProof();
    const quota = quotaView({ ...state, unlocked: state.unlocked || exempt });
    return {
      ...quota,
      exempt,
      login: state.login || '',
      oauth: !!state.oauth,
      discord: !!state.discord,
      synced: !!state.synced,
      counts: { ...state.counts },
      day: state.day,
    };
  };
  const emit = () => {
    const snap = view();
    for (const fn of listeners) {
      try { fn(snap); } catch { /* a listener can't break playback */ }
    }
    return snap;
  };
  return {
    snapshot() { return view(); },
    onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    consume(action) {
      roll();
      if (!isKnownAction(action)) return { ...view(), allowed: true, notice: '' };
      if (state.unlocked || state.exempt || ownerProof()) return { ...view(), allowed: true, notice: '' };
      const before = quotaView(state);
      if (!before.allowed) return { ...view(), allowed: false, notice: '' };
      const next = addUsage(state, 1);
      state.deviceUsed = next.deviceUsed;
      state.ipUsed = Math.max(state.ipUsed, next.ipUsed);
      state.counts[action] = (state.counts[action] || 0) + 1;
      if (state.pending) state.pending.n = Math.min(DAILY_LIMIT, state.pending.n + 1);
      else state.pending = { nonce: randomNonce(), n: 1, action };
      let notice = '';
      if (next.remaining != null && WARN_AT.includes(next.remaining) && !state.warned.includes(next.remaining)) {
        state.warned.push(next.remaining);
        notice = next.remaining + ' left today on the base tier. Skips, Insta Play, and Insta Choose share ' + DAILY_LIMIT + '.';
      }
      save();
      emit();
      return { ...view(), allowed: true, notice };
    },
    applyServer(data, { authoritative = false } = {}) {
      if (!data || typeof data !== 'object') return view();
      const day = typeof data.day === 'string' ? data.day : state.day;
      if (day !== state.day) state = fresh(day, data.unlocked ? { unlocked: true, login: data.login } : {});
      state.deviceUsed = Math.max(state.deviceUsed, Math.floor(Number(data.deviceUsed) || 0));
      state.ipUsed = Math.max(state.ipUsed, Math.floor(Number(data.ipUsed) || 0));
      if (data.exempt === true) state.exempt = true;
      if (data.unlocked || data.exempt === true) {
        state.unlocked = true;
        if (typeof data.login === 'string' && data.login) state.login = data.login;
      } else if (authoritative) {
        state.unlocked = false;
        state.exempt = false;
        state.login = '';
      }
      if (typeof data.oauth === 'boolean') state.oauth = data.oauth;
      if (typeof data.discord === 'boolean') state.discord = data.discord;
      state.synced = true;
      save();
      return emit();
    },
    takePending() {
      roll();
      if (!state.pending) return null;
      const batch = state.pending;
      state.pending = null;
      save();
      return batch;
    },
    restorePending(batch) {
      if (!batch?.nonce) return;
      if (state.pending) state.pending.n = Math.min(DAILY_LIMIT, state.pending.n + batch.n);
      else state.pending = batch;
      save();
    },
    pending() { return state.pending ? { ...state.pending } : null; },
  };
}

function spotifyOwnerId() {
  try {
    return store.getSpotifyAccount()?.account?.id || store.getSpotifyStats()?.account?.id || '';
  } catch {
    return '';
  }
}

/** Proof that this browser is one of the owner's devices. Empty for everyone else. */
export function ownerProof(storage = globalThis.localStorage, origin = globalThis.location?.origin) {
  try {
    const token = storage?.getItem?.(DEV_ACCESS_STORAGE_KEY) || '';
    if (token && verifySessionToken(token, { origin })) return token;
    const cached = storage?.getItem?.(DEV_ACCOUNT_CACHE_KEY) || '';
    if (cached && verifySessionToken(cached, { origin })) return cached;
  } catch { /* private mode */ }
  const id = spotifyOwnerId();
  return isAllowedSpotifyId(id) ? String(id) : '';
}

/** Devices linked with the same library sync key count as one person's devices. */
export function householdId(storage = globalThis.localStorage) {
  let key = '';
  try { key = storage?.getItem?.('spotplus.syncKey') || ''; } catch { return ''; }
  if (!key || key.length < 8 || key.length > 200) return '';
  return sha256Hex('spotplus-house:' + key).slice(0, 32);
}

function accessHeaders(extra = {}) {
  const headers = { ...extra };
  const proof = ownerProof();
  if (proof) headers['X-Spotplus-Owner'] = proof;
  const house = householdId();
  if (house) headers['X-Spotplus-Household'] = house;
  return headers;
}

function randomNonce() {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}

let ledger = null;
function book() {
  if (!ledger) ledger = createLedger(browserStorage());
  return ledger;
}

const blockedListeners = new Set();
const noticeListeners = new Set();

export function snapshot() { return book().snapshot(); }
export function onAccessChange(fn) { return book().onChange(fn); }
export function onAccessBlocked(fn) { blockedListeners.add(fn); return () => blockedListeners.delete(fn); }
export function onAccessNotice(fn) { noticeListeners.add(fn); return () => noticeListeners.delete(fn); }

function notifyBlocked(info) {
  for (const fn of blockedListeners) {
    try { fn(info); } catch { /* ignore */ }
  }
}
function notifyNotice(info) {
  for (const fn of noticeListeners) {
    try { fn(info); } catch { /* ignore */ }
  }
}

export function consumeAction(action) {
  const result = book().consume(action);
  if (result.allowed && isKnownAction(action)) scheduleFlush();
  return result;
}

export function isFeatureRestricted(feature = '') {
  const snap = snapshot();
  if (snap.tier === 'full' || !snap.limited) return false;
  if (!feature) return true;
  return RESTRICTED_FEATURES.includes(feature);
}

/** Charge a base-tier action. `system` is for Jam follow and other non-user starts. */
export function allowPlaybackAction(action) {
  if (!action || action === 'system') return true;
  const result = consumeAction(action);
  if (!result.allowed) {
    notifyBlocked({ ...result, feature: action });
    return false;
  }
  if (result.notice) notifyNotice(result);
  return true;
}

/** User features that turn off only after the daily allowance is spent. */
export function allowRestricted(feature) {
  if (!isFeatureRestricted(feature)) return true;
  notifyBlocked({ ...snapshot(), feature, allowed: false, reason: 'limited' });
  return false;
}

export function applyServerSnapshot(data, opts) {
  return book().applyServer(data, opts);
}

let syncEnabled = false;
let flushTimer = 0;
let flushing = false;

export function startAccessSync() {
  syncEnabled = true;
  scheduleFlush();
  return refreshAccess();
}

function scheduleFlush() {
  if (!syncEnabled) return;
  clearTimeout(flushTimer);
  flushTimer = setTimeout(() => { flushAccess().catch(() => {}); }, 350);
  flushTimer.unref?.();
}

export async function flushAccess(fetcher = globalThis.fetch) {
  if (flushing || typeof fetcher !== 'function') return null;
  const batch = book().takePending();
  if (!batch) return null;
  flushing = true;
  const device = deviceId();
  try {
    if (!device) throw new Error('no device');
    const res = await fetcher(STATS_URL + '/access', {
      method: 'POST',
      credentials: 'omit',
      headers: accessHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ device, action: batch.action || 'skip', n: batch.n, nonce: batch.nonce }),
    });
    const data = await res.json();
    if (!res.ok && !data?.tier) throw new Error('status ' + res.status);
    return applyServerSnapshot(data, { authoritative: true });
  } catch {
    book().restorePending(batch);
    return null;
  } finally {
    flushing = false;
    if (book().pending()) scheduleFlush();
  }
}

export async function refreshAccess(fetcher = globalThis.fetch) {
  const device = deviceId();
  if (!device || typeof fetcher !== 'function') return snapshot();
  try {
    const res = await fetcher(STATS_URL + '/access?device=' + device, { credentials: 'omit', headers: accessHeaders() });
    if (!res.ok) return snapshot();
    const data = await res.json();
    return applyServerSnapshot(data, { authoritative: true });
  } catch {
    return snapshot();
  }
}

export async function verifyUsername(username, fetcher = globalThis.fetch) {
  const device = deviceId();
  if (!device) return { ok: false, reason: 'unavailable' };
  try {
    const res = await fetcher(STATS_URL + '/access/verify', {
      method: 'POST',
      credentials: 'omit',
      headers: accessHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ device, username }),
    });
    const data = await res.json().catch(() => null);
    if (!data) return { ok: false, reason: res.status === 429 ? 'rate-limited' : 'unavailable' };
    if (data.ok) applyServerSnapshot(data, { authoritative: true });
    return data;
  } catch {
    return { ok: false, reason: 'unavailable' };
  }
}

export function githubStartUrl(href = globalThis.location?.href || '') {
  const device = deviceId();
  let ret = 'https://coye2.github.io/spot-plus/';
  try {
    const url = new URL(href);
    ret = url.origin + url.pathname;
  } catch { /* keep the public app */ }
  return STATS_URL + '/access/github/start?device=' + device + '&return=' + encodeURIComponent(ret);
}

export function consumeStarQuery() {
  try {
    const url = new URL(globalThis.location.href);
    const star = url.searchParams.get('star') || url.searchParams.get('support') || '';
    if (!star) return '';
    url.searchParams.delete('star');
    url.searchParams.delete('support');
    globalThis.history.replaceState(null, '', url.pathname + url.search + url.hash);
    return star;
  } catch {
    return '';
  }
}

async function supportBody(extra = {}) {
  return { device: deviceId(), mark: await installMark(), signals: signalsFromHere(), ...extra };
}

async function postJson(path, body, fetcher = globalThis.fetch) {
  if (typeof fetcher !== 'function') return { ok: false, reason: 'unavailable' };
  try {
    const res = await fetcher(STATS_URL + path, {
      method: 'POST', credentials: 'omit', headers: accessHeaders({ 'Content-Type': 'application/json' }), body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => null);
    return data || { ok: false, reason: res.status === 429 ? 'rate-limited' : 'unavailable' };
  } catch {
    return { ok: false, reason: 'unavailable' };
  }
}

export async function createReferral(fetcher = globalThis.fetch) {
  return postJson('/access/refer/code', await supportBody(), fetcher);
}

export async function redeemReferral(code, challenge = '', fetcher = globalThis.fetch) {
  return postJson('/access/refer/redeem', await supportBody({ code, challenge }), fetcher);
}

export function discordStartUrl(href = globalThis.location?.href || '') {
  const device = deviceId();
  let ret = 'https://coye2.github.io/spot-plus/';
  try {
    const url = new URL(href);
    ret = url.origin + url.pathname;
  } catch { /* keep the public app */ }
  return STATS_URL + '/access/discord/start?device=' + device + '&return=' + encodeURIComponent(ret);
}
