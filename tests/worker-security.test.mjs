import test from 'node:test';
import assert from 'node:assert/strict';
import {secureHandle,rateLimited} from '../canvas-bridge/worker.js';
const req=(path,origin)=>new Request('https://bridge.test'+path,{headers:origin?{Origin:origin}:{}});
test('other websites cannot use the bridge',async()=>{
  const bad=await secureHandle(req('/health','https://evil.example'));
  assert.equal(bad.status,403);
  assert.equal(bad.headers.get('Access-Control-Allow-Origin'),null);
  const ok=await secureHandle(req('/health','https://coye2.github.io'));
  assert.equal(ok.status,200);
  assert.equal(ok.headers.get('Access-Control-Allow-Origin'),'https://coye2.github.io');
  assert.equal(ok.headers.get('X-Frame-Options'),'DENY');
  assert.match(ok.headers.get('Content-Security-Policy'),/default-src 'none'/);
});
test('oversized requests and floods are refused',async()=>{
  assert.equal((await secureHandle(req('/lyrics-search?q='+'a'.repeat(1300)))).status,414);
  const table=new Map();let blocked=false;
  for(let i=0;i<125;i++)blocked=rateLimited('1.2.3.4',1000,table,{limit:120,windowMs:60000});
  assert.equal(blocked,true);
  assert.equal(rateLimited('1.2.3.4',70000,table,{limit:120,windowMs:60000}),false,'window resets');
});
