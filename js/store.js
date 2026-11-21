// store.js — everything Spot+ keeps in the user's own browser (localStorage).
import {mergeAccountSnapshot,validateAccountSnapshot,validateStats} from './spotify-account.js';
import {spotifyCover} from './spotify-reader.js';
import {normalizeFolders,mergeFolders} from './folders.js';
const P = 'spotplus.';
const listeners = new Set();
export const onChange = (fn) => listeners.add(fn);
const emit = (key) => listeners.forEach((fn) => { try { fn(key); } catch (e) { console.error(e); } });

function read(key, def) {
  try { const v = localStorage.getItem(P + key); return v == null ? def : JSON.parse(v); } catch { return def; }
}
function write(key, value, silent = false) {
  try { localStorage.setItem(P + key, JSON.stringify(value)); } catch { throw new Error('Your browser storage is full or unavailable. Export a backup or free some space and try again.'); }
  if (!silent) emit(key);
}

export const slim = (t) => ({
  id: String(t.id), title: t.title || '', searchTitle: t.searchTitle || t.title || '',
  artist: t.artist || '', artistId: t.artistId || null, album: t.album || '', albumId: t.albumId || null,
  cover: t.cover || '', coverXl: t.coverXl || t.cover || '', duration: t.duration || 0, explicit: !!t.explicit,
  preview: t.preview || '', local: !!t.local,
  spotifyId:t.spotifyId||'',provider:t.provider||'',externalUrl:t.externalUrl||'',
  // Podcasts and audiobooks
  ...(t.direct?{direct:String(t.direct),mime:t.mime||'audio/mpeg',kind:t.kind||'episode',date:t.date||0,feed:t.feed||'',bookId:t.bookId||'',notes:String(t.notes||'').slice(0,500)}:{}),
});

/* ---------- Liked songs ---------- */
let likedIds = null;
export const getLikes = () => read('likes', []);
export function isLiked(id) {
  if (!likedIds) likedIds = new Set(getLikes().map((t) => String(t.id)));
  return likedIds.has(String(id));
}
export function toggleLike(t) {
  let likes = getLikes();
  const on = likes.some((x) => String(x.id) === String(t.id));
  likes = on ? likes.filter((x) => String(x.id) !== String(t.id)) : [slim(t), ...likes];
  write('likes', likes, true);
  likedIds = new Set(likes.map((x) => String(x.id)));
  emit('likes');
  return !on;
}

/* ---------- Your playlists ---------- */
export const getPlaylists = () => read('playlists', []);
export const getPlaylist = (id) => getPlaylists().find((p) => p.id === id) || null;
const savePlaylists = (pls) => write('playlists', pls);
export function createPlaylist(name, tracks = []) {
  const p = { id: 'pl' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), name: name || 'New playlist', tracks: tracks.map(slim), created: Date.now() };
  savePlaylists([p, ...getPlaylists()]);
  return p;
}
export function updatePlaylist(id, fn, {remote = false} = {}) {
  const pls = getPlaylists();
  const p = pls.find((x) => x.id === id);
  if (!p) return;
  fn(p);
  if (!remote) p.updated = Date.now();
  savePlaylists(pls);
}
export const renamePlaylist = (id, name) => updatePlaylist(id, (p) => { p.name = name; });
export const deletePlaylist = (id) => { savePlaylists(getPlaylists().filter((p) => p.id !== id)); setPlaylistCover(id, null); };
export function addToPlaylist(id, tracks) {
  let added = 0;
  updatePlaylist(id, (p) => {
    const have = new Set(p.tracks.map((t) => t.id));
    for (const t of tracks) if (!have.has(t.id)) { p.tracks.push(slim(t)); have.add(t.id); added++; }
  });
  return added;
}
export const removeFromPlaylist = (id, index) => updatePlaylist(id, (p) => { p.tracks.splice(index, 1); });

