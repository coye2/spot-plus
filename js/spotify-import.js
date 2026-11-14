import {unzipSync,strFromU8} from './vendor/fflate.js';

const text=x=>typeof x==='string'?x.trim():'';
function hash(value){let h=2166136261;for(const c of value){h^=c.charCodeAt(0);h=Math.imul(h,16777619);}return (h>>>0).toString(36);}
export function normalizeSpotifyTrack(raw){
  if(!raw||typeof raw!=='object')return null;
  const t=raw.track&&typeof raw.track==='object'?raw.track:raw;
  const title=text(t.trackName||t.track||t.name||t.title),artist=text(t.artistName||t.artist||t.artists?.map(a=>a.name).join(', '));
  if(!title||!artist)return null;
  const uri=text(t.trackUri||t.uri),id=uri.match(/(?:spotify:track:|open\.spotify\.com\/track\/)([A-Za-z0-9]{22})/)?.[1]||'';
  const album=text(t.albumName||t.album?.name||t.album);
  return {id:id?'spotify:'+id:'spotify-import:'+hash([title,artist,album].join('|')),spotifyId:id,provider:'spotify-import',title,artist,album,duration:Number(t.duration_ms||0)/1000,explicit:!!t.explicit,externalUrl:id?'https://open.spotify.com/track/'+id:'',cover:'',coverXl:''};
}
export function normalizeSpotifyDocuments(documents){
  const likes=[],playlists=[],errors=[];let recognized=0;
  for(const doc of documents){
    const d=doc.data;
    if(!d||typeof d!=='object')continue;
    if(Array.isArray(d.tracks)){recognized++;likes.push(...d.tracks.map(normalizeSpotifyTrack).filter(Boolean));}
    if(Array.isArray(d.playlists)){recognized++;for(const p of d.playlists){if(!p||!Array.isArray(p.items))continue;const tracks=p.items.map(normalizeSpotifyTrack).filter(Boolean),name=text(p.name)||'Spotify playlist';playlists.push({id:'spimport'+hash(name+'|'+text(p.uri)),name,tracks,created:Date.parse(p.lastModifiedDate)||Date.now(),source:'spotify-export'});}}
    if(d.app==='spotplus-spotify-export'&&Array.isArray(d.documents)){const nested=normalizeSpotifyDocuments(d.documents);likes.push(...nested.likes);playlists.push(...nested.playlists);recognized+=nested.recognized;}
  }
  if(!recognized)throw new Error('No Spotify library or playlist data was found. Choose YourLibrary.json, Playlist*.json, or the Account data ZIP from Spotify.');
  return {likes:[...new Map(likes.map(t=>[t.id,t])).values()],playlists:[...new Map(playlists.map(p=>[p.id,p])).values()],recognized,errors};
}
export function readSpotifyArchive(buffer,name='data.json'){
  const bytes=new Uint8Array(buffer);if(bytes.byteLength>80*1024*1024)throw new Error('Choose the Account data ZIP (under 80 MB), or individual library/playlist JSON files.');
  const docs=[];
  if(/\.zip$/i.test(name)){
    let total=0,count=0;
    const entries=unzipSync(bytes,{filter:file=>{if(!/(?:^|[\/\\])(YourLibrary|Playlist\d*|Playlists)\.json$/i.test(file.name))return false;total+=file.originalSize;count++;if(file.originalSize>20*1024*1024||total>50*1024*1024||count>100)throw new Error('The music export is too large. Import individual playlist JSON files instead.');return true;}});
    for(const [filename,data]of Object.entries(entries))docs.push({name:filename,data:JSON.parse(strFromU8(data).replace(/^\uFEFF/,''))});
  }else docs.push({name,data:JSON.parse(strFromU8(bytes).replace(/^\uFEFF/,''))});
  return normalizeSpotifyDocuments(docs);
}
