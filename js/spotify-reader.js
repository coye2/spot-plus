// Read-only Spotify web-client adapter. No cookie access, login or audio extraction.
// Request names/hashes describe Spotify's interface; see docs/spotify-helper.md.
export const COMPANION_VERSION = '1.7.0';
export const SPOTIFY_QUERY_URL = 'https://api-partner.spotify.com/pathfinder/v2/query';
export const READ_QUERIES = Object.freeze({
  profileAttributes:'53bcb064f6cd18c23f752bc324a791194d20df612d8e1239c735144ab0399ced',
  libraryV3:'390c78e5b951029bad359785e69b07b536a509c581cbcd0aded5e5067f187455',
  fetchLibraryTracks:'087278b20b743578a6262c2b0b4bcd20d879c503cc359a2285baf083ef944240',
  fetchPlaylist:'cd2275433b29f7316176e7b5b5e098ae7744724e1a52d63549c76636b3257749',
  getTrack:'612585ae06ba435ad26369870deaae23b5c8800a256cd8a57e08eddc25a37294',
});
const cleanText = (value, max=500) => typeof value==='string' ? value.slice(0,max) : '';
export function spotifyId(value, type) {
  return typeof value==='string' ? value.match(new RegExp('^spotify:'+type+':([A-Za-z0-9]{22})$'))?.[1] || '' : '';
}
export function spotifyCover(value) {
  try { const u=new URL(value); return u.protocol==='https:' && /(^|\.)(scdn\.co|spotifycdn\.com)$/.test(u.hostname) && !u.username && !u.password ? u.href : ''; } catch { return ''; }
}
export function spotifyProfileURL(id) {
  try { return id ? 'https://open.spotify.com/user/'+encodeURIComponent(cleanText(id,120)) : ''; } catch { return ''; }
}
export function readSpotifyProfile(profile) {
  const id=cleanText(profile?.username,120);
  if(!id)return null;
  const sources=Array.isArray(profile.avatar?.sources)?profile.avatar.sources:[];
  const avatar=[...sources].sort((a,b)=>(Number(b?.width)||0)-(Number(a?.width)||0)).map(source=>spotifyCover(source?.url)).find(Boolean)||'';
  return {id,name:cleanText(profile.name,120)||id,avatar,externalUrl:spotifyProfileURL(id)};
}
function trackRecord(raw) {
  const wrapper=raw?.itemV2 || raw?.track || raw?.item;
  const data=wrapper && Object.hasOwn(wrapper,'data') ? wrapper.data : wrapper || raw;
  const uri=data?.uri ?? wrapper?._uri ?? wrapper?.uri ?? (data?.__typename==='Track' && /^[A-Za-z0-9]{22}$/.test(data.id||'')?'spotify:track:'+data.id:undefined);
  return {data,uri};
}
function trackArtists(t) {
  const names=items=>Array.isArray(items)?items.map(a=>cleanText(a?.profile?.name||a?.name).trim()).filter(Boolean):[];
  const full=names(Array.isArray(t?.artists)?t.artists:t?.artists?.items);
  return (full.length?full:[...new Set([...names(t?.firstArtist?.items),...names(t?.otherArtists?.items)])]).join(', ');
}
function unsupportedTrack(data,uri) {
  return ['LocalTrack','Episode','Podcast','Audiobook','RestrictedContent','NotFound'].includes(data?.__typename) || /^spotify:(local|episode|show|chapter|audiobook):/.test(uri||'');
}
export function readSpotifyTrack(raw) {
  const {data:t,uri}=trackRecord(raw);
  const id=spotifyId(uri,'track');
  const artist=trackArtists(t),title=cleanText(t?.name).trim();
  if(!id || !title || !artist || unsupportedTrack(t,uri))return null;
  const cover=spotifyCover(t.albumOfTrack?.coverArt?.sources?.[0]?.url);
  const milliseconds=Number(t.duration?.totalMilliseconds??t.trackDuration?.totalMilliseconds??0);
  return {id:'spotify:'+id,spotifyId:id,provider:'spotify-import',title,artist:cleanText(artist),album:cleanText(t.albumOfTrack?.name),cover,coverXl:cover,duration:Number.isFinite(milliseconds)?Math.max(0,Math.min(86400,milliseconds/1000)):0,explicit:t.contentRating?.label==='EXPLICIT',externalUrl:'https://open.spotify.com/track/'+id};
}
export function readSpotifyEntity(raw, type) {
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

function createTrackReader(query,signal,onProgress) {
  const repaired=new Map();let attempts=0,started=null,repairUnavailable=false;
  return async(items,label)=>{
    const tracks=[];let unreadable=0,skipped=0;
    for(const raw of items){
      signal?.throwIfAborted();
      let track=readSpotifyTrack(raw);
      const {data,uri}=trackRecord(raw);
      if(track){tracks.push(track);continue;}
      if(unsupportedTrack(data,uri) || data?.playability?.playable===false){skipped++;continue;}
      const id=spotifyId(uri,'track');
      // Repair only missing metadata, once per ID, with a bounded total cost.
      // A failed optional lookup never turns a partial collection into a complete one.
      if(id && !repaired.has(id) && !repairUnavailable && attempts<20 && (started===null || Date.now()-started<15000)){
        started??=Date.now();attempts++;
        onProgress('Checking missing song details in '+label+'…');
        try {
          const detail=(await query('getTrack',{uri:'spotify:track:'+id})).data?.trackUnion;
          track=readSpotifyTrack(detail);
          if(track?.spotifyId!==id)track=null;
          repaired.set(id,track);
        }catch(error){
          if(error.code!=='metadata-unavailable')throw error;
          repairUnavailable=true;repaired.set(id,null);
        }
      }
      signal?.throwIfAborted();
      track=id?repaired.get(id):null;
      if(track)tracks.push(track);else unreadable++;
    }
    return {tracks,unreadable,skipped};
  };
}

// A failed/truncated read never becomes a successful empty library.
export async function readAllPages(getPage, {limit=50,max=10000,signal,label='library'}={}) {
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

export async function readSpotifyAccount(query,{signal,onProgress=()=>{}}={}) {
  onProgress('Reading your Spotify profile…');
  const profile=(await query('profileAttributes',{})).data?.me?.profile;
  if(!profile?.username || typeof profile.username!=='string')throw new Error('Sign in to Spotify, open Your Library, then try again.');
  const account=readSpotifyProfile(profile);
  const library={app:'spotplus-account',version:2,complete:true,account,capturedAt:Date.now(),likes:[],likesUnreadable:0,playlists:[],albums:[],artists:[],skipped:0};
  const readTracks=createTrackReader(query,signal,onProgress);
  const options={signal,max:10000};
  onProgress('Reading Liked Songs…');
  const liked=await readAllPages(async(offset,limit)=>{
    const page=(await query('fetchLibraryTracks',{offset,limit})).data?.me?.library;
    // Current responses wrap the page in tracks; retain the older direct-page shape.
    // An explicitly malformed tracks page must fail rather than fall back to an empty page.
    return page && Object.hasOwn(page,'tracks') ? page.tracks : page;
  },{...options,label:'Liked Songs'});
  const likedResult=await readTracks(liked,'Liked Songs');
  library.likes=likedResult.tracks;library.likesUnreadable=likedResult.unreadable;library.skipped+=likedResult.skipped;
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
      const result=await readTracks(items,'playlist “'+p.title+'”');
      p.tracks=result.tracks;p.unreadable=result.unreadable;p.status=result.unreadable?'partial':'ready';library.skipped+=result.skipped;
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

// Listening stats, the same data Stats for Spotify shows: top tracks/artists for
// Spotify's three windows and the last 50 plays. Read with the web player's own
// session from api.spotify.com (GET only, allowlisted paths). Optional: a failure here
// never blocks the library read.
export const STATS_RANGES = Object.freeze(['short_term','medium_term','long_term']);
export const STATS_PATHS = Object.freeze({
  tracks: range => '/v1/me/top/tracks?time_range='+range+'&limit=50',
  artists: range => '/v1/me/top/artists?time_range='+range+'&limit=50',
  recent: () => '/v1/me/player/recently-played?limit=50',
});
const webArtistNames = artists => Array.isArray(artists) ? artists.map(a => cleanText(a?.name, 200)).filter(Boolean).join(', ') : '';
const webImage = images => Array.isArray(images) ? spotifyCover(images.find(i => i?.url)?.url) : '';
export function readWebTrack(t) {
  const id = typeof t?.id === 'string' && /^[A-Za-z0-9]{22}$/.test(t.id) ? t.id : '';
  const title = cleanText(t?.name, 300), artist = webArtistNames(t?.artists);
  if (!id || !title || !artist) return null;
  return {spotifyId: id, title, artist, album: cleanText(t.album?.name, 300), cover: webImage(t.album?.images), duration: Number.isFinite(t.duration_ms) ? Math.round(t.duration_ms / 1000) : 0};
}
export function readWebArtist(a) {
  const id = typeof a?.id === 'string' && /^[A-Za-z0-9]{22}$/.test(a.id) ? a.id : '';
  const name = cleanText(a?.name, 200);
  if (!id || !name) return null;
  return {id, name, cover: webImage(a.images), genres: Array.isArray(a.genres) ? a.genres.map(g => cleanText(g, 60)).filter(Boolean).slice(0, 8) : []};
}
export async function readSpotifyStats(get, {onProgress = () => {}} = {}) {
  const stats = {capturedAt: Date.now(), top: {}, recent: []};
  for (const range of STATS_RANGES) {
    onProgress('Reading your top music (' + {short_term: '4 weeks', medium_term: '6 months', long_term: 'all time'}[range] + ')…');
    const [tracks, artists] = [await get(STATS_PATHS.tracks(range)), await get(STATS_PATHS.artists(range))];
    if (!Array.isArray(tracks?.items) || !Array.isArray(artists?.items)) throw new Error('Spotify returned unexpected top-music data.');
    stats.top[range] = {tracks: tracks.items.map(readWebTrack).filter(Boolean), artists: artists.items.map(readWebArtist).filter(Boolean)};
  }
  const recent = await get(STATS_PATHS.recent());
  if (!Array.isArray(recent?.items)) throw new Error('Spotify returned unexpected recently-played data.');
  stats.recent = recent.items.map(item => {
    const track = readWebTrack(item?.track), at = Date.parse(item?.played_at);
    return track && Number.isFinite(at) ? {...track, playedAt: at} : null;
  }).filter(Boolean);
  return stats;
}

// Auto-read is scoped to an explicit, fresh Connect Spotify launch.
export function canAutoRead({bridge,hostReady,authorization,attempted,now=Date.now()}){
 return !!hostReady&&!attempted&&!!bridge&&/^[a-f0-9]{32}$/.test(bridge.nonce||'')&&now>=bridge.started&&now-bridge.started<1800000&&['https://coye2.github.io'].includes(bridge.origin)&&/^Bearer\s+\S+$/.test(authorization||'');
}

// Clipboard handoff: Safari and an iPhone Home Screen app keep separate storage and
// cannot message each other, but they share the system clipboard. The library is
// gzip-compressed and base64-encoded behind a fixed prefix. Metadata only.
export const LIBRARY_TEXT_PREFIX = 'SPOTPLUS-LIBRARY-1:';
const LIBRARY_TEXT_LIMIT = 12 * 1024 * 1024;
function toBase64(bytes) {
  let out = '';
  for (let i = 0; i < bytes.length; i += 0x8000) out += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(out);
}
export async function encodeLibraryText(library) {
  const json = JSON.stringify(library);
  if (typeof CompressionStream !== 'function') return LIBRARY_TEXT_PREFIX + 'json:' + json;
  const gz = new Uint8Array(await new Response(new Blob([json]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer());
  return LIBRARY_TEXT_PREFIX + 'gz:' + toBase64(gz);
}
export function isLibraryText(value) { return typeof value === 'string' && value.trim().startsWith(LIBRARY_TEXT_PREFIX); }
export async function decodeLibraryText(value) {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!text.startsWith(LIBRARY_TEXT_PREFIX)) throw new Error('No Spot+ library found. On Spotify, tap Copy for Spot+ first.');
  let body = text.slice(LIBRARY_TEXT_PREFIX.length);
  if (body.startsWith('gz:')) body = body.replace(/\s+/g, ''); // Base64 may pick up line breaks when pasted.
  const bad = () => new Error('The copied library is incomplete. On Spotify, tap Copy for Spot+ again.');
  let json;
  if (body.startsWith('json:')) json = body.slice(5);
  else if (body.startsWith('gz:')) {
    if (typeof DecompressionStream !== 'function') throw new Error('This browser cannot open copied libraries. Use Save library file instead.');
    if (body.length > LIBRARY_TEXT_LIMIT * 2) throw new Error('The copied library is larger than the 12 MB limit.');
    let bytes;
    try { const raw = atob(body.slice(3)); bytes = new Uint8Array(raw.length); for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i); } catch { throw bad(); }
    const reader = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip')).getReader();
    const chunks = []; let size = 0;
    try {
      for (;;) {
        const {done, value: chunk} = await reader.read();
        if (done) break;
        size += chunk.length; chunks.push(chunk);
        if (size > LIBRARY_TEXT_LIMIT) { reader.cancel().catch(() => {}); throw new Error('The copied library is larger than the 12 MB limit.'); }
      }
    } catch (error) { if (/12 MB/.test(error.message)) throw error; throw bad(); }
    const all = new Uint8Array(size); let at = 0;
    for (const chunk of chunks) { all.set(chunk, at); at += chunk.length; }
    json = new TextDecoder().decode(all);
  } else throw bad();
  if (json.length > LIBRARY_TEXT_LIMIT) throw new Error('The copied library is larger than the 12 MB limit.');
  try { return JSON.parse(json); } catch { throw bad(); }
}
