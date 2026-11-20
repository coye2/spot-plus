// Spotify's own artist pages (photo, monthly listeners, popular songs, releases, related artists), matched to the
// artist pages Spot+ plays from. The match comes from, in order: what this device has learned (artists in your
// synced Spotify songs and playlists, related artists, a link you pasted), then the Spot+ server's lookup
// (Wikidata and MusicBrainz list the same artist on both services). A guess by name alone is never used.
import {fetchPublic} from './spotify-links.js';

const KEY = 'spotplus.spotifyArtists';
const STATS = 'https://spot-plus-canvas.pwr97pnmkn.workers.dev/spotify-stats';
export const fold = (v) => String(v || '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
const id22 = (v) => /^[A-Za-z0-9]{22}$/.test(v || '');
let map = (() => { try { return JSON.parse(localStorage.getItem(KEY) || '{}'); } catch { return {}; } })();
map.byName ||= {}; map.byDeezer ||= {}; map.pics ||= {};
let dirty = 0;
const save = () => { clearTimeout(dirty); dirty = setTimeout(() => { try { localStorage.setItem(KEY, JSON.stringify(map)); } catch { /* full */ } }, 400); };

/** Remember that this name is this Spotify artist (from Spotify's own data). */
export function learn(name, spotifyId, deezerId) {
  if (!id22(spotifyId)) return;
  const k = fold(name);
  if (k && map.byName[k] !== spotifyId) { map.byName[k] = spotifyId; save(); }
  if (deezerId && map.byDeezer[deezerId] !== spotifyId) { map.byDeezer[deezerId] = spotifyId; save(); }
}
/** Learns artists from Spotify songs: "A, B" with artistIds [idA, idB]. */
export function learnFromTracks(tracks) {
  for (const t of tracks || []) {
    const ids = Array.isArray(t?.artistIds) ? t.artistIds : [];
    const names = String(t?.artist || '').split(/,\s*/);
    if (ids.length && ids.length === names.length) ids.forEach((id, i) => learn(names[i], id));
  }
}
let learnedAccount = false;
/** Once per visit: every artist in your synced Spotify library. */
export function learnFromAccount(account) {
  if (learnedAccount || !account) return;
  learnedAccount = true;
  for (const a of account.artists || []) learn(a.title, a.id);
  for (const p of account.playlists || []) learnFromTracks(p.tracks);
  learnFromTracks(account.likes);
}
export const knownFor = (deezerId, name) => map.byDeezer[deezerId] || map.byName[fold(name)] || '';

const pages = new Map();
/** Spotify's public artist page, parsed by the Spot+ server (cached an hour there, ten minutes here). */
export function spotifyArtist(id) {
  const hit = pages.get(id);
  if (hit && hit.until > Date.now()) return hit.p;
  const p = fetchPublic({artist: id}).then((a) => {
    learn(a.name, a.id);
    if (a.picture && map.pics[a.id] !== a.picture) { map.pics[a.id] = a.picture; save(); }
    for (const r of a.related || []) learn(r.name, r.id);
    learnFromTracks(a.top);
    return a;
  });
  p.catch(() => pages.delete(id));
  pages.set(id, {p, until: Date.now() + 10 * 60e3});
  return p;
}

/** The Spotify artist for a Deezer artist, or '' when no reliable match exists. */
export async function spotifyIdFor(deezerArtist, {timeoutMs = 6000} = {}) {
  const known = knownFor(deezerArtist.id, deezerArtist.name);
  if (known) return known;
  const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const r = await fetch(STATS + '?deezerArtistId=' + encodeURIComponent(deezerArtist.id), {signal: ctl.signal, credentials: 'omit'});
    const d = r.ok ? await r.json() : null;
    if (d?.available && id22(d.id) && fold(d.name) === fold(deezerArtist.name)) { learn(d.name, d.id, deezerArtist.id); return d.id; }
  } catch { /* no match */ } finally { clearTimeout(timer); }
  return '';
}
/** A pasted Spotify artist link (or URI) → its ID. */
export function parseArtistLink(text) {
  return /(?:open\.spotify\.com\/(?:intl-[a-z-]+\/)?artist\/|spotify:artist:)([A-Za-z0-9]{22})/.exec(String(text || ''))?.[1] || '';
}

/** Spotify's photo for an artist, when this device knows who they are on Spotify. */
export function photoFor(deezerId, name) { const id = knownFor(deezerId, name); return id ? map.pics[id] || '' : ''; }
/** Fills in photos for artist cards that have none (Deezer has no photo for some artists), from Spotify. */
export async function fillPhotos(root) {
  const cards = [...(root?.querySelectorAll?.('[data-needs-photo]') || [])].slice(0, 8);
  await Promise.all(cards.map(async (card) => {
    const id = knownFor(card.dataset.artistId, card.dataset.name) || await spotifyIdFor({id: card.dataset.artistId, name: card.dataset.name}, {timeoutMs: 5000});
    if (!id) return;
    const a = await spotifyArtist(id).catch(() => null);
    if (a?.picture && card.isConnected) { card.querySelector('.ph-cover')?.replaceWith(Object.assign(document.createElement('img'), {src: a.picture, alt: '', loading: 'lazy'})); card.removeAttribute('data-needs-photo'); }
  }));
}
