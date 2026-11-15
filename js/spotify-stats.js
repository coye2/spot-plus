const ENDPOINT='https://spot-plus-canvas.pwr97pnmkn.workers.dev/spotify-stats';
const cache=new Map(),pending=new Map(),queue=[];let active=0;
const normalize=value=>String(value||'').normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ').trim();
export function matchPlayCount(track,counters){
  if(!counters?.available)return null;
  const spotifyId=track.spotifyId||(/^spotify-/.test(track.id||'')?track.id.slice(8):'');
  const matches=counters.tracks.filter(t=>spotifyId?t.id===spotifyId:normalize(t.title)===normalize(track.title)&&track.duration>0&&t.duration>0&&Math.abs(t.duration-track.duration)<=3);
  return matches.length===1?matches[0]:null;
}
function pump(){while(active<2&&queue.length){active++;const task=queue.shift();task().finally(()=>{active--;pump();});}}
export function getSpotifyStats({spotifyId,artistId,spotifyArtistId}={}){
  const query=spotifyArtistId?{artistId:spotifyArtistId}:spotifyId?{trackId:spotifyId}:artistId&&/^\d+$/.test(artistId)?{deezerArtistId:artistId}:null;
  if(!query)return Promise.resolve({available:false});const key=new URLSearchParams(query).toString();
  if(cache.has(key)&&cache.get(key).expires>Date.now())return Promise.resolve(cache.get(key).data);
  if(pending.has(key))return pending.get(key);
  const promise=new Promise(resolve=>{queue.push(async()=>{
    let data={available:false};const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),12000);
    try{const r=await fetch(ENDPOINT+'?'+key,{signal:controller.signal,credentials:'omit'});if(r.ok)data=await r.json();}catch{/* A counter must never interrupt playback. */}finally{clearTimeout(timer);}
    cache.set(key,{data,expires:Date.now()+(data.available?21600000:600000)});pending.delete(key);resolve(data);
  });});pending.set(key,promise);pump();return promise;
}

export async function getTrackStats(track){
  let data=await getSpotifyStats(track);
  if(!track.spotifyId&&data.available){const matches=data.tracks.filter(t=>normalize(t.title)===normalize(track.title));if(matches.length===1&&!matches[0].duration)data=await getSpotifyStats({spotifyId:matches[0].id});}
  return data;
}
let observer;
export function hydrateStatistics(root){
  observer?.disconnect();
  const load=async node=>{
    const track={id:node.dataset.trackId,spotifyId:node.dataset.spotifyId,artistId:node.dataset.artistId,title:node.dataset.title,duration:Number(node.dataset.duration)};
    const data=await (node.dataset.counter==='artist'?getSpotifyStats({...track,spotifyArtistId:node.dataset.spotifyArtistId}):getTrackStats(track));if(!node.isConnected)return;
    if(node.dataset.counter==='artist'){
      // Spotify style: "12,345,678 monthly listeners". If unavailable, keep the fallback text already shown.
      if(data.available&&data.monthlyListeners!==null){node.textContent=data.monthlyListeners.toLocaleString()+' monthly listeners';node.title='Spotify public count · Checked '+new Date(data.checkedAt).toLocaleString();}
    }else{const count=matchPlayCount(track,data);node.textContent=count?count.plays.toLocaleString()+(node.closest('.artist-popular')?'':' plays'):'';node.title=count?'Spotify public count · Checked '+new Date(data.checkedAt).toLocaleString():'';}
  };
  observer=new IntersectionObserver(entries=>{for(const e of entries)if(e.isIntersecting){observer.unobserve(e.target);load(e.target);}}, {rootMargin:'60px'});
  root.querySelectorAll('[data-counter]').forEach(node=>observer.observe(node));
}
