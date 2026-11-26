import {readFile,rm,writeFile} from 'node:fs/promises';
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
// put us there directly, while Violentmonkey (@inject-into content) and Safari
// Userscripts start in an isolated world. Spotify's CSP blocks inline <script>
// elements (no 'unsafe-inline', no nonce) but allows blob:, so the loader tries
// inline first, then a blob: script, then invokes the packaged core directly
// (never eval, never remote fetches, and never code from page-owned localStorage).
// Updates arrive exclusively through the installed userscript manager's @updateURL
// and @downloadURL mechanism.
const versionLiteral=JSON.stringify(COMPANION_VERSION);
const pageBody=`if(!document.documentElement||document.documentElement.dataset.spotplusCompanion)return;\ndocument.documentElement.dataset.spotplusCompanion=${versionLiteral};\n${sync}\n${reader}\n${entry}\nrunSpotifyCompanion();`;
const pageCode=`(()=>{\n${pageBody}\n})();`;
const loader=`(()=>{
try{if(window.top!==window.self)return;}catch{return;}
if(location.origin!=='https://open.spotify.com')return;
// Clean up obsolete helper-core cache entries written by versions <= 1.7.0
// without touching user data (such as spotplus.syncKey, spotplus.syncAt, or Spotify keys).
try{
  const storage=window.localStorage;
  if(storage&&typeof storage.removeItem==='function'){
    storage.removeItem('spotplus.helperCore');
    storage.removeItem('spotplus.helperCoreAt');
  }
}catch{ /* Storage disabled or restricted. */ }
const PACKAGED=${JSON.stringify(pageCode)};
function runPackagedCore(){
${pageBody}
}
// Some managers start before <html> exists; wait for it (only a moment).
if(!document.documentElement){
  new MutationObserver((_,o)=>{if(document.documentElement){o.disconnect();start();}}).observe(document,{childList:true});
  return;
}
start();
function start(){
  const root=document.documentElement;
  if(!root)return;
  const loaded=()=>!!root.dataset.spotplusCompanion;
  if(loaded())return;
  const inPlace=()=>{if(!loaded())runPackagedCore();};
  try{const s=document.createElement('script');s.textContent=PACKAGED;root.append(s);s.remove();}catch{ /* CSP or DOM unavailable. */ }
  if(loaded())return;
  try{
    const url=URL.createObjectURL(new Blob([PACKAGED],{type:'text/javascript'}));
    const s=document.createElement('script');s.src=url;
    let settled=false;
    const finish=()=>{if(settled)return;settled=true;try{URL.revokeObjectURL(url);}catch{ /* Ignore. */ }s.remove();if(!loaded())inPlace();};
    s.onload=finish;
    s.onerror=finish;
    root.append(s);
  }catch{inPlace();}
}
})();
`;
const output=header+loader;
await writeFile(new URL('../js/spotplus-spotify.user.js',import.meta.url),output);
await writeFile(new URL('../js/spotplus-spotify.meta.js',import.meta.url),header);
await rm(new URL('../js/spotplus-helper-core.js',import.meta.url),{force:true});
console.log('Built the self-contained Spotify browser companion (packaged updates only).');
