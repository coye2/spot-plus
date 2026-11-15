import {readFile,writeFile} from 'node:fs/promises';
import {COMPANION_VERSION} from '../js/spotify-reader.js';
import {build} from 'esbuild';
// Auto-sync (encrypted relay snapshots) is bundled in as a local SpotPlusSync object.
const sync=(await build({entryPoints:[new URL('../js/relay-sync.js',import.meta.url).pathname],bundle:true,format:'iife',globalName:'SpotPlusSync',minify:true,write:false,legalComments:'none',target:'es2020'})).outputFiles[0].text;
const reader=(await readFile(new URL('../js/spotify-reader.js',import.meta.url),'utf8')).replace(/^export /gm,'');
const entry=await readFile(new URL('./spotify-companion-entry.js',import.meta.url),'utf8');
const header=`// ==UserScript==
// @name         Spot+ Spotify Library Companion
// @namespace    https://coye2.github.io/spot-plus/
// @version      ${COMPANION_VERSION}
// @description  Copy your signed-in Spotify music library to Spot+ on this device. Read only; no Premium requirement.
// @updateURL    https://coye2.github.io/spot-plus/js/spotplus-spotify.meta.js
// @downloadURL  https://coye2.github.io/spot-plus/js/spotplus-spotify.user.js
// @match        https://open.spotify.com/*
// @run-at       document-start
// @noframes
// @inject-into  content
// @sandbox      raw
// @grant        none
// ==/UserScript==
`;
// The fetch hook must run in Spotify's page world. Tampermonkey (@sandbox raw) can
// put us there directly, but Safari Userscripts injects page scripts as inline
// <script> elements, which Spotify's CSP blocks (no 'unsafe-inline', no nonce), so the
// panel never appeared on iPhone. Spotify's script-src does allow blob:, so the loader
// tries inline first, then a blob: script, then runs in place as a last resort.
const pageCode=`(()=>{if(document.documentElement.dataset.spotplusCompanion)return;document.documentElement.dataset.spotplusCompanion='1';\n${sync}\n${reader}\n${entry}\nrunSpotifyCompanion();\n})();`;
// The installed script is a small launcher, so people install it once and never again:
// it runs the newest helper core published with Spot+ (cached on Spotify's site for an
// instant start) and fetches any update in the background for the next visit. The
// version bundled here is only a fallback for the very first run or when offline.
const CORE_URL='https://coye2.github.io/spot-plus/js/spotplus-helper-core.js';
const loader=`(()=>{
if(window.top!==window.self)return;
const CORE=${JSON.stringify(CORE_URL)},MARK='/*spotplus-helper-core*/',BUNDLED=${JSON.stringify('/*spotplus-helper-core*/'+pageCode)};
const valid=code=>typeof code==='string'&&code.startsWith(MARK)&&code.length<600000;
let cached=null;try{cached=localStorage.getItem('spotplus.helperCore');}catch{ /* Storage disabled. */ }
const code=valid(cached)?cached:BUNDLED;
// Refresh the cached core for next time (at most every 6 hours).
try{
  const last=Number(localStorage.getItem('spotplus.helperCoreAt'))||0;
  if(Date.now()-last>6*3600*1000||!valid(cached))fetch(CORE+'?t='+Math.floor(Date.now()/3600000),{cache:'no-cache',credentials:'omit'}).then(r=>r.ok?r.text():null).then(next=>{if(valid(next)){localStorage.setItem('spotplus.helperCore',next);localStorage.setItem('spotplus.helperCoreAt',String(Date.now()));}}).catch(()=>{});
}catch{ /* Offline or storage disabled: the cached or bundled core still runs. */ }
// Some managers start before <html> exists; wait for it (only a moment).
if(!document.documentElement){new MutationObserver((_,o)=>{if(document.documentElement){o.disconnect();start();}}).observe(document,{childList:true});return;}
start();
function start(){
const root=document.documentElement;
const loaded=()=>!!root.dataset.spotplusCompanion;
const inPlace=()=>{if(!loaded())(0,eval)(code);};
try{const s=document.createElement('script');s.textContent=code;root.append(s);s.remove();}catch{ /* CSP or DOM unavailable. */ }
if(loaded())return;
try{
  const url=URL.createObjectURL(new Blob([code],{type:'text/javascript'}));
  const s=document.createElement('script');s.src=url;
  s.onload=()=>{URL.revokeObjectURL(url);s.remove();if(!loaded())inPlace();};
  s.onerror=()=>{URL.revokeObjectURL(url);s.remove();inPlace();};
  root.append(s);
}catch{inPlace();}
}
})();
`;
const output=header+loader;
await writeFile(new URL('../js/spotplus-spotify.user.js',import.meta.url),output);
await writeFile(new URL('../js/spotplus-spotify.meta.js',import.meta.url),header);
// The always-current core the launcher loads.
await writeFile(new URL('../js/spotplus-helper-core.js',import.meta.url),'/*spotplus-helper-core*/'+pageCode);
console.log('Built the self-contained Spotify browser companion.');
