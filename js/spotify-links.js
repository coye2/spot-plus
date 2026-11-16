// Spotify, without logging in. Spotify publishes each listener's taste as personal
// playlists ("On Repeat" = most played lately, "Repeat Rewind", "Your Top Songs",
// daylist, Discover Weekly…) that anyone with the link can view, and a public profile
// (name, photo, public playlists). Users paste those links once; Spot+ reads them
// through its own bridge, keeps a daily snapshot, and turns the snapshots into Rewind.
export const BRIDGE = 'https://spot-plus-canvas.pwr97pnmkn.workers.dev/spotify-public';
const DAY = 86400000;

/** Pull every Spotify playlist/profile link or URI out of pasted text. */
export function parseSpotifyLinks(text) {
  const found = {profile: null, playlists: []};
  for (const m of String(text || '').matchAll(/(?:open\.spotify\.com\/(?:intl-[a-z-]+\/)?(?:user\/[^/\s]+\/)?(playlist|user)\/|spotify:(playlist|user):)([A-Za-z0-9._-]{1,64})/g)) {
    const kind = m[1] || m[2], id = m[3];
    if (kind === 'user' && !found.profile && /^[A-Za-z0-9._-]{1,64}$/.test(id)) found.profile = id;
    if (kind === 'playlist' && /^[A-Za-z0-9]{22}$/.test(id) && !found.playlists.includes(id)) found.playlists.push(id);
  }
  return found;
}
/** What a playlist is for, from its name (Spotify's personal playlists have fixed names). */
export function playlistRole(name, id = '') {
  const n = String(name || '').toLowerCase();
  if (n === 'on repeat') return 'onRepeat';
  if (n === 'repeat rewind') return 'repeatRewind';
  if (/^your top songs \d{4}$/.test(n)) return 'topSongs';
  if (n.includes('daylist')) return 'daylist';
  if (n === 'discover weekly') return 'discoverWeekly';
  if (n === 'release radar') return 'releaseRadar';
  if (/^daily mix \d$/.test(n)) return 'dailyMix';
  if (/^37i9dQZF1E/.test(id)) return 'madeForYou';
  return 'playlist';
}
export async function fetchPublic(query, {fetcher = fetch, signal} = {}) {
  const response = await fetcher(BRIDGE + '?' + new URLSearchParams(query), {signal, credentials: 'omit'});
  const data = await response.json().catch(() => null);
  if (response.status === 404 && !data?.error) throw new Error('Spotify linking isn’t available right now. Try again later.');
  if (!response.ok || !data || data.error) throw new Error(data?.error || 'Spotify couldn’t be reached. Check your connection and try again.');
  return data;
}

/* ---------------- Saved state (IndexedDB) ---------------- */
let dbPromise = null;
function db() {
  return dbPromise ??= new Promise((resolve, reject) => {
    if (!globalThis.indexedDB) return reject(new Error('No storage'));
    const r = indexedDB.open('spotplus-links', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('kv');
    r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error);
  });
}
async function kv(mode, fn) { const d = await db(); return new Promise((resolve, reject) => { const tx = d.transaction('kv', mode), q = fn(tx.objectStore('kv')); tx.oncomplete = () => resolve(q?.result); tx.onerror = () => reject(tx.error); }); }
let cache = null;
export async function loadLinks() { if (cache) return cache; try { cache = await kv('readonly', s => s.get('state')) || null; } catch { cache = null; } return cache; }
export const cachedLinks = () => cache;
async function saveLinks(state) { cache = state; try { await kv('readwrite', s => s.put(state, 'state')); } catch { /* Memory copy still works this session. */ } }
export async function clearLinks() { cache = null; try { await kv('readwrite', s => s.delete('state')); } catch { /* Nothing saved. */ } }
const emptyState = () => ({profile: null, playlists: {}, snapshots: [], moods: [], syncedAt: 0});

