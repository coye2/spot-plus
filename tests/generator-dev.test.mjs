import test from 'node:test';import assert from 'node:assert/strict';
import {generate,spreadArtists,suggestName,DEFAULTS} from '../js/generator.js';
import {profileFromInvite} from '../canvas-bridge/dev-profile.js';
const tr=(id,artist,rank=0,explicit=false)=>({id:String(id),title:'Song '+id,artist,artistId:artist.length,rank,explicit});
const api={findArtist:async n=>({id:1,name:n}),artistTop:async()=>[tr(1,'Seed',900),tr(2,'Seed',800),tr(3,'Seed',700)],
  artistRadio:async()=>Array.from({length:40},(_,i)=>tr(100+i,'Other '+(i%10),i*10,i%7===0)),genreArtists:async()=>[],vibeTracks:async()=>[tr(100,'Other 0'),tr(101,'Other 1')]};
test('generator respects length, clean-only and songs-per-artist',async()=>{
  const r=await generate({...DEFAULTS,useTaste:false,artists:[{id:1,name:'Seed'}],length:15,perArtist:1,clean:true},api,{},42);
  assert.equal(r.tracks.length,11,'11 different artists available');
  assert.ok(r.tracks.every(t=>!t.explicit));
  const per=new Map();r.tracks.forEach(t=>per.set(t.artist,(per.get(t.artist)||0)+1));assert.ok([...per.values()].every(n=>n===1));
  assert.equal(r.name,'Mix with Seed');
});
test('vibes push matching songs up; names describe the choices',async()=>{
  const r=await generate({...DEFAULTS,useTaste:false,artists:[{id:1,name:'Seed'}],vibes:['chill'],length:5,perArtist:0},api,{},7);
  assert.ok(r.tracks.some(t=>t.id==='100'||t.id==='101'));
  assert.equal(suggestName({...DEFAULTS,vibes:['chill'],genres:[{name:'R&B'}],artists:[]}),'Chill R&B Mix');
  const spread=spreadArtists([tr(1,'A'),tr(2,'A'),tr(3,'B'),tr(4,'B')]);for(let i=1;i<spread.length;i++)assert.notEqual(spread[i].artist,spread[i-1].artist);
});
test('dev credits read the inviter from the public invite',()=>{
  const p=profileFromInvite({inviter:{id:'1148833893470982246',username:'vibecodegod',global_name:'Coye',avatar:'a_178b691eb82b7f109ac5777dd55d680d'},guild:{name:'Spot+ Official'},approximate_member_count:9});
  assert.match(p.avatar,/\.gif\?size=256$/);assert.equal(p.members,9);assert.equal(p.name,'Coye');
  assert.equal(profileFromInvite({inviter:{id:'x',avatar:'<script>'}}).avatar,'');
});
