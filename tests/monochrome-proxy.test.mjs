import test from 'node:test';
import assert from 'node:assert/strict';
import {monochromeAudio} from '../canvas-bridge/monochrome.js';

test('/mono relabels Monochrome FLAC as audio/flac and passes the range through', async () => {
  let asked;
  const fetcher = async (url, init) => { asked = {url, range: init.headers.Range}; return new Response('fLaC', {status: 206, headers: {'Content-Type': 'application/octet-stream', 'Content-Range': 'bytes 0-3/1000', 'Content-Length': '4'}}); };
  const r = await monochromeAudio(new Request('https://w.dev/mono?id=154011238517444608', {headers: {Range: 'bytes=0-3'}}), {fetcher});
  assert.equal(r.status, 206);
  assert.equal(r.headers.get('Content-Type'), 'audio/flac');
  assert.equal(r.headers.get('Content-Range'), 'bytes 0-3/1000');
  assert.equal(asked.url, 'https://tracks.monochrome.st/track/154011238517444608');
  assert.equal(asked.range, 'bytes=0-3');
  assert.equal(await r.text(), 'fLaC');
});

test('/mono rejects bad ids and reports upstream refusals', async () => {
  assert.equal((await monochromeAudio(new Request('https://w.dev/mono?id=../x'))).status, 400);
  const r = await monochromeAudio(new Request('https://w.dev/mono?id=123456789'), {fetcher: async () => new Response('', {status: 404})});
  assert.equal(r.status, 502);
});
