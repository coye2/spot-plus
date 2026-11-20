import test from 'node:test';
import assert from 'node:assert/strict';
import {createGame, step, turn, speed} from '../js/snake.js';

const songs = Array.from({length: 5}, (_, i) => ({title: 'S' + i}));
const fixed = () => 0; // food at the first free cell

test('the snake eats the next song in the queue and grows with it at its head', () => {
  const g = createGame({songs, random: fixed});
  g.food = {x: 4, y: g.snake[0].y, song: 1};
  assert.equal(step(g), 'ate');
  assert.equal(g.snake.length, 4);
  assert.deepEqual(g.snake.map((s) => s.song), [1, 0, -1, -1]);
  assert.equal(g.food.song, 2, 'next bite is the following song');
});

test('turning back on yourself is ignored; walls and your own body end the game', () => {
  const g = createGame({songs, random: fixed});
  turn(g, 'left');
  assert.deepEqual(g.queued, []);
  turn(g, 'up'); turn(g, 'left');
  assert.deepEqual(g.queued, ['up', 'left']);
  const w = createGame({songs, random: fixed});
  w.food = {x: 0, y: 0, song: 1};
  let r; for (let i = 0; i < 20 && r !== 'over'; i++) r = step(w);
  assert.equal(r, 'over');
  assert.equal(w.over, true);
});

test('the head may move into the square the tail is leaving', () => {
  const g = createGame({songs, random: fixed});
  g.snake = [{x: 5, y: 5, song: 0}, {x: 5, y: 6, song: -1}, {x: 4, y: 6, song: -1}, {x: 4, y: 5, song: -1}];
  g.dir = 'up'; g.food = {x: 0, y: 0, song: 1};
  turn(g, 'left');
  assert.equal(step(g), 'moved');
});

test('the game speeds up as the snake grows', () => {
  assert.equal(speed(0), 170);
  assert.ok(speed(10) < speed(0));
  assert.equal(speed(100), 75);
});
