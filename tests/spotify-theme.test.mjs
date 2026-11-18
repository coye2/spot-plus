import test from 'node:test';
import assert from 'node:assert/strict';
import {zipSync,strToU8} from '../js/vendor/fflate.js';
import {parseSpotifyLink} from '../js/spotify.js';
import {readSpotifyArchive,normalizeSpotifyDocuments} from '../js/spotify-import.js';
import {palette,contrast,presets,normalizeTheme,themeMode} from '../js/themes.js';
const id='1234567890123456789012';
const saved={tracks:[{track:'Song',artist:'Artist',album:'Album',uri:'spotify:track:'+id}]};
const playlist={playlists:[{name:'My music',items:[{track:{trackName:'Song',artistName:'Artist',trackUri:'spotify:track:'+id}},{episode:{name:'A podcast'}}]}]};
test('Spotify links accept official URLs and reject deceptive hosts and paths',()=>{
  assert.deepEqual(parseSpotifyLink('https://open.spotify.com/playlist/'+id+'?si=abc'),{type:'playlist',id});
  assert.deepEqual(parseSpotifyLink('spotify:artist:'+id),{type:'artist',id});
  for(const bad of ['https://open.spotify.com.evil.test/playlist/'+id,'https://evil.test/'+id,'javascript:alert(1)','https://open.spotify.com/playlist/'+id+'/extra'])assert.equal(parseSpotifyLink(bad),null);
});
test('Spotify ZIP reads only music files and preserves stable IDs without importing episodes',()=>{
  const zip=zipSync({'Spotify/YourLibrary.json':strToU8(JSON.stringify(saved)),'Spotify/Playlist1.json':strToU8(JSON.stringify(playlist)),'Spotify/Account.json':strToU8('not even valid JSON')});
  const result=readSpotifyArchive(zip,'account.zip');
  assert.equal(result.likes[0].id,'spotify:'+id);assert.equal(result.playlists[0].tracks.length,1);
  assert.equal(result.playlists[0].tracks[0].id,result.likes[0].id);
  assert.equal(result.playlists[0].tracks[0].provider,'spotify-import');
});
test('PowerShell music-only export is compatible and repeated likes deduplicate',()=>{
  const prepared={app:'spotplus-spotify-export',documents:[{data:saved},{data:saved},{data:playlist}]};
  const result=readSpotifyArchive(strToU8(JSON.stringify(prepared)),'prepared.json');
  assert.equal(result.likes.length,1);assert.equal(result.playlists.length,1);
  assert.throws(()=>normalizeSpotifyDocuments([{data:{account:'private'}}]),/No Spotify/);
});
test('Every preset and extreme custom colors have readable accent text and button labels',()=>{
  for(const setting of [...presets.map(p=>({themePreset:p.id})),{themeCustom:{accent:'#ffffff',raised:'#ffffff',surface:'#ffffff'}},{themeCustom:{accent:'#000000',raised:'#ffffff'}}]){
    const p=palette(setting);assert.ok(contrast(p.accentText,p.raised)>=4.5);assert.ok(contrast(p.accent,p.ink)>=4.5);
  }
  assert.equal(palette().accent,'#1b5e46');assert.equal(palette().canvas,'#000000');
});
test('Clear is a transparent mode that keeps light text on a dark palette',()=>{
  assert.equal(themeMode({themeMode:'clear'}),'dark');
  assert.equal(palette({themeMode:'clear'}).mode,'dark');
  assert.equal(palette({themeMode:'clear'}).text,'#ffffff');
  const theme=normalizeTheme({app:'spotplus-theme',settings:{themeMode:'clear',themeCustom:{accent:'#1b5e46',surface:'#090e0b',raised:'#15231b'}}});
  assert.equal(theme.themeMode,'clear');
});
test('Theme imports whitelist appearance and reject executable color values',()=>{
  const theme=normalizeTheme({app:'spotplus-theme',settings:{source:'evil',themeCustom:{accent:'#1b5e46',surface:'#090e0b',raised:'#15231b'},cornerRadius:999,coverStyle:'evil'}});
  assert.equal(theme.source,undefined);assert.equal(theme.cornerRadius,24);assert.equal(theme.coverStyle,'square');
  assert.throws(()=>normalizeTheme({app:'spotplus-theme',settings:{themeCustom:{accent:'url(evil)'}}}),/invalid color/);
});

test('theme round trips preserve layout preferences without importing unknown nested settings',()=>{
  const settings={themePreset:'pine',themeCustom:{accent:'#1b5e46',surface:'#090e0b',raised:'#15231b',source:'untrusted'},amoled:true,cornerRadius:12,coverStyle:'disc',density:'compact',textSize:'large',motion:'reduced'};
  const result=normalizeTheme(JSON.parse(JSON.stringify({app:'spotplus-theme',settings})));
  assert.deepEqual(result,{...settings,themeCustom:{accent:'#1b5e46',surface:'#090e0b',raised:'#15231b'}});
  const legacy=normalizeTheme({app:'spotplus-theme',settings:{themeCustom:settings.themeCustom,density:'invalid',motion:'always'}});
  for(const key of ['density','textSize','motion'])assert.equal(Object.hasOwn(legacy,key),false);
});
