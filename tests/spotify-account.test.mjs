import test from 'node:test';
import assert from 'node:assert/strict';
import {readAllPages,readSpotifyAccount,readSpotifyTrack} from '../js/spotify-reader.js';
import {validateAccountSnapshot,mergeAccountSnapshot,isAccountMessage} from '../js/spotify-account.js';
import {storageMock} from './helpers.mjs';
const id='0123456789ABCDEFGHIJKL';
const rawTrack={uri:'spotify:track:'+id,name:'Anyone',artists:{items:[{profile:{name:'Justin Bieber'}}]},albumOfTrack:{name:'Justice',coverArt:{sources:[{url:'https://i.scdn.co/image/test'}]}},duration:{totalMilliseconds:190000},contentRating:{label:'EXPLICIT'}};
const song=readSpotifyTrack(rawTrack);
const snapshot=()=>({app:'spotplus-account',version:1,complete:true,account:{id:'test-user',name:'Test library'},capturedAt:1000,likes:[song],playlists:[{id,title:'My private playlist',tracks:[song],status:'ready'}],albums:[],artists:[],skipped:0});

test('account reader follows pagination and rejects truncation, repeated pages and changing counts',async()=>{
  assert.deepEqual(await readAllPages(async offset=>({items:[offset],totalCount:3}),{limit:1}),[0,1,2]);
  await assert.rejects(readAllPages(async()=>({items:[],totalCount:1})),/incomplete/);
  await assert.rejects(readAllPages(async()=>({items:['same'],totalCount:2})),/repeated/);
  await assert.rejects(readAllPages(async offset=>({items:[offset],totalCount:offset?3:2})),/changed during/);
  await assert.rejects(readAllPages(async()=>({items:[],totalCount:20001})),/too large/);
});
test('connector handles a full free-account-shaped library, preserves duplicates, and whitelists exported data',async()=>{
  const query=async(name,variables)=>{
    if(name==='profileAttributes')return {data:{me:{profile:{username:'free-user',name:'Free user',accessToken:'must-not-export'}}}};
    if(name==='fetchLibraryTracks')return {data:{me:{library:{items:[{track:{data:rawTrack}},{track:{data:{uri:'spotify:episode:'+id}}}],totalCount:2}}}};
    if(name==='libraryV3')return {data:{me:{libraryV3:{items:variables.filters[0]==='Playlists'?[{item:{data:{uri:'spotify:playlist:'+id,name:'Private'}}}]:[],totalCount:variables.filters[0]==='Playlists'?1:0}}}};
    return {data:{playlistV2:{content:{items:[{itemV2:{data:rawTrack},uid:'one'},{itemV2:{data:rawTrack},uid:'two'}],totalCount:2}}}};
  };
  const result=await readSpotifyAccount(query);
  assert.equal(result.complete,true);assert.equal(result.likes.length,1);assert.equal(result.playlists[0].tracks.length,2);assert.equal(result.skipped,1);assert.equal(JSON.stringify(result).includes('must-not-export'),false);
});
test('a profile switch or unreadable collection aborts the whole library transfer',async()=>{
  let calls=0;
  const query=async(name)=>name==='profileAttributes'?{data:{me:{profile:{username:++calls===1?'a':'b'}}}}:{data:{me:{library:{items:[],totalCount:0},libraryV3:{items:[],totalCount:0}}}};
  await assert.rejects(readSpotifyAccount(query),/account changed/);
  await assert.rejects(readSpotifyAccount(async name=>name==='profileAttributes'?{data:{me:{profile:{username:'a'}}}}:{errors:[{}]}),/changed its library response/);
});
test('snapshot validation strips unknown account fields and unsafe image URLs, rejects incomplete snapshots',()=>{
  const raw=snapshot();raw.account.token='secret';raw.cookies=['secret'];raw.likes[0]={...song,cover:'https://attacker.example/pixel',preview:'javascript:alert(1)'};
  const clean=validateAccountSnapshot(raw);assert.equal(JSON.stringify(clean).includes('secret'),false);assert.equal(clean.likes[0].cover,'');assert.equal(clean.likes[0].preview,undefined);
  assert.throws(()=>validateAccountSnapshot({...raw,complete:false}),/completed/);
  assert.throws(()=>validateAccountSnapshot({...raw,playlists:[{id,status:'ready'}]}),/incomplete/);
});
test('refresh reflects removals, keeps an unavailable playlist copy, and refuses older snapshots',()=>{
  const old=snapshot(),fresh={...snapshot(),capturedAt:2000,likes:[],playlists:[{id,title:'Private',status:'unavailable',tracks:[]}]};
  const result=mergeAccountSnapshot(old,fresh);assert.equal(result.likes.length,0);assert.equal(result.playlists[0].tracks.length,1);assert.equal(result.playlists[0].status,'unavailable');
  assert.equal(mergeAccountSnapshot(old,{...fresh,playlists:[]}).playlists.length,0);
  assert.throws(()=>mergeAccountSnapshot(fresh,old),/older/);
  assert.equal(mergeAccountSnapshot(old,{...fresh,account:{id:'another',name:'Another'}}).playlists[0].tracks.length,0);
});
test('tab transfer requires Spotify origin, the exact opened window, an unexpired nonce and expected message',()=>{
  const win={},pending={window:win,nonce:'abc',started:Date.now()},event={origin:'https://open.spotify.com',source:win,data:{type:'spotplus-library',nonce:'abc'}};
  assert.equal(isAccountMessage(event,pending),true);
  for(const mutation of [{origin:'https://open.spotify.com.evil.test'},{source:{}},{data:{type:'spotplus-library',nonce:'wrong'}}])assert.equal(isAccountMessage({...event,...mutation},pending),false);
  assert.equal(isAccountMessage(event,{...pending,started:0}),false);
});
test('saving an account copy preserves local music and a failed write preserves the previous account copy',async()=>{
  globalThis.localStorage=storageMock();const store=await import('../js/store.js');
  const local=store.createPlaylist('Local',[{id:'local',title:'Local song'}]);store.setSpotifyAccount(snapshot());
  store.setSpotifyAccount({...snapshot(),capturedAt:2000,likes:[]});assert.equal(store.getPlaylist(local.id).tracks[0].id,'local');
  const original=localStorage.setItem;localStorage.setItem=()=>{throw new Error('QuotaExceededError');};
  assert.throws(()=>store.setSpotifyAccount({...snapshot(),capturedAt:3000}),/storage is full/);localStorage.setItem=original;
  assert.equal(store.getSpotifyAccount().capturedAt,2000);store.clearSpotifyAccount();assert.ok(store.getPlaylist(local.id));assert.equal(store.getSpotifyAccount(),null);
});

