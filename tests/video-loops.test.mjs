import test from 'node:test';
import assert from 'node:assert/strict';
import {matchMusicVideo,chooseLoopFormat,musicVideoLoop,loopWindow} from '../js/video-loops.js';
import {CanvasPlayer,findVisualLoop} from '../js/canvas.js';
const track={title:'Blinding Lights',artist:'The Weeknd',duration:200};
const candidate={id:'4NRXx6U8ABQ',title:'The Weeknd - Blinding Lights (Official Video)',channel:'TheWeekndVEVO',duration:263};
const clip=musicVideoLoop({kind:'music-video',engine:'invidious',instance:'https://videos.example.org',url:'https://videos.example.org/latest_version?id=4NRXx6U8ABQ&itag=134&local=true',videoId:candidate.id,title:candidate.title,duration:263});
const tick=()=>new Promise(resolve=>setImmediate(resolve));
test('Video matching rejects different songs, wrong artists, covers and static audio uploads',()=>{
 assert.equal(matchMusicVideo([candidate],track).id,candidate.id);
 for(const title of ['The Weeknd - Heartless (Official Video)','The Weeknd - Blinding Lights (Official Audio)','The Weeknd - Blinding Lights (Live)','Blinding Lights cover by Somebody'])assert.equal(matchMusicVideo([{...candidate,title}],track),null);
 assert.equal(matchMusicVideo([{...candidate,title:'Blinding Lights (Official Video)',channel:'Unrelated singer'}],track),null);
 assert.equal(matchMusicVideo([{...candidate,title:'Artist - Stay With Me (Official Video)',channel:'Artist'}],{title:'Stay',artist:'Artist'}),null);
 assert.ok(matchMusicVideo([{...candidate,title:'mgk - twin flame (Official Music Video)',channel:'mgk'}],{title:'twin flame',artist:'Machine Gun Kelly'}));
});
test('Video loops choose small H264 streams and reject unsafe or unrelated source URLs',()=>{
 const formats=[{url:clip.url,mime:'video/mp4; codecs="avc1.42E01E"',height:360},{url:clip.url,mime:'video/mp4; codecs="av01"',height:360},{url:clip.url,mime:'video/mp4; codecs="avc1.42E01E"',height:1080}];
 assert.equal(chooseLoopFormat(formats),formats[0]);assert.equal(chooseLoopFormat(formats.slice(1)),null);
 const hd={...formats[0],height:720};assert.equal(chooseLoopFormat([...formats,hd]),hd);assert.equal(chooseLoopFormat([...formats,hd],480),formats[0]);
 assert.ok(musicVideoLoop({...clip,url:'https://rr1.googlevideo.com/videoplayback?itag=136'}));assert.equal(musicVideoLoop({...clip,url:'https://googlevideo.com.attacker.example/videoplayback?itag=136'}),null);
 assert.equal(musicVideoLoop({...clip,url:'https://127.0.0.1/latest_version?id=4NRXx6U8ABQ&itag=134'}),null);
 assert.equal(musicVideoLoop({...clip,url:clip.url.replace('4NRXx6U8ABQ','aaaaaaaaaaa')}),null);
 assert.deepEqual(loopWindow(263),{start:70,end:80});assert.deepEqual(loopWindow(200),{start:64,end:74});assert.deepEqual(loopWindow(6),{start:0,end:6});
});
test('Canvas has priority, with matching video fallback for missing clips and outages',async()=>{
 let calls=0;const videoLookup=async()=>{calls++;return clip;};
 const canvas='https://canvaz.scdn.co/upload/artist/example/video/loop.mp4';
 assert.equal((await findVisualLoop(track,undefined,{canvasLookup:async()=>canvas,videoLookup})).kind,'canvas');assert.equal(calls,0);
 assert.equal((await findVisualLoop(track,undefined,{canvasLookup:async()=>null,videoLookup})).kind,'music-video');
 assert.equal((await findVisualLoop(track,undefined,{canvasLookup:async()=>{throw new Error('offline');},videoLookup})).kind,'music-video');
 const controller=new AbortController();controller.abort();await assert.rejects(()=>findVisualLoop(track,controller.signal,{videoLookup}));assert.equal(calls,2);
});
class Video extends EventTarget {
 paused=true;src='';currentTime=0;duration=263;seeking=false;
 getAttribute(name){return this[name]||null;}removeAttribute(name){this[name]='';}load(){}pause(){this.paused=true;}
 async play(){this.paused=false;this.dispatchEvent(new Event('playing'));}
}
test('Fallback repeats a ten-second section without touching the song player',async()=>{
 const video=new Video(),player=new CanvasPlayer(video,{lookup:async()=>clip});
 player.sync(track,{visible:true,enabled:true,playing:true});await tick();
 video.dispatchEvent(new Event('loadedmetadata'));assert.equal(video.currentTime,70);
 video.currentTime=80.1;video.dispatchEvent(new Event('timeupdate'));assert.equal(video.currentTime,70);
 assert.equal(video.muted,true);assert.equal(player.state,'ready');
 player.sync(track,{visible:false,enabled:true,playing:true});assert.equal(video.src,'');assert.equal(video.paused,true);
});
test('Failed media switches sources, while closing cancels a late fallback',async()=>{
 const video=new Video(),calls=[];let finish;
 const player=new CanvasPlayer(video,{lookup:async(t,s,options)=>{calls.push(options);if(calls.length===1)return clip;return new Promise(resolve=>{finish=resolve;});}});
 player.sync(track,{visible:true,enabled:true,playing:true});await tick();video.dispatchEvent(new Event('error'));
 assert.equal(calls[1].skipCanvas,true);assert.deepEqual(calls[1].skip,[clip.instance]);
 player.clear();finish(clip);await tick();assert.equal(video.src,'');assert.equal(player.state,'idle');
});