// Your own cover photos, for your playlists and for Spotify playlists you synced (key: playlist id, or 'sp:' + Spotify
// id). Kept apart from the playlists themselves so library sync and shared playlists don't carry the image data.
const COVER_OK = /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/;
export const getPlaylistCover = (key) => { const v = read('plCovers', {})[key]; return typeof v === 'string' && COVER_OK.test(v) ? v : ''; };
export function setPlaylistCover(key, dataUrl) {
  if (!key) return false;
  const all = read('plCovers', {});
  if (dataUrl) { if (!COVER_OK.test(dataUrl) || dataUrl.length > 400000) return false; all[key] = dataUrl; }
  else delete all[key];
  write('plCovers', all);
  return true;
}

// Songs you add to a Spotify playlist you synced. Spot+ can't change the playlist on Spotify, so they're kept here
// and shown at the end of it; a refresh from Spotify keeps them (and drops any that Spotify now has itself).
export const getSpotifyAdds = (id) => (read('spotifyAdds', {})[id] || []).filter((t) => t && t.id);
export function addToSpotifyPlaylist(id, tracks, existing = []) {
  const all = read('spotifyAdds', {});
  const list = (all[id] || []).filter((t) => t && t.id);
  const have = new Set([...existing.map((t) => t?.id), ...list.map((t) => t.id)]);
  let added = 0;
  for (const t of tracks) if (t?.id && !have.has(t.id)) { list.push(slim(t)); have.add(t.id); added++; }
  all[id] = list;
  write('spotifyAdds', all);
  return added;
}
export function removeSpotifyAdd(id, trackId) {
  const all = read('spotifyAdds', {});
  all[id] = (all[id] || []).filter((t) => t?.id !== trackId);
  write('spotifyAdds', all);
}

/* ---------- Playlist folders (local organization only) ---------- */
export const getFolders = () => normalizeFolders(read('folders', []));
export const getFolder = id => getFolders().find(f=>f.id===id)||null;
export function createFolder(name){
  if(typeof name!=='string'||!name.trim())throw new Error('Give your folder a name.');
  const folders=getFolders();if(folders.length>=500)throw new Error('Your library has reached the 500-folder limit.');
  const folder={id:'folder'+Date.now().toString(36)+Math.random().toString(36).slice(2,8),name:name.trim().slice(0,100),items:[],created:Date.now()};
  write('folders',[folder,...folders]);return folder;
}
export function renameFolder(id,name){
  const folders=getFolders(),folder=folders.find(f=>f.id===id);
  if(!folder)throw new Error('This folder no longer exists.');
  if(typeof name!=='string'||!name.trim())throw new Error('Give your folder a name.');
  folder.name=name.trim().slice(0,100);write('folders',folders);
}
export const deleteFolder = id => write('folders',getFolders().filter(f=>f.id!==id));
export function moveToFolder(itemId,folderId=null){
  const folders=getFolders(),target=folderId?folders.find(f=>f.id===folderId):null;
  if(folderId&&!target)throw new Error('This folder no longer exists.');
  const available=getPlaylists().some(p=>p.id===itemId)||getSpotifyLinks().some(p=>p.type==='playlist'&&'spotify-'+p.id===itemId)||getSpotifyAccount()?.playlists.some(p=>'spotify-account-'+p.id===itemId);
  if(!available)throw new Error('This playlist is no longer in your library.');
  for(const folder of folders)folder.items=folder.items.filter(id=>id!==itemId);
  if(target)target.items.push(itemId);
  write('folders',folders);
}

/* ---------- Recently played ---------- */
export const getRecent = () => read('recent', []);
export function addRecent(t) {
  const r = getRecent().filter((x) => x.id !== t.id);
  r.unshift(slim(t));
  write('recent', r.slice(0, 30));
  addPlay(t);
}

