import test from 'node:test';
import assert from 'node:assert/strict';
import {browserMocks} from './helpers.mjs';
browserMocks();

const matches = [
  {id: 'aaaaaaaaaaa', title: 'Song (Official Audio)', channel: 'Artist - Topic', duration: 200, why: 'official Topic channel'},
  {id: 'bbbbbbbbbbb', title: 'Song', channel: 'Artist', duration: 201},
];
const track = {id: 't1', title: 'Song', artist: 'Artist', duration: 200};

test('relay: the song plays from the top upload with no separate check request (one YouTube lookup, not two)', async () => {
  let asked = 0;
  globalThis.fetch = async () => { asked++; return new Response('', {status: 206}); };
  const {relayStream} = await import('../js/api.js');
  const stream = await relayStream(track, undefined, matches);
  assert.equal(asked, 0);
  assert.equal(stream.videoId, 'aaaaaaaaaaa');
  assert.equal(stream.kind, 'ytrelay');
  assert.match(stream.url, /\/yta\?id=aaaaaaaaaaa&fmt=/);
  assert.equal(stream.duration, 200);
  assert.equal(stream.why, 'official Topic channel');
});

test('relay: an upload YouTube just refused is tried last', async () => {
  const {relayStream, avoidRelayVideo} = await import('../js/api.js');
  avoidRelayVideo('aaaaaaaaaaa');
  const stream = await relayStream(track, undefined, matches);
  assert.equal(stream.videoId, 'bbbbbbbbbbb');
});

test('relay: a skipped song never starts', async () => {
  const {relayStream} = await import('../js/api.js');
  const ctl = new AbortController();
  ctl.abort(new Error('skipped'));
  await assert.rejects(relayStream(track, ctl.signal, matches), /skipped/);
});

test('relay circuit breaker: two failed songs in a row pause the relay; a played song resets the count', async () => {
  const {relayStream, noteRelaySong} = await import('../js/api.js');
  noteRelaySong(false);
  await relayStream(track, undefined, matches); // one failure: still used
  noteRelaySong(true);
  noteRelaySong(false);
  await relayStream(track, undefined, matches); // the success reset the count
  noteRelaySong(false);
  await assert.rejects(relayStream(track, undefined, matches), /Relay is off/);
});
