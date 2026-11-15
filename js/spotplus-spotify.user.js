// ==UserScript==
// @name         Spot+ Spotify Library Companion
// @namespace    https://coye2.github.io/spot-plus/
// @version      1.3.4
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
(()=>{if(window.top!==window.self)return;(()=>{
// Read-only Spotify web-client adapter. No cookie access, login or audio extraction.
// Request names/hashes describe Spotify's interface; see ACCOUNT-CONNECTION.md.
const COMPANION_VERSION = '1.3.4';
const SPOTIFY_QUERY_URL = 'https://api-partner.spotify.com/pathfinder/v2/query';
const READ_QUERIES = Object.freeze({
  profileAttributes:'53bcb064f6cd18c23f752bc324a791194d20df612d8e1239c735144ab0399ced',
  libraryV3:'390c78e5b951029bad359785e69b07b536a509c581cbcd0aded5e5067f187455',
  fetchLibraryTracks:'087278b20b743578a6262c2b0b4bcd20d879c503cc359a2285baf083ef944240',
  fetchPlaylist:'cd2275433b29f7316176e7b5b5e098ae7744724e1a52d63549c76636b3257749',
});
const cleanText = (value, max=500) => typeof value==='string' ? value.slice(0,max) : '';
function spotifyId(value, type) {
  return typeof value==='string' ? value.match(new RegExp('^spotify:'+type+':([A-Za-z0-9]{22})$'))?.[1] || '' : '';
}
function spotifyCover(value) {
  try { const u=new URL(value); return u.protocol==='https:' && /(^|\.)(scdn\.co|spotifycdn\.com)$/.test(u.hostname) && !u.username && !u.password ? u.href : ''; } catch { return ''; }
}
function spotifyProfileURL(id) {
  try { return id ? 'https://open.spotify.com/user/'+encodeURIComponent(cleanText(id,120)) : ''; } catch { return ''; }
}
function readSpotifyProfile(profile) {
  const id=cleanText(profile?.username,120);
  if(!id)return null;
  const sources=Array.isArray(profile.avatar?.sources)?profile.avatar.sources:[];
  const avatar=[...sources].sort((a,b)=>(Number(b?.width)||0)-(Number(a?.width)||0)).map(source=>spotifyCover(source?.url)).find(Boolean)||'';
  return {id,name:cleanText(profile.name,120)||id,avatar,externalUrl:spotifyProfileURL(id)};
}
function trackRecord(raw) {
  const wrapper=raw?.itemV2 || raw?.track;
  const data=wrapper ? wrapper.data : raw;
  return {data,uri:data?.uri ?? wrapper?._uri ?? wrapper?.uri};
}
function readSpotifyTrack(raw) {
  const {data:t,uri}=trackRecord(raw);
  const id=spotifyId(uri,'track');
  if(!id || !t?.name || !Array.isArray(t.artists?.items))return null;
  const cover=spotifyCover(t.albumOfTrack?.coverArt?.sources?.[0]?.url);
  return {id:'spotify:'+id,spotifyId:id,provider:'spotify-import',title:cleanText(t.name),artist:cleanText(t.artists.items.map(a=>a.profile?.name||a.name||'').filter(Boolean).join(', ')),album:cleanText(t.albumOfTrack?.name),cover,coverXl:cover,duration:Math.max(0,Math.min(86400,Number(t.duration?.totalMilliseconds||t.trackDuration?.totalMilliseconds||0)/1000)),explicit:t.contentRating?.label==='EXPLICIT',externalUrl:'https://open.spotify.com/track/'+id};
}
function readSpotifyEntity(raw, type) {
  const t=raw?.item?.data || raw;
  const id=spotifyId(t?.uri ?? raw?.item?._uri ?? raw?.item?.uri,type);
  if(!id)return null;
  // Spotify can retain a URI in Your Library after the entity becomes unavailable.
  // Keep its identity so a previous local playlist copy can be preserved on refresh.
  if(type==='playlist' && t.__typename==='NotFound')return {id,type,title:'Unavailable playlist',cover:'',owner:'',status:'unavailable'};
  return {id,type,title:cleanText(t.name||t.profile?.name)||'Spotify '+type,cover:spotifyCover(t.coverArt?.sources?.[0]?.url||t.images?.items?.[0]?.sources?.[0]?.url||t.visuals?.avatarImage?.sources?.[0]?.url),owner:cleanText(t.ownerV2?.data?.name)};
}

function responseError(label,value) {
  // Only a bounded GraphQL type name is shown, never the raw response or credentials.
  const type=typeof value?.__typename==='string' && /^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(value.__typename)?' ('+value.__typename+')':'';
  return new Error('Could not read '+label+' from Spotify’s response'+type+'. Your saved library is kept.');
}
function playlistPage(result,playlist) {
  const value=result?.data?.playlistV2;
  if(value?.__typename==='NotFound' || value?.currentUserCapabilities?.canView===false){
    const error=new Error('Spotify could not return this playlist.');error.code='unavailable';throw error;
  }
  const label='playlist “'+playlist.title+'”';
  if(!value?.content)throw responseError(label,value);
  if(value.uri!=null && value.uri!=='spotify:playlist:'+playlist.id)throw new Error('Spotify returned a different playlist. Your saved library is kept.');
  return value.content;
}

function readTracks(items,label) {
  return items.map(raw=>{
    const track=readSpotifyTrack(raw);
    const {data,uri}=trackRecord(raw);
    // Unsupported media can be skipped; a broken music record must not erase songs.
    if(!track && (data?.__typename==='Track' || (data && !data.__typename && spotifyId(uri,'track'))))throw new Error('Could not read a song in '+label+'. Your saved library is kept.');
    return track;
  }).filter(Boolean);
}

// A failed/truncated read never becomes a successful empty library.
async function readAllPages(getPage, {limit=50,max=10000,signal,label='library'}={}) {
  const result=[]; let expected=null; const seen=new Set();
  for(let offset=0;offset<=max;){
    signal?.throwIfAborted();
    const page=await getPage(offset,limit);
    if(!page || !Array.isArray(page.items) || !Number.isInteger(page.totalCount) || page.totalCount<0)throw responseError(label,page);
    if(page.totalCount>max)throw new Error('This collection is too large for a phone sync. Use the Spotify data export instead.');
    if(expected!==null && page.totalCount!==expected)throw new Error('The Spotify library changed during sync. Please try again.');
    expected=page.totalCount;
    if(page.pagingInfo?.offset!=null && page.pagingInfo.offset!==offset)throw new Error('Spotify returned the wrong page. Please try again.');
    if(!page.items.length && offset<expected)throw new Error('Spotify returned an incomplete collection. Your previous copy is kept.');
    const fingerprint=JSON.stringify(page.items);
    if(page.items.length && seen.has(fingerprint))throw new Error('Spotify repeated a page. Your previous copy is kept.');
    seen.add(fingerprint);result.push(...page.items);offset+=page.items.length;
    if(offset>=expected){if(offset!==expected)throw new Error('Spotify returned an inconsistent track count. Please retry.');return result;}
  }
  throw new Error('Spotify pagination did not finish.');
}

async function readSpotifyAccount(query,{signal,onProgress=()=>{}}={}) {
  onProgress('Reading your Spotify profile…');
  const profile=(await query('profileAttributes',{})).data?.me?.profile;
  if(!profile?.username || typeof profile.username!=='string')throw new Error('Sign in to Spotify, open Your Library, then try again.');
  const account=readSpotifyProfile(profile);
  const library={app:'spotplus-account',version:1,complete:true,account,capturedAt:Date.now(),likes:[],playlists:[],albums:[],artists:[],skipped:0};
  const options={signal,max:10000};
  onProgress('Reading Liked Songs…');
  const liked=await readAllPages(async(offset,limit)=>{
    const page=(await query('fetchLibraryTracks',{offset,limit})).data?.me?.library;
    // Current responses wrap the page in tracks; retain the older direct-page shape.
    // An explicitly malformed tracks page must fail rather than fall back to an empty page.
    return page && Object.hasOwn(page,'tracks') ? page.tracks : page;
  },{...options,label:'Liked Songs'});
  library.likes=readTracks(liked,'Liked Songs');library.skipped+=liked.length-library.likes.length;
  for(const [filter,key,type] of [['Playlists','playlists','playlist'],['Albums','albums','album'],['Artists','artists','artist']]){
    onProgress('Reading your '+filter.toLowerCase()+'…');
    const items=await readAllPages(async(offset,limit)=>(await query('libraryV3',{filters:[filter],order:null,textFilter:'',features:[],offset,limit,flatten:true,expandedFolders:[],folderUri:null,includeFoldersWhenFlattening:true})).data?.me?.libraryV3,{signal,max:1000,label:filter.toLowerCase()});
    library[key]=[...new Map(items.map(p=>readSpotifyEntity(p,type)).filter(Boolean).map(p=>[p.id,p])).values()];
  }
  let count=library.likes.length;
  for(const [index,p] of library.playlists.entries()){
    signal?.throwIfAborted();onProgress(`Reading playlist ${index+1} of ${library.playlists.length}: ${p.title}`);
    if(p.status==='unavailable'){p.tracks=[];continue;}
    try {
      const items=await readAllPages(async(offset,limit)=>playlistPage(await query('fetchPlaylist',{uri:'spotify:playlist:'+p.id,offset,limit,enableWatchFeedEntrypoint:false}),p),{...options,label:'playlist “'+p.title+'”'});
      p.tracks=readTracks(items,'playlist “'+p.title+'”');p.status='ready';library.skipped+=items.length-p.tracks.length;
      count+=p.tracks.length;if(count>20000)throw new Error('Your library exceeds this phone connector’s 20,000-track limit. Use the data export instead.');
    } catch(e) {
      // Only an explicitly inaccessible playlist can be omitted. Network/schema/rate failures abort sync.
      if(e.code!=='unavailable')throw e;
      p.tracks=[];p.status='unavailable';
    }
  }
  // Catch account switches during a long read.
  const end=(await query('profileAttributes',{})).data?.me?.profile?.username;
  if(end!==account.id)throw new Error('The Spotify account changed during sync. Please start again.');
  return library;
}

// Auto-read is scoped to an explicit, fresh Connect Spotify launch.
function canAutoRead({bridge,hostReady,authorization,attempted,now=Date.now()}){
 return !!hostReady&&!attempted&&!!bridge&&/^[a-f0-9]{32}$/.test(bridge.nonce||'')&&now>=bridge.started&&now-bridge.started<1800000&&['https://coye2.github.io','https://spot-plus-coyeb.coyeboymitchell2000.chatgpt.site'].includes(bridge.origin)&&/^Bearer\s+\S+$/.test(authorization||'');
}

// Bundled with spotify-reader.js by build-companion.mjs. Runs only on open.spotify.com.
/* global READ_QUERIES, SPOTIFY_QUERY_URL, COMPANION_VERSION, readSpotifyAccount, canAutoRead */
function runSpotifyCompanion(){
  if(location.origin!=='https://open.spotify.com'||document.getElementById('spotplus-companion'))return;
  const permittedOrigins=['https://coye2.github.io','https://spot-plus-coyeb.coyeboymitchell2000.chatgpt.site'];
  let targetOrigin=permittedOrigins[0];
  const originalFetch=window.fetch.bind(window), credentials={};
  const observedQueries=new Map();
  let controller=null,library=null,host=null,bridge=null,receiver=null,autoAttempted=false,autoTimer,attemptedAuth=null,allowAuthRetry=false,autoCancelled=false;
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
  function maybeAutoRead(){
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
    root.innerHTML='<style>:host{color-scheme:dark}*{box-sizing:border-box}section{font:14px/1.45 system-ui,sans-serif;color:#fff;background:#090e0b;border:1px solid #315d49;border-radius:16px;padding:16px;width:330px;max-width:100%;box-shadow:0 8px 36px #000a}h2{font-size:18px;margin:0 0 8px}p{color:#c2c9c4;margin:8px 0}button,a{font:inherit;min-height:44px;border:1px solid #315d49;background:#15231b;color:#fff;border-radius:22px;padding:9px 14px;cursor:pointer;text-decoration:none;display:inline-flex;align-items:center;margin:4px 4px 0 0}button:first-of-type{background:#1b5e46}button:disabled{opacity:.5;cursor:wait}small{display:block;color:#abb6ae;margin-top:12px}#close{float:right;border:0;padding:4px;min-height:28px;margin:0;background:transparent}#cancel[hidden],#send[hidden],#save[hidden]{display:none}</style><section aria-label="Spot+ Spotify companion"><button id="close" aria-label="Minimize companion">−</button><h2>Spot+ companion · Beta</h2><div id="body"><p>Read your signed-in Spotify library. No Premium or developer account needed.</p><p id="status" role="status" aria-live="polite">Sign in and open Your Library, then tap Read library.</p><button id="read">Read library</button><button id="cancel" hidden>Cancel</button><button id="send" hidden>Send to Spot+</button><button id="save" hidden>Save library file</button><small>Reads Liked Songs, playlists, saved albums and followed artists. Only your profile and music details leave this page. Spotify cookies and session tokens stay here.</small></div></section>';
    document.body.append(host);
    const version=document.createElement('small');version.textContent='Helper '+COMPANION_VERSION;root.querySelector('h2').append(version);
    root.getElementById('close').onclick=()=>{const body=root.getElementById('body');body.hidden=!body.hidden;root.getElementById('close').textContent=body.hidden?'+':'−';};
    root.getElementById('cancel').onclick=()=>{clearTimeout(autoTimer);autoAttempted=true;autoCancelled=true;controller?.abort();};
    root.getElementById('read').onclick=async()=>{
      clearTimeout(autoTimer);autoAttempted=true;if(controller&&!controller.signal.aborted&&root.getElementById('read').disabled)return;
      library=null;controller=new AbortController();controls(true);root.getElementById('send').hidden=true;root.getElementById('save').hidden=true;
      notify('reading');
      try{
        library=await readSpotifyAccount(query,{signal:controller.signal,onProgress:status});
        if(JSON.stringify(library).length>12*1024*1024)throw new Error('Your library exceeds the 12 MB phone transfer limit. Use Spotify’s data export.');
        const unavailable=library.playlists.filter(p=>p.status==='unavailable').length;
        status('Ready: '+library.likes.length+' liked songs, '+library.playlists.length+' playlists.'+(unavailable?' '+unavailable+' unavailable; any saved copies will be kept.':'')+' Review and send your library to Spot+.');
        root.getElementById('send').hidden=false;root.getElementById('save').hidden=false;notify('done');
        sendLibrary();
      }catch(error){library=null;allowAuthRetry=/sign in|session expired/i.test(error.message||'');status(error.message||'Sync could not complete. Your previous library is kept.');notify('error');}
      finally{controls(false);}
    };
    root.getElementById('send').onclick=()=>sendLibrary(true);
    root.getElementById('save').onclick=()=>{
      if(!library)return;const url=URL.createObjectURL(new Blob([JSON.stringify(library)],{type:'application/json'}));
      const a=document.createElement('a');a.href=url;a.download='spotplus-spotify-library.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),60000);
      status('In Spot+, open Spotify account → Choose companion file. On iPhone, save the file to Files if Safari opens a preview.');
    };
    maybeAutoRead();
    notify('ready');
    window.addEventListener('message',event=>{
      if(!bridge||Date.now()-bridge.started>=1800000||event.origin!==targetOrigin||event.data?.nonce!==bridge.nonce)return;
      if(event.data.type==='spotplus-receiver-ready'&&event.source===receiver&&library)receiver.postMessage({type:'spotplus-library',nonce:bridge.nonce,library},targetOrigin);
      if(event.data.type==='spotplus-library-applied'&&(event.source===window.opener||event.source===receiver))status('Your library is now saved in Spot+. You can close this Spotify tab.');
    });
  }
  if(document.body)mount();else document.addEventListener('DOMContentLoaded',mount,{once:true});
}

runSpotifyCompanion();
})();})();
