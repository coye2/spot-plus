import {readHistory,saveHistory,summarizeHistory} from './listening-history.js';
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const number=n=>Math.round(n).toLocaleString();
const plays=n=>number(n)+' '+(n===1?'play':'plays');
export const filters={source:'auto',year:String(new Date().getFullYear()),month:'all'};
export async function rewindView(){
  let records;try{records=await readHistory();}catch(error){return `<h1>Your Rewind</h1><p>${esc(error.message)}</p>`;}
  const hasSpotify=records.some(r=>r.source==='spotify');if(filters.source==='auto')filters.source=hasSpotify?'spotify':'spotplus';
  const years=[...new Set([new Date().getFullYear(),...records.map(r=>new Date(r.endedAt).getFullYear())])].sort((a,b)=>b-a);
  const stats=summarizeHistory(records,filters),top=stats.artists[0],song=stats.tracks[0],label=filters.source==='spotify'?'Spotify history':filters.source==='spotplus'?'Spot+ listening':'Combined history';
  const select=(key,label,options)=>`<label>${label}<select data-rewind-filter="${key}">${options.map(([value,name])=>`<option value="${value}"${filters[key]===String(value)?' selected':''}>${name}</option>`).join('')}</select></label>`;
  const rank=(items,kind)=>items.slice(0,10).map((item,index)=>`<li><span class="rewind-rank">${index+1}</span><div><b>${esc(item.name||item.title)}</b><small>${kind==='track'?esc(item.artist)+' · ':''}${number(item.ms/60000)} min · ${plays(item.plays)}</small></div>${item.spotifyId?`<a href="#/spotify/track/${item.spotifyId}" class="icon" aria-label="Open ${esc(item.title)}">↗</a>`:''}</li>`).join('');
  return `<div class="rewind-page"><div class="rewind-heading"><div><p class="kicker">Your music. Every season.</p><h1>Your Rewind</h1><p class="muted">A living picture of what you love.</p></div><span class="rewind-badge">${label}</span></div>
  <div class="rewind-filters">${select('source','Listening from',[['spotify','Spotify'],['spotplus','Spot+'],['all','Both']])}${select('year','Year',[['all','All time'],...years.map(y=>[y,y])])}${select('month','Month',[['all','Every month'],...Array.from({length:12},(_,i)=>[i,new Date(2024,i).toLocaleString(undefined,{month:'long'})])])}</div>
  ${stats.entries?`<div class="rewind-stories"><article class="rewind-story story-minutes"><span>Time well spent</span><strong>${number(stats.ms/60000)}</strong><h2>minutes with music</h2><p>${number(stats.days)} listening ${stats.days===1?'day':'days'}. A soundtrack that’s yours.</p><div class="rewind-rings" aria-hidden="true"></div></article><article class="rewind-story story-artist"><span>Your most-listened artist</span><strong class="rewind-name">${esc(top.name)}</strong><p>${number(top.ms/60000)} minutes together</p><div class="rewind-lines" aria-hidden="true"></div></article><article class="rewind-story story-song"><span>On repeat</span><strong class="rewind-name">${esc(song.title)}</strong><h2>${esc(song.artist)}</h2><p>${plays(song.plays)} · ${number(song.ms/60000)} minutes</p></article></div>
  <div class="rewind-summary"><div><b>${number(stats.plays)}</b><span>Plays</span></div><div><b>${number(stats.artists.length)}</b><span>Artists</span></div><div><b>${number(stats.tracks.length)}</b><span>Songs</span></div></div>
  <section class="rewind-trend"><h2>Your listening rhythm</h2><div class="rewind-bars" role="img" aria-label="Minutes listened each month: ${stats.months.map((ms,i)=>new Date(2024,i).toLocaleString(undefined,{month:'short'})+' '+number(ms/60000)).join(', ')}">${stats.months.map((ms,i)=>`<div><span title="${number(ms/60000)} minutes" style="--height:${ms?Math.max(2,ms/Math.max(...stats.months)*100):0}%"></span><small>${new Date(2024,i).toLocaleString(undefined,{month:'short'})}</small></div>`).join('')}</div></section>
  <div class="rewind-rankings"><section><h2>Your top artists</h2><ol>${rank(stats.artists,'artist')}</ol></section><section><h2>Your top songs</h2><ol>${rank(stats.tracks,'track')}</ol></section></div>`:
  `<div class="rewind-empty"><div class="rewind-empty-orbit" aria-hidden="true">✦</div><h2>${filters.source==='spotify'?'Bring your Spotify story':'Your next listen starts your story'}</h2><p>${filters.source==='spotify'?'Import your Spotify streaming history to see your real account stats. A library connection includes saved music, but not your listening history.':'Listen in Spot+ to build your Rewind, or choose a different date range.'}</p></div>`}
  <section class="box rewind-data"><h2>Your history, your choice</h2><p>Import Spotify’s Streaming History JSON files or the ZIP from your <a href="https://www.spotify.com/account/privacy/" target="_blank" rel="noopener">Spotify privacy page</a>. Files stay on this device. Import again whenever you want to refresh; duplicates are skipped.</p><div class="row-btns"><button class="btn primary" data-act="rewind-import">Import Spotify history</button><input id="rewindImport" type="file" accept=".json,.zip" multiple hidden><button class="btn" data-act="rewind-export">Export Rewind</button><a class="btn" href="#/spotify-account">Spotify library</a></div><p id="rewindImportStatus" role="status"></p><details><summary>How these numbers work</summary><p>Minutes include actual listening time. Plays count entries with at least 30 seconds heard. Rankings use minutes listened. Spotify history covers the dates included in your export; Spot+ starts tracking from this update. Combining both can overlap if the same listening session is present in both sources. This is Spot+ Rewind, an independent overview, not Spotify Wrapped.</p><button class="btn small" data-act="rewind-clear">Clear Rewind history</button></details></section></div>`;
}
export async function importRewind(files,onStatus){
  let imported=0;
  for(const file of files){
    if(file.size>80*1024*1024)throw new Error('Choose files smaller than 80 MB. You can import individual JSON history files.');
    onStatus('Reading '+file.name+'…');
    const bytes=await file.arrayBuffer();
    const records=await new Promise((resolve,reject)=>{
      const worker=new Worker(new URL('./history-import-worker.js',import.meta.url),{type:'module'});
      const timer=setTimeout(()=>{worker.terminate();reject(new Error('This file took too long to read. Try a smaller JSON file.'));},60000);
      const finish=()=>{clearTimeout(timer);worker.terminate();};
      worker.onmessage=({data})=>{finish();data.error?reject(new Error(data.error)):resolve(data.records);};
      worker.onerror=()=>{finish();reject(new Error('Could not read this history file.'));};worker.postMessage({bytes,name:file.name},[bytes]);
    });
    onStatus('Saving your listening history…');
    const before=new Set((await readHistory()).map(r=>r.id));
    for(let offset=0;offset<records.length;offset+=2000)await saveHistory(records.slice(offset,offset+2000));
    for(const row of records)if(!before.has(row.id)){before.add(row.id);imported++;}
  }
  return imported;
}
