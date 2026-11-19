import test from 'node:test';
import assert from 'node:assert/strict';
import {segmentsFor, skipTarget} from '../js/sponsorblock.js';

const memStore = () => { const m = new Map(); return {getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, v)}; };

test('skips a non-music intro and treats an outro to the end as the song finishing', () => {
  const segs = [[0, 12.5], [190, 214]];
  assert.equal(skipTarget(segs, 0.4, 214), 12.5);
  assert.equal(skipTarget(segs, 50, 214), null);
  assert.equal(skipTarget(segs, 12.3, 214), null, 'already at the end of the segment');
  assert.equal(skipTarget(segs, 191, 214), Infinity);
});

test('segments are fetched once per video and "none" (404) is remembered', async () => {
  let calls = 0;
  const storage = memStore();
  const fetcher = async (url) => {
    calls++;
    assert.match(String(url), /categories=%5B%22music_offtopic%22%5D/);
    if (String(url).includes('aaaaaaaaaaa')) return new Response(JSON.stringify([{segment: [0, 9.2], category: 'music_offtopic'}, {segment: [5, 5.4]}]));
    return new Response('Not Found', {status: 404});
  };
  assert.deepEqual(await segmentsFor('aaaaaaaaaaa', {fetcher, storage}), [[0, 9.2]]);
  assert.deepEqual(await segmentsFor('aaaaaaaaaaa', {fetcher, storage}), [[0, 9.2]]);
  assert.deepEqual(await segmentsFor('bbbbbbbbbbb', {fetcher, storage}), []);
  assert.deepEqual(await segmentsFor('bbbbbbbbbbb', {fetcher, storage}), []);
  assert.equal(calls, 2);
  assert.deepEqual(await segmentsFor('nope'), []);
});
