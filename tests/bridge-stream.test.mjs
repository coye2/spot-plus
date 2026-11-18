import test from 'node:test';
import assert from 'node:assert/strict';
import {browserMocks} from './helpers.mjs';
browserMocks();
test('InstantPlay uses the Spot+ bridge stream before public mirrors', async () => {
  localStorage.setItem('spotplus.goodInstance', JSON.stringify({invidious: 'https://dead.example'}));
  const calls = [];
  globalThis.fetch = async (url) => {
    url = String(url); calls.push(url);
    if (url.includes('/match')) {
      return new Response(JSON.stringify({items: [{id: 'MxEjnYdfLXU', title: 'I Wonder', channel: 'Kanye West', duration: 244, verified: true}]}));
    }
    if (url.includes('/stream?id=MxEjnYdfLXU')) {
      return new Response(JSON.stringify({
        url: 'https://googlevideo.example/i-wonder.m4a',
        mime: 'audio/mp4',
        bitrate: 128000,
        itag: 140,
        videoId: 'MxEjnYdfLXU',
        kind: 'bridge',
        fast: true,
        alternatives: [],
      }));
    }
    return new Response('[]');
  };
  const api = await import('../js/api.js');
  const stream = await api.resolve({id: 'wonder-1', title: 'I Wonder', artist: 'Kanye West', duration: 243});
  assert.equal(stream.url, 'https://googlevideo.example/i-wonder.m4a');
  assert.equal(stream.kind, 'bridge');
  assert.equal(stream.fast, true);
  assert.ok(calls.some(u => u.includes('/stream?id=MxEjnYdfLXU')));
  assert.ok(!calls.some(u => u.includes('dead.example')), 'dead mirror never contacted');
});
