import test from 'node:test';import assert from 'node:assert/strict';
import {corsOK,knownCors} from '../js/cors-probe.js';
test('servers are checked once and remembered',async()=>{
  let calls=0;const ok=async()=>{calls++;return new Response('x',{status:206});};const no=async()=>{calls++;throw new TypeError('CORS');};
  assert.equal(await corsOK('https://good.example/a?x=1',ok),true);
  assert.equal(await corsOK('https://good.example/b',ok),true);
  assert.equal(await corsOK('https://bad.example/a',no),false);
  assert.equal(await corsOK('https://bad.example/b',no),false);
  assert.equal(calls,2);assert.equal(knownCors('https://bad.example/z'),false);
  assert.equal(await corsOK('blob:abc'),true);
});
