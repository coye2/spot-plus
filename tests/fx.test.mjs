import test from 'node:test';import assert from 'node:assert/strict';
import {fromPreset,needsGraph,isActive,PRESETS,ROOMS,DEFAULTS} from '../js/fx.js';
test('presets are complete and clean',()=>{
  for(const name of Object.keys(PRESETS)){const s=fromPreset(name);assert.equal(s.preset,name);assert.equal('label' in s,false);assert.ok(s.speed>=0.5&&s.speed<=1.5);assert.ok(s.room in ROOMS);}
  assert.deepEqual({...fromPreset('off'),preset:'off'},{...DEFAULTS,preset:'off'});
});
test('speed alone skips the audio graph; everything else uses it',()=>{
  assert.equal(needsGraph(fromPreset('sped')),false);assert.equal(isActive(fromPreset('sped')),true);
  assert.equal(needsGraph(fromPreset('slowed')),true);assert.equal(isActive(fromPreset('off')),false);
});
