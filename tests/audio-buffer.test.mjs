import test from 'node:test';import assert from 'node:assert/strict';
import {NextAudioBuffer} from '../js/audio-buffer.js';import {FakeAudio} from './helpers.mjs';
test('partial native buffer hands off the same element once without another load',()=>{
 const media=new FakeAudio();let loads=0;media.load=()=>loads++;media.readyState=1;
 const buffer=new NextAudioBuffer(()=>media);buffer.warm('song',{url:'https://audio.example/song'});const loaded=loads;
 assert.equal(buffer.take('other'),null);assert.equal(buffer.take('song').media,media);assert.equal(loads,loaded);assert.equal(buffer.take('song'),null);
});
test('replacement cancels stale audio; expired and failed media cannot be handed off',()=>{
 const buffer=new NextAudioBuffer(()=>new FakeAudio());buffer.warm('old',{url:'old'});buffer.warm('new',{url:'new'});assert.equal(buffer.spare.src,'new');assert.equal(buffer.take('old'),null);
 buffer.spare.error={code:4};assert.equal(buffer.take('new'),null);buffer.spare.error=null;buffer.entry.created-=9*60000;assert.equal(buffer.take('new'),null);buffer.clear();assert.equal(buffer.spare.src,'');
});
test('recycling the old element does not reset the new active player',()=>{
 const buffer=new NextAudioBuffer(()=>new FakeAudio());buffer.warm('one',{url:'one'});const active=buffer.take('one').media,old=new FakeAudio();old.src='old';buffer.recycle(old);assert.equal(active.src,'one');assert.equal(old.src,'');buffer.warm('two',{url:'two'});assert.equal(buffer.take('two').media,old);
});
