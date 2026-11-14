// Matching videos are optional, independent YouTube embeds, never labelled Spotify Canvas.
const clean=value=>String(value||'').toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g,'').replace(/[^\p{L}\p{N}]+/gu,' ').trim();
export function youtubeId(value){try{const u=new URL(String(value));if(!['https:','http:'].includes(u.protocol))return null;const host=u.hostname.replace(/^www\./,'');const id=host==='youtu.be'?u.pathname.slice(1):['youtube.com','m.youtube.com','youtube-nocookie.com'].includes(host)?u.searchParams.get('v')||u.pathname.match(/^\/(?:embed|shorts)\/([^/]+)$/)?.[1]:null;return /^[\w-]{11}$/.test(id||'')?id:null;}catch{return null;}}
export function chooseVideo(items,track){
 const artist=clean(track.artist),title=clean(track.searchTitle||track.title).split(' ').filter(Boolean);
 return items.filter(x=>/^[\w-]{11}$/.test(x.id||'')).map(x=>{
  const name=clean(x.title),by=clean(x.channel);const coverage=title.filter(w=>name.split(' ').includes(w)).length/Math.max(1,title.length);
  const artistMatch=artist&&(name.includes(artist)||by.includes(artist));
  const unsuitable=/\b(lyrics?|audio|karaoke|cover|reaction|tutorial)\b/.test(name)||(/\blive\b/.test(name)&&!clean(track.title).includes('live'));
  return {...x,score:artistMatch&&coverage>=.8&&!unsuitable?coverage+(/official (music )?video/.test(name)?2:0):0};
 }).filter(x=>x.score>0).sort((a,b)=>b.score-a.score)[0]||null;
}
export function embedUrl(id,clip=true){if(!/^[\w-]{11}$/.test(id||''))return null;return `https://www.youtube-nocookie.com/embed/${id}?autoplay=1&playsinline=1&rel=0${clip?'&start=0&end=30':''}`;}

export function savedVideo(track){try{const items=JSON.parse(localStorage.getItem('spotplus.clipChoices')||'[]');const hit=Array.isArray(items)?items.find(x=>x.track===String(track.id)&&/^[\w-]{11}$/.test(x.id)):null;return hit?{id:hit.id,title:String(hit.title||track.title).slice(0,200)}:null;}catch{return null;}}
export function saveVideo(track,video){if(!track?.id||!/^[\w-]{11}$/.test(video?.id||''))return;try{const old=JSON.parse(localStorage.getItem('spotplus.clipChoices')||'[]');const items=[{track:String(track.id),id:video.id,title:String(video.title||track.title).slice(0,200)},...(Array.isArray(old)?old:[]).filter(x=>x.track!==String(track.id))].slice(0,150);localStorage.setItem('spotplus.clipChoices',JSON.stringify(items));}catch{/* Playback still works when storage is full. */}}
