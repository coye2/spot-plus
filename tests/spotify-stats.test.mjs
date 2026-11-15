import test from 'node:test';import assert from 'node:assert/strict';
import {spotifyStats,publicSpotifyEntity,boundedText} from '../canvas-bridge/spotify-stats.js';
import {matchPlayCount} from '../js/spotify-stats.js';
const artist='1Xyo4u8uXC1ZmMpatF05PJ',track='0VjIjW4GlUZAMYd2vXMi3b';
const entity={uri:'spotify:artist:'+artist,profile:{name:'The Weeknd'},stats:{monthlyListeners:12345},discography:{topTracks:{items:[{track:{uri:'spotify:track:'+track,name:'Blinding Lights',playcount:'987654321',duration:{totalMilliseconds:200000}}}]}}};
const html='<script id="initialState" type="text/plain">'+btoa(JSON.stringify({entities:{items:{['spotify:artist:'+artist]:entity}},privateToken:'never returned'}))+'</script>';
test('public counter adapter returns only whitelisted published data',async()=>{
 assert.deepEqual(publicSpotifyEntity(html,'artist',artist),entity);
 const response=await spotifyStats(new Request('https://bridge/spotify-stats?artistId='+artist),{fetcher:async()=>new Response(html)}),data=await response.json();
 assert.equal(data.monthlyListeners,12345);assert.equal(data.tracks[0].plays,987654321);assert.equal('privateToken' in data,false);assert.equal(data.source,'https://open.spotify.com/artist/'+artist);
});
test('bad IDs, multiple parameters, missing metadata and oversized pages fail safely',async()=>{
 let requests=0;const fetcher=async()=>{requests++;return new Response('No metadata');};
 assert.equal((await spotifyStats(new Request('https://bridge/spotify-stats?artistId=bad&trackId='+track),{fetcher})).status,400);assert.equal(requests,0);
 assert.equal((await spotifyStats(new Request('https://bridge/spotify-stats?artistId='+artist),{fetcher})).status,503);
 await assert.rejects(boundedText(new Response('too big'),2),/too large/);
});
test('ambiguous artist mappings do not publish the wrong artist’s count',async()=>{
 const response=await spotifyStats(new Request('https://bridge/spotify-stats?deezerArtistId=123'),{fetcher:async()=>new Response(JSON.stringify({results:{bindings:[{spotify:{value:artist}},{spotify:{value:track}}]}}))});assert.equal((await response.json()).available,false);
});
test('song counts require a Spotify ID or an unambiguous title/duration match',()=>{
 const counters={available:true,tracks:[{id:track,title:'Blinding Lights',duration:200,plays:123}]};
 assert.equal(matchPlayCount({title:'Blinding Lights',duration:200},counters).plays,123);assert.equal(matchPlayCount({title:'Blinding Lights (Live)',duration:200},counters),null);assert.equal(matchPlayCount({spotifyId:'different',title:'Blinding Lights',duration:200},counters),null);
});
