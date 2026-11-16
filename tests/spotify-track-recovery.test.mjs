import test from 'node:test';
import assert from 'node:assert/strict';
import {readSpotifyAccount,readSpotifyTrack} from '../js/spotify-reader.js';
import {validateAccountSnapshot,mergeAccountSnapshot,accountReadNotice} from '../js/spotify-account.js';
import {storageMock} from './helpers.mjs';

// Synthetic metadata only: array artist/wrapper variants and getTrack's
// firstArtist/otherArtists schema are documented in docs/spotify-helper.md.
const id=n=>String(n).padStart(22,'0');
const song=(n=1)=>({__typename:'Track',uri:'spotify:track:'+id(n),name:'Song '+n,artists:{items:[{profile:{name:'Artist'}}]},duration:{totalMilliseconds:180000}});
const sparse=(n=1)=>({...song(n),artists:undefined});
const page=items=>({items,totalCount:items.length});
function reader({likes=[],playlists=[],details=()=>({__typename:'NotFound'}),calls=[]}={}){
  return async(name,variables)=>{
    calls.push({name,variables});
    if(name==='profileAttributes')return {data:{me:{profile:{username:'test-listener',name:'Test listener'}}}};
    if(name==='fetchLibraryTracks')return {data:{me:{library:{tracks:page(likes)}}}};
    if(name==='libraryV3')return {data:{me:{libraryV3:page(variables.filters[0]==='Playlists'?playlists.map((_,i)=>({uri:'spotify:playlist:'+id(i),name:'Playlist '+i})):[])}}};
    if(name==='fetchPlaylist')return {data:{playlistV2:{content:page(playlists[Number(variables.uri.split(':').at(-1))])}}};
    if(name==='getTrack')return {data:{trackUnion:await details(Number(variables.uri.split(':').at(-1)))}};
    throw new Error('Unexpected read '+name);
  };
}

test('track parser supports artist arrays, item wrappers and split artist collections without inventing metadata',()=>{
  const raw={...song(),artists:[{name:'Lead'},{profile:{name:'Guest'}}]};
  for(const wrapped of [raw,{item:raw},{item:{data:raw}},{track:raw},{itemV2:{data:raw}}]){
    assert.equal(readSpotifyTrack(wrapped).artist,'Lead, Guest');
  }
  const split={...sparse(),uri:undefined,id:id(1),firstArtist:{items:[{profile:{name:'Lead'}}]},otherArtists:{items:[{profile:{name:'Guest'}},{profile:{name:'Lead'}}]}};
  assert.equal(readSpotifyTrack(split).spotifyId,id(1));assert.equal(readSpotifyTrack(split).artist,'Lead, Guest');
  assert.equal(readSpotifyTrack({...song(),name:'  '}),null);
  assert.equal(readSpotifyTrack({...song(),artists:{items:[{profile:{name:'  '}}]}}),null);
  assert.equal(readSpotifyTrack({...sparse(),albumOfTrack:{artists:{items:[{name:'Album artist'}]}}}),null);
  assert.equal(readSpotifyTrack({...song(),duration:{totalMilliseconds:'invalid'}}).duration,0);
});

test('missing details are recovered once per ID across collections, retaining order and duplicate songs',async()=>{
  const calls=[];
  const result=await readSpotifyAccount(reader({likes:[sparse(1)],playlists:[[song(2),sparse(1),sparse(1)]],calls,details:n=>({...sparse(n),firstArtist:{items:[{profile:{name:'Recovered artist'}}]}})}));
  assert.deepEqual(result.playlists[0].tracks.map(t=>t.spotifyId),[id(2),id(1),id(1)]);
  assert.equal(result.likes[0].artist,'Recovered artist');assert.equal(result.likesUnreadable,0);
  assert.equal(result.playlists[0].status,'ready');assert.equal(calls.filter(c=>c.name==='getTrack').length,1);
  const normalCalls=[];
  await readSpotifyAccount(reader({likes:[song()],playlists:[[song(2)]],calls:normalCalls}));
  assert.equal(normalCalls.some(c=>c.name==='getTrack'),false);
});

