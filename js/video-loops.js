// Match actual footage to the requested recording; never substitute an unrelated artist.
const normalize = value => String(value || '').normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/&/g,' and ').replace(/[^\p{L}\p{N}]+/gu,' ').trim();
const artistName = value => normalize(String(value || '').replace(/vevo$/i,'')).replace(/\b(official|topic)\b/g,'').replace(/\s+/g,' ').trim().replace(/^machine gun kelly$/,'mgk');
const titleName = value => normalize(String(value || '').replace(/\([^)]*\b(?:feat\.?|ft\.?|with)\b[^)]*\)/gi,''));
export function matchMusicVideo(items, track) {
  const title = titleName(track.searchTitle || track.title), artist = artistName(track.artist);
  if (!title || !artist) return null;
  const wanted = title.split(' ');
  return items.filter(item => /^[\w-]{11}$/.test(item.id || '')).map(item => {
    const name = normalize(item.title), channel = artistName(item.channel);
    let core = titleName(String(item.title).split(/\s[-–—]\s/).pop()).replace(/\b(?:official (?:music )?video|music video|official visuali[sz]er|visuali[sz]er|official mv|hd|4k|hq)\b/g,'').trim();
    for (const prefix of [normalize(track.artist),artist]) if (core.startsWith(prefix+' ')) core=core.slice(prefix.length+1);
    core=core.replace(/\b(?:feat|ft|featuring)\b.*$/,'').trim();
    const titleMatch = (` ${name} `).includes(` ${title} `) && (wanted.length > 1 || core === title);
    const artistMatch = channel === artist || channel.replace(/\s/g,'') === artist.replace(/\s/g,'') || (` ${name} `).includes(` ${artist} `);
    const unwanted = /\b(lyrics?|audio|karaoke|reaction|tutorial|cover|fan made|fanmade|amv)\b/.test(name);
    const mismatch = ['live','remix','sped up','slowed','acoustic'].some(word => name.includes(word) && !title.includes(word));
    const duration = Number(item.duration);
    const reasonable = duration > 16 && duration < Math.max(900, (track.duration || 0) * 2);
    const footage = /\b(official (music )?video|music video|visuali[sz]er|mv)\b/.test(name) || channel === artist;
    return {...item,score:titleMatch && artistMatch && footage && !unwanted && !mismatch && reasonable ? 1 + (channel === artist ? 3 : 0) + (/official (music )?video/.test(name) ? 2 : 0) + (item.verified ? 1 : 0) : 0};
  }).filter(item => item.score).sort((a,b)=>b.score-a.score)[0] || null;
}
export function publicMediaURL(value) {
  try {
    const url = new URL(value), host = url.hostname;
    if (url.protocol !== 'https:' || url.username || url.password || url.port || !host.includes('.') || host.includes(':') || /^\d+(\.\d+){3}$/.test(host) || /(^|\.)(localhost|local|internal|test|invalid)$/.test(host)) return null;
    return url.href;
  } catch { return null; }
}
export function chooseLoopFormat(formats) {
  // Small H.264 MP4 streams work with Safari and Android without another decoder.
  return formats.filter(format => /^video\/mp4/i.test(format.mime || '') && /avc1|h264/i.test(format.mime+' '+format.codec) && format.height > 0 && format.height <= 480 && publicMediaURL(format.url))
    .sort((a,b)=>Math.abs(a.height-360)-Math.abs(b.height-360) || Number(a.bitrate)-Number(b.bitrate))[0] || null;
}
export function loopWindow(duration) {
  if (!Number.isFinite(duration) || duration <= 0) return {start:0,end:8};
  const start = duration <= 12 ? 0 : Math.min(45,Math.floor(duration*.2),duration-8);
  return {start,end:Math.min(duration,start+8)};
}
export function musicVideoLoop(value) {
  if (value?.kind !== 'music-video' || !/^[\w-]{11}$/.test(value.videoId || '') || !publicMediaURL(value.url) || !publicMediaURL(value.instance)) return null;
  const media = new URL(value.url), instance = new URL(value.instance);
  if (value.engine === 'invidious' && (media.origin !== instance.origin || media.pathname !== '/latest_version' || media.searchParams.get('id') !== value.videoId || !/^\d{1,3}$/.test(media.searchParams.get('itag') || ''))) return null;
  if (!['invidious','piped'].includes(value.engine)) return null;
  return {...value,sourceURL:'https://www.youtube.com/watch?v='+value.videoId,...loopWindow(Number(value.duration))};
}
