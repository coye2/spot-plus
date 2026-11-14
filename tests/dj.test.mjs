import test from 'node:test';import assert from 'node:assert/strict';
import {browserMocks} from './helpers.mjs';browserMocks();
const dj=await import('../js/dj.js');
test('lighter DJ removes request boilerplate without inventing tracks',()=>{assert.equal(dj.fallbackQuery('Please play some Miles Davis'),'Miles Davis');assert.equal(dj.fallbackQuery('jazz for a rainy day'),'jazz for a rainy day');});
test('DJ deduplicates real track identifiers',()=>{assert.equal(dj.uniqueTracks([{id:'1',title:'A'},{id:1,title:'A'},null,{id:'2',title:'B'}]).length,2);});
test('optional model starts unloaded and can be released without a download',()=>{assert.equal(dj.localModel.status.phase,'idle');dj.localModel.release();assert.equal(dj.localModel.status.phase,'idle');});
