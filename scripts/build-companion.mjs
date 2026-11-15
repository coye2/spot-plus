import {readFile,writeFile} from 'node:fs/promises';
import {COMPANION_VERSION} from '../js/spotify-reader.js';
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
const pageCode=`(()=>{if(document.documentElement.dataset.spotplusCompanion)return;document.documentElement.dataset.spotplusCompanion='1';\n${reader}\n${entry}\nrunSpotifyCompanion();\n})();`;
const loader=`(()=>{
if(window.top!==window.self)return;
const code=${JSON.stringify(pageCode)};
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
})();
`;
const output=header+loader;
await writeFile(new URL('../js/spotplus-spotify.user.js',import.meta.url),output);
await writeFile(new URL('../js/spotplus-spotify.meta.js',import.meta.url),header);
console.log('Built the self-contained Spotify browser companion.');
