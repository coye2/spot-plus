// The living part of the home feed: things that change through the day, the week and the year, built from
// your own listening (on repeat, likes, recent) plus Deezer's catalogue. Everything is cached on the device
// for its period, so the home screen stays fast and only rebuilds when a period turns over.

const DAY = 864e5;
const seededShuffle = (list, seed) => {
  const out = [...list];
  let x = seed % 2147483647 || 1;
  for (let i = out.length - 1; i > 0; i--) { x = (x * 48271) % 2147483647; const j = x % (i + 1); [out[i], out[j]] = [out[j], out[i]]; }
  return out;
};
const uniqTracks = (list) => { const seen = new Set(); return list.filter((t) => t?.id && !seen.has(String(t.id)) && seen.add(String(t.id))); };

/** daylist: a name and a period for this moment, like Spotify's ("Thursday late night chill"). */
export function daylistMoment(now = new Date()) {
  const h = now.getHours();
  const [part, mood] = h < 5 ? ['late night', 'chill'] : h < 9 ? ['early morning', 'easy'] : h < 12 ? ['morning', 'upbeat']
    : h < 17 ? ['afternoon', 'feel-good'] : h < 21 ? ['evening', 'wind down'] : ['night', 'mellow'];
  const weekday = now.toLocaleDateString('en-US', {weekday: 'long'});
  // A new daylist each part of the day.
  const period = `${now.toDateString()}:${part}`;
  return {title: `daylist • ${weekday} ${part} ${mood}`, part, mood, period};
}

/** Holidays and seasons, for a shelf of fitting playlists. Several can overlap (late November: both). */
export function seasonalThemes(now = new Date()) {
  const m = now.getMonth() + 1, d = now.getDate(), out = [];
  const between = (m1, d1, m2, d2) => { const v = m * 100 + d; return v >= m1 * 100 + d1 && v <= m2 * 100 + d2; };
  if (between(12, 27, 12, 31) || between(1, 1, 1, 2)) out.push({id: 'newyear', title: 'New Year’s Eve party', query: 'new years eve party'});
  if (between(11, 15, 12, 26)) out.push({id: 'christmas', title: 'Christmas music', query: 'christmas hits'});
  if (between(11, 10, 11, 30)) out.push({id: 'thanksgiving', title: 'Thanksgiving dinner', query: 'thanksgiving'});
  if (between(10, 1, 10, 31)) out.push({id: 'halloween', title: 'Halloween', query: 'halloween party'});
  if (between(2, 1, 2, 14)) out.push({id: 'valentines', title: 'Valentine’s Day', query: 'love songs valentines'});
  if (between(3, 10, 3, 17)) out.push({id: 'stpatricks', title: 'St. Patrick’s Day', query: 'st patricks day'});
  if (between(6, 15, 7, 4)) out.push({id: 'july4', title: 'Fourth of July', query: '4th of july'});
  const season = m <= 2 || m === 12 ? ['winter', 'Cozy winter'] : m <= 5 ? ['spring', 'Spring feels'] : m <= 8 ? ['summer', 'Summer hits'] : ['fall', 'Fall vibes'];
  out.push({id: season[0], title: season[1], query: season[0] === 'fall' ? 'autumn vibes' : season[1].toLowerCase()});
  return out;
}

const weekOf = (now, startDay) => { // the most recent Monday (1) or Friday (5)
  const d = new Date(now); d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - ((d.getDay() - startDay + 7) % 7));
  return d.toDateString();
};

/** Your top artists from what you play and like, most first: [{id, name}]. */
export function topArtists({onRepeat = [], recent = [], likes = [], limit = 8}) {
  const score = new Map();
  const add = (t, w) => { if (!t?.artistId) return; const k = String(t.artistId); const s = score.get(k) || {id: k, name: t.artist, n: 0}; s.n += w; score.set(k, s); };
  onRepeat.forEach((t) => add(t, 3)); recent.forEach((t) => add(t, 2)); likes.slice(0, 200).forEach((t) => add(t, 1));
  return [...score.values()].sort((a, b) => b.n - a.n).slice(0, limit);
}

