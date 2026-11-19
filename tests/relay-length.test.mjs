import test from 'node:test';
import assert from 'node:assert/strict';
import {browserMocks} from './helpers.mjs';
browserMocks();
const player = await import('../js/player.js');

test('relay songs show YouTube’s real length, not Safari’s guess from the file size', () => {
  player.state.queue = [{id: 'r1', title: 'Song', artist: 'Artist', duration: 181}];
  player.state.index = 0;
  player.el.src = 'https://spot-plus-canvas.pwr97pnmkn.workers.dev/yta?id=aaaaaaaaaaa&fmt=aac';
  player.el.duration = 512; // what Safari reported for a 3-minute song
  player.state.source = {kind: 'ytrelay', duration: 183, url: player.el.src};
  assert.equal(player.duration(), 183);
  // Other sources keep trusting the audio element.
  player.state.source = {kind: 'monochrome', url: player.el.src};
  assert.equal(player.duration(), 512);
  player.state.source = null;
  player.el.src = '';
});