test('general backup restores a sanitized Spotify library copy on a new device',async()=>{
  globalThis.localStorage=storageMock();const store=await import('../js/store.js');
  const account=snapshot();account.account.token='never-copy';store.setSpotifyAccount(account);
  const playlist=store.createPlaylist('Local music',[{id:'local-song',title:'Local song'}]);
  store.setSettings({density:'compact'});const backup=JSON.parse(JSON.stringify(store.exportData()));
  assert.equal(JSON.stringify(backup).includes('never-copy'),false);localStorage.clear();
  assert.equal(store.importData(backup).spotifyAccount,'restored');
  assert.equal(store.getSpotifyAccount().account.id,'test-user');
  assert.equal(store.getSpotifyAccount().playlists[0].tracks.length,1);
  assert.ok(store.getPlaylist(playlist.id));assert.equal(store.getSettings().density,'compact');
});

test('backup import preserves a newer Spotify copy or a different signed-in account',async()=>{
  globalThis.localStorage=storageMock();const store=await import('../js/store.js');
  store.setSpotifyAccount({...snapshot(),capturedAt:3000,likes:[]});
  const backup={app:'spotplus',spotifyAccount:snapshot(),likes:[{id:'from-backup',title:'Song'}]};
  assert.equal(store.importData(backup).spotifyAccount,'newer-copy-kept');
  assert.equal(store.getSpotifyAccount().capturedAt,3000);assert.equal(store.getSpotifyAccount().likes.length,0);
  assert.ok(store.getLikes().some(t=>t.id==='from-backup'));
  backup.spotifyAccount={...snapshot(),capturedAt:4000,account:{id:'another-user',name:'Someone else'}};
  assert.equal(store.importData(backup).spotifyAccount,'different-account-kept');
  assert.equal(store.getSpotifyAccount().account.id,'test-user');
  assert.equal(store.importData({app:'spotplus',version:1}).spotifyAccount,'none');
  assert.equal(store.getSpotifyAccount().capturedAt,3000);
});

test('an invalid Spotify backup cannot partially modify existing library data',async()=>{
  globalThis.localStorage=storageMock();const store=await import('../js/store.js');
  const local=store.createPlaylist('Keep this',[{id:'keep',title:'Keep'}]);
  store.setSpotifyAccount(snapshot());const before=JSON.stringify(store.exportData().spotifyAccount);
  assert.throws(()=>store.importData({app:'spotplus',spotifyAccount:{...snapshot(),complete:false},likes:[{id:'not-imported'}]}),/completed/);
  assert.equal(JSON.stringify(store.getSpotifyAccount()),before);assert.ok(store.getPlaylist(local.id));
  assert.equal(store.getLikes().some(t=>t.id==='not-imported'),false);
});
