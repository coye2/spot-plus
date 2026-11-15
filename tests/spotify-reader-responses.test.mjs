import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {COMPANION_VERSION,readSpotifyAccount,readSpotifyTrack} from '../js/spotify-reader.js';
import {COMPANION_VERSION as setupVersion} from '../js/account-setup.js';

// Independently written minimal responses matching the public Spotify recordings:
// sonic-liberation/spotube-plugin-spotify, commit 3d1e83b74dce0ba8495f81c083d51d447d09c729,
// spotify_gql_client/src/commonTest/resources/{librarySavedTracks,libraryPlaylists,
// libraryAlbums,libraryArtists,fetchPlaylist}_200.json. No real account data is copied.
const id='0123456789ABCDEFGHIJKL';
const second='1123456789ABCDEFGHIJKL';
const uri=(type,value=id)=>'spotify:'+type+':'+value;
const track=()=>({__typename:'Track',name:'Test song',artists:{items:[{profile:{name:'Test artist'}}]},albumOfTrack:{name:'Test album',coverArt:{sources:[{url:'https://i.scdn.co/image/test'}]}},duration:{totalMilliseconds:180000}});
const liked=(value=id)=>({__typename:'UserLibraryTrackResponse',track:{_uri:uri('track',value),data:track()}});
const page=(items=[],totalCount=items.length,offset=0)=>({items,totalCount,pagingInfo:{offset,limit:50}});
const likesResponse=p=>({data:{me:{library:{tracks:p}}}});
const libraryResponse=p=>({data:{me:{libraryV3:p}}});
const entity=(type,extra={})=>({item:{_uri:uri(type),data:{__typename:type[0].toUpperCase()+type.slice(1),uri:uri(type),name:'Test '+type,...extra}}});
function queryWith(overrides={}) {
  return async(name,variables)=>{
    if(overrides[name])return overrides[name](variables);
    if(name==='profileAttributes')return {data:{me:{profile:{username:'fixture-user',name:'Fixture user'}}}};
    if(name==='fetchLibraryTracks')return likesResponse(page());
    if(name==='libraryV3')return libraryResponse(page());
    if(name==='fetchPlaylist')return {data:{playlistV2:{content:page()}}};
    throw new Error('Unexpected query '+name);
  };
}

test('recorded response shapes read nested Liked Songs, paginated tracks and all library sections',async()=>{
  const offsets=[];
  const result=await readSpotifyAccount(queryWith({
    fetchLibraryTracks:({offset})=>{
      offsets.push(offset);
      return likesResponse(page([liked(offset?second:id)],2,offset));
    },
    libraryV3:({filters})=>{
      const groups={
        Playlists:[{item:{_uri:'spotify:collection:tracks',data:{__typename:'PseudoPlaylist',name:'Liked Songs'}}},entity('playlist')],
        Albums:[entity('album',{coverArt:{sources:[{url:'https://i.scdn.co/image/album'}]}})],
        Artists:[entity('artist',{name:undefined,profile:{name:'Test artist'},visuals:{avatarImage:{sources:[{url:'https://i.scdn.co/image/artist'}]}}})]
      };
      return libraryResponse(page(groups[filters[0]]));
    },
    fetchPlaylist:()=>({data:{playlistV2:{content:page([{itemV2:{data:{...track(),uri:uri('track'),duration:undefined,trackDuration:{totalMilliseconds:210000}}}}])}}})
  }));
  assert.deepEqual(offsets,[0,1]);
  assert.deepEqual(result.likes.map(t=>t.spotifyId),[id,second]);
  assert.equal(result.likes[0].duration,180);
  assert.equal(result.playlists.length,1);
  assert.equal(result.playlists[0].tracks[0].duration,210);
  assert.equal(result.albums[0].cover,'https://i.scdn.co/image/album');
  assert.equal(result.artists[0].title,'Test artist');
  assert.equal(result.artists[0].cover,'https://i.scdn.co/image/artist');
  assert.equal(result.skipped,0);
});

test('older direct Liked Songs pages remain supported',async()=>{
  const result=await readSpotifyAccount(queryWith({fetchLibraryTracks:()=>({data:{me:{library:page([{track:{data:{...track(),uri:uri('track')}}}])}}})}));
  assert.equal(result.likes[0].spotifyId,id);
});

test('track IDs can live on the response wrapper without accepting non-track IDs',()=>{
  assert.equal(readSpotifyTrack(liked()).spotifyId,id);
  assert.equal(readSpotifyTrack({track:{uri:uri('track'),data:track()}}).spotifyId,id);
  assert.equal(readSpotifyTrack({itemV2:{data:{...track(),uri:uri('track')}}}).spotifyId,id);
  assert.equal(readSpotifyTrack({track:{_uri:uri('track'),data:{...track(),uri:uri('episode')}}}),null);
});

test('malformed nested pages never fall back to an empty legacy library or finish a partial read',async()=>{
  for(const tracks of [null,{}, {items:[]}, {items:[],totalCount:1}]){
    await assert.rejects(readSpotifyAccount(queryWith({fetchLibraryTracks:()=>({data:{me:{library:{...page(),tracks}}}})})),/Liked Songs|incomplete/);
  }
  await assert.rejects(readSpotifyAccount(queryWith({fetchLibraryTracks:({offset})=>likesResponse(offset?page([],2,offset):page([liked()],2))})),/incomplete/);
});

test('broken song metadata aborts a transfer while unsupported media are counted',async()=>{
  await assert.rejects(readSpotifyAccount(queryWith({fetchLibraryTracks:()=>likesResponse(page([{track:{_uri:uri('track'),data:{__typename:'Track',name:'Missing artists'}}}]))})),/Could not read a song in Liked Songs/);
  const result=await readSpotifyAccount(queryWith({fetchLibraryTracks:()=>likesResponse(page([
    liked(),{track:{_uri:uri('episode'),data:{__typename:'Episode'}}},
    {track:{_uri:uri('track',second),data:{__typename:'NotFound'}}}
  ]))}));
  assert.equal(result.likes.length,1);
  assert.equal(result.skipped,2);
});

test('schema errors identify the failing section or playlist',async()=>{
  await assert.rejects(readSpotifyAccount(queryWith({libraryV3:()=>libraryResponse({})})),/Could not read playlists/);
  await assert.rejects(readSpotifyAccount(queryWith({
    libraryV3:({filters})=>libraryResponse(page(filters[0]==='Playlists'?[entity('playlist')]:[])),
    fetchPlaylist:()=>({data:{playlistV2:{content:{}}}})
  })),/Could not read playlist “Test playlist”/);
});

test('installed helper, update metadata and setup page publish the same version',async()=>{
  assert.equal(COMPANION_VERSION,setupVersion);
  for(const file of ['spotplus-spotify.user.js','spotplus-spotify.meta.js']){
    const source=await readFile(new URL('../js/'+file,import.meta.url),'utf8');
    assert.equal(source.match(/^\/\/ @version\s+(\S+)/m)?.[1],COMPANION_VERSION);
    if(file.endsWith('.user.js'))assert.ok(source.includes("version.textContent='Helper '+COMPANION_VERSION"));
  }
});
