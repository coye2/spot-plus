import test from 'node:test';
import assert from 'node:assert/strict';
import {storageMock} from './helpers.mjs';
import {normalizeFolders,mergeFolders} from '../js/folders.js';
import {libraryItems} from '../js/library.js';
globalThis.localStorage=storageMock();
const store=await import('../js/store.js');
const data=()=>({likes:[],downloads:[],localFiles:[],albums:[],artists:[],playlists:store.getPlaylists(),folders:store.getFolders(),spotifyLinks:store.getSpotifyLinks()});

test('moving between folders and removing a folder preserves playlists and songs',()=>{
  localStorage.clear();const p=store.createPlaylist('Night drive',[{id:'song',title:'Song'}]);
  const a=store.createFolder('Evenings'),b=store.createFolder('On the road');
  store.moveToFolder(p.id,a.id);store.moveToFolder(p.id,b.id);
  assert.deepEqual(store.getFolder(a.id).items,[]);assert.deepEqual(store.getFolder(b.id).items,[p.id]);
  assert.equal(libraryItems(data()).some(x=>x.id===p.id),false);
  assert.equal(libraryItems(data(),{folderId:b.id})[0].route,'#/my/'+p.id);
  store.renameFolder(b.id,'Travel');assert.equal(store.getFolder(b.id).name,'Travel');
  store.deleteFolder(b.id);assert.equal(libraryItems(data()).some(x=>x.id===p.id),true);
  assert.equal(store.getPlaylist(p.id).tracks[0].id,'song');
});

test('library search finds grouped playlists and folder counts exclude unavailable members',()=>{
  localStorage.clear();const p=store.createPlaylist('Night drive'),f=store.createFolder('Evenings');store.moveToFolder(p.id,f.id);
  const result=libraryItems(data(),{query:'night'});assert.equal(result[0].folderName,'Evenings');assert.equal(result[0].id,p.id);
  assert.equal(libraryItems(data(),{query:'evenings'}).length,2);
  assert.equal(libraryItems(data(),{folderId:f.id,query:'evenings'}).length,0);
  assert.equal(libraryItems(data(),{folderId:f.id,query:'night'}).length,1);
  assert.equal(libraryItems(data(),{filter:'artists'}).length,0);
  assert.equal(libraryItems(data()).find(x=>x.id===f.id).subtitle,'Folder · 1 playlist');
  store.deletePlaylist(p.id);assert.equal(libraryItems(data()).find(x=>x.id===f.id).subtitle,'Folder · 0 playlists');
});

test('folder backup restores organization and preserves existing membership on merge',()=>{
  localStorage.clear();const p=store.createPlaylist('Music'),a=store.createFolder('Original');store.moveToFolder(p.id,a.id);
  const backup=JSON.parse(JSON.stringify(store.exportData()));localStorage.clear();store.importData(backup);
  assert.deepEqual(store.getFolder(a.id).items,[p.id]);assert.ok(store.getPlaylist(p.id));
  const b=store.createFolder('Current');store.moveToFolder(p.id,b.id);store.importData(backup);
  assert.deepEqual(store.getFolder(b.id).items,[p.id]);assert.deepEqual(store.getFolder(a.id).items,[]);
  store.importData({app:'spotplus',version:1});assert.ok(store.getFolder(b.id));
});

test('invalid moves and storage failures leave folder membership unchanged',()=>{
  localStorage.clear();const p=store.createPlaylist('Keep me'),a=store.createFolder('A'),b=store.createFolder('B');store.moveToFolder(p.id,a.id);
  assert.throws(()=>store.moveToFolder(p.id,'missing'),/no longer exists/);
  assert.throws(()=>store.moveToFolder('unknown-playlist',b.id),/no longer in your library/);
  const set=localStorage.setItem;localStorage.setItem=()=>{throw new Error('quota');};
  try{assert.throws(()=>store.moveToFolder(p.id,b.id),/storage is full/);}finally{localStorage.setItem=set;}
  assert.deepEqual(store.getFolder(a.id).items,[p.id]);assert.deepEqual(store.getFolder(b.id).items,[]);
});

test('Spotify playlist links can be grouped without changing Spotify metadata',()=>{
  localStorage.clear();const id='0123456789ABCDEFGHIJKL';store.saveSpotifyLink({id,type:'playlist',title:'Official playlist',saved:1});
  const f=store.createFolder('Spotify');const before=JSON.stringify(store.getSpotifyLinks());store.moveToFolder('spotify-'+id,f.id);
  assert.equal(libraryItems(data(),{folderId:f.id})[0].route,'#/spotify/playlist/'+id);
  assert.equal(JSON.stringify(store.getSpotifyLinks()),before);store.moveToFolder('spotify-'+id);
  assert.equal(libraryItems(data()).some(x=>x.id==='spotify-'+id),true);
});

test('folder imports sanitize metadata and prevent duplicate assignment or folder nesting',()=>{
  const clean=normalizeFolders([{id:'folderA',name:'  A  ',items:['pl1','pl1','folderB',{},null],token:'secret'},{id:'folderB',name:'B',items:['pl1','pl2']}]);
  assert.deepEqual(clean.map(f=>f.items),[['pl1'],['pl2']]);assert.equal(clean[0].name,'A');assert.equal(clean[0].token,undefined);
  assert.equal(normalizeFolders([{id:'../folder',name:'Bad',items:[]}]).length,0);
  const merged=mergeFolders(clean,[{id:'folderA',name:'Old name',items:['pl3']}]);assert.equal(merged[0].name,'A');assert.deepEqual(merged[0].items,['pl1','pl3']);
});
