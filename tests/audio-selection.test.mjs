import test from 'node:test';import assert from 'node:assert/strict';
import {rankAudioMatches,chooseAudioFormat,raceAudioSources} from '../js/audio-selection.js';
const track={title:'Blinding Lights',artist:'The Weeknd',duration:200};
test('matching rejects covers, alternate editions, wrong artists and wrong lengths',()=>{
 const item={title:'The Weeknd - Blinding Lights (Official Audio)',channel:'The Weeknd',duration:200};
 const matches=rankAudioMatches([item,{...item,channel:'Other',title:'Blinding Lights'},{...item,title:item.title+' live'},{...item,title:item.title+' cover'},{...item,duration:99}],track);
 assert.equal(matches.length,1);assert.equal(matches[0].title,item.title);
 assert.equal(rankAudioMatches([{title:'ETA full album',channel:'NewJeans',duration:151}],{title:'ETA',artist:'NewJeans',duration:151}).length,0);
});
test('requested editions are preserved and MGK aliases match',()=>{
 assert.equal(rankAudioMatches([{title:'Machine Gun Kelly - roll the windows up',channel:'Machine Gun Kelly - Topic',duration:180}],{title:'roll the windows up',artist:'mgk',duration:180}).length,1);
 assert.equal(rankAudioMatches([{title:'Song (Remix)',channel:'Artist',duration:200}],{title:'Song (Remix)',artist:'Artist',duration:200}).length,1);
});
test('quality compares compatible codecs instead of blindly preferring Opus',()=>{
 const list=[{url:'https://a/1',mime:'audio/webm',codec:'opus',bitrate:64000},{url:'https://a/2',mime:'audio/mp4',bitrate:256000},{url:'https://a/3',mime:'video/mp4',bitrate:999000}];
 assert.equal(chooseAudioFormat(list).bitrate,256000);assert.equal(chooseAudioFormat(list,{quality:'low'}).bitrate,64000);assert.equal(chooseAudioFormat(list,{canPlay:m=>!m.includes('webm')}).bitrate,256000);
});
test('provider pool expands past dead servers with bounded concurrency',async()=>{
 let active=0,max=0,attempts=0;const winner=await raceAudioSources([1,2,3,4,5,6],async n=>{active++;max=Math.max(max,active);attempts++;await new Promise(r=>setTimeout(r,2));active--;if(n<6)throw new Error('offline');return {bitrate:128000,n};},{concurrency:2});assert.equal(winner.n,6);assert.equal(max,2);assert.equal(attempts,6);
});
test('low bitrate does not beat a shortly arriving quality source; cancellation terminates the race',async()=>{
 const result=await raceAudioSources([1,2],async n=>{if(n===2)await new Promise(r=>setTimeout(r,10));return {bitrate:n===1?48000:160000};},{qualityWait:50});assert.equal(result.bitrate,160000);
 const controller=new AbortController();const promise=raceAudioSources([1],()=>new Promise(()=>{}),{signal:controller.signal});controller.abort();await assert.rejects(promise,{name:'AbortError'});
});
