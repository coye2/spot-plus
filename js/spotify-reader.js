// Read-only Spotify web-client adapter. No cookie access, login or audio extraction.
// Request names/hashes describe Spotify's interface; see ACCOUNT-CONNECTION.md.
export const COMPANION_VERSION = '1.3.3';
export const SPOTIFY_QUERY_URL = 'https://api-partner.spotify.com/pathfinder/v2/query';
export const READ_QUERIES = Object.freeze({
  profileAttributes:'53bcb064f6cd18c23f752bc324a791194d20df612d8e1239c735144ab0399ced',
  libraryV3:'390c78e5b951029bad359785e69b07b536a509c581cbcd0aded5e5067f187455',
  fetchLibraryTracks:'087278b20b743578a6262c2b0b4bcd20d879c503cc359a2285baf083ef944240',
  fetchPlaylist:'cd2275433b29f7316176e7b5b5e098ae7744724e1a52d63549c76636b3257749',
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
  const wrapper=raw?.itemV2 || raw?.track;
  const data=wrapper ? wrapper.data : raw;
  return {data,uri:data?.uri ?? wrapper?._uri ?? wrapper?.uri};
}
export function readSpotifyTrack(raw) {
  const {data:t,uri}=trackRecord(raw);
  const id=spotifyId(uri,'track');
  if(!id || !t.name || !Array.isArray(t.artists?.items))return null;
  const cover=spotifyCover(t.albumOfTrack?.coverArt?.sources?.[0]?.url);
  return {id:'spotify:'+id,spotifyId:id,provider:'spotify-import',title:cleanText(t.name),artist:cleanText(t.artists.items.map(a=>a.profile?.name||a.name||'').filter(Boolean).join(', ')),album:cleanText(t.albumOfTrack?.name),cover,coverXl:cover,duration:Math.max(0,Math.min(86400,Number(t.duration?.totalMilliseconds||t.trackDuration?.totalMilliseconds||0)/1000)),explicit:t.contentRating?.label==='EXPLICIT',externalUrl:'https://open.spotify.com/track/'+id};
}
export function readSpotifyEntity(raw, type) {
  const t=raw?.item?.data || raw;
  const id=spotifyId(t?.uri ?? raw?.item?._uri ?? raw?.item?.uri,type);
  if(!id)return null;
  return {id,type,title:cleanText(t.name||t.profile?.name)||'Spotify '+type,cover:spotifyCover(t.coverArt?.sources?.[0]?.url||t.images?.items?.[0]?.sources?.[0]?.url||t.visuals?.avatarImage?.sources?.[0]?.url),owner:cleanText(t.ownerV2?.data?.name)};
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
export async function readAllPages(getPage, {limit=50,max=10000,signal,label='library'}={}) {
  const result=[]; let expected=null; const seen=new Set();
  for(let offset=0;offset<=max;){
    signal?.throwIfAborted();
    const page=await getPage(offset,limit);
    if(!page || !Array.isArray(page.items) || !Number.isInteger(page.totalCount) || page.totalCount<0)throw new Error('Could not read '+label+' from Spotify’s response. Your saved library is kept.');
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
    try {
      const items=await readAllPages(async(offset,limit)=>(await query('fetchPlaylist',{uri:'spotify:playlist:'+p.id,offset,limit,enableWatchFeedEntrypoint:false})).data?.playlistV2?.content,{...options,label:'playlist “'+p.title+'”'});
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
export function canAutoRead({bridge,hostReady,authorization,attempted,now=Date.now()}){
 return !!hostReady&&!attempted&&!!bridge&&/^[a-f0-9]{32}$/.test(bridge.nonce||'')&&now>=bridge.started&&now-bridge.started<1800000&&['https://coye2.github.io','https://spot-plus-coyeb.coyeboymitchell2000.chatgpt.site'].includes(bridge.origin)&&/^Bearer\s+\S+$/.test(authorization||'');
}
