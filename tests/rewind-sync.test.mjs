import test from 'node:test';
import assert from 'node:assert/strict';
import {rewindModel,persona} from '../js/rewind.js';
import {syncIdentity,sealSnapshot,openSnapshot,newSyncKey,validSyncKey} from '../js/relay-sync.js';
import {spotifyConnectionURLs} from '../js/account-setup.js';

const DAY = 86400000, now = Date.UTC(2026, 10, 15, 18);
const rec = (i, artist, title, daysAgo, hour = 21) => ({id: 'r' + i, source: 'spotify', artist, title, ms: 200000, spotifyId: '', endedAt: now - daysAgo * DAY - (18 - hour) * 3600000});

test('Rewind merges history and synced Spotify stats for a range', () => {
  const records = [rec(1, 'A', 'One', 1), rec(2, 'A', 'One', 2), rec(3, 'B', 'Two', 3), rec(4, 'C', 'Old', 200)];
  const local = rewindModel(records, {stats: null}, 'short_term', now);
  assert.equal(local.plays, 3, 'only the last 4 weeks count');
  assert.equal(local.tracks[0].title, 'One');
  assert.equal(local.artistCount, 2);
  assert.equal(local.fromSpotify, false);
  const synced = {stats: {capturedAt: now, top: {short_term: {tracks: [{spotifyId: 'T'.repeat(22), title: 'Spotify Top', artist: 'Z'}], artists: [{id: 'A'.repeat(22), name: 'Z', genres: ['pop']}]}}, recent: []}, statsPrevious: null};
  const merged = rewindModel(records, synced, 'short_term', now);
  assert.equal(merged.tracks[0].title, 'Spotify Top', 'Spotify’s own ranking wins when synced');
  assert.equal(merged.genres[0].name, 'pop');
  assert.equal(merged.minutes, 10, 'minutes still come from listening history');
  assert.equal(rewindModel([], {stats: null}).empty, true);
});

test('listening persona follows the peak hour', () => {
  assert.equal(persona(7).name, 'Early bird');
  assert.equal(persona(23).name, 'Night owl');
  assert.equal(persona(null), null);
});

test('sync snapshots are compressed, encrypted and tied to the link key', async () => {
  const key = newSyncKey(); assert.ok(validSyncKey(key));
  const a = await syncIdentity(key), again = await syncIdentity(key), other = await syncIdentity(newSyncKey());
  assert.equal(a.pubkey, again.pubkey, 'the same key always publishes to the same address (replaceable)');
  assert.equal(a.address, again.address); assert.notEqual(a.address, other.address);
  const value = {v: 1, stats: {capturedAt: 1, top: {}, recent: [], note: 'Secret Song '.repeat(200)}};
  const sealed = await sealSnapshot(a, value);
  assert.doesNotMatch(sealed, /Secret/); assert.ok(sealed.length < JSON.stringify(value).length / 3, 'compressed');
  assert.deepEqual(await openSnapshot(a, sealed), value);
  await assert.rejects(openSnapshot(other, sealed));
});

test('the link key travels in the URL fragment, never the query', () => {
  const key = newSyncKey(), urls = spotifyConnectionURLs('https://coye2.github.io', 'a'.repeat(32), key);
  const url = new URL(urls.browser);
  assert.equal(url.hash, '#spotplus_sync=' + key);
  assert.ok(!url.search.includes(key));
});
