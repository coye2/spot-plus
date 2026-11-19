import test from 'node:test';
import assert from 'node:assert/strict';
import {radioAfter} from '../js/mixes.js';

const song = (id, artist, artistId) => ({id, title: 'Song ' + id, artist, artistId});

test('Up next mixes your related music and what you have on repeat with similar songs, two of yours per similar one', async () => {
  const queue = [song('q1', 'Post Malone', 1)];
  const similar = [song('r1', 'Swae Lee', 2), song('r2', 'Morgan Wallen', 3), song('r3', 'Swae Lee', 2)];
  const out = await radioAfter(queue, {
    artistRadio: async () => similar, findArtist: async () => null, skips: {},
    library: [song('l1', 'Post Malone', 1), song('l2', 'Taylor Swift', 9), song('l3', 'Swae Lee', 2)],
    onRepeat: [song('o1', 'Hozier', 7)],
  });
  const ids = out.map((t) => t.id);
  assert.ok(!ids.includes('l2'), 'unrelated library songs stay out');
  assert.ok(ids.includes('o1'), 'on repeat is in');
  assert.ok(ids.includes('l1') && ids.includes('l3'), 'your related songs are in');
  assert.equal(ids.length, 6);
  // Positions 0,1 yours, 2 similar, 3,4 yours, 5 similar (whatever is left).
  assert.ok(['r1', 'r2', 'r3'].includes(ids[2]));
});

test('Up next still works with an empty library, and never loops forever', async () => {
  const out = await radioAfter([song('q1', 'A', 1)], {artistRadio: async () => [song('r1', 'B', 2)], findArtist: async () => null, skips: {}});
  assert.deepEqual(out.map((t) => t.id), ['r1']);
  const mineOnly = await radioAfter([song('q1', 'A', 1)], {artistRadio: async () => [], findArtist: async () => null, skips: {}, onRepeat: [song('o1', 'C', 3), song('o2', 'D', 4)]});
  assert.deepEqual(mineOnly.map((t) => t.id).sort(), ['o1', 'o2']);
});
