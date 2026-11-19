import test from 'node:test';
import assert from 'node:assert/strict';
import {soundcloud, pickTrack} from '../canvas-bridge/soundcloud.js';

const env = {SC_CLIENT_ID: 'id', SC_CLIENT_SECRET: 'secret'};
const track = (over) => ({id: 1, access: 'playable', title: 'Blinding Lights', duration: 200040, user: {username: 'The Weeknd', verified: true}, playback_count: 9e8, ...over});

test('picks the real recording, not a remix, cover, preview, or wrong length', () => {
  const want = {title: 'Blinding Lights', artist: 'The Weeknd', duration: 200};
  const items = [
    track({id: 2, title: 'Blinding Lights (Remix)'}),
    track({id: 3, title: 'Blinding Lights - piano cover', user: {username: 'Piano Guy the weeknd fan'}}),
    track({id: 4, access: 'preview'}),
    track({id: 5, duration: 260000}),
    track({id: 6, title: 'Blinding Lights', user: {username: 'Someone Else'}}),
    track({id: 7}),
  ];
  assert.equal(pickTrack(items, want).id, 7);
  assert.equal(pickTrack([track({access: 'blocked'})], want), null);
});

test('/sc signs in once, finds the song, and returns the signed audio link', async () => {
  const calls = [];
  const store = new Map();
  const cache = {match: async (k) => store.get(typeof k === 'string' ? k : k.url)?.clone(), put: async (k, v) => { store.set(typeof k === 'string' ? k : k.url, v); }};
  const fetcher = async (url, init = {}) => {
    calls.push(String(url));
    if (String(url).startsWith('https://secure.soundcloud.com/oauth/token')) {
      assert.equal(init.headers.Authorization, 'Basic ' + btoa('id:secret'));
      return new Response(JSON.stringify({access_token: 'tok', expires_in: 3600}));
    }
    assert.equal(init.headers.Authorization, 'OAuth tok');
    if (String(url).includes('/tracks?q=')) {
      assert.match(String(url), /access=playable/);
      return new Response(JSON.stringify({collection: [track({id: 42, urn: 'soundcloud:tracks:42'})]}));
    }
    if (String(url).endsWith('/streams')) return new Response(JSON.stringify({http_mp3_128_url: 'https://api.soundcloud.com/tracks/soundcloud:tracks:42/streams/http_mp3_128'}));
    if (String(url).includes('/streams/http_mp3_128')) return new Response(null, {status: 302, headers: {location: `https://cf-media.sndcdn.com/abc.128.mp3?Policy=x&Signature=y&Expires=${Math.floor(Date.now() / 1000) + 3600}`}});
    throw new Error('unexpected ' + url);
  };
  const waits = [];
  const req = () => new Request('https://w.dev/sc?title=Blinding%20Lights&artist=The%20Weeknd&duration=200');
  const r = await soundcloud(req(), {env, fetcher, cache, waitUntil: (p) => waits.push(p)});
  await Promise.all(waits);
  const d = await r.json();
  assert.equal(r.status, 200);
  assert.match(d.url, /^https:\/\/cf-media\.sndcdn\.com\/abc\.128\.mp3/);
  assert.equal(d.duration, 200);
  // Second request: answered from the edge cache, no new sign-in or search.
  const before = calls.length;
  const again = await soundcloud(req(), {env, fetcher, cache});
  assert.equal(again.status, 200);
  assert.equal(calls.length, before);
  assert.equal(calls.filter((u) => u.includes('oauth/token')).length, 1);
});

test('/sc stays off until the SoundCloud key is set', async () => {
  const r = await soundcloud(new Request('https://w.dev/sc?title=a&artist=b'), {env: {}});
  assert.equal(r.status, 503);
});
