// Daily base-tier allowance and GitHub-star verification for the Spot+ bridge.
// Optional Worker secrets (never sent to the browser):
//   GITHUB_TOKEN            higher GitHub API rate limit for star checks
//   GITHUB_CLIENT_ID        enables "Verify fully with GitHub" (OAuth)
//   GITHUB_CLIENT_SECRET    OAuth code exchange; also signs the OAuth state
//   UNLOCK_SECRET           optional dedicated state-signing key
//   DISCORD_CLIENT_ID       enables "Verify Discord membership"
//   DISCORD_CLIENT_SECRET   Discord OAuth code exchange
//   DISCORD_GUILD_ID        optional; otherwise the public invite's server is used
// Callbacks: /access/github/callback and /access/discord/callback.
import {
  DAILY_LIMIT, DISCORD, MAX_DEVICES_PER_LOGIN, REPO, addUsage, isKnownAction, normalizeLogin, quotaView, utcDay,
} from '../js/access-policy.js';
import { discordGuildId, handleReferral, isGuildMember } from './referral.js';
import { isOwnerProof } from '../js/maintenance.js';

export const MAX_STAR_PAGES = 15;
const STATE_TTL_MS = 10 * 60 * 1000;
const HEADERS = {
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
};

const json = (data, status = 200, extra = {}) => new Response(JSON.stringify(data), {
  status, headers: { ...HEADERS, ...extra },
});

export function safeReturn(value) {
  try {
    const url = new URL(String(value || ''));
    if (url.username || url.password) return '';
    let path = url.pathname;
    if (path.endsWith('/index.html')) path = path.slice(0, -'index.html'.length);
    const bare = path.replace(/\/+$/, '') || '/';
    const pages = url.origin === 'https://coye2.github.io' && bare === '/spot-plus';
    const local = (url.origin === 'http://localhost:8080' || url.origin === 'http://127.0.0.1:8080') && bare === '/';
    if (!pages && !local) return '';
    if (bare === '/') return url.origin + '/';
    return url.origin + bare + '/';
  } catch {
    return '';
  }
}

function returnTarget(value) {
  return safeReturn(value) || 'https://coye2.github.io/spot-plus/';
}

async function hmacHex(secret, message) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message)));
  return [...sig].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function safeEqual(a, b) {
  const s1 = String(a || ''), s2 = String(b || '');
  if (s1.length !== s2.length) return false;
  let diff = 0;
  for (let i = 0; i < s1.length; i++) diff |= s1.charCodeAt(i) ^ s2.charCodeAt(i);
  return diff === 0;
}

