const text=value=>typeof value==='string'?value.trim().slice(0,300):'';
export function parseHistory(data){
  const rows=Array.isArray(data)?data:data?.app==='spotplus-rewind'?data.records:null;
  if(!rows)throw new Error('Choose Spotify Streaming History JSON, a Spotify data ZIP, or a Spot+ Rewind export.');
  if(rows.length>250000)throw new Error('Import history in smaller files (up to 250,000 entries each).');
  return rows.flatMap(row=>{
    const backup=data?.app==='spotplus-rewind';
    const artist=text(backup?row.artist:row.master_metadata_album_artist_name??row.artistName);
    const title=text(backup?row.title:row.master_metadata_track_name??row.trackName);
    const raw=backup?row.endedAt:row.ts||row.endTime;
    const endedAt=typeof raw==='number'?raw:Date.parse(/^\d{4}-\d\d-\d\d \d\d:\d\d$/.test(raw||'')?raw.replace(' ','T')+':00Z':raw);
    const ms=Number(backup?row.ms:row.ms_played??row.msPlayed);
    if(!artist||!title||!Number.isFinite(endedAt)||endedAt<0||!Number.isFinite(ms)||ms<=0||ms>43200000)return [];
    const source=backup&&row.source==='spotplus'?'spotplus':'spotify';
    const spotifyId=text(backup?row.spotifyId:row.spotify_track_uri?.split(':')[2]);
    const id=backup&&source==='spotplus'&&/^local-[\w-]+$/.test(row.id||'')?row.id:JSON.stringify([source,endedAt,artist,title,ms]);
    return [{id,source,endedAt,ms:Math.round(ms),artist,title,spotifyId:/^[A-Za-z0-9]{22}$/.test(spotifyId)?spotifyId:''}];
  });
}

export function summarizeHistory(records,{source='all',year='all',month='all'}={}){
  const filtered=records.filter(r=>{const d=new Date(r.endedAt);return(source==='all'||r.source===source)&&(year==='all'||d.getFullYear()===Number(year))&&(month==='all'||d.getMonth()===Number(month));});
  const artists=new Map(),tracks=new Map(),days=new Set(),months=Array(12).fill(0);let ms=0,plays=0;
  for(const r of filtered){
    const d=new Date(r.endedAt),play=r.ms>=30000?1:0;ms+=r.ms;plays+=play;days.add(d.toLocaleDateString('en-CA'));months[d.getMonth()]+=r.ms;
    const a=artists.get(r.artist)||{name:r.artist,ms:0,plays:0};a.ms+=r.ms;a.plays+=play;artists.set(r.artist,a);
    const key=JSON.stringify([r.artist,r.title]),t=tracks.get(key)||{title:r.title,artist:r.artist,ms:0,plays:0,spotifyId:r.spotifyId};t.ms+=r.ms;t.plays+=play;tracks.set(key,t);
  }
  return {ms,plays,days:days.size,artists:[...artists.values()].sort((a,b)=>b.ms-a.ms),tracks:[...tracks.values()].sort((a,b)=>b.ms-a.ms),months,entries:filtered.length};
}

// Count audible progress, not seeks, paused time, or the act of pressing Play.
export class ListeningMeter {
  constructor(save){this.save=save;this.session=null;this.last=null;this.saved=0;}
  reset(){this.session=null;this.last=null;this.saved=0;}
  tick(track,{time,playing,sessionKey=track?.id,now=performance.now(),wall=Date.now()}){
    const key=track&&sessionKey;
    if(!key||this.session?.trackId!==key){this.flush();this.session=key?{id:'local-'+crypto.randomUUID(),trackId:key,source:'spotplus',artist:track.artist,title:track.title,spotifyId:track.spotifyId||'',ms:0,endedAt:wall}:null;this.last=null;this.saved=0;}
    if(!this.session)return;
    if(this.last?.playing){const elapsed=now-this.last.now,progress=(time-this.last.time)*1000;if(elapsed>0&&elapsed<60000&&progress>0&&progress<=elapsed*1.5+500)this.session.ms+=Math.min(progress,elapsed);}
    this.session.endedAt=wall;this.last={time,now,playing};
    if(!playing||this.session.ms-this.saved>=15000)this.flush();
  }
  flush(){if(this.session?.ms>=1000&&this.session.ms>this.saved){this.saved=this.session.ms;const {trackId,...record}=this.session;void trackId;this.save({...record,ms:Math.round(record.ms)});}}
}

let dbPromise;
function database(){return dbPromise??=(new Promise((resolve,reject)=>{
  if(!globalThis.indexedDB){reject(new Error('Listening history needs browser storage.'));return;}
  const request=indexedDB.open('spotplus-rewind',1);
  request.onupgradeneeded=()=>request.result.createObjectStore('listens',{keyPath:'id'});
  request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);
})).catch(error=>{dbPromise=null;throw error;});}
export async function saveHistory(records){const db=await database();return new Promise((resolve,reject)=>{const tx=db.transaction('listens','readwrite');for(const r of records)tx.objectStore('listens').put(r);tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error);});}
export async function readHistory(){const db=await database();return new Promise((resolve,reject)=>{const r=db.transaction('listens').objectStore('listens').getAll();r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});}
export async function clearHistory(source){const db=await database();return new Promise((resolve,reject)=>{const tx=db.transaction('listens','readwrite'),store=tx.objectStore('listens'),request=store.openCursor();request.onsuccess=()=>{const c=request.result;if(!c)return;if(source==='all'||c.value.source===source)c.delete();c.continue();};tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);});}
