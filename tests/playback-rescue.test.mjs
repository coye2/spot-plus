import test from 'node:test';
import assert from 'node:assert/strict';
import {browserMocks} from './helpers.mjs';
browserMocks();

test('a dead audio network never plays a 30-second clip in Automatic', async () => {
  globalThis.fetch = async () => new Response('no', {status: 404});
  const api = await import('../js/api.js');
  await assert.rejects(api.resolve({
    id: 'oxygene',
    title: 'Oxygène',
    artist: 'C418',
    duration: 65,
    preview: 'https://cdnt-preview.dzcdn.net/stream/oxygene.mp3',
  }));
});