test('unreadable rows leave an explicit partial collection and do not block subsequent playlists',async()=>{
  const result=await readSpotifyAccount(reader({likes:[song(),null],playlists:[[song(2),sparse(3),null],[song(4)]]}));
  assert.equal(result.version,2);assert.equal(result.likesUnreadable,1);
  assert.equal(result.playlists[0].status,'partial');assert.equal(result.playlists[0].unreadable,2);
  assert.deepEqual(result.playlists[0].tracks.map(t=>t.spotifyId),[id(2)]);
  assert.equal(result.playlists[1].status,'ready');assert.equal(result.playlists[1].tracks[0].spotifyId,id(4));
  assert.match(accountReadNotice(result),/1 playlist has incomplete song details/);
  assert.match(accountReadNotice(result),/Incomplete entries in Liked Songs: 1/);
});

test('local, restricted, unavailable and spoken media are counted separately from missing metadata',async()=>{
  const calls=[];
  const unsupported=['LocalTrack','Episode','Podcast','Audiobook','RestrictedContent','NotFound'].map(__typename=>({...sparse(),__typename}));
  const result=await readSpotifyAccount(reader({likes:[song(),...unsupported,{...sparse(),playability:{playable:false}}],calls}));
  assert.equal(result.likes.length,1);assert.equal(result.skipped,7);assert.equal(result.likesUnreadable,0);
  assert.equal(calls.some(c=>c.name==='getTrack'),false);
});

test('a lookup for a different song cannot fill missing metadata',async()=>{
  const result=await readSpotifyAccount(reader({likes:[sparse(1)],details:()=>song(2)}));
  assert.equal(result.likesUnreadable,1);assert.deepEqual(result.likes,[]);
});

test('optional metadata failures stop further repair attempts but keep valid library records',async()=>{
  const calls=[];
  const result=await readSpotifyAccount(reader({likes:[sparse(1),sparse(2),song(3)],calls,details:()=>{throw Object.assign(new Error('Metadata unavailable'),{code:'metadata-unavailable'});}}));
  assert.equal(result.likesUnreadable,2);assert.equal(result.likes.length,1);
  assert.equal(calls.filter(c=>c.name==='getTrack').length,1);
});

test('metadata repair has a request budget and a time window',async t=>{
  const calls=[];
  const result=await readSpotifyAccount(reader({likes:Array.from({length:25},(_,i)=>sparse(i)),calls}));
  assert.equal(result.likesUnreadable,25);assert.equal(calls.filter(c=>c.name==='getTrack').length,20);
  let clock=1000;t.mock.method(Date,'now',()=>clock);
  const timedCalls=[];
  const timed=await readSpotifyAccount(reader({likes:[sparse(1),sparse(2)],calls:timedCalls,details:()=>{clock+=15001;return song(1);}}));
  assert.equal(timed.likes.length,1);assert.equal(timed.likesUnreadable,1);assert.equal(timedCalls.filter(c=>c.name==='getTrack').length,1);
});

test('network, authentication, rate-limit and cancellation errors still stop a read',async()=>{
  for(const message of ['Network failed','Session expired','Rate limited']){
    await assert.rejects(readSpotifyAccount(reader({likes:[sparse()],details:()=>{throw new Error(message);}})),new RegExp(message));
  }
  const controller=new AbortController();
  await assert.rejects(readSpotifyAccount(reader({likes:[sparse()],details:()=>{controller.abort();return song();}}),{signal:controller.signal}),{name:'AbortError'});
});

