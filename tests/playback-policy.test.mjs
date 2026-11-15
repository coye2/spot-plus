import test from 'node:test';import assert from 'node:assert/strict';import {audioHasHeadroom,bufferedAhead,loopQuality} from '../js/playback-policy.js';
test('background media waits for a useful audio buffer and backs off on data saver',()=>{
 const media={src:'https://media.example/song',paused:false,currentTime:10,duration:200,buffered:{length:1,start:()=>0,end:()=>30}};assert.equal(bufferedAhead(media),20);assert.equal(audioHasHeadroom(media),true);media.buffered.end=()=>12;assert.equal(audioHasHeadroom(media),false);media.currentTime=198;media.buffered.end=()=>200;assert.equal(audioHasHeadroom(media),true);media.paused=true;assert.equal(audioHasHeadroom(media),false);
 assert.equal(loopQuality(),1080);assert.equal(loopQuality({effectiveType:'4g',downlink:4}),720);assert.equal(loopQuality({saveData:true}),360);assert.equal(loopQuality({effectiveType:'3g'}),480);
});
