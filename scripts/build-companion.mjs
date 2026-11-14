import {readFile,writeFile} from 'node:fs/promises';
const reader=(await readFile(new URL('../js/spotify-reader.js',import.meta.url),'utf8')).replace(/^export /gm,'');
const entry=await readFile(new URL('./spotify-companion-entry.js',import.meta.url),'utf8');
const header=`// ==UserScript==
// @name         Spot+ Spotify Library Companion
// @namespace    https://coye2.github.io/spot-plus/
// @version      1.1.0
// @description  Copy your signed-in Spotify music library to Spot+ on this device. Read only; no Premium requirement.
// @match        https://open.spotify.com/*
// @run-at       document-start
// @noframes
// @inject-into  content
// @grant        none
// ==/UserScript==
`;
// A local blob runs the hook in the Spotify page's JS world, also from Safari's isolated extension world.
// There is no downloaded executable code, cookie access, external token proxy or remote script dependency.
const pageCode=`(()=>{\n${reader}\n${entry}\nrunSpotifyCompanion();\n})();`;
const output=header+`(()=>{if(window.top!==window.self)return;const source=${JSON.stringify(pageCode)};const url=URL.createObjectURL(new Blob([source],{type:'text/javascript'}));const script=document.createElement('script');script.src=url;script.onload=()=>{URL.revokeObjectURL(url);script.remove();};script.onerror=()=>{URL.revokeObjectURL(url);script.remove();};if(document.documentElement)(document.head||document.documentElement).append(script);else{const observer=new MutationObserver(()=>{if(document.documentElement){observer.disconnect();(document.head||document.documentElement).append(script);}});observer.observe(document,{childList:true});}})();\n`;
await writeFile(new URL('../js/spotplus-spotify.user.js',import.meta.url),output);
console.log('Built the self-contained Spotify phone companion.');
