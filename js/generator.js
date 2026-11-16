// Playlist generator: turns your choices (starting points, vibes, familiar↔fresh, hits↔deep cuts,
// length, variety, order) into a playlist using the music catalog and your own listening.
import {topArtists, seeded} from './mixes.js';

export const VIBES = {
  chill: {label: 'Chill', words: 'chill'}, hype: {label: 'Hype', words: 'hype'}, happy: {label: 'Happy', words: 'feel good'},
  sad: {label: 'Sad', words: 'sad'}, focus: {label: 'Focus', words: 'focus'}, party: {label: 'Party', words: 'party'},
  workout: {label: 'Workout', words: 'workout'}, romance: {label: 'Romance', words: 'love songs'}, night: {label: 'Late night', words: 'late night'},
  roadtrip: {label: 'Road trip', words: 'road trip'}, throwback: {label: 'Throwback', words: 'throwback'}, sleep: {label: 'Sleep', words: 'sleep'},
};
export const DEFAULTS = {useTaste: true, artists: [], songs: [], genres: [], vibes: [], discovery: 0.5, popularity: 0.5, length: 30, perArtist: 2, clean: false, order: 'flow', name: ''};

const norm = s => String(s || '').toLowerCase().replace(/\([^)]*\)|\[[^\]]*\]/g, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
const songKey = t => norm(t.title) + '|' + norm(t.artist);

/** A name that describes the choices, e.g. "Chill Hip-Hop with Drake". */
export function suggestName(o) {
  const vibe = o.vibes.map(v => VIBES[v]?.label).filter(Boolean)[0] || '';
  const genre = o.genres[0]?.name || '';
  const who = o.artists[0]?.name || o.songs[0]?.artist || '';
  const core = [vibe, genre].filter(Boolean).join(' ') || (who ? 'Mix' : 'Your Mix');
  return who ? `${core} with ${who}` : core === 'Your Mix' ? 'Made for You' : `${core} Mix`;
}

/** Order so the same artist rarely plays twice in a row. */
export function spreadArtists(tracks) {
  const groups = new Map();
  for (const t of tracks) { const k = norm(t.artist); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(t); }
  const out = []; let last = '';
  while (out.length < tracks.length) {
    const options = [...groups].filter(([k, list]) => list.length && k !== last).sort((a, b) => b[1].length - a[1].length);
    const pick = options[0] || [...groups].find(([, list]) => list.length);
    out.push(pick[1].shift()); last = pick[0];
  }
  return out;
}

/**
 * Build the candidate pool and score it.
 * api: {artistRadio, artistTop, genreArtists, vibeTracks, findArtist}
 * you: {history, likes, recent, skips}
 */
export async function generate(options, api, you = {}, seed = Date.now()) {
  const o = {...DEFAULTS, ...options}, pool = new Map(), known = new Set([...(you.likes || []), ...(you.recent || [])].map(t => norm(t.artist)));
  for (const r of you.history || []) known.add(norm(r.artist));
  const add = (tracks, source, weight) => { for (const t of tracks || []) { if (!t?.id) continue; const id = String(t.id); const e = pool.get(id) || {track: t, score: 0, sources: new Set()}; e.score += weight; e.sources.add(source); pool.set(id, e); } };
  const jobs = [];

  // Starting points
  const seedArtists = [...o.artists];
  if (o.useTaste || (!o.artists.length && !o.songs.length && !o.genres.length && !o.vibes.length)) {
    for (const a of topArtists({history: you.history, likes: you.likes, recent: you.recent, skips: you.skips}).slice(0, 4)) seedArtists.push({name: a.name});
  }
  const resolveArtist = async a => a.id ? a : await api.findArtist(a.name).catch(() => null);
  for (const a of seedArtists.slice(0, 8)) jobs.push((async () => {
    const artist = await resolveArtist(a); if (!artist) return;
    const familiarWeight = 1.6 * (1 - o.discovery), freshWeight = 0.6 + 1.4 * o.discovery;
    const [top, radio] = await Promise.allSettled([api.artistTop(artist.id), api.artistRadio(artist.id)]);
    if (top.status === 'fulfilled') add(top.value, 'artist', familiarWeight + (o.artists.length ? 0.6 : 0));
    if (radio.status === 'fulfilled') add(radio.value, 'radio', freshWeight);
  })());
  for (const s of o.songs.slice(0, 5)) {
    add([s], 'song', 3);
    if (s.artistId) jobs.push(api.artistRadio(s.artistId).then(t => add(t, 'radio', 1.2)).catch(() => {}));
  }
  for (const g of o.genres.slice(0, 4)) jobs.push((async () => {
    const artists = (await api.genreArtists(g.id).catch(() => [])).slice(0, 3);
    await Promise.allSettled(artists.map(a => api.artistRadio(a.id).then(t => add(t, 'genre', 1.1))));
  })());
  // Vibes: songs from public playlists matching the vibe (and genre/artist when picked) count extra.
  const flavour = o.genres[0]?.name || o.artists[0]?.name || '';
  for (const v of o.vibes.slice(0, 4)) jobs.push(api.vibeTracks(`${VIBES[v]?.words || v} ${flavour}`.trim()).then(t => add(t, 'vibe', 1.8)).catch(() => {}));
  await Promise.allSettled(jobs);

  // Score
  const ranks = [...pool.values()].map(e => e.track.rank || 0).sort((a, b) => a - b);
  const pct = r => { if (!ranks.length) return 0.5; let lo = 0, hi = ranks.length; while (lo < hi) { const m = (lo + hi) >> 1; if (ranks[m] < r) lo = m + 1; else hi = m; } return lo / ranks.length; };
  const scored = [];
  for (const e of pool.values()) {
    const t = e.track; if (o.clean && t.explicit) continue;
    if ((you.skips?.[norm(t.artist)] || 0) >= 4) continue;
    let score = e.score + (e.sources.size - 1) * 1.2; // found by several starting points = strong match
    if (o.vibes.length && !e.sources.has('vibe') && !e.sources.has('song')) score *= 0.55;
    const p = pct(t.rank || 0); score += (o.popularity - 0.5) * 2.4 * (p - 0.5) * 2;
    if (known.has(norm(t.artist))) score += (0.5 - o.discovery) * 2; else score += (o.discovery - 0.5) * 1.6;
    scored.push({t, score});
  }
  // Weighted pick with a little randomness (Regenerate gives a fresh take), dedupe and cap per artist.
  let s = seed >>> 0 || 1; const rand = () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296;
  scored.forEach(x => { x.key = x.score + rand() * 1.4; });
  scored.sort((a, b) => b.key - a.key);
  const picked = [], titles = new Set(), perArtist = new Map(), cap = o.perArtist > 0 ? o.perArtist : Infinity;
  for (const {t} of scored) {
    if (picked.length >= o.length) break;
    const k = songKey(t), a = norm(t.artist);
    if (titles.has(k) || (perArtist.get(a) || 0) >= cap) continue;
    titles.add(k); perArtist.set(a, (perArtist.get(a) || 0) + 1); picked.push(t);
  }
  const ordered = o.order === 'popular' ? [...picked].sort((a, b) => (b.rank || 0) - (a.rank || 0)) : o.order === 'shuffle' ? seeded(picked, seed) : spreadArtists(picked);
  return {name: o.name.trim() || suggestName(o), tracks: ordered, pool: pool.size};
}
