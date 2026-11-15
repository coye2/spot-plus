const clean = value => String(value || '').normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/&/g,' and ').replace(/[^\p{L}\p{N}]+/gu,' ').trim();
const artist = value => clean(String(value || '').replace(/vevo$/i,'')).replace(/\b(official|topic)\b/g,'').replace(/\s+/g,' ').trim().replace(/^machine gun kelly$/,'mgk');
const baseTitle = value => clean(String(value || '').replace(/\([^)]*\b(?:feat\.?|ft\.?|with)\b[^)]*\)/gi,'').replace(/\b(?:feat\.?|ft\.?)\s+.*$/i,''));
const editions = ['live','remix','acoustic','instrumental','sped up','slowed','nightcore','reverb','karaoke','cover','8d'];
export function rankAudioMatches(items,track) {
  const title=baseTitle(track.title),who=artist(track.artist),expected=Number(track.duration)||0;
  if(!title||!who)return [];
  return items.map(item=>{
    const name=baseTitle(item.title),channel=artist(item.channel),duration=Number(item.duration)||0;
    const exactArtist=channel===who||channel.replace(/ /g,'')===who.replace(/ /g,'');
    const artistInTitle=(' '+name+' ').includes(' '+who+' ') || (' '+name+' ').includes(' '+clean(track.artist)+' ');
    const titleInName=(' '+name+' ').includes(' '+title+' ');
    const conflicting=editions.some(word=>new RegExp('\\b'+word+'\\b').test(name)!==new RegExp('\\b'+word+'\\b').test(title));
    const delta=expected&&duration?Math.abs(expected-duration):0;
    const wrongLength=duration<20 || (expected&&delta>Math.max(25,expected*.14));
    const unwanted=/\b(reaction|tutorial|bass boosted|tiktok version|1 hour|10 hours|full album)\b/.test(name);
    let core=name.split(/\b(?:official audio|official music video|official video|lyrics?|visuali[sz]er)\b/)[0].trim();
    for(const prefix of [clean(track.artist),who])if(core.startsWith(prefix+' '))core=core.slice(prefix.length+1);
    const ambiguous=title.split(' ').length===1&&core!==title;
    const valid=titleInName&&(exactArtist||artistInTitle)&&!conflicting&&!wrongLength&&!unwanted&&!ambiguous;
    return {...item,score:valid?100+(exactArtist?30:0)+(/\btopic\b/i.test(item.channel||'')?15:0)+(/official audio/i.test(item.title||'')?12:0)+(item.verified?5:0)-delta:0};
  }).filter(item=>item.score>0).sort((a,b)=>b.score-a.score);
}
export function chooseAudioFormat(formats,{quality='high',canPlay=()=>true}={}) {
  const list=formats.filter(f=>/^audio\//.test(f.mime||'')&&/^https:\/\//.test(f.url||'')&&canPlay(f.mime+(f.codec&&!f.mime.includes('codecs=')?`; codecs="${f.codec}"`:'')));
  const effective=f=>(Number(f.bitrate)||0)*(/opus/.test(f.mime+' '+f.codec)?1.15:1);
  list.sort((a,b)=>effective(b)-effective(a));
  return (quality==='low'?list.at(-1):list[0])||null;
}
// A bounded race expands to additional servers only when earlier ones fail.
// A low-bitrate result stays available as a last resort instead of winning first.
export function raceAudioSources(sources,attempt,{signal,concurrency=4,quality='high',qualityWait=900}={}) {
  return new Promise((resolve,reject)=>{
    let cursor=0,active=0,finished=false,fallback=null,qualityTimer;
    const cleanup=()=>{clearTimeout(qualityTimer);signal?.removeEventListener('abort',abort);};
    const win=value=>{if(finished)return;finished=true;cleanup();resolve(value);};
    const abort=()=>{if(finished)return;finished=true;cleanup();reject(new DOMException('Playback cancelled','AbortError'));};
    const pump=()=>{
      if(finished)return;
      if(signal?.aborted){abort();return;}
      while(active<concurrency&&cursor<sources.length){
        const source=sources[cursor++];active++;
        Promise.resolve().then(()=>attempt(source)).then(value=>{
          if(finished||!value)return;
          if(quality==='low'||value.bitrate>=96000||value.lossless)win(value);
          else {if(!fallback||value.bitrate>fallback.bitrate)fallback=value;if(!qualityTimer)qualityTimer=setTimeout(()=>win(fallback),qualityWait);}
        },()=>{}).finally(()=>{active--;if(finished)return;if(cursor===sources.length&&active===0){if(fallback)win(fallback);else{finished=true;cleanup();reject(new Error('No matching playable source'));}}else pump();});
      }
      if(!sources.length){finished=true;cleanup();reject(new Error('No audio sources configured'));}
    };
    signal?.addEventListener('abort',abort,{once:true});pump();
  });
}
