import test from 'node:test';
import assert from 'node:assert/strict';
import {browserMocks} from './helpers.mjs';
browserMocks();

const matches = [
  {id: 'aaaaaaaaaaa', title: 'Song (Official Audio)', channel: 'Artist - Topic', duration: 200},
  {id: 'bbbbbbbbbbb', title: 'Song', channel: 'Artist', duration: 200},
  {id: 'ccccccccccc', title: 'Song (Lyrics)', channel: 'Lyrics', duration: 200},
];
const track = {id: 't1', title: 'Song', artist: 'Artist', duration: 200};
const idOf = (url) => new URL(String(url)).searchParams.get('id');
const later = (ms, value, signal) => new Promise((resolve, reject) => {
  const timer = setTimeout(() => resolve(value), ms);
  signal?.addEventListener('abort', () => { clearTimeout(timer); reject(new Error('aborted')); });
});
const audio = () => new Response('ab', {status: 206, headers: {'Content-Type': 'audio/mp4', 'Content-Range': 'bytes 0-1/1000'}});
const refused = () => new Response('{"error":"Sign in to confirm you’re not a bot"}', {status: 502, headers: {'Content-Type': 'application/json'}});

test('relay: the top upload plays when it answers, and nothing else is asked', async () => {
  const asked = [];
  globalThis.fetch = async (url) => { asked.push(idOf(url)); return audio(); };
  const {relayStream} = await import('../js/api.js');
  const stream = await relayStream(track, undefined, matches);
  assert.equal(stream.videoId, 'aaaaaaaaaaa');
  assert.equal(stream.kind, 'ytrelay');
  assert.deepEqual(asked, ['aaaaaaaaaaa']);
});

test('relay: a slow refusal does not hold up the song: the next upload starts in parallel and wins', async () => {
  const {relayStream, RELAY_HEDGE_MS} = await import('../js/api.js');
  const asked = [];
  let aborted = false;
  globalThis.fetch = async (url, init) => {
    const id = idOf(url); asked.push(id);
    init.signal.addEventListener('abort', () => { if (id === 'aaaaaaaaaaa') aborted = true; });
    // The top upload is stuck in the worker's retries for 6 s; the second streams right away.
    return id === 'aaaaaaaaaaa' ? later(6000, refused(), init.signal) : audio();
  };
  const started = Date.now();
  const stream = await relayStream(track, undefined, matches);
  const took = Date.now() - started;
  assert.equal(stream.videoId, 'bbbbbbbbbbb');
  assert.ok(took < RELAY_HEDGE_MS + 500, `took ${took} ms`);
  assert.deepEqual(asked, ['aaaaaaaaaaa', 'bbbbbbbbbbb']);
  assert.equal(aborted, true, 'the stuck request is cancelled once a song plays');
});

test('relay: a quick refusal moves straight on, and the second round retries the top uploads', async () => {
  const {relayStream} = await import('../js/api.js');
  const asked = [];
  let topTries = 0;
  globalThis.fetch = async (url) => {
    const id = idOf(url); asked.push(id);
    if (id === 'aaaaaaaaaaa' && ++topTries === 2) return audio(); // YouTube's bot check passed on the retry
    return refused();
  };
  const stream = await relayStream(track, undefined, matches);
  assert.equal(stream.videoId, 'aaaaaaaaaaa');
  assert.deepEqual(asked, ['aaaaaaaaaaa', 'bbbbbbbbbbb', 'ccccccccccc', 'aaaaaaaaaaa']);
});

test('relay: never more than two at once, never the same upload twice at once, and it gives up cleanly', async () => {
  const {relayStream} = await import('../js/api.js');
  let inFlight = 0, most = 0;
  const live = new Set();
  globalThis.fetch = async (url) => {
    const id = idOf(url);
    assert.ok(!live.has(id), 'same upload asked twice at once');
    live.add(id); inFlight++; most = Math.max(most, inFlight);
    await later(30);
    live.delete(id); inFlight--;
    return refused();
  };
  await assert.rejects(relayStream(track, undefined, matches), /502/);
  assert.ok(most <= 2, `${most} at once`);
});

test('relay: skipping the song cancels every request', async () => {
  const {relayStream} = await import('../js/api.js');
  const ctl = new AbortController();
  let cancelled = 0;
  globalThis.fetch = (url, init) => new Promise((resolve, reject) => init.signal.addEventListener('abort', () => { cancelled++; reject(new Error('aborted')); }));
  const pending = relayStream(track, ctl.signal, matches);
  setTimeout(() => ctl.abort(new Error('skipped')), 1700); // after the hedge, so two are in flight
  await assert.rejects(pending, /skipped/);
  await later(10);
  assert.equal(cancelled, 2);
});
