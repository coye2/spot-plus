import {spotifyCover,spotifyProfileURL} from './spotify-reader.js';

export const ACCOUNT_FILE_LIMIT=12*1024*1024;
const text=(v,n=500)=>typeof v==='string'?v.slice(0,n):'';
const validId=v=>typeof v==='string'&&/^[A-Za-z0-9]{22}$/.test(v);
function track(t){
  if(!t||!validId(t.spotifyId)||!text(t.title).trim()||!text(t.artist).trim())return null;
  const cover=spotifyCover(t.cover);
  return {id:'spotify:'+t.spotifyId,spotifyId:t.spotifyId,provider:'spotify-import',title:text(t.title),artist:text(t.artist),album:text(t.album),cover,coverXl:cover,duration:Number.isFinite(t.duration)?Math.min(86400,Math.max(0,t.duration)):0,explicit:!!t.explicit,externalUrl:'https://open.spotify.com/track/'+t.spotifyId};
}
function entity(p,type){return {id:p.id,type,title:text(p.title)||'Spotify '+type,owner:text(p.owner),cover:spotifyCover(p.cover)};}
function unreadableCount(value){
  if(value==null)return 0;
  if(!Number.isInteger(value)||value<0||value>10000)throw new Error('Invalid incomplete-song count. Your saved copy is unchanged.');
  return value;
}
// Listening stats (top tracks/artists per range, recent plays). Invalid stats are
// dropped rather than failing the whole library.
const RANGES=['short_term','medium_term','long_term'];
function statTrack(t){const x=track(t);return x&&{...x,...(Number.isFinite(t.playedAt)&&t.playedAt>0?{playedAt:t.playedAt}:{})};}
function statArtist(a){return a&&validId(a.id)&&text(a.name,200).trim()?{id:a.id,name:text(a.name,200),cover:spotifyCover(a.cover),genres:Array.isArray(a.genres)?a.genres.map(g=>text(g,60)).filter(Boolean).slice(0,8):[]}:null;}
export function validateStats(raw){
  if(!raw||typeof raw!=='object'||!Number.isFinite(raw.capturedAt)||!raw.top)return null;
  const top={};
  for(const range of RANGES){const r=raw.top[range];if(!r||!Array.isArray(r.tracks)||!Array.isArray(r.artists))return null;top[range]={tracks:r.tracks.slice(0,50).map(statTrack).filter(Boolean),artists:r.artists.slice(0,50).map(statArtist).filter(Boolean)};}
  const recent=Array.isArray(raw.recent)?raw.recent.slice(0,50).map(statTrack).filter(t=>t?.playedAt):[];
  return {capturedAt:raw.capturedAt,top,recent};
}
export function validateAccountSnapshot(raw){
  if(!raw||raw.app!=='spotplus-account'||![1,2].includes(raw.version)||raw.complete!==true||!text(raw.account?.id,120)||!Number.isFinite(raw.capturedAt))throw new Error('Choose a completed Spot+ companion library file.');
  if(JSON.stringify(raw).length>ACCOUNT_FILE_LIMIT)throw new Error('This library is too large. The phone connector limit is 12 MB.');
  for(const k of ['likes','playlists','albums','artists'])if(!Array.isArray(raw[k]))throw new Error('The library file is incomplete. Your saved copy is unchanged.');
  if(raw.likes.length>10000||raw.playlists.length>1000||raw.albums.length>1000||raw.artists.length>1000)throw new Error('This collection exceeds the phone connector limits.');
  const playlists=raw.playlists.map(p=>{
    if(!p||!validId(p.id)||!Array.isArray(p.tracks)||p.tracks.length>10000||!['ready','unavailable','partial'].includes(p.status))throw new Error('A playlist is incomplete. Sync again from Spotify.');
    const tracks=p.tracks.map(track).filter(Boolean),unreadable=unreadableCount(unreadableCount(p.unreadable)+p.tracks.length-tracks.length);
    if(p.status==='partial'&&!unreadable)throw new Error('A partial playlist is missing its incomplete-song count.');
    return {...entity(p,'playlist'),status:p.status==='unavailable'?'unavailable':unreadable?'partial':'ready',tracks,unreadable};
  });
  const likes=raw.likes.map(track).filter(Boolean);
  const likesUnreadable=unreadableCount(unreadableCount(raw.likesUnreadable)+raw.likes.length-likes.length);
  if(likes.length+playlists.reduce((n,p)=>n+p.tracks.length,0)>20000)throw new Error('This library exceeds the 20,000-track limit.');
  return {app:'spotplus-account',version:2,complete:true,account:{id:text(raw.account.id,120),name:text(raw.account.name,120)||text(raw.account.id,120),avatar:spotifyCover(raw.account.avatar),externalUrl:spotifyProfileURL(raw.account.id)},capturedAt:raw.capturedAt,likes,likesUnreadable,playlists,albums:raw.albums.filter(p=>p&&validId(p.id)).map(p=>entity(p,'album')),artists:raw.artists.filter(p=>p&&validId(p.id)).map(p=>entity(p,'artist')),skipped:Math.max(0,Math.min(20000,Number(raw.skipped)||0)),stats:validateStats(raw.stats),statsPrevious:validateStats(raw.statsPrevious),statsError:raw.stats?'':text(raw.statsError,200)};
}
export function mergeAccountSnapshot(previous,incoming){
  const next=validateAccountSnapshot(incoming);
  if(previous?.account?.id===next.account.id){
    if(next.capturedAt<previous.capturedAt)throw new Error('This file is older than your saved Spotify library. Choose a newer sync.');
    if(next.likesUnreadable)next.likes=previous.likes;
    for(const p of next.playlists)if(p.status==='unavailable'||p.status==='partial'){
      const old=previous.playlists.find(item=>item.id===p.id);
      if(!old)continue;
      p.tracks=old.tracks;
      if(['Unavailable playlist','Spotify playlist'].includes(p.title))p.title=old.title;
      p.cover=p.cover||old.cover;p.owner=p.owner||old.owner;
    }
  }
  // Stats: keep the last good copy when a refresh couldn't read them; remember the
  // previous copy so ranks can show movement, like Stats for Spotify.
  if(previous?.account?.id===next.account.id){
    if(!next.stats){next.stats=previous.stats||null;next.statsPrevious=previous.statsPrevious||null;}
    else if(previous.stats&&previous.stats.capturedAt<next.stats.capturedAt)next.statsPrevious=previous.stats;
    else next.statsPrevious=previous.statsPrevious||null;
  }
  // Retained tracks also count toward the limits and must remain safe for backup/export.
  return validateAccountSnapshot(next);
}
export function isAccountMessage(event,pending,type='spotplus-library'){
  return !!pending && !!pending.window && Date.now()>=pending.started && Date.now()-pending.started<30*60*1000 && event.origin==='https://open.spotify.com' && event.source===pending.window && event.data?.type===type && event.data.nonce===pending.nonce;
}

export function accountReadNotice(snapshot){
  const parts=[],partial=snapshot.playlists.filter(p=>p.status==='partial').length,unavailable=snapshot.playlists.filter(p=>p.status==='unavailable').length;
  if(unavailable)parts.push(unavailable+' unavailable playlist'+(unavailable===1?'':'s')+'. Any saved copies of those playlists will be kept.');
  if(snapshot.likesUnreadable)parts.push('Incomplete entries in Liked Songs: '+snapshot.likesUnreadable+'.');
  if(partial)parts.push(partial+' playlist'+(partial===1?' has':'s have')+' incomplete song details.');
  if(partial||snapshot.likesUnreadable)parts.push('For incomplete collections, an existing copy is kept. New collections contain only readable songs. Refresh from Spotify to try again.');
  return parts.join(' ');
}
