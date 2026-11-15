import test from 'node:test';
import assert from 'node:assert/strict';
import {encodeLibraryText,decodeLibraryText,isLibraryText,LIBRARY_TEXT_PREFIX} from '../js/spotify-reader.js';
import {setupHtml} from '../js/account-setup.js';

const library={app:'spotplus-account',version:2,complete:true,account:{id:'user'},capturedAt:1,likes:Array.from({length:500},(_,i)=>({spotifyId:'a'.repeat(21)+(i%10),title:'Song '+i,artist:'Artist'})),playlists:[],albums:[],artists:[]};

test('clipboard text round-trips a library and is compressed', async () => {
  const text=await encodeLibraryText(library);
  assert.ok(isLibraryText(text));
  assert.ok(text.startsWith(LIBRARY_TEXT_PREFIX+'gz:'));
  assert.ok(text.length<JSON.stringify(library).length/3);
  assert.deepEqual(await decodeLibraryText(text),library);
});

test('pasted text tolerates line breaks and surrounding spaces', async () => {
  const text=await encodeLibraryText(library);
  const wrapped='  '+text.slice(0,40)+'\n'+text.slice(40)+'\n';
  assert.deepEqual(await decodeLibraryText(wrapped),library);
});

test('clipboard text rejects unrelated, truncated and corrupt input', async () => {
  const text=await encodeLibraryText(library);
  await assert.rejects(decodeLibraryText('https://open.spotify.com'),/Copy for Spot\+/);
  await assert.rejects(decodeLibraryText(text.slice(0,text.length-20)),/incomplete/);
  await assert.rejects(decodeLibraryText(LIBRARY_TEXT_PREFIX+'gz:@@@'),/incomplete/);
  await assert.rejects(decodeLibraryText(LIBRARY_TEXT_PREFIX+'zip:abc'),/incomplete/);
  assert.equal(isLibraryText(null),false);
});

test('uncompressed fallback still decodes', async () => {
  assert.deepEqual(await decodeLibraryText(LIBRARY_TEXT_PREFIX+'json:'+JSON.stringify(library)),library);
});

test('iPhone setup uses the copy and paste handoff', () => {
  const html=setupHtml('iphone');
  assert.match(html,/data-act="account-paste"/);
  assert.match(html,/Copy for Spot\+/);
  assert.doesNotMatch(setupHtml('android'),/account-paste/);
});
