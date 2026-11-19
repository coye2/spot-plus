import test from 'node:test';
import assert from 'node:assert/strict';
import {browserMocks} from './helpers.mjs';
browserMocks();
const player = await import('../js/player.js');

function strayElement() {
  // An element the player used earlier and swapped away from while it was still playing.
  const media = new Audio();
  player.__test.bindAudio(media);
  media.src = 'https://spot-plus-canvas.pwr97pnmkn.workers.dev/yta?id=aaaaaaaaaaa&fmt=aac';
  media.paused = false;
  media.pause = () => { media.paused = true; };
  return media;
}

test('pause also stops an older element that kept playing (screen said paused, music kept going)', () => {
  const stray = strayElement();
  player.pause();
  assert.equal(stray.paused, true);
});

test('when the screen shows paused but a stray element plays, the play button stops it instead of adding a second song', () => {
  const stray = strayElement();
  player.state.queue = [{id: 'x', title: 'Song', artist: 'A', duration: 100}];
  player.state.index = 0;
  player.el.paused = true;
  player.toggle();
  assert.equal(stray.paused, true);
  assert.equal(player.el.paused, true, 'did not start the current element as well');
});

test('silent unlock audio is left alone', () => {
  const media = new Audio();
  player.__test.bindAudio(media);
  media.src = 'data:audio/wav;base64,AAAA';
  media.paused = false;
  let paused = false;
  media.pause = () => { paused = true; };
  player.__test.silenceOthers();
  assert.equal(paused, false);
});
