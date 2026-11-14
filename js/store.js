// store.js — everything Spot+ keeps in the user's own browser (localStorage).
import {mergeAccountSnapshot,validateAccountSnapshot} from './spotify-account.js';
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
export function updatePlaylist(id, fn) {
  const pls = getPlaylists();
  const p = pls.find((x) => x.id === id);
  if (!p) return;
  fn(p);
  savePlaylists(pls);
}
export const renamePlaylist = (id, name) => updatePlaylist(id, (p) => { p.name = name; });
export const deletePlaylist = (id) => savePlaylists(getPlaylists().filter((p) => p.id !== id));
export function addToPlaylist(id, tracks) {
  let added = 0;
  updatePlaylist(id, (p) => {
    const have = new Set(p.tracks.map((t) => t.id));
    for (const t of tracks) if (!have.has(t.id)) { p.tracks.push(slim(t)); have.add(t.id); added++; }
  });
  return added;
}
export const removeFromPlaylist = (id, index) => updatePlaylist(id, (p) => { p.tracks.splice(index, 1); });

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
}

/* ---------- Downloads (audio lives in Cache Storage, this is the list) ---------- */
export const getDownloads = () => read('downloads', []);
export const isDownloaded = (id) => getDownloads().some((t) => t.id === String(id));
export function addDownload(t) { write('downloads', [slim(t), ...getDownloads().filter((x) => x.id !== t.id)]); }
export function removeDownloadMeta(id) { write('downloads', getDownloads().filter((x) => x.id !== String(id))); }

/* ---------- Settings ---------- */
const DEFAULTS = { themePreset:'pine', amoled:true, preloadNext:true, source: 'auto', quality: 'high', customPiped: '', customInvidious: '', density: 'comfortable', accent: 'green', motion: 'system', textSize: 'normal', sidebarWidth: 288, librarySort: 'recent', libraryFilter: 'all', showExplicit: true, displayName: 'Your library', libraryCollapsed:false, djVoice:true, djCommentary:true, djHost:'afterhours' };
export const getSettings = () => {
  const saved={...DEFAULTS,...read('settings',{})};
  for(const key of ['displayName','customPiped','customInvidious'])saved[key]=typeof saved[key]==='string'?saved[key]:DEFAULTS[key];
  return saved;
};
export const setSettings = (patch) => write('settings', { ...getSettings(), ...patch });

/* ---------- Which YouTube video matches which track ---------- */
export function getVideoCache(id) { return read('vcache', {})[id] || null; }
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
export const getSpotifyAccount=()=>read('spotifyAccount',null);
export function setSpotifyAccount(snapshot){const next=mergeAccountSnapshot(getSpotifyAccount(),snapshot);write('spotifyAccount',next);return next;}
export function clearSpotifyAccount(){localStorage.removeItem(P+'spotifyAccount');emit('spotifyAccount');}
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
  return { app: 'spotplus', version: 2, exported: new Date().toISOString(), likes: getLikes(), playlists: getPlaylists(), folders:getFolders(), recent: getRecent(), settings: getSettings(), albums:getAlbums(), artists:getArtists(), pins:getPins(), spotifyLinks:getSpotifyLinks(),spotifyAccount:account?validateAccountSnapshot(account):null,themes:getThemes(),vcache: read('vcache', {}) };
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
  for (const key of ['albums','artists','recent']) if (Array.isArray(d[key])) {
    const merged = new Map([...read(key,[]), ...d[key].filter(x=>x && x.id != null)].map(x=>[String(x.id),x]));
    write(key,[...merged.values()]);
  }
  if (Array.isArray(d.pins)) write('pins',[...new Set([...getPins(), ...d.pins.filter(p=>typeof p==='string')])]);
  for(const key of ['spotifyLinks','themes'])if(Array.isArray(d[key])){const merged=new Map([...read(key,[]),...d[key].filter(x=>x&&typeof x.id==='string')].map(x=>[x.id,x]));write(key,[...merged.values()]);}
  if(Array.isArray(d.folders))write('folders',mergeFolders(getFolders(),d.folders));
  return {spotifyAccount:accountResult};
}
