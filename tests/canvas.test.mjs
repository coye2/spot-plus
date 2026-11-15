import test from 'node:test';
import assert from 'node:assert/strict';
import {CanvasPlayer,canvasURL,canvasQuery,findCanvas,canvasEnabled,setCanvasEnabled} from '../js/canvas.js';
import {handle,queryFor,boundedJSON} from '../canvas-bridge/worker.js';
const clip='https://canvaz.scdn.co/upload/artist/example/video/loop.cnvs.mp4';
const track={id:'123',title:'Snooze',artist:'SZA',duration:201};
const tick=()=>new Promise(resolve=>setImmediate(resolve));
class Video extends EventTarget {
  paused=true; plays=0; src=''; loads=0;
  getAttribute(name){return this[name]||null;}
  removeAttribute(name){this[name]='';}
  load(){this.loads++;}
  pause(){this.paused=true;}
  async play(){this.plays++;this.paused=false;this.dispatchEvent(new Event('playing'));}
}
test('Canvas accepts only Spotify HTTPS video URLs',()=>{
 assert.equal(canvasURL(clip),clip);
 for(const url of ['javascript:alert(1)',clip.replace('https:','http:'),clip.replace('canvaz.scdn.co','canvaz.scdn.co.bad.test'),clip.replace('canvaz','user@canvaz'),clip.replace('.mp4','.html')])assert.equal(canvasURL(url),null);
 assert.equal(canvasQuery({...track,spotifyId:'3OHfY25tqY28d16oZczHc8'}).get('trackId'),'3OHfY25tqY28d16oZczHc8');
 assert.equal(canvasQuery(track).get('durationMs'),'201000');
 assert.equal(canvasQuery({...track,local:true}),null);
});
test('Late Canvas lookup cannot replace a newer song or reopen a closed player',async()=>{
 const pending=[],video=new Video(),player=new CanvasPlayer(video,{lookup:(t,signal)=>new Promise(resolve=>pending.push({resolve,signal}))});
 const options={visible:true,enabled:true,playing:true};
 player.sync(track,options);player.sync({...track,title:'Saturn'},options);
 assert.equal(pending[0].signal.aborted,true);
 pending[0].resolve(clip);await tick();assert.equal(video.src,'');
 pending[1].resolve(clip);await tick();assert.equal(video.src,clip);assert.equal(player.state,'ready');
 assert.equal(video.muted,true);assert.equal(video.loop,true);assert.equal(video.playsInline,true);
 player.sync({...track,title:'Saturn'},{...options,playing:false});assert.equal(video.paused,true);
 player.sync({...track,title:'Saturn'},{...options,visible:false});assert.equal(video.src,'');assert.equal(video.paused,true);
 player.sync(track,options);player.clear();pending[2].resolve(clip);await tick();assert.equal(video.src,'');
});
test('Missing, rejected autoplay, and video errors keep a cover fallback without retry storms',async()=>{
 let lookups=0;const video=new Video();video.play=async()=>{throw new Error('NotAllowedError');};
 const player=new CanvasPlayer(video,{lookup:async()=>{lookups++;return clip;}}),options={visible:true,enabled:true,playing:true};
 player.sync(track,options);await tick();assert.equal(player.state,'blocked');
 for(let i=0;i<10;i++)player.sync(track,options);assert.equal(lookups,1);
 video.dispatchEvent(new Event('error'));assert.equal(player.state,'fallback');assert.equal(video.src,'');player.clear();
 const missing=new CanvasPlayer(new Video(),{lookup:async()=>null});missing.sync(track,options);await tick();assert.equal(missing.state,'missing');
});
test('Canvas waits for music before requesting video bytes and resumes without another lookup',async()=>{
 const video=new Video();let lookups=0;const player=new CanvasPlayer(video,{lookup:async()=>{lookups++;return clip;}});
 const options={visible:true,enabled:true,playing:false};player.sync(track,options);await tick();
 assert.equal(video.src,'');assert.equal(player.state,'waiting');assert.equal(lookups,1);
 player.sync(track,{...options,playing:true});assert.equal(video.src,clip);assert.equal(video.paused,false);assert.equal(lookups,1);
 player.sync(track,{...options,enabled:false});assert.equal(video.src,'');assert.equal(video.paused,true);
});
test('Canvas metadata cache avoids extra requests and remembers explicit motion preference',async()=>{
 const storage=globalThis.localStorage,fetcher=globalThis.fetch;const values=new Map();
 globalThis.localStorage={getItem:k=>values.get(k)??null,setItem:(k,v)=>values.set(k,v)};let calls=0;
 globalThis.fetch=async(url,options)=>{calls++;assert.equal(options.credentials,'omit');return Response.json({success:true,canvasUrl:clip});};
 try {
  assert.equal(canvasEnabled({reducedMotion:true}),false);setCanvasEnabled(true);assert.equal(canvasEnabled({reducedMotion:true}),true);
  assert.equal(await findCanvas(track,undefined,'https://bridge.test/canvas'),clip);assert.equal(await findCanvas(track),clip);assert.equal(calls,1);
 }finally{globalThis.localStorage=storage;globalThis.fetch=fetcher;}
});
test('Hosted bridge accepts only bounded public metadata and never forwards credentials',async()=>{
 assert.equal(queryFor(new URLSearchParams({url:'https://private.test'})),null);
 assert.equal(queryFor(new URLSearchParams({song:'x'.repeat(201),artist:'SZA'})),null);
 let called=0;const response=await handle(new Request('https://bridge.test/canvas?song=Snooze&artist=SZA&url=https://private.test',{headers:{Cookie:'private',Authorization:'secret'}}),{fetcher:async(url,options)=>{
  called++;assert.equal(new URL(url).hostname,'canvas.auramusic.site');assert.equal(new URL(url).searchParams.has('url'),false);assert.equal(options.headers.Cookie,undefined);assert.equal(options.headers.Authorization,undefined);return Response.json({canvasUrl:clip});
 }});
 assert.equal(called,1);assert.equal(response.headers.get('Access-Control-Allow-Origin'),'*');assert.equal((await response.json()).canvasUrl,clip);
 const rejected=await handle(new Request('https://bridge.test/canvas?url=https://private.test'),{fetcher:()=>{throw new Error('Should not fetch');}});assert.equal(rejected.status,400);
});
test('Bridge separates genuine missing Canvas from outages and rejects oversized responses',async()=>{
 const request=new Request('https://bridge.test/canvas?song=Snooze&artist=SZA');
 const missing=await handle(request,{fetcher:async()=>new Response('',{status:404})});assert.equal((await missing.json()).canvasUrl,null);assert.match(missing.headers.get('cache-control'),/3600/);
 const outage=await handle(request,{fetcher:async()=>new Response('',{status:429})});assert.equal(outage.status,503);assert.equal(outage.headers.get('cache-control'),'no-store');
 await assert.rejects(()=>boundedJSON(new Response('x'.repeat(65537))),/too large/);
});
