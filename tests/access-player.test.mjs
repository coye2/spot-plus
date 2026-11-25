import test from 'node:test';
import assert from 'node:assert/strict';
import { browserMocks, settle } from './helpers.mjs';

test('an excluded device can still start and skip after the base tier cap', async () => {
  browserMocks();
  const { applyServerSnapshot } = await import('../js/access.js');
  const { utcDay } = await import('../js/access-policy.js');
  const player = await import('../js/player.js');
  const day = utcDay();
  applyServerSnapshot({ day, deviceUsed: 300, ipUsed: 300, unlocked: false, exempt: true }, { authoritative: true });
  const tracks = ['one', 'two', 'three'].map((id) => ({ id, title: id, artist: 'Unit', duration: 180, local: true }));
  assert.equal(player.playList(tracks, 0, { intent: 'insta-play' }), true);
  assert.equal(player.current().id, 'one');
  assert.notEqual(player.next(true), false);
  assert.equal(player.current().id, 'two');
  await settle();
});

test('a base-tier device stops at the cap', async () => {
  const { applyServerSnapshot, snapshot } = await import('../js/access.js');
  const { utcDay } = await import('../js/access-policy.js');
  const player = await import('../js/player.js');
  applyServerSnapshot({ day: utcDay(), deviceUsed: 300, ipUsed: 300, unlocked: false, exempt: false }, { authoritative: true });
  assert.equal(snapshot().limited, true);
  assert.equal(player.playList([{ id: 'late', title: 'Late', artist: 'Unit', duration: 180, local: true }], 0, { intent: 'insta-choose' }), false);
});
