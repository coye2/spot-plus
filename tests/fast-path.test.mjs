import test from 'node:test';import assert from 'node:assert/strict';import {browserMocks} from './helpers.mjs';browserMocks();
test('known recording + a server that worked = play right away, no extra server request',async()=>{
  localStorage.setItem('spotplus.goodInstance',JSON.stringify({invidious:'https://inv.example'}));
  const calls=[];
  globalThis.fetch=async url=>{calls.push(String(url));
    if(String(url).includes('/match'))return new Response(JSON.stringify({items:[{id:'fHI8X4OXluQ',title:'The Weeknd - Blinding Lights (Official Audio)',channel:'The Weeknd',duration:204}]}));
    return new Response('[]');};
  const api=await import('../js/api.js');
  const s=await api.resolve({id:'908604612',title:'Blinding Lights',artist:'The Weeknd',duration:200});
  assert.match(s.url,/^https:\/\/inv\.example\/latest_version\?id=fHI8X4OXluQ&itag=(140|251)&local=true$/);
  assert.equal(s.fast,true);
  assert.ok(!calls.some(u=>u.includes('/api/v1/videos')||u.includes('/streams/')),'no audio-links request');
});
