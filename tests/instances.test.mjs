import test from 'node:test';import assert from 'node:assert/strict';import {browserMocks} from './helpers.mjs';browserMocks();
test('audio server choices are ready while directory refresh is still pending',async()=>{
 const pending=[];globalThis.fetch=()=>new Promise(resolve=>pending.push(resolve));
 const api=await import('../js/api.js');const available=await api.instances();assert.ok(available.piped.length);assert.ok(available.invidious.length);assert.equal(pending.length,2);
 const refresh=api.instances(true);for(const finish of pending)finish(new Response('[]',{headers:{'Content-Type':'application/json'}}));await refresh;
});
