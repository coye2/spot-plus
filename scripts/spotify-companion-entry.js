// Bundled with spotify-reader.js by build-companion.mjs. Runs only on open.spotify.com.
/* global READ_QUERIES, SPOTIFY_QUERY_URL, readSpotifyAccount */
function runSpotifyCompanion(){
  if(location.origin!=='https://open.spotify.com'||document.getElementById('spotplus-companion'))return;
  const permittedOrigins=['https://coye2.github.io','https://spot-plus-coyeb.coyeboymitchell2000.chatgpt.site'];
  let targetOrigin=permittedOrigins[0];
  const originalFetch=window.fetch.bind(window), credentials={};
  const observedQueries=new Map();
  let controller=null,library=null,host=null,bridge=null;
  try {
    const params=new URL(location.href).searchParams;
    const nonce=params.get('spotplus_bridge');
    const requestedOrigin=params.get('spotplus_origin');
    if(permittedOrigins.includes(requestedOrigin))targetOrigin=requestedOrigin;
    if(/^[a-f0-9]{32}$/.test(nonce||''))sessionStorage.setItem('spotplus.bridge',JSON.stringify({nonce,origin:targetOrigin,started:Date.now()}));
    const saved=JSON.parse(sessionStorage.getItem('spotplus.bridge')||'null');
    if(saved&&Date.now()-saved.started<30*60*1000&&/^[a-f0-9]{32}$/.test(saved.nonce)){bridge=saved;if(permittedOrigins.includes(saved.origin))targetOrigin=saved.origin;}
  }catch{ /* Safari can disable storage in a restricted session. File handoff still works. */ }
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
  XMLHttpRequest.prototype.send=function(body){if(xhrRequests.get(this)?.query)rememberBody(body);return xhrSend.call(this,body);};
  function status(message){const p=host?.shadowRoot?.getElementById('status');if(p)p.textContent=message;}
  function controls(busy){for(const id of ['read','send','save']){const b=host?.shadowRoot?.getElementById(id);if(b)b.disabled=busy;}const cancel=host?.shadowRoot?.getElementById('cancel');if(cancel)cancel.hidden=!busy;}
  async function query(name,variables){
    if(!Object.hasOwn(READ_QUERIES,name))throw new Error('Only reading your music library is supported.');
    controller.signal.throwIfAborted();
    const known=observedQueries.get(name),headers={};
    for(const key of allowedHeaders)if(credentials[key])headers[key]=credentials[key];
    if(!/^Bearer\s+\S+$/.test(headers.authorization||''))throw new Error('Sign in to Spotify and open Your Library first. Then tap Read library. If needed, reload this Spotify tab after enabling the companion.');
    headers['content-type']='application/json';
    const body={operationName:name,variables:{...known?.variables,...variables},extensions:{persistedQuery:{version:1,sha256Hash:known?.hash||READ_QUERIES[name]}}};
    const timeout=new AbortController(),id=setTimeout(()=>timeout.abort(),30000);
    const abort=()=>timeout.abort();controller.signal.addEventListener('abort',abort,{once:true});
    try{
      const response=await originalFetch(SPOTIFY_QUERY_URL,{method:'POST',headers,body:JSON.stringify(body),credentials:'omit',cache:'no-store',redirect:'error',signal:timeout.signal});
      if(response.status===401)throw new Error('Your Spotify session expired. Reload Spotify and sign in again.');
      if(response.status===429)throw new Error('Spotify is limiting requests. Wait '+(Math.max(1,Number(response.headers.get('retry-after'))||60))+' seconds before syncing again.');
      if(response.status===403)throw new Error('Spotify refused this request. Open the collection on Spotify and try again.');
      if(!response.ok)throw new Error('Spotify is temporarily unavailable ('+response.status+'). Your previous library is kept.');
      const result=await response.json();
      if(result.errors?.length){
        if(name==='fetchPlaylist'&&result.errors.every(e=>['NOT_FOUND','PERMISSION_DENIED'].includes(e.extensions?.code))){const error=new Error('Playlist unavailable');error.code='unavailable';throw error;}
        throw new Error('Spotify’s web interface changed or this collection is unavailable. Open Liked Songs and a playlist on Spotify, then try again. Your saved library is kept.');
      }
      return result;
    }catch(error){if(error.name==='AbortError')throw new Error(controller.signal.aborted?'Sync cancelled. Your saved library is kept.':'Spotify took too long to respond. Try again.');throw error;}
    finally{clearTimeout(id);controller.signal.removeEventListener('abort',abort);}
  }
  function mount(){
    if(!document.body)return;
    host=document.createElement('div');host.id='spotplus-companion';host.style.cssText='position:fixed;right:12px;bottom:88px;z-index:2147483647;max-width:calc(100vw - 24px)';
    const root=host.attachShadow({mode:'open'});
    root.innerHTML='<style>:host{color-scheme:dark}*{box-sizing:border-box}section{font:14px/1.45 system-ui,sans-serif;color:#fff;background:#090e0b;border:1px solid #315d49;border-radius:16px;padding:16px;width:330px;max-width:100%;box-shadow:0 8px 36px #000a}h2{font-size:18px;margin:0 0 8px}p{color:#c2c9c4;margin:8px 0}button,a{font:inherit;min-height:44px;border:1px solid #315d49;background:#15231b;color:#fff;border-radius:22px;padding:9px 14px;cursor:pointer;text-decoration:none;display:inline-flex;align-items:center;margin:4px 4px 0 0}button:first-of-type{background:#1b5e46}button:disabled{opacity:.5;cursor:wait}small{display:block;color:#abb6ae;margin-top:12px}#close{float:right;border:0;padding:4px;min-height:28px;margin:0;background:transparent}#cancel[hidden],#send[hidden],#save[hidden]{display:none}</style><section aria-label="Spot+ Spotify companion"><button id="close" aria-label="Minimize companion">−</button><h2>Spot+ companion · Beta</h2><div id="body"><p>Read your signed-in Spotify library. No Premium or developer account needed.</p><p id="status" role="status" aria-live="polite">Sign in and open Your Library, then tap Read library.</p><button id="read">Read library</button><button id="cancel" hidden>Cancel</button><button id="send" hidden>Send to Spot+</button><button id="save" hidden>Save library file</button><small>Reads Liked Songs, playlists, saved albums and followed artists. Only music metadata leaves this page. Spotify cookies and session tokens stay here.</small></div></section>';
    document.body.append(host);
    root.getElementById('close').onclick=()=>{const body=root.getElementById('body');body.hidden=!body.hidden;root.getElementById('close').textContent=body.hidden?'+':'−';};
    root.getElementById('cancel').onclick=()=>controller?.abort();
    root.getElementById('read').onclick=async()=>{
      library=null;controller=new AbortController();controls(true);root.getElementById('send').hidden=true;root.getElementById('save').hidden=true;
      try{
        library=await readSpotifyAccount(query,{signal:controller.signal,onProgress:status});
        if(JSON.stringify(library).length>12*1024*1024)throw new Error('Your library exceeds the 12 MB phone transfer limit. Use Spotify’s data export.');
        status('Ready: '+library.likes.length+' liked songs, '+library.playlists.length+' playlists. Review and send your library to Spot+.');
        root.getElementById('send').hidden=!(bridge&&window.opener);root.getElementById('save').hidden=false;
      }catch(error){library=null;status(error.message||'Sync could not complete. Your previous library is kept.');}
      finally{controls(false);}
    };
    root.getElementById('send').onclick=()=>{
      if(!library||!bridge||!window.opener)return;
      window.opener.postMessage({type:'spotplus-library',nonce:bridge.nonce,library},targetOrigin);
      status('Sent for review. Return to the Spot+ tab to apply it. If the browser separated the tabs, use Save library file instead.');
    };
    root.getElementById('save').onclick=()=>{
      if(!library)return;const url=URL.createObjectURL(new Blob([JSON.stringify(library)],{type:'application/json'}));
      const a=document.createElement('a');a.href=url;a.download='spotplus-spotify-library.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),60000);
      status('In Spot+, open Spotify account → Choose companion file. On iPhone, save the file to Files if Safari opens a preview.');
    };
    window.addEventListener('message',event=>{if(bridge&&event.origin===targetOrigin&&event.source===window.opener&&event.data?.type==='spotplus-library-applied'&&event.data.nonce===bridge.nonce)status('Your library is now saved in Spot+. You can close this Spotify tab.');});
  }
  if(document.body)mount();else document.addEventListener('DOMContentLoaded',mount,{once:true});
}
