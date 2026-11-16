import test from 'node:test';import assert from 'node:assert/strict';import {browserMocks} from './helpers.mjs';browserMocks();
const api=await import('../js/api.js');
test('fastest audio servers are asked first; failed ones go last; your own servers stay first',()=>{
  const table={'https://a':3000,'https://b':400,'https://c':900};
  assert.deepEqual(api.rankBySpeed(['https://a','https://b','https://c','https://d'],{table}),['https://b','https://c','https://d','https://a']);
  assert.deepEqual(api.rankBySpeed(['https://a','https://b'],{table,failed:b=>b==='https://b'}),['https://a','https://b']);
  assert.deepEqual(api.rankBySpeed(['https://a','https://b','https://mine'],{table,custom:['https://mine']})[0],'https://mine');
});
test('songs are remembered until their audio link expires, capped at 3 hours',()=>{
  const now=1_800_000_000_000;
  assert.equal(api.streamExpiry(`https://x/videoplayback?expire=${(now+6*3600e3)/1000}&id=1`,now),now+3*3600e3);
  assert.equal(api.streamExpiry(`https://x/videoplayback?expire=${(now+3600e3)/1000}`,now),now+3600e3-10*60e3);
  assert.equal(api.streamExpiry('https://inv.example/latest_version?id=1',now),now+45*60e3);
});