function b64urlEncode(text) {
  const bytes = new TextEncoder().encode(text);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function b64urlDecode(text) {
  const pad = text.length % 4 === 0 ? '' : '='.repeat(4 - (text.length % 4));
  const bin = atob(text.replace(/-/g, '+').replace(/_/g, '/') + pad);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

export async function sealState(payload, secret) {
  const body = b64urlEncode(JSON.stringify(payload));
  const sig = await hmacHex(secret, body);
  return `${body}.${sig}`;
}

export async function openState(token, secret, now = Date.now()) {
  const dot = String(token || '').lastIndexOf('.');
  if (dot <= 0 || !secret) return null;
  const body = token.slice(0, dot), sig = token.slice(dot + 1);
  const expect = await hmacHex(secret, body);
  if (!safeEqual(expect, sig)) return null;
  try {
    const payload = JSON.parse(b64urlDecode(body));
    if (!payload || !(payload.exp > now)) return null;
    if (!/^[a-f0-9]{32}$/.test(payload.device || '')) return null;
    const returnTo = safeReturn(payload.returnTo);
    if (!returnTo) return null;
    return { device: payload.device, returnTo };
  } catch {
    return null;
  }
}

export async function shortHash(text) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('spotplus:' + text));
  return [...new Uint8Array(digest)].slice(0, 8).map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function readJsonLimited(response, limit = 700000) {
  const text = await response.text();
  if (text.length > limit) throw new Error('large');
  return JSON.parse(text);
}

function githubHeaders(token) {
  const headers = {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'SpotPlus (https://coye2.github.io/spot-plus/)',
    'X-GitHub-Api-Version': '2022-11-28',
  };
  if (token) headers.Authorization = 'Bearer ' + token;
  return headers;
}

/** True when a GitHub stars page links this exact repository. */
export function pageShowsStar(html, full = REPO.full) {
  const page = String(html || '').toLowerCase();
  const name = String(full || '').toLowerCase();
  return page.includes('href="/' + name + '"') || page.includes('href="/' + name + '/"');
}

async function findStarOnSite(name, fetcher, signal) {
  const headers = { Accept: 'text/html', 'User-Agent': 'SpotPlus (https://coye2.github.io/spot-plus/)' };
  for (let page = 1; page <= 5; page++) {
    const url = 'https://github.com/' + encodeURIComponent(name) + '?tab=stars' + (page > 1 ? '&page=' + page : '');
    let res;
    try { res = await fetcher(url, { headers, redirect: 'manual', signal }); } catch { return { ok: false, reason: 'unavailable' }; }
    if (res.status === 404) return { ok: false, reason: 'not-found' };
    if (res.status === 403 || res.status === 429) return { ok: false, reason: 'rate-limited' };
    if (res.status >= 300 && res.status < 400) return { ok: false, reason: 'not-found' };
    if (!res.ok) return { ok: false, reason: 'unavailable' };
    const html = await res.text();
    if (html.length > 2000000) return { ok: false, reason: 'unavailable' };
    if (pageShowsStar(html)) return { ok: true, login: name };
    if (!/rel="next"/i.test(html)) return { ok: false, reason: 'not-starred' };
  }
  return { ok: false, reason: 'incomplete', login: name };
}

/**
 * Confirm the account exists and that coye2/spot-plus is in its public stars.
 * The public stars page is checked first. The REST API is only the fallback,
 * because Cloudflare's shared address exhausts GitHub's unauthenticated quota.
 */
export async function findStar(login, fetcher, { token = '', maxPages = MAX_STAR_PAGES, signal } = {}) {
  const name = normalizeLogin(login);
  if (!name) return { ok: false, reason: 'invalid' };
  if (!token) {
    const page = await findStarOnSite(name, fetcher, signal);
    if (page.ok || page.reason === 'not-starred' || page.reason === 'not-found' || page.reason === 'incomplete') return page;
  }
  const headers = githubHeaders(token);
  let userRes;
  try {
    userRes = await fetcher('https://api.github.com/users/' + encodeURIComponent(name), { headers, signal });
  } catch {
    return { ok: false, reason: 'unavailable' };
  }
  if (userRes.status === 404) return { ok: false, reason: 'not-found' };
  if (userRes.status === 403 || userRes.status === 429) return { ok: false, reason: 'rate-limited' };
  if (!userRes.ok) return { ok: false, reason: 'unavailable' };
  let user;
  try { user = await readJsonLimited(userRes, 100000); } catch { return { ok: false, reason: 'unavailable' }; }
  const canonical = normalizeLogin(user?.login);
  if (!canonical || canonical.toLowerCase() !== name.toLowerCase()) return { ok: false, reason: 'not-found' };
  for (let page = 1; page <= maxPages; page++) {
    let res;
    try {
      res = await fetcher(`https://api.github.com/users/${encodeURIComponent(canonical)}/starred?per_page=100&page=${page}`, { headers, signal });
    } catch {
      return { ok: false, reason: 'unavailable' };
    }
    if (res.status === 403 || res.status === 429) return { ok: false, reason: 'rate-limited' };
    if (res.status === 404) return { ok: false, reason: 'not-starred' };
    if (!res.ok) return { ok: false, reason: 'unavailable' };
    let repos;
    try { repos = await readJsonLimited(res); } catch { return { ok: false, reason: 'unavailable' }; }
    if (!Array.isArray(repos)) return { ok: false, reason: 'unavailable' };
    if (repos.some((repo) => String(repo?.full_name || '').toLowerCase() === REPO.full)) return { ok: true, login: canonical };
    if (repos.length < 100) return { ok: false, reason: 'not-starred' };
  }
  return { ok: false, reason: 'incomplete', login: canonical };
}

/** Authenticated check: 204 means the signed-in user has starred the repo. */
export async function viewerStarred(token, fetcher, { signal } = {}) {
  const headers = githubHeaders(token);
  let userRes;
  let starRes;
  try {
    userRes = await fetcher('https://api.github.com/user', { headers, signal });
    starRes = await fetcher('https://api.github.com/user/starred/' + REPO.full, { headers, signal });
  } catch {
    return { ok: false, reason: 'unavailable' };
  }
  if (userRes.status === 401 || starRes.status === 401) return { ok: false, reason: 'unavailable' };
  if (userRes.status === 403 || starRes.status === 403 || userRes.status === 429 || starRes.status === 429) {
    return { ok: false, reason: 'rate-limited' };
  }
  if (!userRes.ok) return { ok: false, reason: 'unavailable' };
  let user;
  try { user = await readJsonLimited(userRes, 100000); } catch { return { ok: false, reason: 'unavailable' }; }
  const login = normalizeLogin(user?.login);
  if (!login) return { ok: false, reason: 'not-found' };
  if (starRes.status === 204) return { ok: true, login };
  if (starRes.status === 404) return { ok: false, reason: 'not-starred', login };
  return { ok: false, reason: 'unavailable' };
}

function validDevice(id) {
  return /^[a-f0-9]{32}$/.test(String(id || ''));
}

function validNonce(nonce) {
  return /^[a-f0-9]{16,32}$/.test(String(nonce || ''));
}

async function mutate(storage, fn) {
  if (typeof storage.transaction === 'function') return storage.transaction(fn);
  return fn(storage);
}

async function rollQuotaDay(storage, day) {
  const prev = await storage.get('quotaDay');
  if (prev === day) return;
  if (prev && typeof storage.list === 'function' && typeof storage.delete === 'function') {
    const drop = [];
    for (const prefix of ['q:', 'nonce:']) {
      const listed = await storage.list({ prefix });
      for (const key of listed.keys()) {
        if (!String(key).includes(':' + day + ':')) drop.push(key);
        if (drop.length >= 400) break;
      }
      if (drop.length >= 400) break;
    }
    if (drop.length) await storage.delete(drop);
    if (drop.length >= 400) return;
  }
  await storage.put({ quotaDay: day });
}

async function readCounts(storage, day, device, ipHash) {
  const deviceUsed = Number(await storage.get(`q:d:${day}:${device}`)) || 0;
  const ipUsed = ipHash ? (Number(await storage.get(`q:ip:${day}:${ipHash}`)) || 0) : 0;
  const full = await storage.get('full:' + device);
  return { deviceUsed, ipUsed, unlocked: !!full?.login, login: full?.login || '' };
}

function statusBody(counts, { oauth = false, discord = false, day, charged = 0 } = {}) {
  const view = quotaView({ ...counts, limit: DAILY_LIMIT });
  return {
    ...view,
    day,
    login: counts.login || null,
    unlocked: view.tier === 'full',
    oauth: !!oauth,
    discord: !!discord,
    exempt: !!counts.exempt,
    discordInvite: DISCORD.invite,
    charged,
    repo: REPO.url,
  };
}

async function rememberUnlock(storage, device, login, name = '') {
  const account = String(login || '').slice(0, 80).toLowerCase();
  if (!account) return { ok: false, reason: 'invalid' };
  const key = 'stardev:' + account;
  const existing = await storage.get(key);
  const devices = Array.isArray(existing) ? [...existing] : [];
  if (!devices.includes(device)) {
    if (devices.length >= MAX_DEVICES_PER_LOGIN) return { ok: false, reason: 'device-cap' };
    devices.push(device);
  }
  const display = String(name || login).slice(0, 80);
  await storage.put({
    [key]: devices.slice(0, MAX_DEVICES_PER_LOGIN),
    ['full:' + device]: { login: display, account, at: Date.now() },
  });
  return { ok: true, login: display };
}

function secretsOf(request) {
  return {
    token: request.headers.get('X-Github-Token') || '',
    clientId: request.headers.get('X-Github-Client-Id') || '',
    clientSecret: request.headers.get('X-Github-Client-Secret') || '',
    unlockSecret: request.headers.get('X-Unlock-Secret') || request.headers.get('X-Github-Client-Secret') || request.headers.get('X-Discord-Client-Secret') || '',
    publicOrigin: request.headers.get('X-Public-Origin') || '',
    discordId: request.headers.get('X-Discord-Client-Id') || '',
    discordSecret: request.headers.get('X-Discord-Client-Secret') || '',
    discordGuild: request.headers.get('X-Discord-Guild') || '',
  };
}

function oauthEnabled(secrets) {
  return !!(secrets.clientId && secrets.clientSecret && secrets.unlockSecret);
}

function discordEnabled(secrets) {
  return !!(secrets.discordId && secrets.discordSecret && secrets.unlockSecret);
}

function flagsFor(secrets) {
  return { oauth: oauthEnabled(secrets), discord: discordEnabled(secrets) };
}

async function markOwner(storage, device, proof, origin, now, household = '') {
  if (!validDevice(device)) return false;
  const house = /^[a-f0-9]{32}$/.test(household) ? household : '';
  if (await storage.get('own:' + device)) {
    if (house && isOwnerProof(proof, { origin, now })) await storage.put({ ['house:' + house]: now });
    return true;
  }
  if (house && await storage.get('house:' + house)) {
    await storage.put({ ['own:' + device]: now });
    return true;
  }
  if (!isOwnerProof(proof, { origin, now })) return false;
  const put = { ['own:' + device]: now };
  if (house) put['house:' + house] = now;
  await storage.put(put);
  return true;
}

function ownerRequest(request) {
  const household = request.headers.get('X-Spotplus-Household') || '';
  return {
    proof: request.headers.get('X-Spotplus-Owner') || '',
    origin: request.headers.get('X-App-Origin') || request.headers.get('Origin') || '',
    household: /^[a-f0-9]{32}$/.test(household) ? household : '',
  };
}

async function touchSeen(storage, device, now) {
  if (!validDevice(device)) return 0;
  const key = 'seen:' + device;
  const prev = Number(await storage.get(key)) || 0;
  if (!prev) await storage.put({ [key]: now });
  return prev || now;
}

export async function handleAccess(request, { storage, fetcher = fetch, now = Date.now() } = {}) {
  if (!storage?.get || !storage?.put) return json({ error: 'Access limits are not set up' }, 503);
  const clock = typeof now === 'function' ? now() : now;
  const url = new URL(request.url);
  const secrets = secretsOf(request);
  const ipHash = /^[a-f0-9]{8,64}$/.test(request.headers.get('X-Client') || '') ? request.headers.get('X-Client') : '';
  const day = utcDay(clock);
  const signal = fetcher === fetch && typeof AbortSignal !== 'undefined' && AbortSignal.timeout ? AbortSignal.timeout(8000) : undefined;

  if (url.pathname === '/access/github/start') return startGithub(url, secrets, clock);
  if (url.pathname === '/access/github/callback') return finishGithub(url, secrets, storage, fetcher, clock, signal, day);
  if (url.pathname === '/access/discord/start') return startDiscord(url, secrets, clock);
  if (url.pathname === '/access/discord/callback') return finishDiscord(url, secrets, storage, fetcher, clock, signal, day);
  if (url.pathname === '/access/refer/code' || url.pathname === '/access/refer/redeem') {
    return handleReferral(request, {
      storage, now: clock, ipHash, hash: shortHash,
      unlock: (referrer, account, label) => mutate(storage, (txn) => rememberUnlock(txn, referrer, account, label)),
      ownerProof: ownerRequest(request).proof,
      origin: ownerRequest(request).origin,
      household: ownerRequest(request).household,
    });
  }

  await rollQuotaDay(storage, day);

  if (url.pathname === '/access/verify') {
    if (request.method !== 'POST') return json({ error: 'Use POST' }, 405);
    const body = await request.json().catch(() => ({}));
    const device = String(body.device || '');
    if (!validDevice(device)) return json({ ok: false, reason: 'invalid' }, 400);
    const found = await findStar(body.username, fetcher, { token: secrets.token, signal });
    if (!found.ok) return json({ ok: false, reason: found.reason, login: found.login || null }, found.reason === 'rate-limited' ? 429 : 200);
    const saved = await mutate(storage, (txn) => rememberUnlock(txn, device, found.login));
    if (!saved.ok) return json({ ok: false, reason: saved.reason, login: found.login }, 200);
    const counts = await readCounts(storage, day, device, ipHash);
    return json({ ok: true, ...statusBody({ ...counts, unlocked: true, login: found.login }, { ...flagsFor(secrets), day }) });
  }

  if (url.pathname !== '/access') return json({ error: 'Not found' }, 404);

  if (request.method === 'GET') {
    const device = url.searchParams.get('device') || '';
    if (!validDevice(device)) return json({ error: 'bad device' }, 400);
    await touchSeen(storage, device, clock);
    const owner = ownerRequest(request);
    const exempt = await markOwner(storage, device, owner.proof, owner.origin, clock, owner.household);
    const counts = await readCounts(storage, day, device, ipHash);
    if (exempt) { counts.unlocked = true; counts.exempt = true; }
    return json(statusBody(counts, { ...flagsFor(secrets), day }));
  }

  if (request.method !== 'POST') return json({ error: 'Use GET or POST' }, 405);
  const body = await request.json().catch(() => ({}));
  const device = String(body.device || '');
  if (!validDevice(device)) return json({ error: 'bad device' }, 400);
  await touchSeen(storage, device, clock);
  const owner = ownerRequest(request);
  if (await markOwner(storage, device, owner.proof, owner.origin, clock, owner.household)) {
    const counts = await readCounts(storage, day, device, ipHash);
    counts.unlocked = true;
    counts.exempt = true;
    return json(statusBody(counts, { ...flagsFor(secrets), day, charged: 0 }));
  }
  const action = String(body.action || 'status');
  if (action !== 'status' && !isKnownAction(action)) return json({ error: 'bad action' }, 400);
  const n = action === 'status' ? 0 : Math.max(1, Math.min(DAILY_LIMIT, Math.floor(Number(body.n) || 1)));
  const nonce = validNonce(body.nonce) ? String(body.nonce) : '';

  const result = await mutate(storage, async (txn) => {
    if (nonce) {
      const seen = await txn.get(`nonce:${day}:${device}:${nonce}`);
      if (seen) {
        const counts = await readCounts(txn, day, device, ipHash);
        return statusBody(counts, { ...flagsFor(secrets), day, charged: 0 });
      }
    }
    const counts = await readCounts(txn, day, device, ipHash);
    if (n === 0 || counts.unlocked) {
      if (nonce) await txn.put({ [`nonce:${day}:${device}:${nonce}`]: 1 });
      return statusBody(counts, { ...flagsFor(secrets), day, charged: 0 });
    }
    const next = addUsage({ ...counts, trackIp: !!ipHash }, n);
    const put = {
      ['q:d:' + day + ':' + device]: next.deviceUsed,
    };
    if (ipHash) put['q:ip:' + day + ':' + ipHash] = next.ipUsed;
    if (nonce) put[`nonce:${day}:${device}:${nonce}`] = 1;
    await txn.put(put);
    return statusBody({ ...counts, deviceUsed: next.deviceUsed, ipUsed: next.ipUsed }, { ...flagsFor(secrets), day, charged: next.charged });
  });
  return json(result);
}

async function startGithub(url, secrets, now) {
  if (!oauthEnabled(secrets) || !/^https?:\/\//.test(secrets.publicOrigin)) return json({ error: 'oauth-not-configured' }, 404);
  const device = url.searchParams.get('device') || '';
  if (!validDevice(device)) return json({ error: 'bad device' }, 400);
  const returnTo = returnTarget(url.searchParams.get('return') || '');
  const state = await sealState({ device, returnTo, exp: now + STATE_TTL_MS }, secrets.unlockSecret);
  const redirectUri = secrets.publicOrigin.replace(/\/$/, '') + '/access/github/callback';
  const auth = new URL('https://github.com/login/oauth/authorize');
  auth.searchParams.set('client_id', secrets.clientId);
  auth.searchParams.set('redirect_uri', redirectUri);
  auth.searchParams.set('state', state);
  auth.searchParams.set('allow_signup', 'true');
  return Response.redirect(auth.href, 302);
}

async function finishGithub(url, secrets, storage, fetcher, now, signal, day) {
  if (!oauthEnabled(secrets) || !/^https?:\/\//.test(secrets.publicOrigin)) return json({ error: 'oauth-not-configured' }, 404);
  const back = (reason, returnTo) => {
    const dest = new URL(returnTarget(returnTo));
    dest.searchParams.set('star', reason);
    return Response.redirect(dest.href, 302);
  };
  if (url.searchParams.get('error')) return back('denied', '');
  const opened = await openState(url.searchParams.get('state') || '', secrets.unlockSecret, now);
  if (!opened) return back('invalid', '');
  const code = url.searchParams.get('code') || '';
  if (!code || code.length > 200) return back('invalid', opened.returnTo);
  const redirectUri = secrets.publicOrigin.replace(/\/$/, '') + '/access/github/callback';
  let tokenRes;
  try {
    tokenRes = await fetcher('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: { Accept: 'application/json', 'User-Agent': 'SpotPlus (https://coye2.github.io/spot-plus/)' },
      body: new URLSearchParams({
        client_id: secrets.clientId,
        client_secret: secrets.clientSecret,
        code,
        redirect_uri: redirectUri,
      }),
      signal,
    });
  } catch {
    return back('unavailable', opened.returnTo);
  }
  let tokenBody = {};
  try { tokenBody = await readJsonLimited(tokenRes, 20000); } catch { return back('unavailable', opened.returnTo); }
  if (!tokenRes.ok || !tokenBody.access_token) return back('unavailable', opened.returnTo);
  const starred = await viewerStarred(tokenBody.access_token, fetcher, { signal });
  if (!starred.ok) return back(starred.reason || 'unavailable', opened.returnTo);
  await rollQuotaDay(storage, day);
  const saved = await mutate(storage, (txn) => rememberUnlock(txn, opened.device, starred.login));
  if (!saved.ok) return back(saved.reason, opened.returnTo);
  return back('ok', opened.returnTo);
}

async function startDiscord(url, secrets, now) {
  if (!discordEnabled(secrets) || !/^https?:\/\//.test(secrets.publicOrigin)) return json({ error: 'oauth-not-configured' }, 404);
  const device = url.searchParams.get('device') || '';
  if (!validDevice(device)) return json({ error: 'bad device' }, 400);
  const returnTo = returnTarget(url.searchParams.get('return') || '');
  const state = await sealState({ device, returnTo, exp: now + STATE_TTL_MS, kind: 'discord' }, secrets.unlockSecret);
  const redirectUri = secrets.publicOrigin.replace(/\/$/, '') + '/access/discord/callback';
  const auth = new URL('https://discord.com/oauth2/authorize');
  auth.searchParams.set('client_id', secrets.discordId);
  auth.searchParams.set('redirect_uri', redirectUri);
  auth.searchParams.set('response_type', 'code');
  auth.searchParams.set('scope', 'identify guilds');
  auth.searchParams.set('state', state);
  auth.searchParams.set('prompt', 'consent');
  return Response.redirect(auth.href, 302);
}

async function finishDiscord(url, secrets, storage, fetcher, now, signal, day) {
  if (!discordEnabled(secrets) || !/^https?:\/\//.test(secrets.publicOrigin)) return json({ error: 'oauth-not-configured' }, 404);
  const back = (reason, returnTo) => {
    const dest = new URL(returnTarget(returnTo));
    dest.searchParams.set('support', reason);
    return Response.redirect(dest.href, 302);
  };
  if (url.searchParams.get('error')) return back('denied', '');
  const opened = await openState(url.searchParams.get('state') || '', secrets.unlockSecret, now);
  if (!opened) return back('invalid', '');
  const code = url.searchParams.get('code') || '';
  if (!code || code.length > 200) return back('invalid', opened.returnTo);
  const redirectUri = secrets.publicOrigin.replace(/\/$/, '') + '/access/discord/callback';
  let tokenRes;
  try {
    tokenRes = await fetcher('https://discord.com/api/oauth2/token', {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'SpotPlus (https://coye2.github.io/spot-plus/)' },
      body: new URLSearchParams({
        client_id: secrets.discordId,
        client_secret: secrets.discordSecret,
        grant_type: 'authorization_code',
        code,
        redirect_uri: redirectUri,
      }),
      signal,
    });
  } catch {
    return back('unavailable', opened.returnTo);
  }
  let tokenBody = {};
  try { tokenBody = await readJsonLimited(tokenRes, 20000); } catch { return back('unavailable', opened.returnTo); }
  if (!tokenRes.ok || !tokenBody.access_token) return back('unavailable', opened.returnTo);
  const headers = { Accept: 'application/json', Authorization: 'Bearer ' + tokenBody.access_token, 'User-Agent': 'SpotPlus (https://coye2.github.io/spot-plus/)' };
  let userRes;
  let guildRes;
  try {
    userRes = await fetcher('https://discord.com/api/users/@me', { headers, signal });
    guildRes = await fetcher('https://discord.com/api/users/@me/guilds', { headers, signal });
  } catch {
    return back('unavailable', opened.returnTo);
  }
  if (!userRes.ok || !guildRes.ok) return back(userRes.status === 429 || guildRes.status === 429 ? 'rate-limited' : 'unavailable', opened.returnTo);
  let user;
  let guilds;
  try {
    user = await readJsonLimited(userRes, 100000);
    guilds = await readJsonLimited(guildRes, 400000);
  } catch {
    return back('unavailable', opened.returnTo);
  }
  let guildId = '';
  try { guildId = await discordGuildId(storage, fetcher, secrets.discordGuild, signal); } catch { guildId = ''; }
  if (!guildId) return back('unavailable', opened.returnTo);
  if (!isGuildMember(guilds, guildId)) return back('not-member', opened.returnTo);
  const login = 'discord:' + String(user.id || '');
  const name = String(user.global_name || user.username || 'Discord').slice(0, 40);
  if (!/^\d{5,25}$/.test(String(user.id || ''))) return back('invalid', opened.returnTo);
  await rollQuotaDay(storage, day);
  const saved = await mutate(storage, (txn) => rememberUnlock(txn, opened.device, login, name));
  if (!saved.ok) return back(saved.reason, opened.returnTo);
  return back('ok', opened.returnTo);
}

export async function routeAccess(request, env) {
  if (!env?.INSTALLS?.get || !env?.INSTALLS?.idFromName) return json({ error: 'Access limits are not set up' }, 503);
  const url = new URL(request.url);
  const headers = new Headers();
  headers.set('X-Client', await shortHash(request.headers.get('CF-Connecting-IP') || 'local'));
  headers.set('X-Public-Origin', url.origin);
  const appOrigin = request.headers.get('Origin') || '';
  if (appOrigin) headers.set('X-App-Origin', appOrigin);
  const ownerProofHeader = request.headers.get('X-Spotplus-Owner') || '';
  if (ownerProofHeader && ownerProofHeader.length <= 600) headers.set('X-Spotplus-Owner', ownerProofHeader);
  const household = request.headers.get('X-Spotplus-Household') || '';
  if (/^[a-f0-9]{32}$/.test(household)) headers.set('X-Spotplus-Household', household);
  if (env.GITHUB_TOKEN) headers.set('X-Github-Token', String(env.GITHUB_TOKEN));
  if (env.GITHUB_CLIENT_ID) headers.set('X-Github-Client-Id', String(env.GITHUB_CLIENT_ID));
  if (env.GITHUB_CLIENT_SECRET) headers.set('X-Github-Client-Secret', String(env.GITHUB_CLIENT_SECRET));
  if (env.DISCORD_CLIENT_ID) headers.set('X-Discord-Client-Id', String(env.DISCORD_CLIENT_ID));
  if (env.DISCORD_CLIENT_SECRET) headers.set('X-Discord-Client-Secret', String(env.DISCORD_CLIENT_SECRET));
  if (env.DISCORD_GUILD_ID) headers.set('X-Discord-Guild', String(env.DISCORD_GUILD_ID));
  const secret = env.UNLOCK_SECRET || env.GITHUB_CLIENT_SECRET || env.DISCORD_CLIENT_SECRET || '';
  if (secret) headers.set('X-Unlock-Secret', String(secret));
  const stub = env.INSTALLS.get(env.INSTALLS.idFromName('global'));
  const init = { method: request.method, headers };
  if (request.method !== 'GET' && request.method !== 'HEAD') init.body = (await request.text()).slice(0, 4500);
  const res = await stub.fetch('https://counter' + url.pathname + url.search, init);
  const location = res.headers.get('Location');
  if (res.status >= 300 && res.status < 400 && location) {
    return new Response(null, { status: res.status, headers: { Location: location, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } });
  }
  return new Response(await res.text(), { status: res.status, headers: HEADERS });
}
