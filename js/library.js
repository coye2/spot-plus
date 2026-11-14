/* Pure library projection shared by the sidebar and the mobile library. */
import {normalizeFolders} from './folders.js';
export function libraryItems(data, {filter='all', query='', sort='recent', pins=[],folderId=null,flat=false}={}) {
  const entries = [
    {id:'liked',title:'Liked Songs',type:'playlists',subtitle:`Playlist · ${data.likes.length} songs`,route:'#/liked',icon:'heartFill',className:'grad',order:Infinity},
    {id:'downloads',title:'Downloads',type:'downloaded',subtitle:`${data.downloads.length} songs · On this device`,route:'#/downloads',icon:'download',className:'grad2',order:Infinity-1},
    ...(data.localFiles.length ? [{id:'local',title:'Local files',type:'downloaded',subtitle:`${data.localFiles.length} songs · On this device`,route:'#/local',icon:'note',order:Infinity-2}] : []),
    ...data.playlists.map((p,i)=>({id:p.id,title:p.name,type:'playlists',folderable:true,subtitle:`Playlist · ${p.tracks.length} songs`,route:`#/my/${p.id}`,cover:p.tracks.find(t=>t.cover)?.cover,order:p.created||data.playlists.length-i})),
    ...data.albums.map(a=>({id:`album-${a.id}`,title:a.title,type:'albums',subtitle:`Album · ${a.artist}`,route:`#/album/${a.id}`,cover:a.cover,order:a.saved||0})),
    ...data.artists.map(a=>({id:`artist-${a.id}`,title:a.name,type:'artists',subtitle:'Artist',route:`#/artist/${a.id}`,cover:a.picture,order:a.saved||0})),
    ...(data.spotifyLinks||[]).filter(p=>/^[a-zA-Z0-9]{22}$/.test(p.id)&&['playlist','album','artist','track'].includes(p.type)).map(p=>({id:`spotify-${p.id}`,title:p.title,type:'playlists',folderable:p.type==='playlist',subtitle:'Spotify · Opens in Spotify player',route:`#/spotify/${p.type}/${p.id}`,cover:p.cover,order:p.saved||0})),
    ...(data.spotifyAccount ? [
      {id:'spotify-likes',title:'Spotify Liked Songs',type:'playlists',subtitle:`Spotify · ${data.spotifyAccount.likes.length} songs`,route:'#/spotify-account/likes',icon:'heartFill',className:'grad',order:data.spotifyAccount.capturedAt},
      ...data.spotifyAccount.playlists.map(p=>({id:'spotify-account-'+p.id,title:p.title,type:'playlists',folderable:true,subtitle:`Spotify copy · ${p.tracks.length} songs${p.status==='unavailable'?' · Update unavailable':''}`,route:'#/spotify-account/playlist/'+p.id,cover:p.cover,order:data.spotifyAccount.capturedAt})),
      ...data.spotifyAccount.albums.map(p=>({id:'spotify-album-'+p.id,title:p.title,type:'albums',subtitle:'Spotify album · Spotify player',route:'#/spotify/album/'+p.id,cover:p.cover,order:data.spotifyAccount.capturedAt})),
      ...data.spotifyAccount.artists.map(p=>({id:'spotify-artist-'+p.id,title:p.title,type:'artists',subtitle:'Followed on Spotify · Spotify player',route:'#/spotify/artist/'+p.id,cover:p.cover,order:data.spotifyAccount.capturedAt})),
    ]:[]),
  ];
  const folders=normalizeFolders(data.folders),membership=new Map(folders.flatMap(f=>f.items.map(id=>[id,f])));
  for(const entry of entries)if(entry.folderable&&membership.has(entry.id)){entry.folderId=membership.get(entry.id).id;entry.folderName=membership.get(entry.id).name;}
  let visible=entries;
  if(folderId)visible=entries.filter(x=>x.folderId===folderId);
  else if(!flat){
    const grouped=folders.map(f=>{const count=entries.filter(x=>x.folderId===f.id).length;return {id:f.id,title:f.name,type:'playlists',isFolder:true,subtitle:`Folder · ${count} playlist${count===1?'':'s'}`,route:'#/folder/'+f.id,icon:'folder',order:f.created};});
    visible=[...grouped,...entries.filter(x=>!x.folderId||query.trim())];
  }
  return visible.filter(x=>(filter==='all'||x.type===filter) && `${x.title} ${x.subtitle} ${folderId?'':x.folderName||''}`.toLowerCase().includes(query.toLowerCase())).sort((a,b)=>Number(pins.includes(b.id))-Number(pins.includes(a.id)) || (sort==='name'?a.title.localeCompare(b.title):sort==='type'?a.type.localeCompare(b.type)||a.title.localeCompare(b.title):b.order-a.order));
}
export function visibleTracks(tracks, settings) { return settings.showExplicit === false ? tracks.filter(t=>!t.explicit) : tracks; }
export function parseRoute(hash) {
  try { decodeURIComponent(hash || ''); return hash || '#/home'; } catch { return '#/home'; }
}
