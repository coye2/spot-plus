// Spot+ Rewind: your listening, automatically. Sources, merged without imports:
//  • Spotify's own top tracks/artists (4 weeks, 6 months, all time) and recent plays,
//    synced by the helper whenever a Spotify web tab is open (relay-sync.js);
//  • everything you play in Spot+ (counted as you listen);
//  • (optional) an imported Spotify history file, for years of older listening.
// Rendering is instant: history lives in memory and artwork fills in afterwards.
import {readHistory,saveHistory,cachedHistory} from './listening-history.js';
import {getSpotifyStats} from './store.js';
import {SPOTIFY_RANGES,spotifyTop,spotifyGenres,topTracks,topArtists,listeningClock,streaks,recentlyPlayed,PLAY_MS} from './stats-api.js';
import {artistPicture,trackArtwork} from './api.js';

const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const number=n=>Math.round(n).toLocaleString();
const ago=t=>{const m=Math.round((Date.now()-t)/60000);return m<1?'just now':m<60?m+' min ago':m<1440?Math.round(m/60)+' h ago':Math.round(m/1440)+' d ago';};
export const filters={range:'short_term'};
const LOCAL_RANGE={short_term:'short',medium_term:'medium',long_term:'long'};
const DAY=86400000;

export function persona(hour){
  if(hour===null||hour===undefined)return null;
  if(hour>=5&&hour<11)return {name:'Early bird',line:'Your music starts with the sunrise.'};
  if(hour>=11&&hour<17)return {name:'Daytime listener',line:'You soundtrack your days.'};
  if(hour>=17&&hour<22)return {name:'Evening groover',line:'Your music comes alive after work.'};
  return {name:'Night owl',line:'Your best listening happens after dark.'};
}
const hourLabel=h=>new Date(2024,0,1,h).toLocaleTimeString(undefined,{hour:'numeric'});

/** Everything Rewind shows for one range, from every source, in one object. */
export function rewindModel(records,synced,range=filters.range,now=Date.now()){
  const local=LOCAL_RANGE[range]||'short';
  const windowDays={short:28,medium:182,long:null}[local];
  const inRange=records.filter(r=>windowDays===null||r.endedAt>now-windowDays*DAY);
  const historyTracks=topTracks(records,{range:local,now,limit:50}),historyArtists=topArtists(records,{range:local,now,limit:50});
  const spotifyTracks=spotifyTop(synced,{range,kind:'tracks'}),spotifyArtists=spotifyTop(synced,{range,kind:'artists'});
  const tracks=spotifyTracks.length?spotifyTracks.map(t=>({...t,plays:historyTracks.find(h=>h.spotifyId&&h.spotifyId===t.spotifyId)?.plays||0})):historyTracks;
  const artists=spotifyArtists.length?spotifyArtists:historyArtists.map(a=>({...a,id:'',cover:'',genres:[]}));
  const clock=listeningClock(records,{range:local,now});
  return {range,label:SPOTIFY_RANGES[range],
    minutes:inRange.reduce((n,r)=>n+r.ms,0)/60000,plays:inRange.filter(r=>r.ms>=PLAY_MS).length,
    artistCount:new Set(inRange.map(r=>r.artist.toLowerCase())).size,songCount:new Set(inRange.map(r=>(r.spotifyId||r.artist+'|'+r.title).toLowerCase())).size,
    tracks,artists,genres:spotifyGenres(synced,{range}),clock,persona:persona(clock.peakHour),streak:streaks(records).longest,
    recent:recentlyPlayed(records,{limit:20}),fromSpotify:!!spotifyTracks.length,syncedAt:synced?.stats?.capturedAt||0,
    empty:!tracks.length&&!records.length};
}

function movement(change){
  if(change===null||change===undefined)return '';
  if(change==='new')return '<span class="stat-move new">NEW</span>';
  if(change>0)return `<span class="stat-move up" aria-label="Up ${change}">▲${change}</span>`;
  if(change<0)return `<span class="stat-move down" aria-label="Down ${-change}">▼${-change}</span>`;
  return '<span class="stat-move same">–</span>';
}
const art=(src,cls,attrs='')=>src?`<img class="${cls}" src="${esc(src)}" alt="" loading="lazy" decoding="async">`:`<span class="${cls} rw-ph" ${attrs}></span>`;