function cached(storage, key, period) {
  try { const v = JSON.parse(storage.getItem(key) || 'null'); return v?.period === period ? v.value : null; } catch { return null; }
}
function save(storage, key, period, value) {
  try { storage.setItem(key, JSON.stringify({period, value})); } catch { /* storage full */ }
}

/**
 * Builds the living feed. api: {artistRadio(id), artist(id), searchPlaylists(q)}.
 * Returns {daylist, onRepeat, discover, releaseRadar, seasonal: [{title, playlists}]}; missing parts are null.
 */
export async function buildFeed({api, onRepeat = [], recent = [], likes = [], now = new Date(), storage = globalThis.localStorage}) {
  const tops = topArtists({onRepeat, recent, likes});
  const known = new Set([...onRepeat, ...recent, ...likes].map((t) => String(t.artistId || '')));
  const moment = daylistMoment(now);
  const seed = Math.floor(now.getTime() / DAY);

  const daylist = cached(storage, 'spotplus.feed.daylist', moment.period) || await (async () => {
    // Your songs plus radio from two of your artists, picked for this part of the day.
    const radio = (await Promise.all(tops.slice(0, 2).map((a) => api.artistRadio(a.id).catch(() => [])))).flat();
    const tracks = uniqTracks(seededShuffle([...onRepeat.slice(0, 15), ...seededShuffle(likes, seed).slice(0, 15), ...radio], seed + moment.part.length)).slice(0, 50);
    const value = tracks.length >= 8 ? {id: 'daylist', title: moment.title, subtitle: 'Changes through the day', color: '#c2410c', tracks} : null;
    if (value) save(storage, 'spotplus.feed.daylist', moment.period, value);
    return value;
  })();

  const monday = weekOf(now, 1);
  const discover = cached(storage, 'spotplus.feed.discover', monday) || await (async () => {
    // Songs by artists similar to yours that you don't listen to yet. New every Monday.
    const radio = (await Promise.all(tops.slice(0, 5).map((a) => api.artistRadio(a.id).catch(() => [])))).flat();
    const fresh = radio.filter((t) => !known.has(String(t.artistId || '')));
    const perArtist = new Map();
    const tracks = seededShuffle(uniqTracks(fresh), seed).filter((t) => { const n = perArtist.get(t.artistId) || 0; perArtist.set(t.artistId, n + 1); return n < 2; }).slice(0, 30);
    const value = tracks.length >= 10 ? {id: 'discover-weekly', title: 'Discover Weekly', subtitle: 'New music for you, every Monday', color: '#1e3a8a', tracks} : null;
    if (value) save(storage, 'spotplus.feed.discover', monday, value);
    return value;
  })();

  const friday = weekOf(now, 5);
  const releaseRadar = cached(storage, 'spotplus.feed.releases', friday) || await (async () => {
    // New albums and singles from your artists in the last 30 days. New every Friday.
    const pages = await Promise.all(tops.slice(0, 8).map((a) => api.artist(a.id).catch(() => null)));
    const since = new Date(now.getTime() - 30 * DAY).toISOString().slice(0, 10);
    const albums = pages.flatMap((p) => (p?.albums || []).filter((al) => al.released && al.released >= since))
      .sort((a, b) => b.released.localeCompare(a.released)).slice(0, 12);
    save(storage, 'spotplus.feed.releases', friday, albums);
    return albums;
  })();

  const seasonal = await Promise.all(seasonalThemes(now).slice(0, 2).map(async (theme) => {
    const key = 'spotplus.feed.season.' + theme.id;
    const day = now.toDateString();
    const playlists = cached(storage, key, day) || await api.searchPlaylists(theme.query).catch(() => []);
    if (playlists.length) save(storage, key, day, playlists);
    return {title: theme.title, playlists: playlists.slice(0, 10)};
  }));

  const repeat = onRepeat.length >= 5 ? {id: 'on-repeat', title: 'On Repeat', subtitle: 'The songs you can’t stop playing', color: '#be185d', tracks: onRepeat.slice(0, 50)} : null;
  return {daylist, onRepeat: repeat, discover, releaseRadar: releaseRadar || [], seasonal: seasonal.filter((s) => s.playlists.length)};
}
