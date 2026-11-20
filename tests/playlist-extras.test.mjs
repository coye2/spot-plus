import test from 'node:test';
import assert from 'node:assert/strict';
import {browserMocks} from './helpers.mjs';
browserMocks();
const store = await import('../js/store.js');
const song = (id) => ({id, title: 'Song ' + id, artist: 'A', duration: 200});

test('songs can be added to a synced Spotify playlist: kept in Spot+, no duplicates of what Spotify has', () => {
  const spotifyHas = [song('s1')];
  assert.equal(store.addToSpotifyPlaylist('SPID', [song('s1'), song('n1'), song('n2')], spotifyHas), 2);
  assert.equal(store.addToSpotifyPlaylist('SPID', [song('n1')], spotifyHas), 0);
  assert.deepEqual(store.getSpotifyAdds('SPID').map((t) => t.id), ['n1', 'n2']);
  store.removeSpotifyAdd('SPID', 'n1');
  assert.deepEqual(store.getSpotifyAdds('SPID').map((t) => t.id), ['n2']);
});

test('playlist cover photos: only small image data is kept, and removing works', () => {
  const pic = 'data:image/jpeg;base64,' + 'A'.repeat(100);
  assert.equal(store.setPlaylistCover('pl1', pic), true);
  assert.equal(store.getPlaylistCover('pl1'), pic);
  assert.equal(store.setPlaylistCover('pl1', 'javascript:alert(1)'), false);
  assert.equal(store.setPlaylistCover('pl2', 'data:image/jpeg;base64,' + 'A'.repeat(500000)), false);
  assert.equal(store.getPlaylistCover('pl2'), '');
  store.setPlaylistCover('pl1', null);
  assert.equal(store.getPlaylistCover('pl1'), '');
});

test('backups carry covers and songs added to Spotify playlists', () => {
  store.setPlaylistCover('sp:X', 'data:image/png;base64,AAAA');
  store.addToSpotifyPlaylist('X', [song('z')]);
  const backup = store.exportData();
  assert.equal(backup.plCovers['sp:X'], 'data:image/png;base64,AAAA');
  assert.equal(backup.spotifyAdds.X[0].id, 'z');
});
