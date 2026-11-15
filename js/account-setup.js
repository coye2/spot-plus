export function connectionDevice(ua='',platform='',touches=0){if(/iPhone|iPad|iPod/i.test(ua)||(platform==='MacIntel'&&touches>1))return 'iphone';if(/Android/i.test(ua))return 'android';return 'computer';}
import {COMPANION_VERSION} from './spotify-reader.js';
export {COMPANION_VERSION};
export const COMPANION_INSTALL_URL='https://coye2.github.io/spot-plus/js/spotplus-spotify.user.js';
const deviceInfo={
 iphone:{browser:'Safari',manager:'Userscripts',url:'https://github.com/quoid/userscripts#installation'},
 android:{browser:'Firefox',manager:'Tampermonkey',url:'https://www.tampermonkey.net/index.php?browser=firefox'},
 computer:{browser:'Chrome, Edge or Firefox',manager:'Tampermonkey',url:'https://www.tampermonkey.net/'}
};
function validDevice(selected){return Object.hasOwn(deviceInfo,selected)?selected:'computer';}
function deviceChoices(device){return '<div class="device-choices" aria-label="Your device">'+[['iphone','iPhone'],['android','Android'],['computer','Computer']].map(([key,label])=>'<button data-act="account-device" data-device="'+key+'" aria-pressed="'+(key===device)+'">'+label+'</button>').join('')+'</div>';}

export async function copyHelperInstallLink({clipboard,field,status}){
 try{
  if(!clipboard?.writeText)throw new Error('Clipboard unavailable');
  await clipboard.writeText(COMPANION_INSTALL_URL);
  status.textContent='Link copied. Open Tampermonkey → Dashboard → Utilities, then paste it into Import from URL.';
  return true;
 }catch{
  field.focus();field.select();
  status.textContent='Automatic copying is unavailable. The link is selected below; use Copy, then paste it into Tampermonkey’s Import from URL field.';
  return false;
 }
}

