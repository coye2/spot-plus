import test from 'node:test';import assert from 'node:assert/strict';import {readFile,stat} from 'node:fs/promises';
import {HOSTS,PHRASES,clipUrl,validHost} from '../js/dj-hosts.js';
test('every selectable host has every real bundled response, under a small download budget',async()=>{
 let total=0;for(const host of HOSTS)for(const cue of Object.keys(PHRASES)){const url=new URL(clipUrl(host.id,cue));const size=(await stat(url)).size;const bytes=await readFile(url);assert.ok(size>3000);assert.ok(bytes.subarray(0,3).toString()==='ID3'||bytes[0]===255);total+=size;}
 assert.ok(total<2*1024*1024);assert.equal(validHost('../../bad'),'afterhours');assert.equal(clipUrl('afterhours','../../private'),null);
});
