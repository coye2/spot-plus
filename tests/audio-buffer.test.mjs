import test from 'node:test';
import assert from 'node:assert/strict';
import {NextAudioBuffer} from '../js/audio-buffer.js';
test('prepared audio can be consumed once without another media request',async()=>{
 let requests=0;const buffer=new NextAudioBuffer(async()=>{requests++;return new Response(new Uint8Array([1,2,3]));});
 await buffer.warm('song|quality|video',{url:'https://audio.example/song',mime:'audio/mp4'});
 assert.equal(buffer.take('different'),null);const ready=buffer.take('song|quality|video');assert.equal(ready.blob.size,3);assert.equal(requests,1);assert.equal(buffer.take('song|quality|video'),null);
});
test('oversized, failed and stale buffers are never used for playback',async()=>{
 const large=new NextAudioBuffer(async()=>new Response(new Uint8Array(12)),8);await large.warm('a',{url:'a'});assert.equal(large.take('a'),null);
 const failed=new NextAudioBuffer(async()=>new Response('error',{status:403}));await failed.warm('b',{url:'b'});assert.equal(failed.take('b'),null);
 const stale=new NextAudioBuffer(async()=>new Response('audio'));await stale.warm('c',{url:'c'});stale.entry.created-=6*60000;assert.equal(stale.take('c'),null);
});
test('replacing a pending warmup aborts it and cannot replace the newer result',async()=>{
 let release,signal;const buffer=new NextAudioBuffer((url,options)=>{if(url==='old'){signal=options.signal;return new Promise(resolve=>{release=resolve;});}return Promise.resolve(new Response('new'));});
 const old=buffer.warm('old',{url:'old'});await buffer.warm('new',{url:'new'});assert.equal(signal.aborted,true);release(new Response('old'));await old;assert.equal(await buffer.take('new').blob.text(),'new');
});
