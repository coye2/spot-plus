import test from 'node:test';import assert from 'node:assert/strict';
import {InstallCounter} from '../canvas-bridge/installs.js';
const storage=()=>{const m=new Map();return {get:async k=>m.get(k),put:async o=>{for(const [k,v] of Object.entries(o))m.set(k,v);}};};
const post=(path,body,ip='a')=>new Request('https://counter'+path,{method:'POST',body:JSON.stringify(body),headers:{'X-Client':ip}});
const dev=n=>String(n).padStart(32,'0');
test('installs count each device once and cap per network per day',async()=>{
  const c=new InstallCounter({storage:storage()});
  await c.fetch(post('/installs',{device:dev(1)}));await c.fetch(post('/installs',{device:dev(1)}));
  assert.equal((await (await c.fetch(new Request('https://counter/stats'))).json()).installs,1);
  for(let i=2;i<10;i++)await c.fetch(post('/installs',{device:dev(i)}));
  assert.equal((await (await c.fetch(new Request('https://counter/stats'))).json()).installs,3,'3 per network per day');
  assert.equal((await c.fetch(post('/installs',{device:'nope'}))).status,400);
});
test('listening counts players that checked in recently',async()=>{
  const c=new InstallCounter({storage:storage()});
  await c.fetch(post('/listening',{device:dev(1),playing:true}));await c.fetch(post('/listening',{device:dev(2),playing:true}));
  await c.fetch(post('/listening',{device:dev(2),playing:false}));
  assert.equal((await (await c.fetch(new Request('https://counter/stats'))).json()).listening,1);
  c.live.set(dev(3),Date.now()-600000);assert.equal(c.liveCount(),1,'stale players drop off');
});
