// Read public page metadata only. Never forward browser credentials or return
// Spotify's anonymous session/configuration objects from the page.
const validId = value => /^[A-Za-z0-9]{22}$/.test(value||'');
const count = value => /^\d+$/.test(String(value)) && Number.isSafeInteger(Number(value)) ? Number(value) : null;
const headers={'Access-Control-Allow-Origin':'*','Content-Type':'application/json; charset=utf-8','X-Content-Type-Options':'nosniff'};
const json=(data,status=200,age=21600)=>new Response(JSON.stringify(data),{status,headers:{...headers,'Cache-Control':age?'public, max-age='+age:'no-store'}});
export async function boundedText(response,limit=1500000) {
 const reader=response.body.getReader(),decoder=new TextDecoder();let size=0,result='';
 try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>limit){await reader.cancel();throw new Error('Page too large');}result+=decoder.decode(value,{stream:true});}return result+decoder.decode();}finally{reader.releaseLock();}
}
export function publicSpotifyEntity(html,type,id) {
 const encoded=html.match(/<script[^>]*id="initialState"[^>]*>([^<]+)<\/script>/)?.[1];
 if(!encoded)throw new Error('Public metadata unavailable');
 const bytes=Uint8Array.from(atob(encoded),c=>c.charCodeAt(0));
 return JSON.parse(new TextDecoder().decode(bytes)).entities?.items?.['spotify:'+type+':'+id] || null;
}
export function artistCounters(entity) {
 const id=String(entity?.uri||'').split(':')[2];if(!validId(id))return null;
 const tracks=(entity.discography?.topTracks?.items||[]).map(({track})=>({id:String(track?.uri||'').split(':')[2],title:String(track?.name||'').slice(0,300),plays:count(track?.playcount),duration:Math.round((track?.duration?.totalMilliseconds||0)/1000)})).filter(t=>validId(t.id)&&t.plays!==null);
 return {id,name:String(entity.profile?.name||'').slice(0,200),monthlyListeners:count(entity.stats?.monthlyListeners),tracks,source:'https://open.spotify.com/artist/'+id,checkedAt:Date.now()};
}
export async function spotifyStats(request,{fetcher=fetch,cache,waitUntil=()=>{}}={}) {
 const params=new URL(request.url).searchParams;
 const artist=params.get('artistId'),track=params.get('trackId'),deezer=params.get('deezerArtistId');
 if([artist,track,deezer].filter(x=>x!==null).length!==1||Number(validId(artist))+Number(validId(track))+Number(/^\d{1,16}$/.test(deezer||''))!==1)return json({error:'Provide one valid artist or track ID'},400,0);
 const query=new URLSearchParams(artist?{artistId:artist}:track?{trackId:track}:{deezerArtistId:deezer});
 const key=new Request(new URL(request.url).origin+'/spotify-stats-v2?'+query),hit=await cache?.match(key);if(hit)return hit;
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),10000);
 const get=async(url,accept='text/html')=>{const r=await fetcher(url,{signal:controller.signal,redirect:'manual',headers:{Accept:accept,'User-Agent':'SpotPlus/2.0 (https://coye2.github.io/spot-plus/)'}});if(!r.ok)throw new Error('Public source unavailable');return boundedText(r);};
 try{
  let id=artist;
  if(deezer){
   const sparql=`SELECT ?spotify WHERE { ?entity wdt:P2722 "${deezer}"; wdt:P1902 ?spotify. } LIMIT 2`;
   const data=JSON.parse(await get('https://query.wikidata.org/sparql?format=json&query='+encodeURIComponent(sparql),'application/sparql-results+json'));
   const ids=[...new Set((data.results?.bindings||[]).map(x=>x.spotify?.value).filter(validId))];
   if(ids.length!==1)return json({available:false,reason:'No unique Spotify artist mapping'},200,3600);id=ids[0];
  }
  let counters;
  if(track){
   const entity=publicSpotifyEntity(await get('https://open.spotify.com/track/'+track),'track',track);
   counters=artistCounters(entity?.firstArtist?.items?.[0]);
   const matching=counters?.tracks.find(t=>t.id===track);if(matching)matching.duration=Math.round((entity?.duration?.totalMilliseconds||0)/1000);
  }else counters=artistCounters(publicSpotifyEntity(await get('https://open.spotify.com/artist/'+id),'artist',id));
  const response=json(counters?{available:true,...counters}:{available:false,reason:'Spotify does not publish these counts on this page'});
  if(cache)waitUntil(cache.put(key,response.clone()).catch(()=>{}));return response;
 }catch{return json({available:false,error:'Spotify public statistics are temporarily unavailable'},503,0);}finally{clearTimeout(timer);}
}
