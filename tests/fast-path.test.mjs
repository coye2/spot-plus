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
test('loops: one cached search finds the official video and plays it straight from a working server',async()=>{
  localStorage.setItem('spotplus.goodInstance',JSON.stringify({invidious:'https://inv.example'}));
  globalThis.fetch=async url=>{url=String(url);
    if(url.includes('/match')&&url.includes('type=video'))return new Response(JSON.stringify({items:[{id:'4NRXx6U8ABQ',title:'The Weeknd - Blinding Lights (Official Video)',channel:'The Weeknd',duration:263,verified:true}]}));
    return new Response('[]');};
  const api=await import('../js/api.js');
  const loop=await api.fastVideoLoop({id:'908604612',title:'Blinding Lights',artist:'The Weeknd',duration:200},{target:1080});
  assert.match(loop.url,/^https:\/\/inv\.example\/latest_version\?id=4NRXx6U8ABQ&itag=137&local=true$/);
  assert.equal(loop.height,1080);assert.equal(loop.start,70);
});
test('mashups and "song x song" blends never count as the song',async()=>{
  const {rankAudioMatches}=await import('../js/audio-selection.js');
  const items=[{id:'a',title:'Linkin Park x Ludacris - In The End x Move Bitch (Mashup)',channel:'Mashup Kid',duration:220},{id:'b',title:'In the End',channel:'Linkin Park',duration:216},{id:'c',title:'In The End vs Move Bitch',channel:'DJ',duration:216}];
  assert.deepEqual(rankAudioMatches(items,{title:'In the End',artist:'Linkin Park',duration:216}).map(x=>x.id),['b']);
  assert.equal(rankAudioMatches([{id:'d',title:'Lil Nas X - Old Town Road',channel:'Lil Nas X',duration:157}],{title:'Old Town Road',artist:'Lil Nas X',duration:157}).length,1,'artists with X in the name still match');
});