test('incomplete refresh preserves entire previous collections for the same account; new collections retain readable songs',async()=>{
  const previous=await readSpotifyAccount(reader({likes:[song(1),song(2)],playlists:[[song(1),song(2)]]}));previous.capturedAt=1;
  const incoming=await readSpotifyAccount(reader({likes:[song(3),sparse(4)],playlists:[[song(3),sparse(4)],[song(5),sparse(6)]]}));incoming.capturedAt=2;
  const kept=mergeAccountSnapshot(previous,incoming);
  assert.deepEqual(kept.likes.map(t=>t.spotifyId),[id(1),id(2)]);
  assert.deepEqual(kept.playlists[0].tracks.map(t=>t.spotifyId),[id(1),id(2)]);
  assert.deepEqual(kept.playlists[1].tracks.map(t=>t.spotifyId),[id(5)]);
  assert.equal(kept.likesUnreadable,1);assert.equal(kept.playlists[0].unreadable,1);assert.equal(kept.playlists[0].status,'partial');
  const first=mergeAccountSnapshot(null,incoming),other=mergeAccountSnapshot({...previous,account:{id:'other'}},incoming);
  assert.deepEqual(first,other);assert.deepEqual(first.likes.map(t=>t.spotifyId),[id(3)]);
  const complete=await readSpotifyAccount(reader({likes:[],playlists:[[song(5)]]}));complete.capturedAt=3;
  const refreshed=mergeAccountSnapshot(kept,complete);
  assert.deepEqual(refreshed.likes,[]);assert.equal(refreshed.likesUnreadable,0);assert.equal(refreshed.playlists[0].status,'ready');
  assert.deepEqual(refreshed.playlists[0].tracks.map(t=>t.spotifyId),[id(5)]);assert.equal(accountReadNotice(refreshed),'');
});

test('validation preserves warnings, upgrades legacy snapshots and flags records discarded during normalization',async()=>{
  const base=await readSpotifyAccount(reader({likes:[song()],playlists:[[song()]]}));
  assert.equal(validateAccountSnapshot({...base,version:1}).version,2);
  const raw=structuredClone(base);raw.likes.push({spotifyId:id(2)});raw.playlists[0].tracks.push({spotifyId:id(2)});
  const clean=validateAccountSnapshot(raw);
  assert.equal(clean.likesUnreadable,1);assert.equal(clean.playlists[0].unreadable,1);assert.equal(clean.playlists[0].status,'partial');
  assert.deepEqual(validateAccountSnapshot(JSON.parse(JSON.stringify(clean))),clean);
  for(const count of [-1,1.5,'2',10001,NaN]){
    assert.throws(()=>validateAccountSnapshot({...base,likesUnreadable:count}),/incomplete-song count/);
    assert.throws(()=>validateAccountSnapshot({...base,playlists:[{...base.playlists[0],unreadable:count}]}),/incomplete-song count/);
  }
  assert.throws(()=>validateAccountSnapshot({...base,playlists:[{...base.playlists[0],status:'partial',unreadable:0}]}),/missing its incomplete-song count/);
  assert.throws(()=>validateAccountSnapshot({...base,version:3}),/completed/);
});

test('backup and restore retain incomplete-collection warnings and the previously saved tracks',async()=>{
  globalThis.localStorage=storageMock();const store=await import('../js/store.js');
  const previous=await readSpotifyAccount(reader({likes:[song(1),song(2)],playlists:[[song(1),song(2)]]}));previous.capturedAt=1;
  const incoming=await readSpotifyAccount(reader({likes:[sparse(1)],playlists:[[sparse(1)]]}));incoming.capturedAt=2;
  store.setSpotifyAccount(previous);store.setSpotifyAccount(incoming);
  const saved=store.getSpotifyAccount(),backup=JSON.parse(JSON.stringify(store.exportData()));localStorage.clear();
  assert.equal(store.importData(backup).spotifyAccount,'restored');assert.deepEqual(store.getSpotifyAccount(),saved);
  assert.equal(saved.likes.length,2);assert.equal(saved.likesUnreadable,1);assert.equal(saved.playlists[0].tracks.length,2);assert.equal(saved.playlists[0].status,'partial');
});
