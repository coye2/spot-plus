import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { storageMock } from './helpers.mjs';
import {
  MAINTENANCE_MODE,
  ALLOWED_SPOTIFY_IDS,
  DEV_ACCESS_STORAGE_KEY,
  normalizeDeveloperHandle,
  isAllowedSpotifyId,
  canBypassMaintenance,
  unlockDeveloperAccess,
} from '../js/maintenance.js';

test('boot.js and maintenance.js keep the maintenance flag synchronized', async () => {
  const boot = await readFile(new URL('../js/boot.js', import.meta.url), 'utf8');
  const match = boot.match(/var\s+MAINTENANCE\s*=\s*(true|false)\s*;/);
  assert.ok(match, 'js/boot.js must declare var MAINTENANCE = true|false;');
  assert.equal(match[1] === 'true', MAINTENANCE_MODE);
});

test('index.html routes startup through js/gate.js and includes maintenance screen', async () => {
  const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
  assert.match(html, /id="maintenanceScreen"/);
  assert.match(html, /We’ll return momentarily/);
  assert.match(html, /<script type="module" src="js\/gate\.js"><\/script>/);
  assert.doesNotMatch(html, /<script type="module" src="js\/app\.js"><\/script>/);
});

test('developer handle normalization recognizes coye-9 handles, URIs, and profile URLs', () => {
  assert.ok(ALLOWED_SPOTIFY_IDS.includes('coye-9'));
  assert.equal(normalizeDeveloperHandle('coye-9'), 'coye-9');
  assert.equal(normalizeDeveloperHandle('@COYE-9'), 'coye-9');
  assert.equal(normalizeDeveloperHandle('spotify:user:coye-9'), 'coye-9');
  assert.equal(normalizeDeveloperHandle('https://open.spotify.com/user/coye-9?si=xyz'), 'coye-9');
  assert.equal(isAllowedSpotifyId('coye-9'), true);
  assert.equal(isAllowedSpotifyId('other-listener'), false);
});

test('maintenance mode blocks public visitors while allowing coye-9 Spotify and unlocked devices', () => {
  const storage = storageMock();

  const publicVisit = canBypassMaintenance({ storage });
  assert.equal(publicVisit.allowed, !MAINTENANCE_MODE);

  const otherUser = canBypassMaintenance({
    storage,
    spotifyAccount: { account: { id: 'random-listener' } },
  });
  assert.equal(otherUser.allowed, !MAINTENANCE_MODE);

  // Connected coye-9 via Spotify account snapshot
  const byAccount = canBypassMaintenance({
    storage,
    spotifyAccount: { account: { id: 'coye-9' } },
  });
  assert.equal(byAccount.allowed, true);

  // Connected coye-9 via synced stats
  const byStats = canBypassMaintenance({
    storage,
    spotifyStats: { account: { id: 'COYE-9' } },
  });
  assert.equal(byStats.allowed, true);

  // Connected coye-9 via linked public Spotify profile
  const byLinks = canBypassMaintenance({
    storage,
    links: { profile: { id: 'coye-9' } },
  });
  assert.equal(byLinks.allowed, true);

  // Unlocking device (e.g. iPhone) via ?dev=coye-9 or form persists access for that device
  assert.equal(unlockDeveloperAccess('not-the-owner', storage), false);
  assert.equal(storage.getItem(DEV_ACCESS_STORAGE_KEY), null);

  assert.equal(unlockDeveloperAccess('https://open.spotify.com/user/coye-9', storage), true);
  assert.equal(storage.getItem(DEV_ACCESS_STORAGE_KEY), 'coye-9');
  assert.equal(canBypassMaintenance({ storage }).allowed, true);

  const storage2 = storageMock();
  const byParam = canBypassMaintenance({ storage: storage2, search: '?dev=coye-9' });
  assert.equal(byParam.allowed, true);
  assert.equal(storage2.getItem(DEV_ACCESS_STORAGE_KEY), 'coye-9');
});