export async function rewindView(){
  const records=cachedHistory()||await readHistory().catch(()=>[]);
  const synced=getSpotifyStats(),m=rewindModel(records,synced);
  if(m.empty)return `<div class="rw"><header class="rw-head"><p class="kicker">Rewind</p><h1>Your music, all year</h1></header>
  <section class="rw-empty"><div class="rw-empty-orb" aria-hidden="true"></div><h2>Your Rewind fills itself in</h2><p>Connect Spotify once and your top songs, artists, genres and recent plays sync here automatically, whenever Spotify is open on any of your devices. Everything you play in Spot+ counts too.</p><a class="btn primary" href="#/spotify-account">Connect Spotify</a></section>${optionalTools()}</div>`;
  const chip=(value,label)=>`<button class="stat-chip" data-act="rewind-range" data-value="${value}" aria-pressed="${filters.range===value}">${label}</button>`;
  const tiles=[[m.minutes,'minutes listened'],[m.plays,'songs played'],[m.artistCount,'artists'],[m.streak,'day streak']].filter(([v])=>v>0);
  const maxHour=Math.max(...m.clock.hours,1);
  return `<div class="rw">
  <header class="rw-head"><p class="kicker">${m.syncedAt?'Synced from Spotify · '+ago(m.syncedAt):'Automatic'}</p><h1>Rewind</h1>
  <div class="stat-chips" role="group" aria-label="Time range">${Object.entries(SPOTIFY_RANGES).map(([v,l])=>chip(v,l)).join('')}</div></header>
  <button class="rw-cta" data-act="rewind-story"><span class="rw-cta-art" aria-hidden="true">${m.artists.slice(0,3).map((a,i)=>art(a.cover,'rw-cta-face','data-artist="'+esc(a.name)+'" style="--i:'+i+'"')).join('')}</span><span><b>Play your Rewind</b><small>${esc(m.label)}, as a story you can share</small></span><span class="rw-cta-play" aria-hidden="true">▶</span></button>
  ${tiles.length?`<div class="rw-tiles">${tiles.map(([v,l])=>`<div><b>${number(v)}</b><span>${l}</span></div>`).join('')}</div>`:''}
  ${m.artists.length?`<section><h2>Top artists</h2><div class="rw-artists">${m.artists.slice(0,10).map((a,i)=>`<a class="rw-artist" ${a.id?`href="https://open.spotify.com/artist/${esc(a.id)}" target="_blank" rel="noopener"`:''}><span class="rw-rank">${i+1}</span>${art(a.cover,'rw-face','data-artist="'+esc(a.name)+'"')}<b>${esc(a.name)}</b>${movement(a.change)}</a>`).join('')}</div></section>`:''}
  ${m.tracks.length?`<section class="collapsible"><h2>Top songs</h2><ol class="stat-list rw-songs">${m.tracks.slice(0,20).map((t,i)=>`<li class="${i>=10?'more-row':''}"><span class="rewind-rank">${i+1}</span>${art(t.cover,'rw-cover','data-track="'+esc(t.artist+'\u0001'+t.title)+'"')}<div><b>${esc(t.title)}</b><small>${esc(t.artist)}${t.plays?' · '+number(t.plays)+' plays':''}</small></div>${movement(t.change)}${t.spotifyId?`<a href="#/spotify/track/${t.spotifyId}" class="icon" aria-label="Open ${esc(t.title)}">↗</a>`:''}</li>`).join('')}</ol>${m.tracks.length>10?'<button class="see-more" data-act="expand-section">See more</button>':''}</section>`:''}
  ${m.genres.length?`<section><h2>Top genres</h2><ol class="rw-genres">${m.genres.slice(0,6).map(g=>`<li><b>${esc(g.name)}</b><span class="stat-bar"><span style="--w:${Math.round(g.share/m.genres[0].share*100)}%"></span></span></li>`).join('')}</ol></section>`:''}
  ${m.persona?`<section class="rw-clock"><h2>When you listen</h2><p class="rw-persona"><b>${m.persona.name}.</b> ${m.persona.line} Peak: ${hourLabel(m.clock.peakHour)}.</p><div class="rw-hours" role="img" aria-label="Listening by hour of day">${m.clock.hours.map((v,h)=>`<i style="--h:${Math.max(3,v/maxHour*100)}%" class="${h===m.clock.peakHour?'peak':''}"></i>`).join('')}</div><div class="rw-hour-labels"><span>12 AM</span><span>6 AM</span><span>12 PM</span><span>6 PM</span><span>11 PM</span></div></section>`:''}
  ${m.recent.length?`<section><h2>Recently played</h2><ol class="stat-list">${m.recent.slice(0,10).map(t=>`<li>${art(t.cover,'rw-cover','data-track="'+esc(t.artist+'\u0001'+t.title)+'"')}<div><b>${esc(t.title)}</b><small>${esc(t.artist)}</small></div><small>${ago(t.endedAt)}</small></li>`).join('')}</ol></section>`:''}
  ${m.fromSpotify?'':`<p class="settings-note rw-hint">Connect Spotify to add your Spotify top music and listening here automatically. <a href="#/spotify-account">Connect</a></p>`}
  ${optionalTools()}</div>`;
}
function optionalTools(){
  return `<details class="box rewind-data"><summary>More options</summary><p>Rewind builds itself. To include years of older listening, you can also import Spotify’s Streaming History from your <a href="https://www.spotify.com/account/privacy/" target="_blank" rel="noopener">Spotify privacy page</a>. Files stay on this device.</p><div class="row-btns"><button class="btn" data-act="rewind-import">Import Spotify history</button><input id="rewindImport" type="file" accept=".json,.zip" multiple hidden><button class="btn" data-act="rewind-export">Export Rewind</button><button class="btn small" data-act="rewind-clear">Clear Rewind history</button></div><p id="rewindImportStatus" role="status"></p></details>`;
}

