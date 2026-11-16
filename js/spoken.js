// Podcasts and audiobooks: directory lookups through the Spot+ bridge, plus "where you left off".
import {STATS_URL} from './live-stats.js';
const get = async path => { const r = await fetch(STATS_URL + path, {credentials: 'omit'}); if (!r.ok) throw new Error(r.status === 404 ? 'Podcasts need the latest Spot+ bridge. Try again soon.' : 'Couldn’t reach podcasts right now.'); return r.json(); };
export const searchShows = q => get('/podcasts' + (q ? '?q=' + encodeURIComponent(q) : '')).then(d => d.shows || []);
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
