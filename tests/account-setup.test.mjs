import test from 'node:test';import assert from 'node:assert/strict';
import {connectionDevice,setupHtml,helperInstallHtml,copyHelperInstallLink,COMPANION_INSTALL_URL} from '../js/account-setup.js';import {canAutoRead} from '../js/spotify-reader.js';
test('connection setup selects phones, touch iPads and computers with manual switching',()=>{assert.equal(connectionDevice('iPhone'),'iphone');assert.equal(connectionDevice('Mozilla','MacIntel',5),'iphone');assert.equal(connectionDevice('Android'),'android');assert.equal(connectionDevice('Windows'),'computer');assert.match(helperInstallHtml('computer'),/Allow User Scripts/);assert.match(setupHtml('iphone'),/Safari/);assert.match(setupHtml('android'),/Firefox/);});
test('helper link copying writes the public installer and only reports copied after success',async()=>{
 let copied;const status={textContent:'Ready'};const field={focus(){throw new Error('Should not need manual selection');},select(){throw new Error('Should not need manual selection');}};
 const result=await copyHelperInstallLink({clipboard:{async writeText(value){assert.equal(status.textContent,'Ready');copied=value;}},field,status});
 assert.equal(result,true);assert.equal(copied,COMPANION_INSTALL_URL);assert.equal(new URL(copied).origin,'https://coye2.github.io');assert.ok(new URL(copied).pathname.endsWith('.user.js'));assert.equal(new URL(copied).search,'');assert.match(status.textContent,/Link copied/);assert.doesNotMatch(status.textContent,/installed successfully/i);
});
test('blocked or missing clipboard selects the usable link without claiming success',async()=>{
 for(const clipboard of [undefined,{writeText:async()=>{throw new Error('NotAllowedError');}}]){
  const status={textContent:'Ready'},actions=[];
  assert.equal(await copyHelperInstallLink({clipboard,status,field:{focus(){actions.push('focus');},select(){actions.push('select');}}}),false);
  assert.deepEqual(actions,['focus','select']);assert.match(status.textContent,/link is selected/);assert.doesNotMatch(status.textContent,/Link copied/);
 }
});
test('automatic Spotify handoff requires a fresh explicit launch and stays single attempt',()=>{const input={bridge:{nonce:'a'.repeat(32),origin:'https://coye2.github.io',started:1000},now:2000,hostReady:true,authorization:'Bearer test',attempted:false};assert.equal(canAutoRead(input),true);for(const patch of [{attempted:true},{hostReady:false},{authorization:''},{bridge:null},{now:1801000},{now:0},{bridge:{...input.bridge,origin:'https://evil.test'}}])assert.equal(canAutoRead({...input,...patch}),false);});
