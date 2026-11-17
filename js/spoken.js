// Podcasts and audiobooks: directory lookups through the Spot+ bridge, plus "where you left off".
import {STATS_URL} from './live-stats.js';
const safeUrl = u => { try { const x = new URL(u); return ['https:', 'http:'].includes(x.protocol) ? x.href : ''; } catch { return ''; } };
const showFromItunes = r => ({id: String(r.collectionId), title: r.collectionName || '', author: r.artistName || '', image: r.artworkUrl600 || r.artworkUrl100 || '', feed: safeUrl(r.feedUrl), genre: r.primaryGenreName || '', episodes: r.trackCount || 0});
const showFromFyyd = r => ({id: String(r.id), title: r.title || '', author: r.author || '', image: safeUrl(r.imgURL || r.layoutImageURL || r.thumbImageURL), feed: safeUrl(r.xmlURL), genre: '', episodes: r.episode_count || 0});

let cbSeq = 0;
function itunesJsonp(path, params) {
  if (typeof document === 'undefined' || !document.head) return Promise.reject(new Error('No DOM'));
  return new Promise((resolve, reject) => {
    const cb = `__pod_${Date.now().toString(36)}_${++cbSeq}`;
    const qs = new URLSearchParams({...params, callback: cb});
    const s = document.createElement('script');
    const done = () => { clearTimeout(timer); window[cb] = () => {}; s.remove(); setTimeout(() => { try { delete window[cb]; } catch { /* ignore */ } }, 30000); };
    const timer = setTimeout(() => { done(); reject(new Error('Timed out')); }, 6000);
    window[cb] = data => { done(); resolve(data); };
    s.onerror = () => { done(); reject(new Error('Network error')); };
    s.src = `https://itunes.apple.com${path}?${qs}`;
    document.head.appendChild(s);
  });
}

async function fetchJSON(url, ms = 6000) {
  const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), ms);
  try {
    const r = await fetch(url, {credentials: 'omit', signal: ctl.signal});
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return await r.json();
  } finally { clearTimeout(timer); }
}

const get = async path => {
  const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), 5000);
  try {
    const r = await fetch(STATS_URL + path, {credentials: 'omit', signal: ctl.signal});
    if (!r.ok) throw new Error(r.status === 404 ? 'Podcasts need the latest Spot+ bridge. Try again soon.' : 'Couldn’t reach podcasts right now.');
    return await r.json();
  } finally { clearTimeout(timer); }
};

export async function searchShows(q) {
  try {
    const d = await get('/podcasts' + (q ? '?q=' + encodeURIComponent(q) : ''));
    if (Array.isArray(d?.shows) && (d.shows.length || q)) return d.shows;
  } catch { /* fall back directly to public directories */ }
  if (!q) {
    try {
      const top = await fetchJSON('https://itunes.apple.com/us/rss/toppodcasts/limit=30/json');
      const ids = (top?.feed?.entry || []).map(e => e?.id?.attributes?.['im:id']).filter(id => /^\d+$/.test(id)).slice(0, 30);
      if (ids.length) {
        const look = await itunesJsonp('/lookup', {id: ids.join(','), entity: 'podcast'});
        const shows = (look?.results || []).filter(r => r.feedUrl).map(showFromItunes);
        if (shows.length) return shows;
      }
    } catch { /* fall back to fyyd */ }
    const fyyd = await fetchJSON('https://api.fyyd.de/0.2/feature/podcast/hot?count=30');
    return (fyyd?.data || []).filter(r => r?.xmlURL).map(showFromFyyd);
  }
  try {
    const data = await itunesJsonp('/search', {media: 'podcast', limit: '24', term: q});
    const shows = (data?.results || []).filter(r => r.feedUrl).map(showFromItunes);
    if (shows.length) return shows;
  } catch { /* fall back to fyyd */ }
  const fyyd = await fetchJSON(`https://api.fyyd.de/0.2/search/podcast?count=24&title=${encodeURIComponent(q)}`);
  return (fyyd?.data || []).filter(r => r?.xmlURL).map(showFromFyyd);
}
export const show = feed => get('/podcast?feed=' + encodeURIComponent(feed));
export const searchBooks = q => get('/audiobooks' + (q ? '?q=' + encodeURIComponent(q) : '')).then(d => d.books || []);
export const book = id => get('/audiobooks?id=' + encodeURIComponent(id)).then(d => d.book);

const hash = s => { let h = 2166136261; for (const c of String(s)) { h ^= c.codePointAt(0); h = Math.imul(h, 16777619); } return (h >>> 0).toString(36); };
/** An episode as a playable item in the Spot+ queue. */
export const episodeTrack = (ep, s) => ({id: 'ep:' + hash(ep.id || ep.url), kind: 'episode', title: ep.title, artist: s.title, album: s.title, cover: ep.image || s.image, coverXl: ep.image || s.image,
  duration: ep.duration || 0, direct: ep.url, mime: ep.type || 'audio/mpeg', date: ep.date || 0, feed: s.feed, notes: ep.description || ''});
export const chapterTrack = (ch, b) => ({id: 'ab:' + hash(ch.id), kind: 'audiobook', title: ch.title, artist: b.author || 'LibriVox', album: b.title, cover: b.image, coverXl: b.image,
  duration: ch.duration || 0, direct: ch.url, mime: 'audio/mpeg', bookId: b.id, notes: b.description || ''});
export const isSpoken = t => t?.kind === 'episode' || t?.kind === 'audiobook';

/* ---------------- Where you left off ---------------- */
const KEY = 'spotplus.progress', SUBS = 'spotplus.shows';
const read = (k, d) => { try { return JSON.parse(localStorage.getItem(k) || 'null') ?? d; } catch { return d; } };
const write = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage full */ } };
export function progress(id) { return read(KEY, {})[id] || null; }
export function saveProgress(t, pos, dur) {
  if (!isSpoken(t) || !dur) return;
  const all = read(KEY, {}); all[t.id] = {pos: Math.floor(pos), dur: Math.floor(dur), done: pos / dur > 0.95, at: Date.now(), track: t};
  const kept = Object.entries(all).sort((a, b) => b[1].at - a[1].at).slice(0, 200);
  write(KEY, Object.fromEntries(kept));
}
/** Start where you stopped (a few seconds back for context), unless you finished it. */
export function resumeAt(t) { const p = progress(t.id); return p && !p.done && p.pos > 15 ? Math.max(0, p.pos - 5) : 0; }
export function continueListening() { return Object.values(read(KEY, {})).filter(p => !p.done && p.pos > 30 && p.track).sort((a, b) => b.at - a.at).slice(0, 10); }

/* ---------------- Followed shows ---------------- */
export const followed = () => read(SUBS, []);
export const isFollowing = feed => followed().some(s => s.feed === feed);
export function toggleFollow(s) { const list = followed(); write(SUBS, isFollowing(s.feed) ? list.filter(x => x.feed !== s.feed) : [{title: s.title, author: s.author, image: s.image, feed: s.feed}, ...list]); return isFollowing(s.feed); }
