import test from 'node:test';
import assert from 'node:assert/strict';
import {readSpotifyStats,readWebTrack,STATS_PATHS} from '../js/spotify-reader.js';
import {validateStats,mergeAccountSnapshot} from '../js/spotify-account.js';
import {spotifyTop,spotifyGenres,recentPlaysAsHistory,topTracks,streaks} from '../js/stats-api.js';

const sid=i=>('T'.repeat(21)+String.fromCharCode(65+i));
const aid=i=>('A'.repeat(21)+String.fromCharCode(65+i));
const webTrack=i=>({id:sid(i),name:'Song '+i,duration_ms:200000,artists:[{name:'Artist '+i},{name:'Guest'}],album:{name:'Album',images:[{url:'https://i.scdn.co/image/abc'+i}]}});
const webArtist=(i,genres)=>({id:aid(i),name:'Artist '+i,genres,images:[{url:'https://i.scdn.co/image/a'+i}]});

function fakeApi(order){
  const calls=[];
  const get=async path=>{
    calls.push(path);
    if(path.includes('/top/tracks'))return {items:order.map(webTrack)};
    if(path.includes('/top/artists'))return {items:[webArtist(0,['indie pop','pop']),webArtist(1,['pop'])]};
    if(path.includes('recently-played'))return {items:[{track:webTrack(5),played_at:'2026-11-14T20:00:00Z'},{track:{id:'bad'},played_at:'x'}]};
    throw new Error('unexpected '+path);
  };
  return {get,calls};
}
const account=stats=>({app:'spotplus-account',version:2,complete:true,account:{id:'me'},capturedAt:stats?.capturedAt??3000,likes:[],playlists:[],albums:[],artists:[],stats});

test('reads all three ranges and recent plays from allowlisted GET paths', async()=>{
  const {get,calls}=fakeApi([0,1,2]);
  const stats=await readSpotifyStats(get);
  assert.deepEqual(Object.keys(stats.top),['short_term','medium_term','long_term']);
  assert.equal(calls.length,7);
  assert.ok(calls.every(p=>/^\/v1\/me\/(top\/(tracks|artists)\?time_range=\w+_term&limit=50|player\/recently-played\?limit=50)$/.test(p)));
  assert.equal(stats.top.short_term.tracks[0].artist,'Artist 0, Guest');
  assert.equal(stats.recent.length,1);
  assert.equal(stats.recent[0].playedAt,Date.parse('2026-11-14T20:00:00Z'));
  assert.equal(STATS_PATHS.recent(),'/v1/me/player/recently-played?limit=50');
});

test('web track parsing rejects unsafe or incomplete items', ()=>{
  assert.equal(readWebTrack({id:'short',name:'x',artists:[{name:'y'}]}),null);
  assert.equal(readWebTrack({...webTrack(1),album:{images:[{url:'https://evil.example/x.jpg'}]}}).cover,'');
});

test('validated stats survive the account snapshot and ranks show movement', async()=>{
  const first=await readSpotifyStats(fakeApi([0,1,2]).get);first.capturedAt=1000;
  const second=await readSpotifyStats(fakeApi([2,0,3]).get);second.capturedAt=2000;
  const saved=mergeAccountSnapshot(null,account(first));
  assert.ok(saved.stats);assert.equal(spotifyTop(saved)[0].change,null);
  const next=mergeAccountSnapshot(saved,{...account(second),capturedAt:2000});
  const ranked=spotifyTop(next,{range:'short_term',kind:'tracks'});
  assert.deepEqual(ranked.map(t=>t.change),[2,-1,'new']);
  // A refresh without stats keeps the last good stats.
  const kept=mergeAccountSnapshot(next,{...account(null),capturedAt:3000,statsError:'Spotify stats unavailable (429).'});
  assert.equal(kept.stats.capturedAt,2000);
});

test('invalid stats are dropped instead of failing the library', ()=>{
  assert.equal(validateStats({capturedAt:1,top:{short_term:{tracks:[]}}}),null);
  assert.equal(validateStats('nope'),null);
});

test('genres are weighted by artist rank', async()=>{
  const stats=await readSpotifyStats(fakeApi([0]).get);
  const g=spotifyGenres(account(validateStats(stats)));
  assert.equal(g[0].name,'pop');assert.ok(g[0].share>g[1].share);
});

test('recent plays become deduplicated Rewind history', async()=>{
  const stats=validateStats(await readSpotifyStats(fakeApi([0]).get));
  const rows=recentPlaysAsHistory(account(stats));
  assert.equal(rows.length,1);assert.equal(rows[0].source,'spotify');assert.match(rows[0].id,/^recent:/);
  assert.equal(topTracks(rows,{range:'long'})[0].title,'Song 5');
  assert.equal(streaks(rows).longest,1);
});
