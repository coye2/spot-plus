import test from 'node:test';import assert from 'node:assert/strict';
import {CHANGELOG,unseen,APP_VERSION} from '../js/changelog.js';
const mem=(v,onboarded=null)=>({getItem:k=>k==='spotplus.seenVersion'?v:onboarded,setItem(){}});
test('changelog is newest-first with unique versions',()=>{
  const v=CHANGELOG.map(e=>e.version);assert.equal(new Set(v).size,v.length);assert.equal(APP_VERSION,v[0]);
  for(const e of CHANGELOG){assert.match(e.version,/^\d+\.\d+\.\d+$/);assert.ok(e.items.length);}
});
test('what’s new shows only unseen releases, never to first-time users',()=>{
  assert.deepEqual(unseen(mem(null)),[]);
  assert.deepEqual(unseen(mem(null,'1')).map(e=>e.version),[APP_VERSION]);
  const fresh=unseen(mem('1.3.0')).map(e=>e.version);assert.ok(fresh.includes('1.3.1')||fresh.length===3);assert.ok(!fresh.includes('1.3.0'));assert.ok(fresh.length<=3);
  assert.deepEqual(unseen(mem(APP_VERSION)),[]);
});