/* ---------- Play counts: what you have on repeat ---------- */
export const getPlays = () => read('plays', {});
export function addPlay(t, now = Date.now()) {
  if (!t?.id) return;
  const plays = getPlays(), id = String(t.id), old = plays[id];
  plays[id] = {t: slim(t), n: (old?.n || 0) + 1, last: now};
  // Keep the 400 most recently played songs.
  const ids = Object.keys(plays);
  if (ids.length > 400) ids.sort((a, b) => plays[a].last - plays[b].last).slice(0, ids.length - 400).forEach((k) => delete plays[k]);
  write('plays', plays);
}
/** Your most-played songs of the last `days` days (at least twice), most played first. */
export function getOnRepeat({days = 30, limit = 50, now = Date.now()} = {}) {
  return Object.values(getPlays()).filter((p) => p.n >= 2 && now - p.last < days * 864e5)
    .sort((a, b) => b.n - a.n || b.last - a.last).slice(0, limit).map((p) => p.t);
}

/* ---------- Downloads (audio lives in Cache Storage, this is the list) ---------- */
export const getDownloads = () => read('downloads', []);
export const isDownloaded = (id) => getDownloads().some((t) => t.id === String(id));
export function addDownload(t) { write('downloads', [slim(t), ...getDownloads().filter((x) => x.id !== t.id)]); }
export function removeDownloadMeta(id) { write('downloads', getDownloads().filter((x) => x.id !== String(id))); }

/* ---------- Settings ---------- */
const DEFAULTS = { smartRadio:true, automix:'0', mixStyle:'smart', notifyUpdates:true, notifyReleases:true, notifyStats:true, themePreset:'pine', amoled:true, preloadNext:true, source: 'auto', quality: 'high', customPiped: '', customInvidious: '', customHifi: '', density: 'comfortable', accent: 'green', motion: 'system', textSize: 'normal', sidebarWidth: 288, librarySort: 'recent', libraryFilter: 'all', showExplicit: true, displayName: 'Your library', libraryCollapsed:false, djVoice:true, djCommentary:true, djHost:'afterhours' };
// Audio sources that are no longer offered move to the closest one that is: the YouTube-based ones
// (Piped, Invidious, YouTube's own player) to Spot+ YouTube Relay; Deezer's 30-second previews to Automatic.
export const SOURCES = ['ytrelay', 'auto', 'soundcloud', 'hifi', 'jiosaavn', 'audius'];
const LEGACY_SOURCES = {piped: 'ytrelay', invidious: 'ytrelay', youtube: 'ytrelay', deezer: 'auto', preview: 'auto'};
export const migrateSource = (source) => SOURCES.includes(source) ? source : LEGACY_SOURCES[source] || 'auto';
/** Once at startup and after importing a profile: move a saved source that is no longer offered. */
export function migrateSavedSource() {
  const saved = read('settings', {});
  if (saved.source !== undefined && migrateSource(saved.source) !== saved.source) write('settings', {...saved, source: migrateSource(saved.source)});
}
export const getSettings = () => {
  const saved={...DEFAULTS,...read('settings',{})};
  for(const key of ['displayName','customPiped','customInvidious','customHifi'])saved[key]=typeof saved[key]==='string'?saved[key]:DEFAULTS[key];
  return saved;
};
export const setSettings = (patch) => write('settings', { ...getSettings(), ...patch });

/* ---------- Which YouTube video matches which track ---------- */
export function getVideoCache(id) { return read('vcache', {})[id] || null; }
/** The most recent video that is known to play in YouTube's player (used to boot the player early). */
export function lastPlayableVideo() {
  const c = read('vcache', {});
  const ids = Object.values(c).filter((v) => v?.embedOk && /^[\w-]{11}$/.test(String(v.id || ''))).map((v) => v.id);
  return ids.at(-1) || '';
}
export function setVideoCache(id, v) {
  const c = read('vcache', {});
  if (v) c[id] = v; else delete c[id];
  const keys = Object.keys(c);
  if (keys.length > 3000) keys.slice(0, keys.length - 3000).forEach((k) => delete c[k]);
  write('vcache', c, true);
}
export const clearVideoCache = () => write('vcache', {}, true);

/* ---------- Player state (so the queue survives a reload) ---------- */
export const savePlayer = (s) => write('player', s, true);
export const loadPlayer = () => read('player', null);

