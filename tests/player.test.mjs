import test from 'node:test';import assert from 'node:assert/strict';
import {browserMocks,settle} from './helpers.mjs';browserMocks();
const player=await import('../js/player.js');const store=await import('../js/store.js');
const tracks=['one','two','three','four'].map(id=>({id,title:id,artist:'Unit test',duration:180,local:true}));
test('queue starts, reorders and persists without changing the current track',async()=>{player.playList(tracks);await settle();assert.equal(player.current().id,'one');assert.ok(player.isPlaying());player.moveQueue(3,1);assert.equal(player.state.queue[1].id,'four');assert.equal(store.loadPlayer().queue[1].id,'four');player.moveQueue(0,2);assert.equal(player.current().id,'one');});
test('removing a shuffled item does not resurrect it when shuffle is disabled',async()=>{player.playList(tracks);await settle();player.toggleShuffle();const removed=player.state.queue[2].id;player.removeAt(2);player.toggleShuffle();assert.ok(!player.state.queue.some(t=>t.id===removed));assert.equal(player.current().id,'one');});
test('clear upcoming queue survives switching shuffle off',async()=>{player.playList(tracks);await settle();player.toggleShuffle();player.clearUpNext();player.toggleShuffle();assert.equal(player.state.queue.length,1);});
test('repeat cycles through real states and seeking clamps to duration',()=>{player.state.repeat='off';player.cycleRepeat();assert.equal(player.state.repeat,'all');player.cycleRepeat();assert.equal(player.state.repeat,'one');player.cycleRepeat();assert.equal(player.state.repeat,'off');player.seek(999);assert.equal(player.el.currentTime,180);player.seek(-2);assert.equal(player.el.currentTime,0);});
test('rapid track change cannot apply the previous asynchronous load',async()=>{player.playList(tracks);player.playIndex(2);await settle();assert.equal(player.current().id,'three');assert.ok(player.isPlaying());assert.equal(store.getRecent()[0].id,'three');});
test('cancel loading cannot later begin playback',async()=>{player.playList(tracks);player.toggle();await settle();assert.equal(player.state.loading,false);assert.equal(player.isPlaying(),false);});
test('restored queues do not autoplay and malformed volume is clamped',()=>{player.el.pause();store.savePlayer({queue:tracks,index:2,vol:2,repeat:'broken',pos:22});player.restore();assert.equal(player.current().id,'three');assert.equal(player.el.volume,1);assert.equal(player.state.repeat,'off');assert.equal(player.restoredPosition(),22);assert.equal(player.isPlaying(),false);});

test('audio unlock does not replace the real track duration',()=>{player.el.src='data:audio/wav;base64,silence';player.el.duration=.1;assert.equal(player.duration(),180);});

test('the first tap starts a restored song even while the silent unlock clip is playing',async()=>{player.el.duration=180;player.el.src='data:audio/wav;base64,silence';player.el.paused=false;player.toggle();await settle();assert.ok(!player.el.src.startsWith('data:'));assert.ok(player.isPlaying());});

test('restored shuffle removal survives disabling shuffle',()=>{store.savePlayer({queue:tracks.map(t=>({...t})),original:[...tracks].reverse().map(t=>({...t})),index:0,shuffle:true});player.restore();player.removeAt(2);player.toggleShuffle();assert.ok(!player.state.queue.some(t=>t.id==='three'));});

test('a stream failure keeps the selected song and exposes an error',async()=>{player.playList(tracks);await settle();player.el.dispatchEvent(new Event('error'));assert.equal(player.current().id,'one');assert.match(player.state.error,/Playback failed/);assert.equal(player.state.loading,false);});

test('a single failed playback attempt emits error at most once',async()=>{
  let errors=0;const unsub=()=>{errors++;};
  player.on('error',unsub);
  player.playList(tracks);await settle();
  player.el.dispatchEvent(new Event('error'));
  player.el.dispatchEvent(new Event('error'));
  await settle();
  assert.equal(errors,1);
});

test('preview fallback clears crossOrigin so CORS-strict previews still play',async()=>{
  const previewTrack={id:'p-cors',title:'Cors Test',artist:'Unit',duration:180,preview:'https://cdnt-preview.dzcdn.net/stream/p.mp3'};
  player.el.setAttribute('crossorigin','anonymous');
  globalThis.fetch=async()=>new Response('no',{status:404});
  player.playList([previewTrack]);
  await settle();
  assert.equal(player.el.crossOrigin,null);
});

test('ended auto-advances queue (including preview paths), wraps repeat-all, restarts repeat-one, and continues radio',async()=>{
  player.state.repeat='off';
  const radioTracks=[];
  player.setQueueHooks({continueQueue:async()=>{const nextTrack={id:'radio-1',title:'Radio 1',artist:'Unit',duration:180,local:true};radioTracks.push(nextTrack);return [nextTrack];}});
  const q=[
    {id:'q1',title:'Song 1',artist:'Unit',duration:30,preview:'https://cdnt-preview.dzcdn.net/stream/1.mp3'},
    {id:'q2',title:'Song 2',artist:'Unit',duration:180,local:true},
  ];
  globalThis.fetch=async()=>new Response('no',{status:404});
  player.playList(q,0,{shuffle:false});
  await settle();
  assert.equal(player.current().id,'q1');
  assert.equal(player.state.source?.kind,'preview');
  assert.ok(player.isPlaying());

  // Preview finishes -> loads q2 and starts playing without user tap
  player.el.dispatchEvent(new Event('ended'));
  await settle();
  assert.equal(player.current().id,'q2');
  assert.ok(player.isPlaying());

  // Repeat one restarts q2 without advancing
  player.state.repeat='one';
  player.el.currentTime=120;
  player.el.dispatchEvent(new Event('ended'));
  await settle();
  assert.equal(player.current().id,'q2');
  assert.equal(player.el.currentTime,0);
  assert.ok(player.isPlaying());

  // Repeat all wraps queue back to q1
  player.state.repeat='all';
  player.el.dispatchEvent(new Event('ended'));
  await settle();
  assert.equal(player.current().id,'q1');
  assert.ok(player.isPlaying());

  // End of queue with repeat off continues into radio
  player.state.repeat='off';
  player.el.dispatchEvent(new Event('ended'));
  await settle();
  assert.equal(player.current().id,'q2');
  player.el.dispatchEvent(new Event('ended'));
  await settle();
  assert.equal(player.current().id,'radio-1');
  assert.equal(radioTracks.length,1);
  assert.ok(player.isPlaying());

  player.setQueueHooks({continueQueue:null});
});

test('intentional pause prevents auto-advance when ended fires',async()=>{
  player.state.repeat='off';
  const q=[
    {id:'p1',title:'Pause 1',artist:'Unit',duration:180,local:true},
    {id:'p2',title:'Pause 2',artist:'Unit',duration:180,local:true},
  ];
  player.playList(q,0,{shuffle:false});
  await settle();
  player.pause();
  player.el.dispatchEvent(new Event('ended'));
  await settle();
  assert.equal(player.current().id,'p1');
  assert.equal(player.isPlaying(),false);
});

