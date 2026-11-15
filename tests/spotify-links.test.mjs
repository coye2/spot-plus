import test from 'node:test';
import assert from 'node:assert/strict';
import {parseSpotifyLinks,playlistRole,recordSnapshot,linkStats,madeForYou} from '../js/spotify-links.js';
import {spotifyTop} from '../js/stats-api.js';
import {playlistFromEmbed,profileFromPage} from '../canvas-bridge/spotify-public.js';

const id = n => ('T'.repeat(21) + String.fromCharCode(65 + n));
const tr = n => ({spotifyId: id(n), title: 'Song ' + n, artist: 'Artist ' + (n % 3), duration: 200});

test('finds profile and playlist links in anything pasted', () => {
  const found = parseSpotifyLinks('my profile https://open.spotify.com/user/coye2?si=x and On Repeat https://open.spotify.com/playlist/37i9dQZF1EpsrbFdahj89I?si=abc spotify:playlist:37i9dQZF1EpBwQLOZTpjaW https://open.spotify.com/intl-de/playlist/37i9dQZF1EpsrbFdahj89I');
  assert.equal(found.profile, 'coye2');
  assert.deepEqual(found.playlists, ['37i9dQZF1EpsrbFdahj89I', '37i9dQZF1EpBwQLOZTpjaW']);
  assert.deepEqual(parseSpotifyLinks('nothing here'), {profile: null, playlists: []});
});

test('recognises Spotify’s personal playlists', () => {
  assert.equal(playlistRole('On Repeat'), 'onRepeat');
  assert.equal(playlistRole('Your Top Songs 2025'), 'topSongs');
  assert.equal(playlistRole('chill indie sunday morning daylist'), 'daylist');
  assert.equal(playlistRole('Road trip'), 'playlist');
  assert.equal(playlistRole('Mix', '37i9dQZF1E4abcdefghijk'), 'madeForYou');
});

test('daily snapshots turn into rankings with movement', () => {
  const state = {profile: {id: 'me', name: 'Coye', avatar: ''}, playlists: {}, snapshots: [], moods: []};
  const day1 = Date.UTC(2026, 10, 1), day2 = day1 + 86400000;
  const onRepeat = {id: 'x', role: 'onRepeat', name: 'On Repeat', tracks: [tr(0), tr(1), tr(2)]};
  recordSnapshot(state, onRepeat, day1);
  recordSnapshot(state, onRepeat, day1 + 1000);
  assert.equal(state.snapshots.length, 1, 'unchanged playlist adds no snapshot');
  onRepeat.tracks = [tr(2), tr(0), tr(3)]; onRepeat.fetchedAt = day2;
  recordSnapshot(state, onRepeat, day2);
  state.playlists.x = onRepeat;
  recordSnapshot(state, {role: 'daylist', name: 'chill pop monday morning'}, day2);
  const stats = linkStats(state, day2 + 1000);
  const top = spotifyTop(stats, {range: 'short_term', kind: 'tracks'});
  assert.deepEqual(top.map(t => t.title), ['Song 2', 'Song 0', 'Song 3']);
  assert.deepEqual(top.map(t => t.change), [2, -1, 'new']);
  const six = spotifyTop(stats, {range: 'medium_term', kind: 'tracks'});
  assert.equal(six[0].title, 'Song 0', 'six months adds up both days');
  assert.equal(stats.account.name, 'Coye');
  assert.equal(stats.moods[0].name, 'chill pop monday morning');
  assert.deepEqual(madeForYou(state).map(p => p.role), ['onRepeat']);
  assert.equal(linkStats({playlists: {}, snapshots: [], moods: []}), null);
});

test('worker parses Spotify playlist and profile pages', () => {
  const next = {props: {pageProps: {state: {data: {entity: {type: 'playlist', id: 'P'.repeat(22), name: 'On Repeat', subtitle: 'Spotify', coverArt: {sources: [{url: 'https://i.scdn.co/image/a', width: 300}]}, trackList: [{uri: 'spotify:track:' + id(1), title: 'One', subtitle: 'A, B', duration: 200000, isExplicit: true}, {uri: 'bad', title: 'x'}]}}}}}};
  const p = playlistFromEmbed(`<script id="__NEXT_DATA__" type="application/json">${JSON.stringify(next)}</script>`);
  assert.equal(p.name, 'On Repeat'); assert.equal(p.tracks.length, 1); assert.deepEqual(p.tracks[0], {spotifyId: id(1), title: 'One', artist: 'A, B', duration: 200, explicit: true});
  const state = {entities: {items: {'spotify:user:coye': {name: 'Coye', avatar: {sources: [{url: 'https://i.scdn.co/image/b', width: 300}, {url: 'https://evil.example/x', width: 900}]}, publicPlaylistsV2: {items: [{_uri: 'spotify:playlist:' + id(2), data: {name: 'Mine', images: {items: [{sources: [{url: 'https://i.scdn.co/image/c'}]}]}}}]}}}}};
  const prof = profileFromPage(`<script id="initialState" type="text/plain">${Buffer.from(JSON.stringify(state)).toString('base64')}</script>`, 'coye');
  assert.equal(prof.name, 'Coye'); assert.equal(prof.avatar, 'https://i.scdn.co/image/b', 'only Spotify image hosts'); assert.equal(prof.playlists[0].name, 'Mine');
  assert.equal(playlistFromEmbed('<html></html>'), null);
});
