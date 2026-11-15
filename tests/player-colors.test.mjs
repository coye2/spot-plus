import test from 'node:test';import assert from 'node:assert/strict';
import {songPalette} from '../js/player-colors.js';import {contrast} from '../js/themes.js';
test('album colors preserve dominant hue and keep white lyrics readable',()=>{
 const p=songPalette(new Uint8ClampedArray([255,30,30,255,230,20,20,255,255,255,255,255]));assert.ok(contrast(p.color,'#ffffff')>=5.2);assert.ok(parseInt(p.color.slice(1,3),16)>parseInt(p.color.slice(3,5),16));assert.ok(contrast(p.deep,'#ffffff')>contrast(p.color,'#ffffff'));assert.match(songPalette([]).color,/^#[a-f0-9]{6}$/);
});
