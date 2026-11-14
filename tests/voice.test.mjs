import test from 'node:test';import assert from 'node:assert/strict';
import {browserMocks,settle,FakeAudio} from './helpers.mjs';browserMocks();
let latestAudio;
globalThis.Audio=class extends FakeAudio {constructor(){super();latestAudio=this;}};
globalThis.isSecureContext=true;
let activeRecognition;
class Recognition {constructor(){activeRecognition=this;}start(){this.onstart?.();}abort(){} }
globalThis.SpeechRecognition=Recognition;
const voice=await import('../js/dj-voice.js');const player=await import('../js/player.js');
test('microphone pauses music, publishes interim captions and dispatches one final request',async()=>{
 player.playList([{id:'local-test',title:'Test',local:true}]);await settle();const requests=[];voice.bindRequest(text=>requests.push(text));
 voice.listen();assert.equal(voice.state.phase,'listening');assert.equal(player.isPlaying(),false);
 activeRecognition.onresult({results:[Object.assign([{transcript:'more energy'}],{isFinal:false})]});assert.equal(voice.state.transcript,'more energy');assert.equal(requests.length,0);
 activeRecognition.onresult({results:[Object.assign([{transcript:'more energy'}],{isFinal:true})]});await settle();assert.deepEqual(requests,['more energy']);assert.equal(player.isPlaying(),true);assert.equal(voice.state.phase,'idle');voice.stop();
});
test('microphone denial stops conversation and offers the typed fallback',()=>{
 voice.toggleConversation();activeRecognition.onerror({error:'not-allowed'});assert.equal(voice.state.conversation,false);assert.match(voice.state.error,/Microphone access is off/);assert.equal(voice.state.phase,'idle');voice.stop();
});
test('cancelling listening restores playback and ignores late recognition results',()=>{
 voice.listen();const old=activeRecognition;voice.stop();assert.equal(old.onresult,null);assert.equal(voice.state.phase,'idle');assert.equal(player.isPlaying(),true);
});

test('bundled host audio ducks music and restores volume when the clip ends',async()=>{
 const originalFetch=globalThis.fetch;globalThis.fetch=async()=>new Response(new Blob(['voice'],{type:'audio/mpeg'}));
 try{player.setVolume(.7);const playback=voice.speak('Next',{cue:'next'});await settle();assert.equal(voice.state.phase,'speaking');assert.equal(voice.state.lastVoice,'After Hours');assert.ok(player.el.volume<.7);latestAudio.onended();await playback;assert.equal(player.el.volume,.7);assert.equal(voice.state.phase,'idle');}
 finally{voice.stop();globalThis.fetch=originalFetch;}
});

test('cancelled voice downloads never start stale speech',async()=>{
 const originalFetch=globalThis.fetch;let finish;
 globalThis.fetch=()=>new Promise(resolve=>{finish=resolve;});
 try{const playback=voice.speak('Pause',{cue:'pause'});voice.cancelSpeech();finish(new Response(new Blob(['voice'])));await playback;assert.equal(voice.state.phase,'idle');assert.equal(latestAudio.paused,true);assert.equal(player.el.volume,.7);}
 finally{voice.stop();globalThis.fetch=originalFetch;}
});
