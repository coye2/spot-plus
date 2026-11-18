import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { storageMock } from './helpers.mjs';
import {
  MAINTENANCE_MODE,
  ALLOWED_ID_HASHES,
  DEV_ACCESS_STORAGE_KEY,
  DEV_ATTEMPTS_STORAGE_KEY,
  normalizeDeveloperHandle,
  hashDeveloperHandle,
  isAllowedSpotifyId,
  createSessionToken,
  verifySessionToken,
  getUnlockCooldown,
  canBypassMaintenance,
  unlockDeveloperAccess,
  clearDeveloperAccess,
} from '../js/maintenance.js';

const TEST_OWNER = 'coye-9';

test('boot.js and maintenance.js keep the maintenance flag synchronized and contain no plaintext owner credentials', async () => {
  const [boot, maint, gate, html] = await Promise.all([
    readFile(new URL('../js/boot.js', import.meta.url), 'utf8'),
    readFile(new URL('../js/maintenance.js', import.meta.url), 'utf8'),
    readFile(new URL('../js/gate.js', import.meta.url), 'utf8'),
    readFile(new URL('../index.html', import.meta.url), 'utf8'),
  ]);
  const match = boot.match(/var\s+MAINTENANCE\s*=\s*(true|false)\s*;/);
  assert.ok(match, 'js/boot.js must declare var MAINTENANCE = true|false;');
  assert.equal(match[1] === 'true', MAINTENANCE_MODE);

  for (const [name, content] of [['js/boot.js', boot], ['js/maintenance.js', maint], ['js/gate.js', gate], ['index.html', html]]) {
    assert.ok(!content.toLowerCase().includes(TEST_OWNER), `${name} must not expose plaintext owner credential`);
  }
});

test('index.html routes startup through js/gate.js and hides unlock form by default', async () => {
  const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
  assert.match(html, /id="maintenanceScreen"/);
  assert.match(html, /We’ll return momentarily/);
  assert.match(html, /id="maintUnlockWrap"[^>]*hidden/);
  assert.doesNotMatch(html, /<summary>Developer access<\/summary>/);
  assert.match(html, /<script type="module" src="js\/gate\.js"><\/script>/);
  assert.doesNotMatch(html, /<script type="module" src="js\/app\.js"><\/script>/);
});

test('developer handle hashing verifies owner handles, URIs, and profile URLs', () => {
  assert.ok(ALLOWED_ID_HASHES.includes(hashDeveloperHandle(TEST_OWNER)));
  assert.equal(normalizeDeveloperHandle(TEST_OWNER), TEST_OWNER);
  assert.equal(normalizeDeveloperHandle('@COYE-9'), TEST_OWNER);
  assert.equal(normalizeDeveloperHandle(`spotify:user:${TEST_OWNER}`), TEST_OWNER);
  assert.equal(normalizeDeveloperHandle(`https://open.spotify.com/user/${TEST_OWNER}?si=xyz`), TEST_OWNER);
  assert.equal(isAllowedSpotifyId(TEST_OWNER), true);
  assert.equal(isAllowedSpotifyId('other-listener'), false);
});

test('maintenance tokens are origin-bound, tamper-evident, and expire cleanly', () => {
  const digest = hashDeveloperHandle(TEST_OWNER);
  const now = Date.UTC(2026, 10, 18);
  const token = createSessionToken(digest, { origin: 'https://coye2.github.io', now });
  assert.ok(token && !token.includes(TEST_OWNER));
  assert.equal(verifySessionToken(token, { origin: 'https://coye2.github.io', now: now + 1000 }), true);
  assert.equal(verifySessionToken(token, { origin: 'https://evil.example', now: now + 1000 }), false);
  assert.equal(verifySessionToken(token, { origin: 'https://coye2.github.io', now: now + 40 * 86400_000 }), false);

  const tampered = JSON.stringify({ ...JSON.parse(token), h: '0'.repeat(64) });
  assert.equal(verifySessionToken(tampered, { origin: 'https://coye2.github.io', now }), false);
  assert.equal(verifySessionToken(TEST_OWNER, { origin: 'https://coye2.github.io', now }), false);
});

test('maintenance mode blocks public visitors, rejects plaintext forged tokens, and rate-limits bad attempts', () => {
  const storage = storageMock();
  const origin = 'https://coye2.github.io';
  const now = Date.UTC(2026, 10, 18);

  const publicVisit = canBypassMaintenance({ storage, origin, now });
  assert.equal(publicVisit.allowed, !MAINTENANCE_MODE);

  // Legacy plaintext handle in storage is rejected and cleared
  storage.setItem(DEV_ACCESS_STORAGE_KEY, TEST_OWNER);
  assert.equal(canBypassMaintenance({ storage, origin, now }).allowed, !MAINTENANCE_MODE);
  assert.equal(storage.getItem(DEV_ACCESS_STORAGE_KEY), null);

  const otherUser = canBypassMaintenance({
    storage,
    origin,
    now,
    spotifyAccount: { account: { id: 'random-listener' } },
  });
  assert.equal(otherUser.allowed, !MAINTENANCE_MODE);

  // Connected owner via Spotify account, synced stats, or linked profile
  assert.equal(canBypassMaintenance({ storage, origin, now, spotifyAccount: { account: { id: TEST_OWNER } } }).allowed, true);
  assert.equal(canBypassMaintenance({ storage, origin, now, spotifyStats: { account: { id: TEST_OWNER.toUpperCase() } } }).allowed, true);
  assert.equal(canBypassMaintenance({ storage, origin, now, links: { profile: { id: TEST_OWNER } } }).allowed, true);

  // Repeated failed attempts trigger lockout
  for (let i = 0; i < 5; i++) {
    assert.equal(unlockDeveloperAccess(`wrong-${i}`, storage, { origin, now: now + i * 100 }), false);
  }
  assert.ok(getUnlockCooldown(storage, now + 500) >= 59);
  assert.equal(unlockDeveloperAccess(TEST_OWNER, storage, { origin, now: now + 500 }), false);

  // Unlocking after cooldown clears attempts and stores signed token without plaintext handle
  const afterCooldown = now + 70_000;
  assert.equal(unlockDeveloperAccess(`https://open.spotify.com/user/${TEST_OWNER}`, storage, { origin, now: afterCooldown }), true);
  const stored = storage.getItem(DEV_ACCESS_STORAGE_KEY);
  assert.ok(stored && !stored.includes(TEST_OWNER));
  assert.equal(storage.getItem(DEV_ATTEMPTS_STORAGE_KEY), null);
  assert.equal(canBypassMaintenance({ storage, origin, now: afterCooldown + 1000 }).allowed, true);

  // Dev URL parameter strips/issues signed token
  const storage2 = storageMock();
  const byParam = canBypassMaintenance({ storage: storage2, search: `?dev=${TEST_OWNER}`, origin, now });
  assert.equal(byParam.allowed, true);
  assert.equal(byParam.stripParam, true);
  assert.ok(verifySessionToken(storage2.getItem(DEV_ACCESS_STORAGE_KEY), { origin, now: now + 1000 }));

  clearDeveloperAccess(storage2);
  assert.equal(storage2.getItem(DEV_ACCESS_STORAGE_KEY), null);
});
