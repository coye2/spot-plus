import test from 'node:test';import assert from 'node:assert/strict';
import {browserMocks,settle,FakeAudio} from './helpers.mjs';browserMocks();
let latestAudio;
globalThis.Audio=class extends FakeAudio {constructor(){super();latestAudio=this;}};
globalThis.isSecureContext=true;
let activeRecognition;
class Recognition {constructor(){activeRecognition=this;}start(){this.onstart?.();}abort(){} }
globalThis.SpeechRecognition=Recognition;
let voiceWorker,holdSpeech=false;const generatedTexts=[];let delayedJob;
globalThis.Worker=class {constructor(){voiceWorker=this;}terminate(){}postMessage(job){if(job.type==='cancel')return;if(job.type==='load'){queueMicrotask(()=>this.onmessage({data:{id:job.id,result:true}}));return;}generatedTexts.push(job.text);if(holdSpeech){delayedJob=job;return;}queueMicrotask(()=>this.onmessage({data:{id:job.id,result:{blob:new Blob(['generated audio'],{type:'audio/wav'})}}}));}};
const live=await import('../js/live-voice.js');
const voice=await import('../js/dj-voice.js');const player=await import('../js/player.js');
test('microphone pauses music, publishes interim captions and dispatches one final request',async()=>{
 player.playList([{id:'local-test',title:'Test',local:true}]);await settle();const requests=[];voice.bindRequest(text=>requests.push(text));
 voice.listen();assert.equal(voice.state.phase,'listening');assert.equal(player.isPlaying(),false);
 activeRecognition.onresult({results:[Object.assign([{transcript:'more energy'}],{isFinal:false})]});assert.equal(voice.state.transcript,'more energy');assert.equal(requests.length,0);
 activeRecognition.onresult({results:[Object.assign([{transcript:'more energy'}],{isFinal:true})]});assert.equal(requests.length,0);activeRecognition.onend();await settle();assert.deepEqual(requests,['more energy']);assert.equal(player.isPlaying(),true);assert.equal(voice.state.phase,'idle');voice.stop();
});
test('microphone denial stops conversation and offers the typed fallback',()=>{
 voice.toggleConversation();activeRecognition.onerror({error:'not-allowed'});assert.equal(voice.state.conversation,false);assert.match(voice.state.error,/Microphone access is off/);assert.equal(voice.state.phase,'idle');voice.stop();
});
test('cancelling listening restores playback and ignores late recognition results',()=>{
 voice.listen();const old=activeRecognition;voice.stop();assert.equal(old.onresult,null);assert.equal(voice.state.phase,'idle');assert.equal(player.isPlaying(),true);
});

test('new text is sent to live synthesis and music volume restores after speech',async()=>{
 await live.load();player.setVolume(.7);const text='Your new request is midnight jazz.';const playback=voice.speak(text);await settle();assert.equal(voice.state.phase,'speaking');assert.equal(generatedTexts.at(-1),text);assert.equal(voice.state.caption,text);assert.ok(player.el.volume<.7);latestAudio.onended();await playback;assert.equal(player.el.volume,.7);assert.equal(voice.state.phase,'idle');voice.stop();
});
test('interruption ignores a late synthesized result and restores volume',async()=>{
 holdSpeech=true;const playback=voice.speak('This is a newly generated sentence.');await settle();voice.cancelSpeech();voiceWorker.onmessage({data:{id:delayedJob.id,result:{blob:new Blob(['late'])}}});await playback;assert.equal(latestAudio.paused,true);assert.equal(player.el.volume,.7);holdSpeech=false;voice.stop();
});
test('disabled live voice keeps text and never silently substitutes a recorded clip',async()=>{
 live.release();const count=generatedTexts.length;await voice.speak('A song name never heard before.');assert.equal(generatedTexts.length,count);assert.match(voice.state.error,/Enable live DJ/);assert.equal(voice.state.caption,'A song name never heard before.');
});
test('mixed final and interim segments are never dispatched as a cut-off request',async()=>{
 const requests=[];voice.bindRequest(text=>requests.push(text));voice.listen();const first=Object.assign([{transcript:'play some'}],{isFinal:true}),partial=Object.assign([{transcript:'Taylor'}],{isFinal:false});
 activeRecognition.onresult({results:[first,partial]});await settle();assert.equal(requests.length,0);assert.equal(voice.state.transcript,'play some Taylor');
 activeRecognition.onresult({results:[first,Object.assign([{transcript:'Taylor Swift'}],{isFinal:true})]});activeRecognition.onend();await settle();assert.deepEqual(requests,['play some Taylor Swift']);voice.stop();
});
test('recognition ending mid-sentence preserves the words for editing without dispatch',async()=>{
 const requests=[];voice.bindRequest(text=>requests.push(text));voice.listen();activeRecognition.onresult({results:[Object.assign([{transcript:'play'}],{isFinal:true}),Object.assign([{transcript:'something by'}],{isFinal:false})]});activeRecognition.onend();await settle();assert.deepEqual(requests,[]);assert.equal(voice.state.transcript,'play something by');assert.match(voice.state.caption,/complete request/);voice.stop();
});
