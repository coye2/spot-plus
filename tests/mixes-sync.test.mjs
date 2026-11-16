import test from 'node:test';import assert from 'node:assert/strict';
import {topArtists,buildMixes,radioAfter,seeded} from '../js/mixes.js';
import {mergeLibraries,applyShared,validShareCode,newShareCode} from '../js/library-sync.js';
const tr=(id,artist,artistId)=>({id:String(id),title:'Song '+id,artist,artistId});
test('top artists weigh recent listening, likes and skips',()=>{
  const now=Date.now();
  const top=topArtists({history:[{artist:'SZA',ms:60*60000,endedAt:now},{artist:'Drake',ms:30*60000,endedAt:now-200*864e5}],likes:[tr(1,'Drake')],skips:{sza:0,drake:20},now});
  assert.equal(top[0].name,'SZA');assert.ok(!top.some(a=>a.name==='Drake'),'heavily skipped artist dropped');
});
test('daily mixes mix your songs with radio, stay the same all day',async()=>{
  const radio=id=>Array.from({length:30},(_,i)=>tr(id*100+i,i%3?'Other '+(i%5):'Seed '+id));
  const args={history:[],likes:[tr(1,'Seed A'),tr(2,'Seed B')],recent:[],skips:{},findArtist:async n=>({id:n.endsWith('A')?1:2,name:n,picture:''}),artistRadio:async id=>radio(id),now:Date.UTC(2026,10,16,12)};
  const a=await buildMixes(args),b=await buildMixes({...args,now:Date.UTC(2026,10,16,20)});
  assert.equal(a.length,2);assert.equal(a[0].tracks[0].id,b[0].tracks[0].id);assert.ok(a[0].tracks.some(t=>t.id==='1'));
  assert.deepEqual(seeded([1,2,3],5),seeded([1,2,3],5));
});
test('smart radio continues with new, non-skipped songs',async()=>{
  const queue=[tr(1,'A',7)],more=await radioAfter(queue,{artistRadio:async()=>[tr(1,'A',7),tr(2,'B'),tr(3,'Skipped')],findArtist:async()=>null,skips:{skipped:9}});
  assert.deepEqual(more.map(t=>t.id),['2']);
});
test('linking devices combines libraries without losing anything',()=>{
  const m=mergeLibraries({likes:[tr(1,'a')],playlists:[{id:'p1',name:'Mine',tracks:[tr(1,'a')],updated:5}],albums:[],artists:[],folders:[]},
    {likes:[tr(2,'b')],playlists:[{id:'p2',name:'Theirs',tracks:[],updated:3}],albums:[{id:9}],artists:[],folders:[]});
  assert.deepEqual(m.likes.map(t=>t.id).sort(),['1','2']);assert.equal(m.playlists.length,2);assert.equal(m.albums.length,1);
});
test('shared playlists: remote changes apply; local edits are kept and sent back',()=>{
  const local={id:'p',name:'Trip',tracks:[tr(1,'a')],syncedAt:10,updated:10};
  const fromFriend=applyShared(local,{updatedAt:20,name:'Trip',tracks:[tr(1,'a'),tr(2,'b')]});
  assert.deepEqual(fromFriend.playlist.tracks.map(t=>t.id),['1','2']);assert.equal(fromFriend.publish,false);
  const both=applyShared({...local,updated:15,tracks:[tr(1,'a'),tr(3,'c')]},{updatedAt:20,name:'Trip',tracks:[tr(1,'a'),tr(2,'b')]});
  assert.deepEqual(both.playlist.tracks.map(t=>t.id),['1','2','3']);assert.equal(both.publish,true);
  assert.ok(validShareCode(newShareCode()));
});
