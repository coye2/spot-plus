import test from 'node:test';
import assert from 'node:assert/strict';
import {shouldAsk, noteUse, noteAsked, ratingText, starsHtml} from '../js/rating.js';
const store = () => { const m = new Map(); return {getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, String(v))}; };
const DAY = 86400e3;

test('the rating dialog waits for real use, and backs off after "Not now"', () => {
  const s = store(), t0 = Date.UTC(2026, 0, 1);
  noteUse(t0, s);
  assert.equal(shouldAsk({plays: 50, now: t0 + DAY, storage: s}), false, 'not on day one');
  assert.equal(shouldAsk({plays: 5, now: t0 + 5 * DAY, storage: s}), false, 'not before 20 songs');
  assert.equal(shouldAsk({plays: 25, now: t0 + 5 * DAY, storage: s}), true);
  assert.equal(shouldAsk({plays: 25, now: t0 + 5 * DAY, shownThisVisit: true, storage: s}), false, 'once per visit');
  noteAsked('later', t0 + 5 * DAY, s);
  assert.equal(shouldAsk({plays: 30, now: t0 + 10 * DAY, storage: s}), false);
  assert.equal(shouldAsk({plays: 30, now: t0 + 27 * DAY, storage: s}), true, 'again after three weeks');
  noteAsked('never', t0 + 27 * DAY, s);
  assert.equal(shouldAsk({plays: 99, now: t0 + 400 * DAY, storage: s}), false, 'never means never');
});

test('live rating text and stars', () => {
  assert.equal(ratingText({average: 4.6, count: 128}), '4.6 · 128 ratings');
  assert.equal(ratingText({count: 0}), 'No ratings yet');
  assert.match(starsHtml(4.5), /width:90%/);
});

test('server: one rating per device (re-rating replaces it), live average in /stats', async () => {
  const {InstallCounter} = await import('../canvas-bridge/installs.js');
  const mem = new Map();
  const state = {storage: {get: async (k) => mem.get(k), put: async (o) => { for (const [k, v] of Object.entries(o)) mem.set(k, structuredClone(v)); }}};
  const c = new InstallCounter(state);
  const rate = (device, stars) => c.fetch(new Request('https://counter/rate', {method: 'POST', body: JSON.stringify({device, stars})})).then((r) => r.json());
  const a = 'a'.repeat(32), b = 'b'.repeat(32);
  await rate(a, 5); await rate(b, 3);
  assert.deepEqual((await rate(a, 4)).rating, {average: 3.5, count: 2, dist: [0, 0, 1, 1, 0]});
  assert.equal((await rate(a, 9)).error, 'stars must be 1-5');
  const stats = await (await c.fetch(new Request('https://counter/stats'))).json();
  assert.equal(stats.rating.average, 3.5);
});
