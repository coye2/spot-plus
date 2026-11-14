import test from 'node:test';import assert from 'node:assert/strict';import {browserMocks,settle} from './helpers.mjs';browserMocks();
const dj=await import('../js/dj.js'),player=await import('../js/player.js'),store=await import('../js/store.js');
test('voice commands never confuse song titles with playback controls',()=>{
 assert.deepEqual(dj.parseCommand('Please pause the music.'),{type:'pause'});assert.deepEqual(dj.parseCommand('shuffle off'),{type:'shuffle',enabled:false});assert.equal(dj.parseCommand('play Stop by Spice Girls'),null);assert.equal(dj.parseCommand('Next to Me'),null);
});
test('fast DJ commands operate the existing queue and save the real current song',async()=>{
 store.setSettings({djVoice:false});player.playList([{id:'local-a',title:'A',local:true},{id:'local-b',title:'B',local:true}]);await settle();await dj.start('next song');await settle();assert.equal(player.current().id,'local-b');await dj.start('like this song');assert.equal(store.isLiked('local-b'),true);await dj.start('pause');assert.equal(player.isPlaying(),false);await dj.start('resume');assert.equal(player.isPlaying(),true);dj.stop();
});
