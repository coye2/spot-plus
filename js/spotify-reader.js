// Read-only Spotify web-client adapter. No cookie access, login or audio extraction.
// Request names/hashes describe Spotify's interface; see ACCOUNT-CONNECTION.md.
export const COMPANION_VERSION = '1.3.5';
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

// Auto-read is scoped to an explicit, fresh Connect Spotify launch.
export function canAutoRead({bridge,hostReady,authorization,attempted,now=Date.now()}){
 return !!hostReady&&!attempted&&!!bridge&&/^[a-f0-9]{32}$/.test(bridge.nonce||'')&&now>=bridge.started&&now-bridge.started<1800000&&['https://coye2.github.io','https://spot-plus-coyeb.coyeboymitchell2000.chatgpt.site'].includes(bridge.origin)&&/^Bearer\s+\S+$/.test(authorization||'');
}
