import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {runInNewContext} from 'node:vm';

const source=await readFile(new URL('../sw.js',import.meta.url),'utf8');
const base='https://coye2.github.io/spot-plus/';
function worker({offline=false,staleHelper=false}={}){
 const listeners={},network=[];
 const entries=new Map([[base+'index.html',new Response('<html>Spot+ shell</html>',{headers:{'Content-Type':'text/html'}})]]);
 if(staleHelper)entries.set(base+'js/spotplus-spotify.user.js',new Response('<html>Wrong old page</html>',{headers:{'Content-Type':'text/html'}}));
 const key=input=>{const u=new URL(typeof input==='string'?input:input.url,base);u.search='';return u.href;};
 const cache={match:async input=>entries.get(key(input))?.clone(),put:async(input,response)=>entries.set(key(input),response)};
 class WorkerRequest extends Request{constructor(input,init){super(typeof input==='object'&&!(input instanceof Request)?input.url:input,init);}}
 runInNewContext(source,{
  self:{location:{href:base+'sw.js',origin:new URL(base).origin},addEventListener:(name,fn)=>listeners[name]=fn},
  caches:{open:async()=>cache},URL,Request:WorkerRequest,Response,
  fetch:async input=>{
   network.push(input);if(offline)throw new Error('Offline');
   const url=typeof input==='string'?input:input.url;
   if(/spotplus-spotify\.(user|meta)\.js/.test(url))return new Response('// ==UserScript==\n// @name Spot+',{headers:{'Content-Type':'application/javascript'}});
   return new Response('Not found',{status:404});
  }
 });
 return {network,request:async(path,mode='navigate')=>{
  let response;
  listeners.fetch({request:{url:new URL(path,base).href,method:'GET',mode},respondWith:promise=>response=promise});
  assert.ok(response,'The same-origin request should be handled');
  return await response;
 }};
}

test('opening the helper file returns JavaScript, never the cached app document',async()=>{
 const app=worker({staleHelper:true});
 const response=await app.request('js/spotplus-spotify.user.js?v=1.3.1');
 assert.match(response.headers.get('content-type'),/javascript/);
 assert.match(await response.text(),/^\/\/ ==UserScript==/);
 assert.equal(app.network.length,1);assert.equal(app.network[0].cache,'no-store');
});
test('helper updates also bypass the shell and stale caches',async()=>{
 const app=worker();const response=await app.request('js/spotplus-spotify.meta.js','cors');
 assert.match(await response.text(),/UserScript/);assert.equal(app.network[0].cache,'no-store');
});
test('offline helper navigation shows a recovery message instead of a broken HTML app',async()=>{
 const response=await worker({offline:true,staleHelper:true}).request('js/spotplus-spotify.user.js');
 assert.equal(response.status,503);assert.match(response.headers.get('content-type'),/text\/plain/);
 assert.match(await response.text(),/check your connection/);
});
test('root and index navigations retain the offline app shell',async()=>{
 const app=worker({offline:true});
 for(const path of ['./?updated=1','index.html?updated=1'])assert.match(await (await app.request(path)).text(),/Spot\+ shell/);
 assert.equal(app.network.length,0);
});
test('missing files and non-app paths keep their real 404, not a misleading shell',async()=>{
 const app=worker();
 for(const path of ['js/missing.js','icons/missing.png','unknown']){
  const response=await app.request(path);assert.equal(response.status,404);assert.equal(await response.text(),'Not found');
 }
 assert.equal(app.network.length,3);
});
