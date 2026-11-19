import test from 'node:test';
import assert from 'node:assert/strict';
import {daylistMoment, seasonalThemes, topArtists, buildFeed} from '../js/feed.js';

const memory = () => { const m = new Map(); return {getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, String(v))}; };
const t = (id, artist, artistId) => ({id, title: 'Song ' + id, artist, artistId});

test('daylist is named for the day and the part of the day', () => {
  const d = daylistMoment(new Date(2026, 10, 19, 23, 30));
  assert.equal(d.title, 'daylist • Thursday night mellow');
  assert.notEqual(daylistMoment(new Date(2026, 10, 19, 8)).period, daylistMoment(new Date(2026, 10, 19, 15)).period);
});

test('holiday shelves follow the calendar', () => {
  assert.deepEqual(seasonalThemes(new Date(2026, 10, 19)).map((s) => s.id), ['christmas', 'thanksgiving', 'fall']);
  assert.deepEqual(seasonalThemes(new Date(2026, 9, 20)).map((s) => s.id), ['halloween', 'fall']);
  assert.deepEqual(seasonalThemes(new Date(2026, 6, 20)).map((s) => s.id), ['summer']);
});

test('top artists weigh what you have on repeat most', () => {
  const tops = topArtists({onRepeat: [t('1', 'A', 1)], recent: [t('2', 'B', 2)], likes: [t('4', 'C', 3)]});
  assert.deepEqual(tops.map((a) => a.name), ['A', 'B', 'C']);
});

test('the feed builds daylist, On Repeat, Discover Weekly (artists you don’t know), Release Radar and holidays', async () => {
  const onRepeat = [1, 2, 3, 4, 5].map((n) => t('o' + n, 'Mine', 1));
  const api = {
    artistRadio: async () => Array.from({length: 30}, (_, n) => t('r' + n, n < 5 ? 'Mine' : 'New ' + n, n < 5 ? 1 : 100 + n)),
    artist: async () => ({albums: [{id: 'a1', title: 'Fresh', released: '2026-11-14'}, {id: 'a0', title: 'Old', released: '2020-01-01'}]}),
    searchPlaylists: async (q) => [{id: 'p-' + q, title: q}],
  };
  const f = await buildFeed({api, onRepeat, recent: [], likes: [], now: new Date(2026, 10, 19, 15), storage: memory()});
  assert.match(f.daylist.title, /^daylist • Thursday afternoon/);
  assert.equal(f.onRepeat.tracks.length, 5);
  assert.ok(f.discover.tracks.every((x) => x.artistId !== 1), 'Discover Weekly skips artists you already play');
  assert.deepEqual(f.releaseRadar.map((a) => a.title), ['Fresh']);
  assert.deepEqual(f.seasonal.map((s) => s.title), ['Christmas music', 'Thanksgiving dinner']);
});
