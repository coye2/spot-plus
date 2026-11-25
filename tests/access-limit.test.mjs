import test from 'node:test';
import assert from 'node:assert/strict';
import { DAILY_LIMIT, addUsage, quotaView, utcDay } from '../js/access-policy.js';
import { hardwareKey, judgeReferral, normalizeCode } from '../js/referral.js';
import { createLedger } from '../js/access.js';
import { ALLOWED_ID_HASHES, createSessionToken, isOwnerProof } from '../js/maintenance.js';
import { handleAccess } from '../canvas-bridge/access.js';
import { storageMock } from './helpers.mjs';

function mem() {
  const m = new Map();
  const api = {
    get: async (k) => m.get(k),
    put: async (o) => { for (const [k, v] of Object.entries(o)) m.set(k, v); },
    list: async ({ prefix } = {}) => {
      const out = new Map();
      for (const [k, v] of m) if (!prefix || String(k).startsWith(prefix)) out.set(k, v);
      return out;
    },
    delete: async (keys) => { for (const k of keys) m.delete(k); },
  };
  api.transaction = async (fn) => fn(api);
  return api;
}

const dev = (ch) => ch.repeat(32);
const ip = (ch) => ch.repeat(16);
const secret = (ch) => ch.repeat(32);
const phone = { ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)', platform: 'iPhone', timezone: 'America/New_York', language: 'en-US', cores: 6, memory: 4, touch: 5, width: 390, height: 844, dpr: 3, color: 24, standalone: true };
const laptop = { ua: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0', platform: 'Win32', timezone: 'America/Chicago', language: 'en-US', cores: 8, memory: 8, touch: 0, width: 1920, height: 1080, dpr: 1, color: 24, standalone: true };

function post(path, body, { address = ip('a'), owner = '', origin = 'https://coye2.github.io', household = '' } = {}) {
  const headers = { 'Content-Type': 'application/json', 'X-Client': address, 'X-App-Origin': origin };
  if (owner) headers['X-Spotplus-Owner'] = owner;
  if (household) headers['X-Spotplus-Household'] = household;
  return new Request('https://counter' + path, { method: 'POST', headers, body: JSON.stringify(body) });
}

test('skip, insta play, and insta choose share 300 on the device and on the network', () => {
  assert.equal(DAILY_LIMIT, 300);
  let state = { deviceUsed: 0, ipUsed: 0 };
  state = addUsage(state, 1);
  assert.equal(state.deviceUsed, 1);
  assert.equal(state.ipUsed, 1);
  assert.equal(state.remaining, 299);
  const capped = addUsage({ deviceUsed: 10, ipUsed: 299 }, 5);
  assert.equal(capped.ipUsed, 300);
  assert.equal(capped.limited, true);
  assert.equal(capped.allowed, false);
  assert.equal(quotaView({ deviceUsed: 300, ipUsed: 0 }).allowed, false);
  assert.equal(quotaView({ deviceUsed: 300, ipUsed: 300, unlocked: true }).tier, 'full');
});

test('the on-device ledger stops at 300 and follows the network count', () => {
  const ledger = createLedger(storageMock(), () => Date.parse('2026-11-25T15:00:00Z'));
  for (let i = 0; i < 300; i++) assert.equal(ledger.consume(i % 2 ? 'skip' : 'insta-play').allowed, true);
  assert.equal(ledger.consume('insta-choose').allowed, false);
  ledger.applyServer({ day: '2026-11-25', deviceUsed: 1, ipUsed: 300, unlocked: false }, { authoritative: true });
  assert.equal(ledger.snapshot().limited, true);
  ledger.applyServer({ day: '2026-11-26', deviceUsed: 0, ipUsed: 0, unlocked: false, exempt: false }, { authoritative: true });
  assert.equal(ledger.snapshot().limited, false);
  assert.equal(ledger.consume('skip').allowed, true);
});

test('an owner session is recognized and is not a blank string', () => {
  const origin = 'https://coye2.github.io';
  const token = createSessionToken(ALLOWED_ID_HASHES[0], { origin, now: 1_700_000_000_000 });
  assert.equal(isOwnerProof(token, { origin, now: 1_700_000_000_000 }), true);
  assert.equal(isOwnerProof('not-the-owner', { origin }), false);
  assert.equal(isOwnerProof('', { origin }), false);
});

test('owner devices are excluded from the device and network allowance', async () => {
  const storage = mem();
  const origin = 'https://coye2.github.io';
  const now = Date.parse('2026-11-25T16:00:00Z');
  const token = createSessionToken(ALLOWED_ID_HASHES[0], { origin, now });
  const ownerDevice = dev('a');
  const other = dev('b');
  const address = ip('c');
  const first = await handleAccess(post('/access', { device: ownerDevice, action: 'skip', n: 300, nonce: 'aa'.repeat(8) }, { address, owner: token, origin }), { storage, now });
  const ownerBody = await first.json();
  assert.equal(ownerBody.exempt, true);
  assert.equal(ownerBody.tier, 'full');
  assert.equal(ownerBody.charged, 0);
  assert.equal(ownerBody.deviceUsed, 0);
  const again = await (await handleAccess(post('/access', { device: ownerDevice, action: 'insta-play', n: 10, nonce: 'bb'.repeat(8) }, { address }), { storage, now: now + 1000 })).json();
  assert.equal(again.exempt, true, 'the device stays excluded after the proof');
  assert.equal(again.ipUsed, 0, 'owner use does not burn the network allowance');
  const stranger = await (await handleAccess(post('/access', { device: other, action: 'skip', n: 1, nonce: 'cc'.repeat(8) }, { address }), { storage, now: now + 2000 })).json();
  assert.equal(stranger.tier, 'base');
  assert.equal(stranger.ipUsed, 1);
  assert.equal(stranger.exempt, false);
  const house = 'ab'.repeat(16);
  await handleAccess(post('/access', { device: ownerDevice, action: 'skip', n: 1, nonce: 'ee'.repeat(8) }, { address, owner: token, origin, household: house }), { storage, now: now + 3000 });
  const linked = dev('c');
  const laptop = await (await handleAccess(post('/access', { device: linked, action: 'insta-choose', n: 40, nonce: 'ff'.repeat(8) }, { address: ip('d'), household: house }), { storage, now: now + 4000 })).json();
  assert.equal(laptop.exempt, true);
  assert.equal(laptop.charged, 0);
  const outsider = await (await handleAccess(post('/access', { device: dev('9'), action: 'skip', n: 1, nonce: '99'.repeat(8) }, { address: ip('e'), household: 'cd'.repeat(16) }), { storage, now: now + 5000 })).json();
  assert.equal(outsider.exempt, false);
  assert.equal(outsider.deviceUsed, 1);
});

test('a friend code rejects the same device, another browser, and a VPN, and accepts another device', () => {
  const mine = { device: dev('a'), mark: 'mark-a', hardware: hardwareKey(phone), browser: 'browser-a', family: 'ios', screen: '400x840@3', ip: ip('a') };
  assert.equal(judgeReferral({ referrer: mine, friend: { ...mine }, standalone: true }).reason, 'self');
  const otherBrowser = { ...mine, device: dev('b'), mark: 'mark-b', browser: 'browser-b', ip: ip('d') };
  assert.equal(judgeReferral({ referrer: mine, friend: otherBrowser, standalone: true }).reason, 'same-device');
  const friend = { device: dev('c'), mark: 'mark-c', hardware: hardwareKey(laptop), browser: 'browser-c', family: 'windows', screen: '1920x1080@1', ip: ip('e') };
  assert.equal(judgeReferral({
    referrer: mine, friend, standalone: true, codeCreatedAt: 100, friendFirstSeen: 0,
  }).ok, true);
  assert.equal(judgeReferral({
    referrer: mine, friend: { ...friend, ip: mine.ip, family: mine.family, screen: mine.screen, hardware: 'different' }, standalone: true,
  }).reason, 'same-network');
  assert.equal(judgeReferral({ referrer: mine, friend, standalone: false }).reason, 'install');
  assert.equal(judgeReferral({
    referrer: mine, friend, standalone: true, codeCreatedAt: 5_000, friendFirstSeen: 1_000,
  }).reason, 'not-new');
  assert.equal(normalizeCode('nope'), '');
  assert.equal(normalizeCode('ab23-cd45'), 'AB23CD45');
});

test('redeeming a code waits, then unlocks only the referrer, and an owner device cannot be the friend', async () => {
  const storage = mem();
  const created = Date.parse('2026-11-25T18:00:00Z');
  const referrer = dev('d');
  const friend = dev('e');
  const made = await (await handleAccess(post('/access/refer/code', {
    device: referrer, mark: secret('1'), signals: phone,
  }, { address: ip('a') }), { storage, now: created })).json();
  assert.equal(made.ok, true);
  assert.match(made.code, /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{8}$/);

  const early = await (await handleAccess(post('/access/refer/redeem', {
    device: friend, mark: secret('2'), code: made.code, signals: laptop,
  }, { address: ip('f') }), { storage, now: created + 10_000 })).json();
  assert.equal(early.reason, 'hold');
  assert.ok(early.challenge);

  const done = await (await handleAccess(post('/access/refer/redeem', {
    device: friend, mark: secret('2'), code: made.code, challenge: early.challenge, signals: laptop,
  }, { address: ip('f') }), { storage, now: created + 80_000 })).json();
  assert.equal(done.ok, true);
  assert.notEqual(done.tier, 'full');
  const referrerStatus = await (await handleAccess(new Request('https://counter/access?device=' + referrer, { headers: { 'X-Client': ip('a') } }), { storage, now: created + 90_000 })).json();
  assert.equal(referrerStatus.tier, 'full');
  assert.match(referrerStatus.login, /friend/);

  const origin = 'https://coye2.github.io';
  const token = createSessionToken(ALLOWED_ID_HASHES[0], { origin, now: created });
  const ownerDevice = dev('f');
  await handleAccess(post('/access', { device: ownerDevice, action: 'status', n: 0, nonce: 'dd'.repeat(8) }, { owner: token, origin }), { storage, now: created });
  const blocked = await (await handleAccess(post('/access/refer/redeem', {
    device: ownerDevice, mark: secret('3'), code: 'ABCD2345', signals: laptop,
  }, { owner: token, origin, address: ip('9') }), { storage, now: created + 120_000 })).json();
  assert.equal(blocked.reason, 'excluded');
});

test('utc day is the allowance window', () => {
  assert.equal(utcDay(Date.parse('2026-11-25T23:30:00Z')), '2026-11-25');
  assert.equal(utcDay(Date.parse('2026-11-26T00:30:00Z')), '2026-11-26');
});
