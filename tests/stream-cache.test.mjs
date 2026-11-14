import test from 'node:test';
import assert from 'node:assert/strict';
import {storageMock,settle} from './helpers.mjs';
globalThis.localStorage=storageMock();
Object.defineProperty(globalThis,'navigator',{value:{},configurable:true});
globalThis.document={createElement:()=>({canPlayType:()=>true})};
const store=await import('../js/store.js');
const api=await import('../js/api.js');
store.setSettings({source:'piped',customPiped:'https://audio.example.test'});
localStorage.setItem('spotplus.instances',JSON.stringify({t:Date.now(),piped:['https://audio.example.test'],invidious:[]}));
let requests=0;
globalThis.fetch=async()=>{requests++;return new Response(JSON.stringify({audioStreams:[{url:'https://audio.example.test/song.m4a',mimeType:'audio/mp4',bitrate:128000}]}));};
const track={id:'cache-check',title:'Song',artist:'Artist'};
store.setVideoCache(track.id,{id:'abcdefghijk',manual:true});
test('preparing the next song avoids a second resolver request',async()=>{
  api.prewarm(track);await settle();const before=requests;
  const result=await api.resolve(track);assert.equal(result.url,'https://audio.example.test/song.m4a');assert.equal(requests,before);
  await api.resolve(track);assert.equal(requests,before);
});
test('cache honors cancellation, source changes and explicit server retry',async()=>{
  const controller=new AbortController();controller.abort();await assert.rejects(api.resolve(track,{signal:controller.signal}),{name:'AbortError'});
  const before=requests;store.setSettings({quality:'low'});await api.resolve(track);assert.ok(requests>before);
  const beforeRetry=requests;await api.resolve(track,{skip:['https://failed.example.test']});assert.ok(requests>beforeRetry);
});