/** Add pasted links. Returns a short description of what was recognised. */
export async function addLinks(text, options) {
  const {profile, playlists} = parseSpotifyLinks(text);
  if (!profile && !playlists.length) throw new Error('Paste a Spotify profile or playlist link (Share → Copy link in Spotify).');
  const state = {...emptyState(), ...(await loadLinks())}, added = [];
  if (profile) { const p = await fetchPublic({user: profile}, options); state.profile = {id: p.id, name: p.name, avatar: p.avatar, playlists: p.playlists}; added.push('your profile'); }
  for (const id of playlists) {
    const p = await fetchPublic({playlist: id}, options);
    state.playlists[id] = {id, name: p.name, cover: p.cover, role: playlistRole(p.name, id), tracks: p.tracks, fetchedAt: Date.now()};
    added.push(p.name);
    recordSnapshot(state, state.playlists[id]);
  }
  await saveLinks(state);
  return added;
}
/** One snapshot per On Repeat change per day; daylist names become a mood timeline. */
export function recordSnapshot(state, playlist, now = Date.now()) {
  if (playlist.role === 'onRepeat' && playlist.tracks?.length) {
    const ids = playlist.tracks.map(t => t.spotifyId), last = state.snapshots.at(-1);
    const day = new Date(now).toISOString().slice(0, 10);
    if (!last || last.ids.join() !== ids.join()) {
      if (last?.day === day) state.snapshots.pop();
      state.snapshots.push({day, at: now, ids});
      state.snapshots = state.snapshots.slice(-400);
    }
    state.tracks = {...(state.tracks || {})};
    for (const t of playlist.tracks) state.tracks[t.spotifyId] = {title: t.title, artist: t.artist, duration: t.duration};
  }
  if (playlist.role === 'daylist' && playlist.name && state.moods.at(-1)?.name !== playlist.name) {
    state.moods.push({name: playlist.name, at: now});
    state.moods = state.moods.slice(-200);
  }
}
/** Refresh everything linked (at most every few hours). Returns true when something changed. */
export async function syncLinks({force = false, ...options} = {}) {
  const state = await loadLinks();
  if (!state || (!force && Date.now() - state.syncedAt < 3 * 3600000)) return false;
  let changed = false;
  for (const p of Object.values(state.playlists)) {
    try {
      const fresh = await fetchPublic({playlist: p.id}, options);
      const before = p.tracks.map(t => t.spotifyId).join() + p.name;
      Object.assign(p, {name: fresh.name, cover: fresh.cover, tracks: fresh.tracks, role: playlistRole(fresh.name, p.id), fetchedAt: Date.now()});
      recordSnapshot(state, p);
      changed ||= before !== p.tracks.map(t => t.spotifyId).join() + p.name;
    } catch { /* Keep the last copy; try again next time. */ }
  }
  if (state.profile?.id && Date.now() - (state.profile.fetchedAt || 0) > DAY) {
    try { const p = await fetchPublic({user: state.profile.id}, options); Object.assign(state.profile, {name: p.name, avatar: p.avatar, playlists: p.playlists, fetchedAt: Date.now()}); changed = true; } catch { /* Later. */ }
  }
  state.syncedAt = Date.now();
  await saveLinks(state);
  return changed;
}

/* ---------------- Rewind from snapshots ---------------- */
const rankScore = (rank, size) => size - rank; // #1 of 30 scores 30, #30 scores 1.
function artistsFrom(tracks) {
  const map = new Map();
  tracks.forEach((t, i) => {
    for (const name of String(t.artist).split(/,\s*/).slice(0, 1)) {
      const a = map.get(name.toLowerCase()) || {id: '', name, cover: '', genres: [], score: 0, tracks: 0};
      a.score += t.score ?? rankScore(i, tracks.length); a.tracks++; map.set(name.toLowerCase(), a);
    }
  });
  return [...map.values()].sort((a, b) => b.score - a.score || b.tracks - a.tracks);
}
function aggregate(snapshots, state) {
  const scores = new Map();
  for (const s of snapshots) s.ids.forEach((id, i) => scores.set(id, (scores.get(id) || 0) + rankScore(i, s.ids.length)));
  return [...scores].sort((a, b) => b[1] - a[1]).map(([id, score]) => ({spotifyId: id, ...state.tracks?.[id], score, cover: ''})).filter(t => t.title);
}
/** Stats in the same shape as Spotify's own top lists, so Rewind can use either. */
export function linkStats(state, now = Date.now()) {
  if (!state) return null;
  const onRepeat = Object.values(state.playlists).find(p => p.role === 'onRepeat');
  const rewind = Object.values(state.playlists).find(p => p.role === 'repeatRewind');
  const yearly = Object.values(state.playlists).filter(p => p.role === 'topSongs').sort((a, b) => b.name.localeCompare(a.name));
  if (!onRepeat && !yearly.length && !rewind) return null;
  const short = (onRepeat?.tracks || []).map(t => ({...t, cover: ''}));
  const sixMonths = state.snapshots.filter(s => now - s.at < 182 * DAY);
  let medium = aggregate(sixMonths, state);
  if (medium.length < 10 && rewind) medium = [...medium, ...rewind.tracks.filter(t => !medium.some(m => m.spotifyId === t.spotifyId))];
  const yearlyTracks = yearly.flatMap(p => p.tracks.map((t, i) => ({...t, score: rankScore(i, p.tracks.length) * 2, cover: ''})));
  const merged = new Map();
  for (const t of [...aggregate(state.snapshots, state), ...yearlyTracks]) { const m = merged.get(t.spotifyId); merged.set(t.spotifyId, m ? {...m, score: m.score + (t.score || 0)} : t); }
  const long = [...merged.values()].sort((a, b) => b.score - a.score);
  const pack = list => ({tracks: list.slice(0, 50), artists: artistsFrom(list).slice(0, 50)});
  const previous = state.snapshots.at(-2);
  return {
    stats: {capturedAt: onRepeat?.fetchedAt || now, top: {short_term: pack(short), medium_term: pack(medium.length ? medium : short), long_term: pack(long.length ? long : short)}, recent: []},
    statsPrevious: previous ? {top: {short_term: {tracks: previous.ids.map(id => ({spotifyId: id})), artists: artistsFrom(previous.ids.map(id => state.tracks?.[id]).filter(Boolean))}}} : null,
    account: state.profile ? {id: state.profile.id, name: state.profile.name, avatar: state.profile.avatar} : null,
    moods: state.moods, source: 'links',
  };
}
export function madeForYou(state) {
  if (!state) return [];
  const order = ['onRepeat', 'daylist', 'discoverWeekly', 'releaseRadar', 'dailyMix', 'repeatRewind', 'topSongs', 'madeForYou'];
  return Object.values(state.playlists).filter(p => p.role !== 'playlist').sort((a, b) => order.indexOf(a.role) - order.indexOf(b.role));
}