/* Additive collections keep v1 data and preferences in place. */
export const getAlbums = () => read('albums', []);
export const getArtists = () => read('artists', []);
export const hasAlbum = (id) => getAlbums().some(a => String(a.id) === String(id));
export const hasArtist = (id) => getArtists().some(a => String(a.id) === String(id));
export function toggleAlbum(album) {
  const on = hasAlbum(album.id);
  write('albums', on ? getAlbums().filter(a => String(a.id) !== String(album.id)) : [{...album, saved:Date.now()}, ...getAlbums()]);
  return !on;
}
export function toggleArtist(artist) {
  const on = hasArtist(artist.id);
  write('artists', on ? getArtists().filter(a => String(a.id) !== String(artist.id)) : [{...artist, saved:Date.now()}, ...getArtists()]);
  return !on;
}
export const getPins = () => read('pins', []);
export function togglePin(id) { const pins = getPins(); write('pins', pins.includes(id) ? pins.filter(p=>p!==id) : [...pins,id]); }
export const getSearches = () => read('searches', []);
export function addSearch(query) { if (query.trim()) write('searches', [query, ...getSearches().filter(q=>q!==query)].slice(0,8)); }
export const clearSearches = () => write('searches', []);
export const getLocalFiles = () => read('localFiles', []);
export function addLocalFile(track) { write('localFiles', [slim(track), ...getLocalFiles().filter(t=>t.id!==track.id)]); }
export const removeLocalFile = id => write('localFiles', getLocalFiles().filter(t=>t.id!==id));
export const getSpotifyLinks=()=>read('spotifyLinks',[]).filter(p=>p&&/^[A-Za-z0-9]{22}$/.test(p.id)&&['playlist','album','artist','track'].includes(p.type));
export function saveSpotifyLink(item){write('spotifyLinks',[item,...getSpotifyLinks().filter(x=>x.id!==item.id||x.type!==item.type)]);}
/* ---------- Spotify account copy (IndexedDB) ----------
   A full Spotify library easily exceeds Safari's ~5 MB localStorage quota, so the
   account copy lives in IndexedDB with an in-memory cache for synchronous reads.
   Older copies in localStorage are moved over by ready(). Without IndexedDB (tests,
   restricted modes) the original localStorage path is used. */
