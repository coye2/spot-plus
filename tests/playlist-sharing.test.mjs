import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spotifyPlaylistLink, spotPlusPlaylistLink, APP_URL } from '../js/share-card.js';

test('spotifyPlaylistLink builds exact Spotify playlist URLs only for valid 22-char IDs', () => {
  assert.equal(
    spotifyPlaylistLink({ spotifyId: '37i9dQZF1DXcBWIGoYBM5M' }),
    'https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M',
  );
  assert.equal(spotifyPlaylistLink({ spotifyId: 'invalid' }), null);
  assert.equal(spotifyPlaylistLink({ kind: 'my', id: 'pl123' }), null);
});

test('spotPlusPlaylistLink routes collab, Deezer, and Spotify playlists to working Spot+ URLs', () => {
  assert.equal(
    spotPlusPlaylistLink({ kind: 'my', collab: 'ab23cd45ef67' }),
    `${APP_URL}#/collab/ab23cd45ef67`,
  );
  assert.equal(
    spotPlusPlaylistLink({ kind: 'deezer', id: '908622995' }),
    `${APP_URL}#/playlist/908622995`,
  );
  assert.equal(
    spotPlusPlaylistLink({ kind: 'spotify', spotifyId: '37i9dQZF1DXcBWIGoYBM5M' }),
    `${APP_URL}#/linked/37i9dQZF1DXcBWIGoYBM5M`,
  );
  assert.equal(
    spotPlusPlaylistLink({ kind: 'deezer', id: '42' }, { base: 'https://example.test/app/' }),
    'https://example.test/app/#/playlist/42',
  );
});

test('Playlist three-dots menus expose Share playlist in Library and inside playlist views', () => {
  const appSrc = readFileSync(new URL('../js/app.js', import.meta.url), 'utf8');
  assert.match(appSrc, /case 'playlist-menu':/);
  assert.match(appSrc, /function playlistShareSheet\(/);
  assert.match(appSrc, /function playlistMenu\(/);
  // Library three-dots menu includes Share playlist.
  const libMenuMatch = appSrc.match(/function libraryMenu\(id\)\{[\s\S]*?\n\}/);
  assert.ok(libMenuMatch, 'libraryMenu should exist');
  assert.match(libMenuMatch[0], /Share playlist/);
  assert.match(libMenuMatch[0], /playlistShareSheet/);

  // Every playlist page view includes a three-dots playlist-menu button.
  assert.match(appSrc, /data-act="playlist-menu" data-kind="my"/);
  assert.match(appSrc, /data-act="playlist-menu" data-kind="deezer"/);
  assert.match(appSrc, /data-act="playlist-menu" data-kind="spotify"/);
  assert.match(appSrc, /data-act="playlist-menu" data-kind="spotify-account"/);
});