/** Fill in missing artist photos and song covers after the page is on screen. */
export function hydrateRewind(root){
  const seen=new Map();
  const once=(key,fn)=>seen.get(key)||seen.set(key,fn()).get(key);
  root.querySelectorAll('.rw-ph[data-artist]').forEach(el=>once('a'+el.dataset.artist,()=>artistPicture(el.dataset.artist)).then(src=>{if(src&&el.isConnected){const img=new Image();img.className=el.className.replace('rw-ph','');img.alt='';img.src=src;img.decoding='async';el.replaceWith(img);}}).catch(()=>{}));
  root.querySelectorAll('.rw-ph[data-track]').forEach(el=>{const [artist,title]=el.dataset.track.split('\u0001');once('t'+el.dataset.track,()=>trackArtwork(artist,title)).then(a=>{if(a?.cover&&el.isConnected){const img=new Image();img.className=el.className.replace('rw-ph','');img.alt='';img.src=a.cover;img.decoding='async';el.replaceWith(img);}}).catch(()=>{});});
}
export async function warmRewind(){await readHistory().catch(()=>{});}

/* ---------------- Story mode ---------------- */
export async function openRewindStory({icons={},canPlayPreview=()=>true}={}){
  if(document.getElementById('rwStory'))return;
  const records=cachedHistory()||await readHistory().catch(()=>[]),m=rewindModel(records,getSpotifyStats());
  const top=m.artists[0],song=m.tracks[0];
  const [topPhoto,songArt]=await Promise.all([top&&(top.cover||artistPicture(top.name).catch(()=>'')),song&&trackArtwork(song.artist,song.title).catch(()=>null)]);
  // Covers for the top five, so the songs slide is complete.
  await Promise.all(m.tracks.slice(0,5).map(async(t,i)=>{if(!t.cover){const a=i===0?songArt:await trackArtwork(t.artist,t.title).catch(()=>null);if(a?.cover)m.tracks[i]={...t,cover:a.cover};}}));
  const slides=[
    {cls:'s-intro',html:`<p class="rw-s-kicker">Spot+ Rewind</p><h2>${esc(m.label)}</h2><p>Let’s look back at what you’ve been playing.</p>`},
    m.minutes>=1&&{cls:'s-minutes',html:`<p class="rw-s-kicker">You listened for</p><h2 class="rw-big">${number(m.minutes)}</h2><p>minutes${m.minutes>1440?` · that’s ${(m.minutes/1440).toFixed(1)} days of music`:''}.</p>`},
    m.genres[0]&&{cls:'s-genre',html:`<p class="rw-s-kicker">Your vibe was</p><h2>${esc(m.genres[0].name)}</h2><p>${m.genres.slice(1,4).map(g=>esc(g.name)).join(' · ')}</p>`},
    top&&{cls:'s-artist',bg:topPhoto,html:`<p class="rw-s-kicker">Your top artist</p><h2>${esc(top.name)}</h2><p>${m.artists.slice(1,4).map(a=>esc(a.name)).join(' · ')}${m.artists.length>1?' close behind.':''}</p>`},
    m.tracks.length&&{cls:'s-songs',html:`<p class="rw-s-kicker">Your top songs</p><ol>${m.tracks.slice(0,5).map((t,i)=>`<li><span>${i+1}</span>${t.cover?`<img src="${esc(t.cover)}" alt="">`:'<i></i>'}<div><b>${esc(t.title)}</b><small>${esc(t.artist)}</small></div></li>`).join('')}</ol>`},
    m.persona&&{cls:'s-clock',html:`<p class="rw-s-kicker">You’re a</p><h2>${esc(m.persona.name)}</h2><p>${esc(m.persona.line)} Your peak hour is ${hourLabel(m.clock.peakHour)}.</p>`},
    m.streak>1&&{cls:'s-streak',html:`<p class="rw-s-kicker">Longest streak</p><h2 class="rw-big">${m.streak}</h2><p>days in a row with music.</p>`},
    {cls:'s-card',card:true,html:`<div class="rw-card" id="rwCard"><p class="rw-s-kicker">My Spot+ Rewind · ${esc(m.label)}</p>${topPhoto?`<img class="rw-card-photo" src="${esc(topPhoto)}" alt="" crossorigin="anonymous">`:''}<div class="rw-card-cols"><div><small>Top artists</small><ol>${m.artists.slice(0,5).map(a=>`<li>${esc(a.name)}</li>`).join('')}</ol></div><div><small>Top songs</small><ol>${m.tracks.slice(0,5).map(t=>`<li>${esc(t.title)}</li>`).join('')}</ol></div></div>${m.minutes>=1?`<div class="rw-card-stat"><small>Minutes listened</small><b>${number(m.minutes)}</b></div>`:''}${m.genres[0]?`<div class="rw-card-stat"><small>Top genre</small><b>${esc(m.genres[0].name)}</b></div>`:''}</div><button class="btn primary rw-share" data-rw="share">${icons.share||''}<span>Share</span></button>`},
  ].filter(Boolean);
  const root=document.createElement('div');
  root.id='rwStory';root.className='rw-story';root.setAttribute('role','dialog');root.setAttribute('aria-modal','true');root.setAttribute('aria-label','Your Rewind story');
  root.innerHTML=`<div class="rw-bars">${slides.map(()=>'<i><b></b></i>').join('')}</div><button class="rw-close" data-rw="close" aria-label="Close">✕</button>${slides.map((s,i)=>`<section class="rw-slide ${s.cls}" data-i="${i}" ${s.bg?`style="--bg:url('${esc(s.bg).replace(/'/g,'')}')"`:''}><div class="rw-slide-inner">${s.html}</div></section>`).join('')}<button class="rw-tap prev" data-rw="prev" aria-label="Previous"></button><button class="rw-tap next" data-rw="next" aria-label="Next"></button>`;
  document.body.append(root);
  let index=0,timer=null,paused=false,started=0,remaining=0;
  const DURATION=5500,bars=[...root.querySelectorAll('.rw-bars b')],secs=[...root.querySelectorAll('.rw-slide')];
  // The #1 song's 30-second preview plays softly underneath, if nothing else is playing.
  let audio=null;
  if(songArt?.preview&&canPlayPreview()){audio=new Audio(songArt.preview);audio.volume=0;audio.loop=true;audio.play().then(()=>{let v=0;const fade=setInterval(()=>{v=Math.min(.55,v+.05);audio.volume=v;if(v>=.55)clearInterval(fade);},120);}).catch(()=>{audio=null;});}
  const show=i=>{
    index=Math.max(0,Math.min(slides.length-1,i));
    secs.forEach((s,j)=>s.classList.toggle('on',j===index));
    bars.forEach((b,j)=>{b.style.transition='none';b.style.width=j<index?'100%':'0%';});
    clearTimeout(timer);
    if(slides[index].card)return;
    requestAnimationFrame(()=>requestAnimationFrame(()=>{bars[index].style.transition=`width ${DURATION}ms linear`;bars[index].style.width='100%';}));
    started=Date.now();remaining=DURATION;timer=setTimeout(()=>show(index+1),DURATION);
  };
  const close=()=>{clearTimeout(timer);if(audio){const a=audio;let v=a.volume;const fade=setInterval(()=>{v-=.08;if(v<=0){clearInterval(fade);a.pause();}else a.volume=v;},60);}root.classList.add('leaving');setTimeout(()=>root.remove(),250);document.removeEventListener('keydown',keys);};
  const keys=e=>{if(e.key==='Escape')close();else if(e.key==='ArrowRight')show(index+1);else if(e.key==='ArrowLeft')show(index-1);};
  document.addEventListener('keydown',keys);
  const hold=on=>{if(slides[index].card)return;if(on&&!paused){paused=true;clearTimeout(timer);remaining-=Date.now()-started;const w=getComputedStyle(bars[index]).width;bars[index].style.transition='none';bars[index].style.width=w;}else if(!on&&paused){paused=false;started=Date.now();bars[index].style.transition=`width ${remaining}ms linear`;bars[index].style.width='100%';timer=setTimeout(()=>show(index+1),remaining);}};
  root.addEventListener('pointerdown',e=>{if(e.target.closest('.rw-tap'))root._holdTimer=setTimeout(()=>{root._held=true;hold(true);},220);});
  root.addEventListener('pointerup',()=>{clearTimeout(root._holdTimer);if(root._held){setTimeout(()=>{root._held=false;},0);hold(false);}});
  root.addEventListener('click',async e=>{
    const b=e.target.closest('[data-rw]');if(!b||root._held)return;
    if(b.dataset.rw==='close')close();
    else if(b.dataset.rw==='next'){if(index===slides.length-1)close();else show(index+1);}
    else if(b.dataset.rw==='prev')show(index-1);
    else if(b.dataset.rw==='share')shareCard(m,topPhoto).catch(()=>{});
  });
  requestAnimationFrame(()=>{root.classList.add('open');show(0);});
}

