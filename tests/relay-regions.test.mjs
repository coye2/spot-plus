import test from 'node:test';
import assert from 'node:assert/strict';
import {browserMocks} from './helpers.mjs';
browserMocks();

const matches = [
  {id: 'aaaaaaaaaaa', title: 'Song (Official Audio)', channel: 'Artist - Topic', duration: 200, why: 'official Topic channel'},
  {id: 'bbbbbbbbbbb', title: 'Song', channel: 'Artist', duration: 201},
];
const track = {id: 't1', title: 'Song', artist: 'Artist', duration: 200};

test('relay: a refused region rests and the next try goes through another region', async () => {
  // Health checks answer; the hedge requests to other regions stay pending (they neither warm nor rest a region).
  globalThis.fetch = (url, init = {}) => init.method === 'HEAD' ? new Promise(() => {}) : Promise.resolve(new Response(JSON.stringify({relay: true})));
  const {relayStream, restRelayRegion, RELAY_REGIONS} = await import('../js/api.js');
  await relayStream(track, undefined, matches); // starts the region health checks
  await new Promise((ok) => setTimeout(ok, 20));
  const first = await relayStream(track, undefined, matches);
  assert.equal(first.relayRegion, RELAY_REGIONS[0]);
  assert.ok(first.url.startsWith(RELAY_REGIONS[0] + '/yta?'));
  restRelayRegion(first.relayRegion);
  const second = await relayStream(track, undefined, matches);
  assert.equal(second.relayRegion, RELAY_REGIONS[1]);
  restRelayRegion(second.relayRegion);
  assert.equal((await relayStream(track, undefined, matches)).relayRegion, RELAY_REGIONS[2]);
  assert.equal(first.instance, second.instance, 'one relay as far as source fallback is concerned');
});

test('relay: a region that is not deployed is never tried', async () => {
  const {relayRegionsUp, RELAY_REGIONS} = await import('../js/api.js');
  assert.ok(relayRegionsUp().includes(RELAY_REGIONS[0]));
});

test('relay: the next song is warmed ahead in several regions and plays from the first region that has it', async () => {
  const {warmRelaySource, relayStream, onRelayReady, RELAY_REGIONS} = await import('../js/api.js');
  const ready = RELAY_REGIONS[3];
  globalThis.fetch = (url, init = {}) => init.method !== 'HEAD' ? Promise.resolve(new Response(JSON.stringify({relay: true})))
    : Promise.resolve(new Response(null, {status: String(url).startsWith(ready) ? 206 : 502}));
  const next = {id: 'warm-1', title: 'Song', artist: 'Artist', duration: 200};
  const heard = [];
  const off = onRelayReady((id, region) => heard.push([id, region]));
  const source = {kind: 'ytrelay', url: RELAY_REGIONS[0] + '/yta?id=aaaaaaaaaaa&fmt=aac', relayRegion: RELAY_REGIONS[0]};
  await warmRelaySource(next, source, {regions: 5});
  off();
  assert.equal(source.relayRegion, ready);
  assert.ok(source.url.startsWith(ready + '/yta?id=aaaaaaaaaaa'));
  assert.deepEqual(heard, [['warm-1', ready]]);
  // Playing it later uses the warmed region straight away.
  assert.equal((await relayStream(next, undefined, matches)).relayRegion, ready);
});
