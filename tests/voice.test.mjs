import test from 'node:test';import assert from 'node:assert/strict';
import {browserMocks,settle} from './helpers.mjs';browserMocks();
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
