import test from 'node:test';
import assert from 'node:assert/strict';
import {storageMock} from './helpers.mjs';
globalThis.localStorage=storageMock();
const store=await import('../js/store.js');
test('v1 settings survive additive migration and persist new preferences',()=>{
 localStorage.setItem('spotplus.settings',JSON.stringify({source:'piped',customPiped:'https://example.com',quality:'low'}));
 assert.equal(store.getSettings().source,'piped');assert.equal(store.getSettings().density,'comfortable');
 store.setSettings({density:'compact',djVoice:true});assert.equal(store.getSettings().customPiped,'https://example.com');assert.equal(store.getSettings().density,'compact');
});
test('likes compare numeric and string IDs and publish the updated state',()=>{
 localStorage.setItem('spotplus.likes',JSON.stringify([{id:'42',title:'Existing'}]));
 let observed;store.onChange(key=>{if(key==='likes')observed=store.isLiked(42);});
 assert.equal(store.toggleLike({id:42,title:'Existing'}),false);assert.equal(observed,false);
 assert.equal(store.toggleLike({id:42,title:'Existing'}),true);assert.equal(observed,true);assert.equal(store.getLikes().length,1);
});
test('backup merge preserves current likes, playlists, saved albums and settings',()=>{
 const pl=store.createPlaylist('Keep me',[{id:'a',title:'Song A'}]);store.toggleAlbum({id:7,title:'Album'});
 store.importData({app:'spotplus',version:1,likes:[{id:'b',title:'Song B'}],playlists:[{id:'import',name:'Imported',tracks:[{id:3,title:'Three'}]}],settings:{quality:'high'}});
 assert.ok(store.getPlaylist(pl.id));assert.equal(store.getPlaylist('import').tracks[0].id,'3');assert.equal(store.getLikes().length,2);assert.ok(store.hasAlbum(7));assert.equal(store.getSettings().density,'compact');assert.equal(store.exportData().version,2);
});
test('library pins, artist following and album saves persist',()=>{store.togglePin('liked');assert.ok(store.getPins().includes('liked'));store.toggleArtist({id:4,name:'Artist'});assert.ok(store.hasArtist(4));store.toggleArtist({id:4,name:'Artist'});assert.equal(store.hasArtist(4),false);});
test('storage failures propagate instead of reporting false success',()=>{const previous=localStorage.setItem;localStorage.setItem=()=>{throw new Error('QuotaExceededError');};assert.throws(()=>store.createPlaylist('Not stored'),/storage is full/);localStorage.setItem=previous;});
