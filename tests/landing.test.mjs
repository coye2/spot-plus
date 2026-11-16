import test from 'node:test';
import assert from 'node:assert/strict';
import {installPlan,installLabel,shouldShowLanding} from '../js/landing.js';
const UA={
  iphone:'Mozilla/5.0 (iPhone; CPU iPhone OS 26_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.1 Mobile/15E148 Safari/604.1',
  ipad:'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.1 Safari/605.1.15',
  insta:'Mozilla/5.0 (iPhone; CPU iPhone OS 26_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 350.0',
  android:'Mozilla/5.0 (Linux; Android 15) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0 Mobile Safari/537.36',
  samsung:'Mozilla/5.0 (Linux; Android 15) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/28.0 Chrome/130.0 Mobile Safari/537.36',
  win:'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0 Safari/537.36 Edg/142.0',
  ff:'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:145.0) Gecko/20100101 Firefox/145.0',
  mac:'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.1 Safari/605.1.15',
};
test('every device gets the right install path',()=>{
  assert.deepEqual(installPlan(UA.iphone),{kind:'ios',device:'iPhone',browser:'Safari'});
  assert.equal(installPlan(UA.ipad,{touchPoints:5}).device,'iPad');
  assert.equal(installPlan(UA.insta).kind,'inapp');
  assert.equal(installPlan(UA.android,{hasPrompt:true}).kind,'prompt');
  assert.equal(installPlan(UA.samsung).browser,'Samsung Internet');
  assert.equal(installPlan(UA.win).kind,'chromium-wait');
  assert.equal(installPlan(UA.ff).kind,'firefox-desktop');
  assert.equal(installPlan(UA.mac).kind,'mac-safari');
  assert.equal(installPlan(UA.win,{standalone:true}).kind,'installed');
  assert.equal(installLabel(installPlan(UA.iphone)),'Install on iPhone');
  assert.equal(installLabel(installPlan(UA.insta)),'Open in Safari');
});
test('download page only for first-time browser visitors',()=>{
  const mem=k=>({getItem:key=>k[key]??null});
  assert.equal(shouldShowLanding({storage:mem({})}),true);
  assert.equal(shouldShowLanding({standalone:true,storage:mem({})}),false);
  assert.equal(shouldShowLanding({storage:mem({'spotplus.landing':'web'})}),false);
  assert.equal(shouldShowLanding({storage:mem({'spotplus.onboarded.v2':'1'})}),false);
  assert.equal(shouldShowLanding({hash:'#/jam/ABC123',storage:mem({})}),false);
});