/* Share card: drawn on a canvas so it can be saved or sent as an image. */
async function loadImage(src){return new Promise(resolve=>{if(!src)return resolve(null);const img=new Image();img.crossOrigin='anonymous';img.onload=()=>resolve(img);img.onerror=()=>resolve(null);img.src=src;});}
export async function renderShareCard(m,photo){
  const W=1080,H=1920,c=document.createElement('canvas');c.width=W;c.height=H;const g=c.getContext('2d');
  const accent=getComputedStyle(document.documentElement).getPropertyValue('--accent').trim()||'#1b5e46';
  const grad=g.createLinearGradient(0,0,W,H);grad.addColorStop(0,accent);grad.addColorStop(.55,'#141018');grad.addColorStop(1,'#050505');g.fillStyle=grad;g.fillRect(0,0,W,H);
  const img=await loadImage(photo);
  if(img){const s=620;g.save();g.beginPath();g.arc(W/2,520,s/2,0,Math.PI*2);g.clip();const r=Math.max(s/img.width,s/img.height);g.drawImage(img,W/2-img.width*r/2,520-img.height*r/2,img.width*r,img.height*r);g.restore();}
  g.fillStyle='#fff';g.textAlign='center';g.font='700 46px Inter, Arial, sans-serif';g.fillText('MY SPOT+ REWIND · '+m.label.toUpperCase(),W/2,140);
  g.textAlign='left';
  const col=(title,items,x)=>{g.font='600 36px Inter, Arial, sans-serif';g.fillStyle='rgba(255,255,255,.7)';g.fillText(title,x,960);g.fillStyle='#fff';items.slice(0,5).forEach((t,i)=>{g.font='700 44px Inter, Arial, sans-serif';let s=`${i+1}  ${t}`;while(g.measureText(s).width>440&&s.length>4)s=s.slice(0,-2);if(s!==`${i+1}  ${t}`)s+='…';g.fillText(s,x,1040+i*78);});};
  col('Top artists',m.artists.map(a=>a.name),90);col('Top songs',m.tracks.map(t=>t.title),570);
  const stat=(label,value,x)=>{g.font='600 36px Inter, Arial, sans-serif';g.fillStyle='rgba(255,255,255,.7)';g.fillText(label,x,1520);g.font='800 84px Inter, Arial, sans-serif';g.fillStyle='#fff';g.fillText(value,x,1620);};
  if(m.minutes>=1)stat('Minutes listened',number(m.minutes),90);
  if(m.genres[0])stat('Top genre',m.genres[0].name.replace(/\b\w/g,c=>c.toUpperCase()).slice(0,16),570);
  g.font='700 38px Inter, Arial, sans-serif';g.fillStyle='rgba(255,255,255,.8)';g.textAlign='center';g.fillText('Spot+',W/2,1820);
  return new Promise(resolve=>c.toBlob(resolve,'image/png'));
}
async function shareCard(m,photo){
  const blob=await renderShareCard(m,photo);if(!blob)return;
  const file=new File([blob],'spotplus-rewind.png',{type:'image/png'});
  if(navigator.canShare?.({files:[file]}))return navigator.share({files:[file],title:'My Spot+ Rewind'}).catch(()=>{});
  const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='spotplus-rewind.png';a.click();setTimeout(()=>URL.revokeObjectURL(a.href),5000);
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
