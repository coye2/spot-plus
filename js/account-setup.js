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
const USERSCRIPTS_APP_URL='https://apps.apple.com/app/userscripts/id1463298887';
const USERSCRIPTS_APP=USERSCRIPTS_APP_URL;
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
export function spotifyConnectionURLs(origin,nonce,syncKey='') {
 if(!/^https?:\/\//.test(origin)||!/^[a-f0-9]{32}$/.test(nonce))throw new Error('Invalid connection request');
 const browser=new URL('https://open.spotify.com/collection');
 browser.searchParams.set('spotplus_origin',new URL(origin).origin);browser.searchParams.set('spotplus_bridge',nonce);
 // The auto-sync link key rides in the #fragment, which browsers never send to Spotify.
 if(/^[a-f0-9]{64}$/.test(syncKey))browser.hash='spotplus_sync='+syncKey;
 const login=new URL('https://accounts.spotify.com/login');login.searchParams.set('continue',browser.href);
 return {browser:browser.href,login:login.href};
}
// One guide per device: three steps, each with one main button, a plain sentence of what to expect, and a check-off
// so you can see where you are. Your progress is kept on this device.
const STEPS_KEY='spotplus.connectSteps';
export function stepProgress(device,storage=globalThis.localStorage){try{return JSON.parse(storage?.getItem(STEPS_KEY)||'{}')[device]||{};}catch{return {};}}
export function markStep(device,step,on,storage=globalThis.localStorage){try{const all=JSON.parse(storage?.getItem(STEPS_KEY)||'{}');all[device]={...(all[device]||{}),[step]:!!on};storage?.setItem(STEPS_KEY,JSON.stringify(all));}catch{/* storage blocked */}}
const GUIDES={
 iphone:[
  {title:'Get the free Userscripts app',body:'It lets Safari run the small Spot+ helper on Spotify’s website. Then open <b>Settings → Apps → Safari → Extensions → Userscripts</b>, turn it on and choose <b>Allow</b> for every website.',button:'<a class="btn primary" href="'+USERSCRIPTS_APP_URL+'" target="_blank" rel="noopener">Get Userscripts</a>'},
  {title:'Add the Spot+ helper',body:'Tap the button: the helper opens in Safari as a page of code. That’s expected. Tap <b>ᴀA</b> (or the puzzle piece) in the address bar → <b>Userscripts</b> → <b>Install</b>.',button:'<button class="btn primary" data-act="account-install-helper">Open the helper in Safari</button>'},
  {title:'Open Spotify and copy your library',body:'Sign in on Spotify’s website in Safari. A green Spot+ panel appears: tap <b>Copy for Spot+</b>, come back here and tap <b>Paste from Spotify</b>.',button:'<button class="btn primary" data-act="account-connect">Open Spotify</button><button class="btn" data-act="account-paste">Paste from Spotify</button>'},
 ],
 android:[
  {title:'Install Firefox and Tampermonkey',body:'Chrome on Android can’t run add-ons, so use <b>Firefox</b>. In Firefox, add the free <b>Tampermonkey</b> extension.',button:'<a class="btn primary" href="https://www.tampermonkey.net/index.php?browser=firefox" target="_blank" rel="noopener">Get Tampermonkey for Firefox</a>'},
  {title:'Add the Spot+ helper',body:'Open this page in Firefox and tap the button. Tampermonkey shows an install page: tap <b>Install</b>.',button:'<a class="btn primary" href="'+COMPANION_INSTALL_URL+'" target="_blank" rel="noopener">Add the helper</a>'},
  {title:'Open Spotify and sign in',body:'Sign in on Spotify’s website in Firefox. The Spot+ panel reads your library and sends it back here by itself. If the Spotify app opens instead, tap <b>Copy for Spot+</b> on the website and paste here.',button:'<button class="btn primary" data-act="account-connect">Open Spotify</button><button class="btn" data-act="account-paste">Paste from Spotify</button>'},
 ],
 computer:[
  {title:'Add Tampermonkey to your browser',body:'It’s free and works in Chrome, Edge and Firefox. <b>Chrome or Edge:</b> afterwards open the extension’s <b>Details</b> and turn on <b>Allow User Scripts</b>.',button:'<a class="btn primary" href="https://www.tampermonkey.net/" target="_blank" rel="noopener">Get Tampermonkey</a>'},
  {title:'Add the Spot+ helper',body:'Click the button. Tampermonkey opens an install page: click <b>Install</b>. Only code showing? Use <b>Copy link</b> and paste it into Tampermonkey → Dashboard → Utilities → Import from URL.',button:'<a class="btn primary" href="'+COMPANION_INSTALL_URL+'" target="_blank" rel="noopener">Add the helper</a><button class="btn" data-act="account-helper-copy">Copy link</button><input class="connection-link" id="helperInstallLink" readonly hidden value="'+COMPANION_INSTALL_URL+'">'},
  {title:'Open Spotify and sign in',body:'Sign in on Spotify’s website in the same browser. The Spot+ panel reads your Liked Songs and playlists and sends them back here by itself.',button:'<button class="btn primary" data-act="account-connect">Open Spotify</button>'},
 ],
};
export function setupHtml(selected){
 const device=validDevice(selected),done=stepProgress(device),steps=GUIDES[device];
 const next=steps.findIndex((_,i)=>!done[i+1]);
 return deviceChoices(device)+'<ol class="guide">'+steps.map((st,i)=>{const n=i+1,ok=!!done[n],now=i===(next<0?steps.length-1:next);
  return '<li class="guide-step'+(ok?' done':'')+(now?' now':'')+'"><button class="guide-check" data-act="connect-step" data-device="'+device+'" data-step="'+n+'" aria-pressed="'+ok+'" aria-label="'+(ok?'Mark step '+n+' as not done':'Mark step '+n+' as done')+'">'+(ok?'✓':n)+'</button><div class="guide-body"><h3>'+st.title+'</h3>'+(ok&&!now?'':'<p>'+st.body+'</p><div class="account-actions">'+st.button+'</div>')+'</div></li>';}).join('')+'</ol>'+
 '<p class="connection-feedback" id="accountConnectionStatus" role="status"><span id="helperCopyStatus"></span>Only music details are copied. Your login stays on Spotify, and Spot+ never changes your account.</p>'+
 '<details class="connection-help"><summary>Something not working?</summary><ul class="guide-help">'+
 '<li><b>No Spot+ panel on Spotify?</b> '+(device==='iphone'?'In Safari tap ᴀA → Userscripts and make sure it’s on for open.spotify.com, then reload.':device==='android'?'Make sure you’re in Firefox and the script is on in Tampermonkey, then reload.':'Make sure the script is on in Tampermonkey (and Allow User Scripts in Chrome/Edge), then reload.')+' The helper can’t run inside the Spotify app, only on the website.</li>'+
 '<li><b>Panel there but nothing read?</b> Open Your Library on the website and press <b>Read library</b>.</li>'+
 '<li><b>Library didn’t come back?</b> Press <b>Copy for Spot+</b> in the panel and paste here, or <b>Save library file</b> and import it: <span class="account-actions"><button class="btn small" data-act="account-paste">Paste from Spotify</button><button class="btn small" data-act="account-file">Import library file</button></span></li>'+
 '<li><b>Updating?</b> Add the helper again the same way; the panel shows <b>Helper '+COMPANION_VERSION+'</b> when you have the latest.</li></ul></details>';
}