export function helperInstallHtml(selected){
 const device=validDevice(selected),info=deviceInfo[device],iphone=device==='iphone';
 const importSteps='<ol class="helper-steps"><li>Open your browser’s <b>Extensions</b> menu and choose <b>Tampermonkey → Dashboard</b>.</li><li>Open <b>Utilities</b>, then find <b>Import from URL</b>.</li><li>Paste the copied link into that field and click <b>Install</b>. Confirm on Tampermonkey’s review screen.</li></ol>';
 const install=iphone?
  '<section class="helper-card"><span class="account-badge">Safari · One-time setup</span><h2>Save the helper to Userscripts</h2><p>In the Userscripts app, choose a folder for your scripts. Enable Userscripts in Settings → Apps → Safari → Extensions.</p><a class="btn primary" href="js/spotplus-spotify.user.js" download="spotplus-spotify.user.js">Download helper file</a><p>Save the downloaded <b>spotplus-spotify.user.js</b> in that folder. In Safari, allow Userscripts on <b>open.spotify.com</b> and reload Spotify.</p><details class="helper-extra"><summary>Install through Safari’s extension menu instead</summary><p>Open the helper file below, then choose Safari’s page menu → Extensions → Userscripts → Install. A code page is expected here; the Install control is inside Userscripts.</p><a class="btn" href="'+COMPANION_INSTALL_URL+'" target="_blank" rel="noopener">Open file in Safari</a></details></section>':
  '<section class="helper-card helper-import"><span class="account-badge">Already have Tampermonkey?</span><h2>Add it from your Dashboard</h2><p>This method also works when the helper link only shows code or has no Install button.</p><button class="btn primary helper-copy" data-act="account-helper-copy">Copy install link</button><p id="helperCopyStatus" class="connection-feedback" role="status" aria-live="polite">Copy the link, then follow these three steps.</p>'+importSteps+'<label class="helper-link-label" for="helperInstallLink">Helper link to paste</label><input class="connection-link" id="helperInstallLink" readonly spellcheck="false" value="'+COMPANION_INSTALL_URL+'"><details class="helper-extra"><summary>Try automatic installation instead</summary><p>Open the file and confirm in Tampermonkey. If it shows code or a stalled installation page, return here and use Import from URL above.</p><a class="btn" href="'+COMPANION_INSTALL_URL+'" target="_blank" rel="noopener">Try automatic install</a></details></section>';
 const updateNote='<p class="connection-note">Updating an older helper? '+(iphone?'Replace the file in your Userscripts folder.':'Import the same link again and confirm the update in Tampermonkey.')+' Then reload Spotify. Its Spot+ panel should show <b>Helper '+COMPANION_VERSION+'</b>.</p>';
 return deviceChoices(device)+updateNote+install+
  '<section class="helper-card helper-finish"><h2>Then connect your library</h2><p>Once <b>Spot+ Spotify Library Companion</b> appears enabled in '+info.manager+', continue to Spotify in the same browser. The panel appears on Spotify’s website, after sign-in.</p><button class="btn primary" data-act="account-connect">Continue to Spotify</button><p class="connection-feedback" id="accountConnectionStatus" role="status">Installing the helper does not sign you in or save your library yet.</p></section>'+
  '<details class="connection-help"><summary>Need '+info.manager+' first?</summary><p>Use '+info.browser+'. Install and enable '+info.manager+' in that browser, then return to this page.</p><a class="btn" href="'+info.url+'" target="_blank" rel="noopener">Get '+info.manager+'</a></details>'+
  '<details class="connection-help"><summary>Installed, but no Spot+ panel on Spotify?</summary><p>'+(iphone?'Enable Userscripts in Safari’s extension settings and allow it on open.spotify.com.':'Check that the Spot+ script is enabled in Tampermonkey. In Chrome or Edge, enable Allow User Scripts in Tampermonkey’s extension Details if shown. Allow the extension on open.spotify.com.')+' Reload Spotify’s website. The helper cannot run inside the Spotify app.</p>'+(!iphone?'<a class="link" href="https://www.tampermonkey.net/faq.php?locale=en&q=Q209" target="_blank" rel="noopener">Tampermonkey permission guide</a>':'')+'</details>'+
  '<p class="connection-note">Helper '+COMPANION_VERSION+' · Your browser confirms installation. Spot+ cannot detect it from this page.</p>';
}
export function spotifyConnectionURLs(origin,nonce) {
 if(!/^https?:\/\//.test(origin)||!/^[a-f0-9]{32}$/.test(nonce))throw new Error('Invalid connection request');
 const browser=new URL('https://open.spotify.com/collection');
 browser.searchParams.set('spotplus_origin',new URL(origin).origin);browser.searchParams.set('spotplus_bridge',nonce);
 const login=new URL('https://accounts.spotify.com/login');login.searchParams.set('continue',browser.href);
 return {browser:browser.href,login:login.href};
}
export function setupHtml(selected){
 const device=validDevice(selected),info=deviceInfo[device];
 return deviceChoices(device)+
 '<div class="connect-steps"><section class="connect-step"><span class="step-number">1</span><div><h2>Add the helper once</h2><p>Use '+info.browser+' with '+info.manager+'. Already installed the extension? Add the Spot+ helper from its '+(device==='iphone'?'scripts folder':'Dashboard')+'.</p><div class="account-actions"><button class="btn primary" data-act="account-helper">Set up helper</button></div><p>'+(device==='iphone'?'Get the file and Safari instructions.':'Includes direct import if the install link only shows code.')+'</p></div></section>'+
 '<section class="connect-step"><span class="step-number">2</span><div><h2>Connect in your browser</h2><p>'+(device==='computer'?'Sign in on Spotify’s website in this browser.':'Copy the Spotify browser link and paste it into '+info.browser+'’s address bar. This avoids the Spotify app handoff.')+' Your login stays on Spotify.</p><p>The helper appears on <b>open.spotify.com</b> after sign-in. It cannot run inside the Spotify app.</p><button class="btn" data-act="account-connect">Connect Spotify</button></div></section>'+
 '<section class="connect-step"><span class="step-number">3</span><div><h2>Send your library to Spot+</h2><p>On Spotify’s website, the Spot+ helper reads your library. Choose <b>Send to Spot+</b>, then review and apply it.</p><p class="connection-feedback" id="accountConnectionStatus" role="status">'+(device==='iphone'?'Using the Home Screen app? Choose Save library file in Safari, then Import library file here. Safari and the installed app can keep separate libraries.':'Keep Spotify’s website open until your library is ready.')+'</p><button class="btn" data-act="account-file">Import library file</button></div></section></div>'+
 '<details class="connection-help"><summary>File import & troubleshooting</summary><p>If no library arrives, open Your Library on Spotify and choose <b>Read library</b> in the Spot+ panel. If the tabs cannot communicate, choose <b>Save library file</b>, then import it here.</p><button class="btn" data-act="account-file">Import library file</button><p>No helper panel? <a href="#/spotify-account/helper">Open helper setup</a> to check installation and browser permissions. <a href="#/spotify">Import a Spotify data export</a> also works without a helper.</p></details>'+
 '<p class="connection-note">Free-account browser companion · Experimental. Copies music metadata when you refresh; it does not change your Spotify account. Spotify’s web interface can change.</p>';
}
