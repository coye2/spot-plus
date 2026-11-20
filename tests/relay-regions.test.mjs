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
  const {relayStream, restRelayRegion, RELAY_REGIONS} = await import('../js/api.js');
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
