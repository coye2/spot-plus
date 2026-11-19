import test from 'node:test';
import assert from 'node:assert/strict';
import {browserMocks} from './helpers.mjs';
browserMocks();

test('a dead full-song network still starts the saved preview in Automatic', async () => {
  globalThis.fetch = async () => new Response('no', {status: 404});
  const api = await import('../js/api.js');
  const source = await api.resolve({
    id: 'oxygene',
    title: 'Oxygène',
    artist: 'C418',
    duration: 65,
    preview: 'https://cdnt-preview.dzcdn.net/stream/oxygene.mp3',
  });
  assert.equal(source.preview, true);
  assert.equal(source.url, 'https://cdnt-preview.dzcdn.net/stream/oxygene.mp3');
});
