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
// @inject-into  page
// @sandbox      raw
// @grant        none
// ==/UserScript==
`;
// Request the page world explicitly in Userscripts and Tampermonkey. An isolated
// content-world fetch hook cannot observe Spotify's page requests.
const pageCode=`(()=>{\n${reader}\n${entry}\nrunSpotifyCompanion();\n})();`;
const output=header+`(()=>{if(window.top!==window.self)return;${pageCode}})();\n`;
await writeFile(new URL('../js/spotplus-spotify.user.js',import.meta.url),output);
await writeFile(new URL('../js/spotplus-spotify.meta.js',import.meta.url),header);
console.log('Built the self-contained Spotify browser companion.');
