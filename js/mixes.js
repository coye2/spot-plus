// Daily Mixes and Smart Radio: built on the device from your listening, likes and skips.
const DAY_KEY = 'spotplus.mixes', SKIP_KEY = 'spotplus.skips';
const norm = s => String(s || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
export const COLORS = ['#1db954', '#e8115b', '#2d46b9', '#ff6437', '#8c67ab', '#148a08'];

/* ----- Learning from skips: a song skipped in its first 30s counts against its artist. ----- */
export function loadSkips(storage = globalThis.localStorage) { try { return JSON.parse(storage.getItem(SKIP_KEY) || '{}'); } catch { return {}; } }
export function recordSkip(track, listenedSeconds, storage = globalThis.localStorage) {
  if (!track?.artist || listenedSeconds > 30) return;
  const skips = loadSkips(storage), key = norm(track.artist);
  skips[key] = Math.min(20, (skips[key] || 0) + 1);
  try { storage.setItem(SKIP_KEY, JSON.stringify(skips)); } catch { /* storage full */ }
}
export function recordFinish(track, storage = globalThis.localStorage) {
  const skips = loadSkips(storage), key = norm(track?.artist);
  if (!skips[key]) return;
  skips[key] = Math.max(0, skips[key] - 0.5);
  try { storage.setItem(SKIP_KEY, JSON.stringify(skips)); } catch { /* storage full */ }
}

/** Your top artists, weighted by listening time (recent counts more), likes and recent plays, minus skips. */
export function topArtists({history = [], likes = [], recent = [], skips = {}, now = Date.now()} = {}) {
  const score = new Map(), names = new Map();
  const add = (artist, value) => { const key = norm(artist); if (!key) return; names.set(key, names.get(key) || artist); score.set(key, (score.get(key) || 0) + value); };
  for (const r of history) { const ageDays = Math.max(0, (now - (r.endedAt || now)) / 864e5); add(r.artist, (r.ms || 0) / 60000 * Math.exp(-ageDays / 45)); }
  likes.forEach(t => add(t.artist, 6));
  recent.slice(0, 50).forEach((t, i) => add(t.artist, 3 - i / 25));
  return [...score].map(([key, value]) => ({key, name: names.get(key), score: value - (skips[key] || 0) * 2.5}))
    .filter(a => a.score > 0).sort((a, b) => b.score - a.score);
}

/** Shuffle with a fixed seed, so a mix stays the same all day. */
export function seeded(list, seed) {
  const out = [...list]; let s = seed >>> 0 || 1;
  for (let i = out.length - 1; i > 0; i--) { s = (s * 1664525 + 1013904223) >>> 0; const j = s % (i + 1); [out[i], out[j]] = [out[j], out[i]]; }
  return out;
}
const dayNumber = now => Math.floor(now / 864e5);

/**
 * Builds up to 6 mixes. Each starts from one of your top artists: about a third songs you already
 * play from that artist, the rest from the artist's radio (similar artists). Skipped artists are left out.
 */
export async function buildMixes({history, likes, recent, skips = loadSkips(), findArtist, artistRadio, now = Date.now(), count = 6}) {
  const seeds = topArtists({history, likes, recent, skips, now}).slice(0, count + 4);
  const day = dayNumber(now), mixes = [], used = new Set();
  const yours = [...likes, ...recent];
  for (const seed of seeds) {
    if (mixes.length >= count) break;
    try {
      const artist = await findArtist(seed.name); if (!artist || used.has(String(artist.id))) continue;
      used.add(String(artist.id));
      const radio = (await artistRadio(artist.id)).filter(t => (skips[norm(t.artist)] || 0) < 4);
      if (radio.length < 10) continue;
      const familiar = yours.filter(t => norm(t.artist) === seed.key).slice(0, 10);
      const seen = new Set(), tracks = [];
      for (const t of [...familiar, ...radio]) { const id = String(t.id); if (!seen.has(id)) { seen.add(id); tracks.push(t); } }
      const others = [...new Set(radio.map(t => t.artist).filter(a => norm(a) !== seed.key))].slice(0, 3);
      mixes.push({id: String(mixes.length + 1), title: `Daily Mix ${mixes.length + 1}`, artist: artist.name, picture: artist.picture || '',
        color: COLORS[mixes.length % COLORS.length], subtitle: [artist.name, ...others].join(', '), tracks: seeded(tracks, day * 31 + mixes.length).slice(0, 40)});
    } catch { /* skip this seed */ }
  }
  return mixes;
}
export function cachedMixes(now = Date.now(), storage = globalThis.localStorage) {
  try { const saved = JSON.parse(storage.getItem(DAY_KEY) || 'null'); return saved?.day === dayNumber(now) ? saved.mixes : null; } catch { return null; }
}
export function saveMixes(mixes, now = Date.now(), storage = globalThis.localStorage) {
  try { storage.setItem(DAY_KEY, JSON.stringify({day: dayNumber(now), mixes})); } catch { /* storage full */ }
}

/** Smart Radio: songs to keep going after the queue ends, similar to what was just playing. */
export async function radioAfter(queue, {artistRadio, findArtist, skips = loadSkips(), limit = 20}) {
  const recentIds = new Set(queue.slice(-200).map(t => String(t.id)));
  const lastArtists = [...new Set(queue.slice(-5).reverse().map(t => t.artistId ? `id:${t.artistId}` : t.artist).filter(Boolean))].slice(0, 2);
  const pool = [];
  for (const who of lastArtists) {
    try {
      const id = who.startsWith('id:') ? who.slice(3) : (await findArtist(who))?.id;
      if (id) pool.push(...await artistRadio(id));
    } catch { /* try the next artist */ }
  }
  const out = [], seen = new Set(recentIds);
  for (const t of seeded(pool, Date.now() % 1e6)) { const id = String(t.id); if (seen.has(id) || (skips[norm(t.artist)] || 0) >= 4) continue; seen.add(id); out.push(t); if (out.length >= limit) break; }
  return out;
}
