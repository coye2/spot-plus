import test from 'node:test';
import assert from 'node:assert/strict';
import {rankSearch, nameMatch} from '../js/search-rank.js';

const artists = [
  {id: 1, name: 'Just Ice', fans: 2000},
  {id: 2, name: 'Justin Bieber', fans: 30000000},
  {id: 3, name: 'Justice', fans: 2500000},
];
const tracks = [
  {id: 't1', title: 'Just the Way You Are', searchTitle: 'Just the Way You Are', artist: 'Bruno Mars', artistId: 9, rank: 900000},
  {id: 't2', title: 'Peaches', searchTitle: 'Peaches', artist: 'Justin Bieber', artistId: 2, rank: 800000},
  {id: 't3', title: 'Blinding Lights', searchTitle: 'Blinding Lights', artist: 'The Weeknd', artistId: 5, rank: 950000},
];

test('typing the start of a big artist’s name puts the artist first', () => {
  const r = rankSearch({artists, tracks, albums: [], playlists: []}, 'just');
  assert.equal(r.top.kind, 'artist');
  assert.equal(r.top.item.name, 'Justin Bieber');
  assert.equal(r.intent, 'artists');
  assert.equal(r.tracks[0].artist, 'Justin Bieber', 'their songs lead the Songs list');
});

test('typing a song title makes the song the top result', () => {
  const r = rankSearch({artists: [{id: 5, name: 'The Weeknd', fans: 40000000}], tracks, albums: [], playlists: []}, 'blinding lights');
  assert.equal(r.top.kind, 'track');
  assert.equal(r.top.item.id, 't3');
  assert.equal(r.intent, 'songs');
});

test('artist and song typed together find the song', () => {
  const r = rankSearch({artists: [{id: 5, name: 'The Weeknd', fans: 40000000}], tracks, albums: [], playlists: []}, 'weeknd blinding');
  assert.equal(r.top.item.id, 't3');
});

test('an artist you listen to beats a similarly named one', () => {
  const r = rankSearch({artists: [{id: 7, name: 'Drake', fans: 1000}, {id: 8, name: 'Drake Bell', fans: 900}], tracks: [], albums: [], playlists: []}, 'drake b', {knownArtists: new Set(['8'])});
  assert.equal(r.top.item.name, 'Drake Bell');
});

test('name matching', () => {
  assert.equal(nameMatch('Justin Bieber', 'justin bieber'), 1);
  assert.ok(nameMatch('Justin Bieber', 'just') > nameMatch('Justin Bieber', 'bieber j'));
  assert.equal(nameMatch('Justin Bieber', 'xyz'), 0);
});

test('partly typed names complete from the cached popular-artist list, no network needed', async () => {
  const {browserMocks} = await import('./helpers.mjs');
  browserMocks();
  localStorage.setItem('spotplus.popularArtists', JSON.stringify({at: Date.now(), list: [
    {id: 1, name: 'Justice', rank: 40}, {id: 2, name: 'Justin Bieber', rank: 95}, {id: 3, name: 'Taylor Swift', rank: 100},
  ]}));
  const {localArtistMatches} = await import('../js/api.js');
  assert.deepEqual(localArtistMatches('just').map((a) => a.name), ['Justin Bieber', 'Justice']);
  assert.deepEqual(localArtistMatches('tay').map((a) => a.name), ['Taylor Swift']);
  assert.deepEqual(localArtistMatches('zzz'), []);
  const r = rankSearch({artists: localArtistMatches('just'), tracks, albums: [], playlists: []}, 'just');
  assert.equal(r.top.item.name, 'Justin Bieber');
});
