import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {COMPANION_VERSION,readSpotifyAccount,readSpotifyTrack,readSpotifyProfile} from '../js/spotify-reader.js';
import {COMPANION_VERSION as setupVersion,spotifyProfileHtml} from '../js/account-setup.js';
import {validateAccountSnapshot,mergeAccountSnapshot} from '../js/spotify-account.js';

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
    if(name==='getTrack')return {data:{trackUnion:{__typename:'NotFound'}}};
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
  assert.equal(readSpotifyTrack({track:{_uri:uri('track'),data:null}}),null);
});

test('malformed nested pages never fall back to an empty legacy library or finish a partial read',async()=>{
  for(const tracks of [null,{}, {items:[]}, {items:[],totalCount:1}]){
    await assert.rejects(readSpotifyAccount(queryWith({fetchLibraryTracks:()=>({data:{me:{library:{...page(),tracks}}}})})),/Liked Songs|incomplete/);
  }
  await assert.rejects(readSpotifyAccount(queryWith({fetchLibraryTracks:({offset})=>likesResponse(offset?page([],2,offset):page([liked()],2))})),/incomplete/);
});

test('unreadable song metadata marks the collection incomplete while unsupported media are counted separately',async()=>{
  const incomplete=await readSpotifyAccount(queryWith({fetchLibraryTracks:()=>likesResponse(page([{track:{_uri:uri('track'),data:{__typename:'Track',name:'Missing artists'}}}]))}));
  assert.equal(incomplete.likesUnreadable,1);assert.deepEqual(incomplete.likes,[]);assert.equal(incomplete.skipped,0);
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

test('profile response preserves display name and best Spotify photo without exporting private fields',async()=>{
  const profile={username:'fixture user',name:'Fixture listener',uri:'spotify:user:fixture user',email:'never-copy@example.test',accessToken:'never-copy',avatar:{sources:[
    {width:64,url:'https://i.scdn.co/image/small'},
    {width:300,url:'https://i.scdn.co/image/profile'},
    {width:500,url:'https://unsafe.example/photo'}
  ]}};
  const expected={id:'fixture user',name:'Fixture listener',avatar:'https://i.scdn.co/image/profile',externalUrl:'https://open.spotify.com/user/fixture%20user'};
  assert.deepEqual(readSpotifyProfile(profile),expected);
  const account=await readSpotifyAccount(queryWith({profileAttributes:()=>({data:{me:{profile}}})}));
  assert.deepEqual(validateAccountSnapshot(account).account,expected);
  assert.equal(JSON.stringify(account).includes('never-copy'),false);
});

test('profile import validates photos and rebuilds links instead of trusting an imported destination',async()=>{
  const account=await readSpotifyAccount(queryWith());
  account.account={id:'listener/?next=evil',name:'Listener',avatar:'https://i.scdn.co.evil.test/photo',externalUrl:'javascript:alert(1)',email:'private'};
  const clean=validateAccountSnapshot(account).account;
  assert.equal(clean.avatar,'');
  assert.equal(clean.externalUrl,'https://open.spotify.com/user/listener%2F%3Fnext%3Devil');
  assert.equal(clean.email,undefined);
  assert.equal(readSpotifyProfile({username:'legacy'}).avatar,'');
  assert.equal(readSpotifyProfile({username:'legacy',avatar:{sources:{}}}).name,'legacy');
});

test('profile cards escape names and support older accounts with no photo',()=>{
  const html=spotifyProfileHtml({id:'old user',name:'<script>bad</script>',avatar:'javascript:bad',externalUrl:'https://evil.test'});
  assert.ok(html.includes('&lt;script&gt;bad&lt;/script&gt;'));
  assert.ok(html.includes('https://open.spotify.com/user/old%20user'));
  assert.doesNotMatch(html,/<script>|<img|evil\.test|javascript:/);
  assert.equal(spotifyProfileHtml(null),'');
});

// Spotify's HTTP-200 NotFound response is recorded in ralph/Spotifly at d0e592a,
// plans/done/playlist-not-found-answers-500.md. Library tombstones with an outer
// _uri and inner NotFound also appear in sonorahq/sonora at cf394e9, library.rs.
const missingPlaylist={item:{_uri:uri('playlist',second),data:{__typename:'NotFound'}}};
const withPlaylists=items=>({filters})=>libraryResponse(page(filters[0]==='Playlists'?items:[]));

test('unavailable library entries do not become nameless playlists that block the account read',async()=>{
  const calls=[];
  const result=await readSpotifyAccount(queryWith({
    fetchLibraryTracks:()=>likesResponse(page([liked()])),
    libraryV3:withPlaylists([missingPlaylist,entity('playlist')]),
    fetchPlaylist:({uri:requested})=>{calls.push(requested);return {data:{playlistV2:{content:page()}}};}
  }));
  assert.equal(result.likes.length,1);
  assert.deepEqual(calls,[uri('playlist')]);
  assert.equal(result.playlists[0].title,'Unavailable playlist');
  assert.equal(result.playlists[0].status,'unavailable');
  assert.deepEqual(result.playlists[0].tracks,[]);
  assert.equal(result.playlists[1].status,'ready');
});

test('HTTP-200 NotFound and explicit no-view permission preserve the rest of the library',async()=>{
  for(const unavailable of [{__typename:'NotFound'},{__typename:'Playlist',currentUserCapabilities:{canView:false}}]){
    const result=await readSpotifyAccount(queryWith({
      fetchLibraryTracks:()=>likesResponse(page([liked()])),
      libraryV3:withPlaylists([entity('playlist'),{item:{data:{uri:uri('playlist',second),name:'Still available'}}}]),
      fetchPlaylist:({uri:requested})=>({data:{playlistV2:requested===uri('playlist')?unavailable:{content:page()}}})
    }));
    assert.equal(result.likes.length,1);
    assert.equal(result.playlists[0].status,'unavailable');
    assert.equal(result.playlists[1].status,'ready');
    assert.deepEqual(result.playlists[1].tracks,[]); // Genuine empty and unavailable remain distinct.
  }
});

test('a playlist lost between pages discards partial tracks and retains the previous complete copy',async()=>{
  const incoming=await readSpotifyAccount(queryWith({
    libraryV3:withPlaylists([entity('playlist')]),
    fetchPlaylist:({offset})=>({data:{playlistV2:offset?{__typename:'NotFound'}:{content:page([{itemV2:{data:{...track(),uri:uri('track',second)}}}],2)}}})
  }));
  assert.equal(incoming.playlists[0].status,'unavailable');
  assert.deepEqual(incoming.playlists[0].tracks,[]);
  const previous={...incoming,capturedAt:incoming.capturedAt-1,playlists:[{...incoming.playlists[0],status:'ready',tracks:[readSpotifyTrack(liked())]}]};
  assert.deepEqual(mergeAccountSnapshot(previous,incoming).playlists[0].tracks.map(t=>t.spotifyId),[id]);
});

test('unknown, malformed, mismatched and failed playlist reads still abort instead of silently skipping',async()=>{
  for(const value of [null,{}, {__typename:'GenericError'}, {__typename:'NewResponse'}, {content:{}}, {uri:uri('playlist',second),content:page()}]){
    await assert.rejects(readSpotifyAccount(queryWith({libraryV3:withPlaylists([entity('playlist')]),fetchPlaylist:()=>({data:{playlistV2:value}})})),/Could not read playlist|different playlist/);
  }
  for(const message of ['Network failed','Rate limited','Session expired']){
    await assert.rejects(readSpotifyAccount(queryWith({libraryV3:withPlaylists([entity('playlist')]),fetchPlaylist:()=>{throw new Error(message);}})),new RegExp(message));
  }
  await assert.rejects(readSpotifyAccount(queryWith({libraryV3:withPlaylists([entity('playlist')]),fetchPlaylist:()=>({data:{playlistV2:{__typename:'GenericError',message:'private-response-do-not-copy'}}})})),error=>error.message.includes('(GenericError)')&&!error.message.includes('private-response-do-not-copy'));
});

test('an unavailable playlist keeps its previous name, cover, owner and tracks only for the same account',async()=>{
  const incoming=await readSpotifyAccount(queryWith({libraryV3:withPlaylists([missingPlaylist])}));
  const previous={...incoming,capturedAt:incoming.capturedAt-1,playlists:[{id:second,title:'My saved mix',cover:'https://i.scdn.co/image/saved',owner:'Saved owner',status:'ready',tracks:[readSpotifyTrack(liked())]}]};
  const kept=mergeAccountSnapshot(previous,incoming).playlists[0];
  assert.equal(kept.title,'My saved mix');assert.equal(kept.owner,'Saved owner');assert.equal(kept.cover,'https://i.scdn.co/image/saved');assert.equal(kept.tracks.length,1);assert.equal(kept.status,'unavailable');
  const other=mergeAccountSnapshot(previous,{...incoming,account:{id:'different-user'}}).playlists[0];
  assert.equal(other.title,'Unavailable playlist');assert.equal(other.tracks.length,0);assert.equal(other.owner,'');
});

test('retained playlists cannot push a refresh over the total track limit',async()=>{
  const base=await readSpotifyAccount(queryWith());
  const music=readSpotifyTrack(liked());
  const previous={...base,capturedAt:1,playlists:[id,second].map(value=>({id:value,title:'Saved',status:'ready',tracks:Array(10000).fill(music)}))};
  const incoming={...base,capturedAt:2,likes:[music],playlists:previous.playlists.map(p=>({...p,status:'unavailable',tracks:[]}))};
  assert.throws(()=>mergeAccountSnapshot(previous,incoming),/20,000-track/);
  assert.equal(previous.playlists[0].tracks.length,10000);
});
