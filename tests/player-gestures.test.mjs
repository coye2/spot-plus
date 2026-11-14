import test from 'node:test';import assert from 'node:assert/strict';import {shouldDismissPlayer} from '../js/player-gestures.js';
test('player dismisses intentional downward drags and flicks, not horizontal or upward gestures',()=>{
 assert.equal(shouldDismissPlayer(8,140,900,844),true);assert.equal(shouldDismissPlayer(2,60,60,844),true);assert.equal(shouldDismissPlayer(100,60,60,844),false);assert.equal(shouldDismissPlayer(0,-140,200,844),false);assert.equal(shouldDismissPlayer(0,20,300,844),false);assert.equal(shouldDismissPlayer(0,60,900,844),false);
});
