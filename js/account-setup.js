export function connectionDevice(ua='',platform='',touches=0){if(/iPhone|iPad|iPod/i.test(ua)||(platform==='MacIntel'&&touches>1))return 'iphone';if(/Android/i.test(ua))return 'android';return 'computer';}
import {COMPANION_VERSION,spotifyCover,spotifyProfileURL} from './spotify-reader.js';
export {COMPANION_VERSION};
export const COMPANION_INSTALL_URL='https://coye2.github.io/spot-plus/js/spotplus-spotify.user.js';
const escapeHtml=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function spotifyProfileHtml(account) {
 if(!account?.id)return '';
 const name=account.name||account.id,avatar=spotifyCover(account.avatar),link=spotifyProfileURL(account.id);
 return '<div class="spotify-profile"><div class="spotify-profile-photo" aria-hidden="true"><span>'+escapeHtml([...name][0]?.toUpperCase()||'S')+'</span>'+(avatar?'<img src="'+escapeHtml(avatar)+'" alt="" width="88" height="88" loading="lazy" decoding="async" referrerpolicy="no-referrer">':'')+'</div><div class="spotify-profile-details"><div class="kicker">Your Spotify profile</div><h2>'+escapeHtml(name)+'</h2><p class="muted">'+escapeHtml(account.id)+'</p>'+(link?'<a class="link" href="'+escapeHtml(link)+'" target="_blank" rel="noopener noreferrer">View on Spotify ↗</a>':'')+'</div></div>';
}
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
 if(device==='iphone')return deviceChoices(device)+iphoneSetupHtml();
 const android=device==='android';
 // Same two steps as iPhone: install once, then one tap to connect.
 return deviceChoices(device)+'<div class="connect-steps">'+
 '<section class="connect-step"><span class="step-number">1</span><div><h2>Install the helper (once)</h2><p>'+(android?'Use <b>Firefox</b> on Android and add the free Tampermonkey extension.':'Add the free Tampermonkey extension to Chrome, Edge or Firefox.')+'</p><div class="account-actions"><a class="btn" href="'+info.url+'" target="_blank" rel="noopener">Get Tampermonkey</a><a class="btn primary" href="'+COMPANION_INSTALL_URL+'" target="_blank" rel="noopener">Install helper</a></div><p>Tampermonkey opens an install page. Tap <b>Install</b>.</p></div></section>'+
 '<section class="connect-step"><span class="step-number">2</span><div><h2>Connect Spotify</h2><p>Sign in on Spotify’s website. The Spot+ panel reads your library and sends it back here by itself.</p><div class="account-actions"><button class="btn primary" data-act="account-connect">Open Spotify</button>'+(android?'<button class="btn" data-act="account-paste">Paste from Spotify</button>':'')+'</div><p class="connection-feedback" id="accountConnectionStatus" role="status">'+(android?'If the Spotify app opens instead, paste the copied link into Firefox’s address bar.':'Only music details are copied. Your login stays on Spotify.')+'</p></div></section></div>'+
 '<details class="connection-help"><summary>Troubleshooting</summary><p>No Spot+ panel on Spotify? Make sure the Spot+ script is enabled in Tampermonkey'+(android?'':'. In Chrome or Edge, also turn on <b>Allow User Scripts</b> in Tampermonkey’s extension details')+', then reload Spotify. Panel there but nothing read? Open Your Library and click <b>Read library</b>.</p><p>Library didn’t come back? Use <b>Copy for Spot+</b> in the panel, then <b>Paste from Spotify</b> here, or <b>Save library file</b> and:</p><div class="account-actions"><button class="btn" data-act="account-paste">Paste from Spotify</button><button class="btn" data-act="account-file">Import library file</button></div><p><a href="#/spotify-account/helper">Other ways to install the helper</a> · <a href="#/spotify">Import a Spotify data export</a></p></details>'+
 '<p class="connection-note">Helper '+COMPANION_VERSION+' · Experimental. Copies music metadata when you refresh; it never changes your Spotify account.</p>';
}
// iPhone: two steps. Install opens real Safari (extensions don't run inside the Home
// Screen app). Connect opens Spotify; the library comes back by message in Safari or
// by one-tap clipboard paste in the Home Screen app.
const USERSCRIPTS_APP='https://apps.apple.com/app/userscripts/id1463298887';
function iphoneSetupHtml(){
 return '<div class="connect-steps">'+
 '<section class="connect-step"><span class="step-number">1</span><div><h2>Install the helper (once)</h2><p>Get the free Userscripts app, then turn it on: Settings → Apps → Safari → Extensions → Userscripts → <b>Allow</b> for all websites.</p><div class="account-actions"><a class="btn" href="'+USERSCRIPTS_APP+'" target="_blank" rel="noopener">Get Userscripts</a><button class="btn primary" data-act="account-install-helper">Install helper</button></div><p>On the page that opens, tap <b>ᴀA</b> → <b>Userscripts</b> → <b>Install</b>.</p></div></section>'+
 '<section class="connect-step"><span class="step-number">2</span><div><h2>Connect Spotify</h2><p>Sign in on Spotify. When the Spot+ panel is ready, tap <b>Copy for Spot+</b> and come back here.</p><div class="account-actions"><button class="btn primary" data-act="account-connect">Open Spotify</button><button class="btn" data-act="account-paste">Paste from Spotify</button></div><p class="connection-feedback" id="accountConnectionStatus" role="status">Only music details are copied. Your login stays on Spotify.</p></div></section></div>'+
 '<details class="connection-help"><summary>Troubleshooting</summary><p>No Spot+ panel on Spotify? Check that Userscripts is allowed on open.spotify.com and reload. Panel there but nothing read? Open Your Library and tap <b>Read library</b>.</p><p>Paste not working? Choose <b>Save library file</b> on Spotify instead, then:</p><button class="btn" data-act="account-file">Import library file</button><p><a href="#/spotify-account/helper">Other ways to install the helper</a> · <a href="#/spotify">Import a Spotify data export</a></p></details>'+
 '<p class="connection-note">Helper '+COMPANION_VERSION+' · Experimental. Copies music metadata when you refresh; it never changes your Spotify account.</p>';
}
