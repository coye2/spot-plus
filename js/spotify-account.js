import {spotifyCover} from './spotify-reader.js';

export const ACCOUNT_FILE_LIMIT=12*1024*1024;
const text=(v,n=500)=>typeof v==='string'?v.slice(0,n):'';
const validId=v=>typeof v==='string'&&/^[A-Za-z0-9]{22}$/.test(v);
function track(t){
  if(!t||!validId(t.spotifyId)||!text(t.title)||!text(t.artist))return null;
  const cover=spotifyCover(t.cover);
  return {id:'spotify:'+t.spotifyId,spotifyId:t.spotifyId,provider:'spotify-import',title:text(t.title),artist:text(t.artist),album:text(t.album),cover,coverXl:cover,duration:Number.isFinite(t.duration)?Math.min(86400,Math.max(0,t.duration)):0,explicit:!!t.explicit,externalUrl:'https://open.spotify.com/track/'+t.spotifyId};
}
function entity(p,type){return {id:p.id,type,title:text(p.title)||'Spotify '+type,owner:text(p.owner),cover:spotifyCover(p.cover)};}
export function validateAccountSnapshot(raw){
  if(!raw||raw.app!=='spotplus-account'||raw.version!==1||raw.complete!==true||!text(raw.account?.id,120)||!Number.isFinite(raw.capturedAt))throw new Error('Choose a completed Spot+ companion library file.');
  if(JSON.stringify(raw).length>ACCOUNT_FILE_LIMIT)throw new Error('This library is too large. The phone connector limit is 12 MB.');
  for(const k of ['likes','playlists','albums','artists'])if(!Array.isArray(raw[k]))throw new Error('The library file is incomplete. Your saved copy is unchanged.');
  if(raw.likes.length>10000||raw.playlists.length>1000||raw.albums.length>1000||raw.artists.length>1000)throw new Error('This collection exceeds the phone connector limits.');
  const playlists=raw.playlists.map(p=>{
    if(!p||!validId(p.id)||!Array.isArray(p.tracks)||p.tracks.length>10000||!['ready','unavailable'].includes(p.status))throw new Error('A playlist is incomplete. Sync again from Spotify.');
    return {...entity(p,'playlist'),status:p.status,tracks:p.tracks.map(track).filter(Boolean)};
  });
  const likes=raw.likes.map(track).filter(Boolean);
  if(likes.length+playlists.reduce((n,p)=>n+p.tracks.length,0)>20000)throw new Error('This library exceeds the 20,000-track limit.');
  return {app:'spotplus-account',version:1,complete:true,account:{id:text(raw.account.id,120),name:text(raw.account.name,120)||text(raw.account.id,120)},capturedAt:raw.capturedAt,likes,playlists,albums:raw.albums.filter(p=>p&&validId(p.id)).map(p=>entity(p,'album')),artists:raw.artists.filter(p=>p&&validId(p.id)).map(p=>entity(p,'artist')),skipped:Math.max(0,Math.min(20000,Number(raw.skipped)||0))};
}
export function mergeAccountSnapshot(previous,incoming){
  const next=validateAccountSnapshot(incoming);
  if(previous?.account?.id===next.account.id){
    if(next.capturedAt<previous.capturedAt)throw new Error('This file is older than your saved Spotify library. Choose a newer sync.');
    for(const p of next.playlists)if(p.status==='unavailable')p.tracks=previous.playlists.find(old=>old.id===p.id)?.tracks||[];
  }
  return next;
}
export function isAccountMessage(event,pending,type='spotplus-library'){
  return !!pending && !!pending.window && Date.now()>=pending.started && Date.now()-pending.started<30*60*1000 && event.origin==='https://open.spotify.com' && event.source===pending.window && event.data?.type===type && event.data.nonce===pending.nonce;
}
