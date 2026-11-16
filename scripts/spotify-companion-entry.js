// Bundled with spotify-reader.js by build-companion.mjs. Runs only on open.spotify.com.
/* global READ_QUERIES, SPOTIFY_QUERY_URL, COMPANION_VERSION, readSpotifyAccount, canAutoRead, encodeLibraryText, readSpotifyStats, readSpotifyProfile, SpotPlusSync */
function runSpotifyCompanion(){
  if(location.origin!=='https://open.spotify.com'||document.getElementById('spotplus-companion'))return;
  const permittedOrigins=['https://coye2.github.io'];
  let targetOrigin=permittedOrigins[0];
  const originalFetch=window.fetch.bind(window), credentials={};
  const observedQueries=new Map();
  const isIOS=/iPhone|iPad|iPod/i.test(navigator.userAgent)||(navigator.platform==='MacIntel'&&navigator.maxTouchPoints>1);
  let libraryText=null,controller=null,library=null,host=null,bridge=null,receiver=null,autoAttempted=false,autoTimer,attemptedAuth=null,allowAuthRetry=false,autoCancelled=false;
  try {
    const params=new URL(location.href).searchParams;
    const nonce=params.get('spotplus_bridge');
    const requestedOrigin=params.get('spotplus_origin');
    if(permittedOrigins.includes(requestedOrigin))targetOrigin=requestedOrigin;
    if(/^[a-f0-9]{32}$/.test(nonce||''))sessionStorage.setItem('spotplus.bridge',JSON.stringify({nonce,origin:targetOrigin,started:Date.now()}));
    const saved=JSON.parse(sessionStorage.getItem('spotplus.bridge')||'null');
    if(saved&&Date.now()-saved.started<30*60*1000&&/^[a-f0-9]{32}$/.test(saved.nonce)){bridge=saved;if(permittedOrigins.includes(saved.origin))targetOrigin=saved.origin;}
  }catch{ /* Safari can disable storage in a restricted session. File handoff still works. */ }
  // Auto-sync: Spot+ hands over a link key once, in the URL #fragment (never sent to
  // Spotify's servers). From then on, any visit to Spotify's website quietly publishes
  // your top music and recent plays (encrypted) for Spot+ to pick up, every 30 minutes.
  let syncKey=null,syncing=false;
  try{
    const linked=location.hash.match(/spotplus_sync=([a-f0-9]{64})/);
    if(linked){localStorage.setItem('spotplus.syncKey',linked[1]);history.replaceState(history.state,'',location.pathname+location.search);}
    syncKey=localStorage.getItem('spotplus.syncKey');
  }catch{ /* Storage disabled: auto-sync stays off. */ }
  const allowedHeaders=['authorization','client-token','spotify-app-version','app-platform'];
  function rememberBody(body){
    try {
      const value=typeof body==='string'?JSON.parse(body):body;
      const hash=value?.extensions?.persistedQuery?.sha256Hash;
      if(Object.hasOwn(READ_QUERIES,value?.operationName)&&/^[a-f0-9]{64}$/.test(hash))observedQueries.set(value.operationName,{hash,variables:value.variables||{}});
    }catch{ /* Unrelated Spotify request. */ }
  }
  function rememberHeaders(headers){
    try {const h=new Headers(headers);for(const name of allowedHeaders)if(h.has(name))credentials[name]=h.get(name);}catch{ /* Preserve Spotify's request even if it has unusual headers. */ }
    maybeAutoRead();
  }
  function isQuery(value){try {const u=new URL(value,location.origin);return u.origin==='https://api-partner.spotify.com'&&/^\/pathfinder\/v[12]\/query$/.test(u.pathname);}catch{return false;}}
  // Observe only Spotify's own query requests. Never read document.cookie or save credentials.
  window.fetch=function(input,init){
    try {
      const url=typeof input==='string'||input instanceof URL?String(input):input.url;
      if(isQuery(url)){
        rememberHeaders(init?.headers||input?.headers);
        const u=new URL(url);if(u.searchParams.has('operationName'))rememberBody({operationName:u.searchParams.get('operationName'),variables:JSON.parse(u.searchParams.get('variables')||'{}'),extensions:JSON.parse(u.searchParams.get('extensions')||'{}')});
        if(init?.body)rememberBody(init.body);else if(input instanceof Request&&input.method==='POST')input.clone().text().then(rememberBody).catch(()=>{});
      }
    }catch{ /* Observation must never interrupt Spotify. */ }
    return originalFetch(input,init);
  };
  const xhrRequests=new WeakMap(),xhrOpen=XMLHttpRequest.prototype.open,xhrHeader=XMLHttpRequest.prototype.setRequestHeader,xhrSend=XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open=function(method,url,...rest){xhrRequests.set(this,{query:isQuery(url)});return xhrOpen.call(this,method,url,...rest);};
  XMLHttpRequest.prototype.setRequestHeader=function(name,value){if(xhrRequests.get(this)?.query&&allowedHeaders.includes(String(name).toLowerCase()))credentials[String(name).toLowerCase()]=String(value);return xhrHeader.call(this,name,value);};
  XMLHttpRequest.prototype.send=function(body){if(xhrRequests.get(this)?.query){rememberBody(body);maybeAutoRead();}return xhrSend.call(this,body);};
  function status(message){const p=host?.shadowRoot?.getElementById('status');if(p)p.textContent=message;}
  function notify(phase){if(bridge&&window.opener&&Date.now()-bridge.started<1800000)window.opener.postMessage({type:'spotplus-connection-status',nonce:bridge.nonce,phase},targetOrigin);}
  function controls(busy){for(const id of ['read','send','save']){const b=host?.shadowRoot?.getElementById(id);if(b)b.disabled=busy;}const cancel=host?.shadowRoot?.getElementById('cancel');if(cancel)cancel.hidden=!busy;}
  async function query(name,variables){
    if(!Object.hasOwn(READ_QUERIES,name))throw new Error('Only reading your music library is supported.');
    controller.signal.throwIfAborted();
    const known=observedQueries.get(name),headers={};
    for(const key of allowedHeaders)if(credentials[key])headers[key]=credentials[key];
    if(!/^Bearer\s+\S+$/.test(headers.authorization||''))throw new Error('Sign in to Spotify and open Your Library first. Then tap Read library. If needed, reload this Spotify tab after enabling the companion.');
    headers['content-type']='application/json';
    const body={operationName:name,variables:{...known?.variables,...variables},extensions:{persistedQuery:{version:1,sha256Hash:known?.hash||READ_QUERIES[name]}}};
    const timeout=new AbortController(),id=setTimeout(()=>timeout.abort(),name==='getTrack'?5000:30000);
    const abort=()=>timeout.abort();controller.signal.addEventListener('abort',abort,{once:true});
    try{
      const response=await originalFetch(SPOTIFY_QUERY_URL,{method:'POST',headers,body:JSON.stringify(body),credentials:'omit',cache:'no-store',redirect:'error',signal:timeout.signal});
      if(response.status===401)throw new Error('Your Spotify session expired. Reload Spotify and sign in again.');
      if(response.status===429)throw new Error('Spotify is limiting requests. Wait '+(Math.max(1,Number(response.headers.get('retry-after'))||60))+' seconds before syncing again.');
      if(response.status===403)throw new Error('Spotify refused this request. Open the collection on Spotify and try again.');
      if(!response.ok)throw new Error('Spotify is temporarily unavailable ('+response.status+'). Your previous library is kept.');
      const result=await response.json();
      if(result.errors?.length){
        if(name==='getTrack'){const error=new Error('Spotify could not supply the missing song details.');error.code='metadata-unavailable';throw error;}
        if(name==='fetchPlaylist'&&result.errors.every(e=>['NOT_FOUND','PERMISSION_DENIED'].includes(e.extensions?.code))){const error=new Error('Playlist unavailable');error.code='unavailable';throw error;}
        throw new Error('Spotify’s web interface changed or this collection is unavailable. Open Liked Songs and a playlist on Spotify, then try again. Your saved library is kept.');
      }
      return result;
    }catch(error){
      if(error.name==='AbortError'){
        const failure=new Error(controller.signal.aborted?'Sync cancelled. Your saved library is kept.':'Spotify took too long to respond. Try again.');
        if(name==='getTrack'&&!controller.signal.aborted)failure.code='metadata-unavailable';
        throw failure;
      }
      throw error;
    }
    finally{clearTimeout(id);controller.signal.removeEventListener('abort',abort);}
  }
  // GET-only access to the allowlisted listening-stats paths on Spotify's public Web API,
  // using the web player's own authorization. Nothing is written to the account.
  async function webGet(path){
    if(!/^\/v1\/me\/(top\/(tracks|artists)\?time_range=(short|medium|long)_term&limit=50|player\/recently-played\?limit=50)$/.test(path))throw new Error('Only reading listening stats is supported.');
    controller?.signal.throwIfAborted();
    if(!/^Bearer\s+\S+$/.test(credentials.authorization||''))throw new Error('Spotify session not ready.');
    const timeout=new AbortController(),id=setTimeout(()=>timeout.abort(),15000),abort=()=>timeout.abort();
    controller?.signal.addEventListener('abort',abort,{once:true});
    try{
      const response=await originalFetch('https://api.spotify.com'+path,{headers:{authorization:credentials.authorization,accept:'application/json'},credentials:'omit',cache:'no-store',redirect:'error',signal:timeout.signal});
      if(!response.ok){const error=new Error('Spotify stats unavailable ('+response.status+').');error.status=response.status;throw error;}
      return await response.json();
    }finally{clearTimeout(id);controller?.signal.removeEventListener('abort',abort);}
  }
  function syncNote(text){const p=host?.shadowRoot?.getElementById('sync');if(p)p.textContent=text;}
  async function publishStats(stats,account){
    if(!syncKey||!stats)return;
    const n=await SpotPlusSync.publishSnapshot(syncKey,{v:1,account,stats,at:Date.now()});
    if(!n)throw new Error('no relay reachable');
    try{localStorage.setItem('spotplus.syncAt',String(Date.now()));}catch{ /* Ignore. */ }
    syncNote('Auto-sync on · Spot+ updated just now');
  }
  async function autoSync(){
    if(!syncKey||syncing||controller||!/^Bearer\s+\S+$/.test(credentials.authorization||''))return;
    let last=0;try{last=Number(localStorage.getItem('spotplus.syncAt'))||0;}catch{ /* Ignore. */ }
    if(Date.now()-last<30*60*1000)return;
    syncing=true;controller=new AbortController();
    try{
      syncNote('Auto-sync · updating Spot+…');
      const stats=await readSpotifyStats(webGet);
      let account=null;try{account=readSpotifyProfile((await query('profileAttributes',{})).data?.me?.profile);}catch{ /* Stats still sync. */ }
      await publishStats(stats,account);
    }catch(error){syncNote('Auto-sync will retry later ('+String(error.message||error).slice(0,60)+')');}
    finally{syncing=false;controller=null;}
  }
  setInterval(autoSync,5*60*1000);
  function maybeAutoRead(){
    if(syncKey)setTimeout(autoSync,4000);
    if(!canAutoRead({bridge,hostReady:!!host,authorization:credentials.authorization,attempted:autoCancelled||(autoAttempted&&!(allowAuthRetry&&attemptedAuth!==credentials.authorization))}))return;
    autoAttempted=true;attemptedAuth=credentials.authorization;allowAuthRetry=false;status('Connected to Spotify. Reading your library…');autoTimer=setTimeout(()=>host?.shadowRoot?.getElementById('read')?.click(),600);
  }
  function sendLibrary(openReceiver=false){
    if(!library)return false;
    if(bridge&&window.opener&&Date.now()-bridge.started<1800000){
      window.opener.postMessage({type:'spotplus-library',nonce:bridge.nonce,library},targetOrigin);
      status('Sent for review. Return to Spot+ to apply your library. If nothing arrives, use Save library file.');
      if(!openReceiver)return true;
    }
    if(!openReceiver)return false;
    if(!bridge||Date.now()-bridge.started>=1800000)bridge={nonce:[...crypto.getRandomValues(new Uint8Array(16))].map(b=>b.toString(16).padStart(2,'0')).join(''),origin:targetOrigin,started:Date.now()};
    const base=targetOrigin===permittedOrigins[0]?targetOrigin+'/spot-plus/':targetOrigin+'/';
    receiver=window.open(base+'#/spotify-account/receive/'+bridge.nonce,'spotplus-library-return');
    status(receiver?'Spot+ opened for review. Keep this Spotify tab open until the transfer finishes.':'Your browser blocked the return tab. Choose Save library file, then import it in Spot+.');
    return !!receiver;
  }
  function mount(){
    if(!document.body)return;
    host=document.createElement('div');host.id='spotplus-companion';host.style.cssText='position:fixed;right:12px;bottom:88px;z-index:2147483647;max-width:calc(100vw - 24px)';
    const root=host.attachShadow({mode:'open'});
    root.innerHTML='<style>:host{color-scheme:dark}*{box-sizing:border-box}section{font:14px/1.45 system-ui,sans-serif;color:#fff;background:#090e0b;border:1px solid #315d49;border-radius:16px;padding:16px;width:330px;max-width:100%;box-shadow:0 8px 36px #000a}h2{font-size:18px;margin:0 0 8px}p{color:#c2c9c4;margin:8px 0}button,a{font:inherit;min-height:44px;border:1px solid #315d49;background:#15231b;color:#fff;border-radius:22px;padding:9px 14px;cursor:pointer;text-decoration:none;display:inline-flex;align-items:center;margin:4px 4px 0 0}button:first-of-type{background:#1b5e46}button:disabled{opacity:.5;cursor:wait}small{display:block;color:#abb6ae;margin-top:12px}#close{float:right;border:0;padding:4px;min-height:28px;margin:0;background:transparent}#cancel[hidden],#sync:empty{display:none}.sync-note{font-size:11px;opacity:.72;margin:6px 0 0}#copy[hidden],#send[hidden],#save[hidden]{display:none}#copy{background:#1db954;color:#000;font-weight:700;width:100%;justify-content:center;min-height:52px}#read[hidden]{display:none}#save{border:0;background:transparent;color:#abb6ae;text-decoration:underline}</style><section aria-label="Spot+ Spotify companion"><button id="close" aria-label="Minimize companion">−</button><h2>Spot+ companion · Beta</h2><div id="body"><p>Read your signed-in Spotify library. No Premium or developer account needed.</p><p id="status" role="status" aria-live="polite">Sign in and open Your Library, then tap Read library.</p><p id="sync" class="sync-note"></p><button id="read">Read library</button><button id="cancel" hidden>Cancel</button><button id="copy" hidden>Copy for Spot+</button><button id="send" hidden>Send to Spot+</button><button id="save" hidden>Save library file</button><small>Reads Liked Songs, playlists, saved albums and followed artists. Only your profile and music details leave this page. Spotify cookies and session tokens stay here.</small></div></section>';
    document.body.append(host);
    const version=document.createElement('small');version.textContent='Helper '+COMPANION_VERSION;root.querySelector('h2').append(version);
    root.getElementById('close').onclick=()=>{const body=root.getElementById('body');body.hidden=!body.hidden;root.getElementById('close').textContent=body.hidden?'+':'−';};
    root.getElementById('cancel').onclick=()=>{clearTimeout(autoTimer);autoAttempted=true;autoCancelled=true;controller?.abort();};
    root.getElementById('read').onclick=async()=>{
      clearTimeout(autoTimer);autoAttempted=true;if(controller&&!controller.signal.aborted&&root.getElementById('read').disabled)return;
      library=null;libraryText=null;controller=new AbortController();controls(true);for(const id of ['copy','send','save'])root.getElementById(id).hidden=true;
      notify('reading');
      try{
        library=await readSpotifyAccount(query,{signal:controller.signal,onProgress:status});
        // Listening stats ride along automatically. Optional: the library still sends if they fail.
        try{library.stats=await readSpotifyStats(webGet,{onProgress:status});publishStats(library.stats,library.account).catch(()=>{});}
        catch(error){if(controller.signal.aborted)throw error;library.stats=null;library.statsError=String(error.message||'Stats unavailable').slice(0,200);}
        if(JSON.stringify(library).length>12*1024*1024)throw new Error('Your library exceeds the 12 MB phone transfer limit. Use Spotify’s data export.');
        const unavailable=library.playlists.filter(p=>p.status==='unavailable').length;
        const unreadable=library.likesUnreadable+library.playlists.reduce((n,p)=>n+(p.unreadable||0),0);
        status('Ready for review: '+library.likes.length+' liked songs, '+library.playlists.length+' playlists'+(library.stats?', your top music and recent plays.':'.')+(unavailable?' '+unavailable+' unavailable; any saved copies will be kept.':'')+(unreadable?' Song entries with incomplete details: '+unreadable+'. Existing copies of affected collections will be kept; new collections contain the readable songs.':'')+(isIOS?' Tap Copy for Spot+, then open Spot+ and tap Paste from Spotify.':' Review and send your library to Spot+.'));
        encodeLibraryText(library).then(text=>{libraryText=text;},()=>{libraryText=null;});
        // iPhone without a Spot+ tab to message: Copy is the one button that matters.
        const pasteOnly=isIOS&&!window.opener;
        root.getElementById('copy').hidden=false;root.getElementById('send').hidden=pasteOnly;root.getElementById('save').hidden=false;
        if(pasteOnly){root.getElementById('read').hidden=true;status('Ready: '+library.likes.length+' liked songs, '+library.playlists.length+' playlists. Tap Copy for Spot+, then go back to Spot+.');}
        notify('done');
        if(sendLibrary()&&isIOS)status('Sent! Switch back to the Spot+ tab to apply your library.');
      }catch(error){library=null;allowAuthRetry=/sign in|session expired/i.test(error.message||'');status(error.message||'Sync could not complete. Your previous library is kept.');notify('error');}
      finally{controls(false);}
    };
    root.getElementById('send').onclick=()=>sendLibrary(true);
    // The clipboard is shared by Safari and the iPhone Home Screen app, so this works
    // where tab messaging cannot. Every path below starts synchronously inside the tap.
    const copied=()=>{status('Copied ✓ Now go back to Spot+ — it will offer to paste. Nothing was sent anywhere else.');root.getElementById('copy').textContent='Copied ✓';};
    const copyFailed=error=>status('Copy failed'+(error?.name?' ('+error.name+')':'')+'. Tap Copy for Spot+ again, or Save library file.');
    function legacyCopy(text){
      // execCommand works on iOS Safari within a tap, even where the async API refuses.
      const field=document.createElement('textarea');field.value=text;field.readOnly=true;
      field.style.cssText='position:fixed;top:0;left:0;width:1px;height:1px;opacity:0;font-size:16px';
      root.append(field);field.focus();field.setSelectionRange(0,text.length);
      let ok=false;try{ok=document.execCommand('copy');}catch{ok=false;}field.remove();return ok;
    }
    root.getElementById('copy').onclick=()=>{
      if(!library)return;
      const clip=navigator.clipboard;
      if(libraryText){
        if(clip?.writeText)clip.writeText(libraryText).then(copied,error=>legacyCopy(libraryText)?copied():copyFailed(error));
        else if(legacyCopy(libraryText))copied();else copyFailed();
        return;
      }
      // Not encoded yet: Safari accepts a promised ClipboardItem inside the tap.
      if(clip?.write&&typeof ClipboardItem==='function'){
        const blob=encodeLibraryText(library).then(text=>{libraryText=text;return new Blob([text],{type:'text/plain'});});
        clip.write([new ClipboardItem({'text/plain':blob})]).then(copied,copyFailed);
      }else status('Preparing your library… tap Copy for Spot+ again in a moment.');
    };
    root.getElementById('save').onclick=()=>{
      if(!library)return;
      const name='spotplus-spotify-library.json',json=JSON.stringify(library);
      // iPhone: the share sheet's Save to Files is the reliable way to keep a file.
      try{
        const file=new File([json],name,{type:'application/json'});
        if(isIOS&&navigator.canShare?.({files:[file]})){
          navigator.share({files:[file]}).then(()=>status('Saved. In Spot+, choose Import library file and pick '+name+'.'),error=>{if(error?.name!=='AbortError')status('Sharing failed. Try Copy for Spot+ instead.');});
          return;
        }
      }catch{ /* Fall back to a normal download. */ }
      const url=URL.createObjectURL(new Blob([json],{type:'application/json'}));
      const a=document.createElement('a');a.href=url;a.download=name;a.rel='noopener';a.style.display='none';
      root.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);
      status('Downloaded '+name+'. In Spot+, choose Import library file.');
    };
    // Spotify's mobile site handles touches at the document level, which can cancel
    // the synthetic click on iOS. Run each button on touchend and keep panel events
    // away from Spotify's listeners.
    for(const type of ['touchstart','touchend','pointerdown','pointerup','mousedown','mouseup','click'])host.addEventListener(type,event=>event.stopPropagation());
    for(const button of root.querySelectorAll('button')){
      let start=null;
      button.addEventListener('touchstart',event=>{const t=event.touches[0];start=t&&{x:t.clientX,y:t.clientY};},{passive:true});
      button.addEventListener('touchend',event=>{
        const t=event.changedTouches[0];
        if(!start||!t||Math.abs(t.clientX-start.x)>10||Math.abs(t.clientY-start.y)>10||button.disabled||button.hidden)return;
        start=null;event.preventDefault();button.onclick?.(event);
      },{passive:false});
    }
    maybeAutoRead();
    notify('ready');
    window.addEventListener('message',event=>{
      if(!bridge||Date.now()-bridge.started>=1800000||event.origin!==targetOrigin||event.data?.nonce!==bridge.nonce)return;
      if(event.data.type==='spotplus-receiver-ready'&&event.source===receiver&&library)receiver.postMessage({type:'spotplus-library',nonce:bridge.nonce,library},targetOrigin);
      if(event.data.type==='spotplus-library-applied'&&(event.source===window.opener||event.source===receiver)){
        status('Your library is now saved in Spot+. You can close this Spotify tab.');
        if(/^[a-f0-9]{64}$/.test(event.data.syncKey||'')){syncKey=event.data.syncKey;try{localStorage.setItem('spotplus.syncKey',syncKey);}catch{ /* Ignore. */ }publishStats(library?.stats,library?.account).catch(()=>{});}
      }
    });
  }
  if(document.body)mount();else document.addEventListener('DOMContentLoaded',mount,{once:true});
}