const STORAGE_FULL='Your browser storage is full or unavailable. Export a backup or free some space and try again.';
let syncedCache=null,useIdb=typeof indexedDB!=='undefined',accountCache=null,accountWrite=Promise.resolve(),dbPromise=null;
function idb(){
  return dbPromise||=new Promise((resolve,reject)=>{const r=indexedDB.open('spotplus',1);r.onupgradeneeded=()=>r.result.createObjectStore('kv');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);r.onblocked=()=>reject(new Error('blocked'));});
}
function idbRun(mode,fn){
  return idb().then(db=>new Promise((resolve,reject)=>{const tx=db.transaction('kv',mode),req=fn(tx.objectStore('kv'));tx.oncomplete=()=>resolve(req?.result);tx.onerror=tx.onabort=()=>reject(tx.error||new Error('aborted'));}));
}
export async function ready(){
  if(!useIdb)return;
  try{
    const saved=await idbRun('readonly',kv=>kv.get('spotifyAccount')),legacy=read('spotifyAccount',null);
    accountCache=saved||legacy||null;
    if(!saved&&legacy)await idbRun('readwrite',kv=>kv.put(legacy,'spotifyAccount'));
    if(legacy)localStorage.removeItem(P+'spotifyAccount');
    syncedCache=await idbRun('readonly',kv=>kv.get('syncedStats'))||null;
  }catch{useIdb=false;accountCache=null;}
}
export const getSpotifyAccount=()=>useIdb?accountCache:read('spotifyAccount',null);
export function setSpotifyAccount(snapshot){
  const previous=getSpotifyAccount(),next=mergeAccountSnapshot(previous,snapshot);
  if(!useIdb){write('spotifyAccount',next);return next;}
  accountCache=next;
  accountWrite=idbRun('readwrite',kv=>kv.put(next,'spotifyAccount')).then(()=>{navigator.storage?.persist?.().catch(()=>{});},()=>{if(accountCache===next)accountCache=previous;emit('spotifyAccount');throw new Error(STORAGE_FULL);});
  accountWrite.catch(()=>{});
  emit('spotifyAccount');return next;
}
/** The newest Spotify stats from either the library copy or automatic sync. */
export function getSpotifyStats(){
  const account=getSpotifyAccount(),synced=useIdb?syncedCache:read('syncedStats',null);
  const fromAccount=account?.stats?{stats:account.stats,statsPrevious:account.statsPrevious||null,account:account.account,statsError:account.statsError||''}:null;
  if(synced?.stats&&(!fromAccount||synced.stats.capturedAt>fromAccount.stats.capturedAt))return synced;
  return fromAccount||{stats:null,statsPrevious:null,account:account?.account||null,statsError:account?.statsError||''};
}
const cleanProfile=a=>a&&typeof a==='object'?{id:String(a.id||'').slice(0,120),name:String(a.name||'').slice(0,120),avatar:/^https:\/\/[^\s]+$/.test(a.avatar||'')?String(a.avatar).slice(0,500):''}:null;
/** Save an automatically synced snapshot when it's newer than what we have. */
export async function setSyncedStats(snapshot){
  const stats=validateStats(snapshot?.stats);if(!stats)return false;
  const current=getSpotifyStats();
  if(current.stats&&current.stats.capturedAt>=stats.capturedAt)return false;
  const next={stats,statsPrevious:current.stats||null,account:cleanProfile(snapshot.account)||current.account||null,statsError:''};
  if(useIdb){syncedCache=next;await idbRun('readwrite',kv=>kv.put(next,'syncedStats')).catch(()=>{});}else write('syncedStats',next);
  emit('spotifyStats');return true;
}
/** Resolves once the last account change is on disk; rejects if it could not be saved. */
export function rememberAccountAvatar(url){
  const avatar=spotifyCover(url),current=getSpotifyAccount();
  if(!avatar||!current?.account?.id||current.account.avatar===avatar)return false;
  setSpotifyAccount({...current,account:{...current.account,avatar}});
  return getSpotifyAccount()?.account?.avatar===avatar;
}
export const flushSpotifyAccount=()=>accountWrite;
export function clearSpotifyAccount(){
  if(useIdb){accountCache=null;accountWrite=idbRun('readwrite',kv=>kv.delete('spotifyAccount'));accountWrite.catch(()=>{});}
  try{localStorage.removeItem(P+'spotifyAccount');}catch{ /* Nothing to remove. */ }
  emit('spotifyAccount');
}
export const getThemes=()=>read('themes',[]);
export function saveTheme(theme){write('themes',[theme,...getThemes().filter(x=>x.id!==theme.id)]);}
export function importSpotify(bundle){
  const oldLikes=getLikes(),likes=[...new Map([...oldLikes,...bundle.likes.map(slim)].map(t=>[String(t.id),t])).values()];
  write('likes',likes,true);likedIds=new Set(likes.map(t=>String(t.id)));emit('likes');
  const existing=getPlaylists();let added=0;
  for(const incoming of bundle.playlists){const found=existing.find(p=>p.id===incoming.id);if(found){found.tracks=[...new Map([...found.tracks,...incoming.tracks.map(slim)].map(t=>[String(t.id),t])).values()];}else{existing.push({...incoming,tracks:incoming.tracks.map(slim)});added++;}}
  savePlaylists(existing);return {liked:likes.length-oldLikes.length,playlists:added};
}

