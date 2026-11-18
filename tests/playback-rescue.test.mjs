import test from 'node:test';
import assert from 'node:assert/strict';
import {browserMocks} from './helpers.mjs';
browserMocks();

test('a dead audio network still starts the catalog preview', async () => {
  globalThis.fetch = async () => new Response('no', {status: 404});
  const api = await import('../js/api.js');
  const stream = await api.resolve({
    id: 'oxygene',
    title: 'Oxygène',
    artist: 'C418',
    duration: 65,
    preview: 'https://cdnt-preview.dzcdn.net/stream/oxygene.mp3',
  });
  assert.equal(stream.preview, true);
  assert.equal(stream.url, 'https://cdnt-preview.dzcdn.net/stream/oxygene.mp3');
  assert.equal(stream.kind, 'preview');
});