/* ---------- Backup ---------- */
export function exportData() {
  const account=getSpotifyAccount();
  return { app: 'spotplus', version: 2, exported: new Date().toISOString(), likes: getLikes(), playlists: getPlaylists(), folders:getFolders(), recent: getRecent(), settings: getSettings(), albums:getAlbums(), artists:getArtists(), pins:getPins(), spotifyLinks:getSpotifyLinks(),spotifyAccount:account?validateAccountSnapshot(account):null,themes:getThemes(),plCovers: read('plCovers', {}),spotifyAdds: read('spotifyAdds', {}),vcache: read('vcache', {}) };
}
export function importData(d) {
  if (!d || d.app !== 'spotplus') throw new Error('Not a Spot+ backup file');
  // Validate the account copy before changing any existing library data.
  const incomingAccount=d.spotifyAccount?validateAccountSnapshot(d.spotifyAccount):null;
  const currentAccount=getSpotifyAccount();
  let accountResult='none';
  if(incomingAccount){
    if(currentAccount&&currentAccount.account.id!==incomingAccount.account.id)accountResult='different-account-kept';
    else if(currentAccount&&currentAccount.capturedAt>incomingAccount.capturedAt)accountResult='newer-copy-kept';
    else{setSpotifyAccount(incomingAccount);accountResult='restored';}
  }
  if (Array.isArray(d.likes)) { likedIds = null; const merged = new Map([...getLikes(), ...d.likes.filter(t=>t && t.id != null).map(slim)].map(t=>[String(t.id),t])); write('likes', [...merged.values()]); }
  if (Array.isArray(d.playlists)) {
    const existing = getPlaylists();
    const ids = new Set(existing.map((p) => p.id));
    savePlaylists([...existing, ...d.playlists.filter((p) => p && !ids.has(p.id) && Array.isArray(p.tracks)).map(p=>({...p, name:String(p.name || 'Playlist'), tracks:p.tracks.filter(t=>t && t.id!=null).map(slim)}))]);
  }
  if (d.settings) setSettings(d.settings);
  if (d.vcache) write('vcache', { ...read('vcache', {}), ...d.vcache }, true);
  if (d.plCovers && typeof d.plCovers === 'object') for (const [k, v] of Object.entries(d.plCovers)) if (!getPlaylistCover(k)) setPlaylistCover(k, v);
  if (d.spotifyAdds && typeof d.spotifyAdds === 'object') for (const [k, list] of Object.entries(d.spotifyAdds)) if (Array.isArray(list)) addToSpotifyPlaylist(k, list);
  for (const key of ['albums','artists','recent']) if (Array.isArray(d[key])) {
    const merged = new Map([...read(key,[]), ...d[key].filter(x=>x && x.id != null)].map(x=>[String(x.id),x]));
    write(key,[...merged.values()]);
  }
  if (Array.isArray(d.pins)) write('pins',[...new Set([...getPins(), ...d.pins.filter(p=>typeof p==='string')])]);
  for(const key of ['spotifyLinks','themes'])if(Array.isArray(d[key])){const merged=new Map([...read(key,[]),...d[key].filter(x=>x&&typeof x.id==='string')].map(x=>[x.id,x]));write(key,[...merged.values()]);}
  if(Array.isArray(d.folders))write('folders',mergeFolders(getFolders(),d.folders));
  migrateSavedSource();
  return {spotifyAccount:accountResult};
}

/** Library for syncing between your devices. */
export const librarySnapshot = () => ({likes: getLikes(), playlists: getPlaylists(), albums: getAlbums(), artists: getArtists(), folders: getFolders()});
/** Replace the library with a synced copy (used when another of your devices changed it). */
export function replaceLibrary(lib) {
  if (Array.isArray(lib.likes)) { likedIds = null; write('likes', lib.likes.filter(t => t && t.id != null).map(slim)); }
  if (Array.isArray(lib.playlists)) write('playlists', lib.playlists.filter(p => p && p.id && Array.isArray(p.tracks)).map(p => ({...p, name: String(p.name || 'Playlist'), tracks: p.tracks.filter(t => t && t.id != null).map(slim)})));
  if (Array.isArray(lib.albums)) write('albums', lib.albums.filter(a => a && a.id != null));
  if (Array.isArray(lib.artists)) write('artists', lib.artists.filter(a => a && a.id != null));
  if (Array.isArray(lib.folders)) write('folders', normalizeFolders(lib.folders));
}
