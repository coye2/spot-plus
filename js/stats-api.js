// Spot+ Stats API: "Stats for Spotify"-style insights with no imports.
//  1. Spotify's own top tracks/artists (4 weeks, 6 months, all time) and recent plays,
//     read automatically by the helper on every library refresh (account.stats).
//  2. Rewind history built automatically from those recent plays and Spot+ listening.
// All functions are pure: pass the saved account or history records in.

/* ---------- Spotify snapshot (automatic) ---------- */
export const SPOTIFY_RANGES = Object.freeze({
  short_term: 'Last 4 weeks',
  medium_term: 'Last 6 months',
  long_term: 'All time',
});
/** Ranked top tracks or artists with movement since the previous refresh: +n up, -n down, 'new', or null on the first refresh. */
export function spotifyTop(account, {range = 'short_term', kind = 'tracks', limit = 50} = {}) {
  const items = account?.stats?.top?.[range]?.[kind];
  if (!Array.isArray(items)) return [];
  const before = account.statsPrevious?.top?.[range]?.[kind];
  const key = item => kind === 'tracks' ? item.spotifyId : item.id;
  const old = Array.isArray(before) ? new Map(before.map((item, i) => [key(item), i + 1])) : null;
  return items.slice(0, limit).map((item, i) => {
    const rank = i + 1, was = old?.get(key(item));
    return {...item, rank, change: old ? (was ? was - rank : 'new') : null};
  });
}
/** Top genres weighted by artist rank (rank 1 counts most), as a share of the total. */
export function spotifyGenres(account, {range = 'short_term', limit = 20} = {}) {
  const artists = account?.stats?.top?.[range]?.artists;
  if (!Array.isArray(artists)) return [];
  const weights = new Map(); let total = 0;
  artists.forEach((a, i) => { const w = artists.length - i; for (const g of a.genres || []) { weights.set(g, (weights.get(g) || 0) + w); total += w; } });
  return [...weights].sort((a, b) => b[1] - a[1]).slice(0, limit).map(([name, w], i) => ({rank: i + 1, name, share: total ? w / total : 0}));
}
/** Turn the snapshot's recent plays into Rewind history records (deduplicated by track and time). */
export function recentPlaysAsHistory(account) {
  const recent = account?.stats?.recent;
  if (!Array.isArray(recent)) return [];
  return recent.filter(t => t.spotifyId && Number.isFinite(t.playedAt)).map(t => ({
    id: 'recent:' + t.spotifyId + ':' + t.playedAt, source: 'spotify', endedAt: t.playedAt,
    ms: Math.max(30000, (t.duration || 180) * 1000), artist: t.artist, title: t.title, spotifyId: t.spotifyId, cover: t.cover || '', estimated: true,
  }));
}

/* ---------- Rewind history ---------- */
// Record shape (listening-history.js): {id, source, endedAt, ms, artist, title, spotifyId}
const DAY = 86400000;
export const RANGES = Object.freeze({
  short: {label: 'Last 4 weeks', days: 28},
  medium: {label: 'Last 6 months', days: 182},
  long: {label: 'All time', days: null},
});
export const PLAY_MS = 30000; // Spotify counts a stream after 30 seconds.

function bySource(records, source) {
  return source === 'all' ? records : records.filter(r => r.source === source);
}
/** The newest listen, used as "now" so imported history that ends in the past still has a useful 4-week view. */
export function latestListen(records) {
  let latest = 0;
  for (const r of records) if (r.endedAt > latest) latest = r.endedAt;
  return latest;
}
function windowOf(range, now) {
  const days = RANGES[range]?.days;
  if (days === undefined) throw new Error('Unknown range: ' + range);
  return days === null ? {from: -Infinity, to: Infinity} : {from: now - days * DAY, to: now};
}
function inWindow(records, {from, to}) {
  return records.filter(r => r.endedAt > from && r.endedAt <= to);
}

function rankTracks(records) {
  const map = new Map();
  for (const r of records) {
    const key = r.spotifyId || JSON.stringify([r.artist.toLowerCase(), r.title.toLowerCase()]);
    const t = map.get(key) || {key, title: r.title, artist: r.artist, spotifyId: r.spotifyId || '', cover: r.cover || '', plays: 0, ms: 0, lastPlayed: 0};
    if (!t.cover && r.cover) t.cover = r.cover;
    t.ms += r.ms; if (r.ms >= PLAY_MS) t.plays++; if (r.endedAt > t.lastPlayed) t.lastPlayed = r.endedAt;
    if (!t.spotifyId && r.spotifyId) t.spotifyId = r.spotifyId;
    map.set(key, t);
  }
  return [...map.values()].sort((a, b) => b.plays - a.plays || b.ms - a.ms || a.title.localeCompare(b.title));
}
function rankArtists(records) {
  const map = new Map();
  for (const r of records) {
    const key = r.artist.toLowerCase();
    const a = map.get(key) || {key, name: r.artist, plays: 0, ms: 0, tracks: new Set(), lastPlayed: 0};
    a.ms += r.ms; if (r.ms >= PLAY_MS) a.plays++; a.tracks.add(r.title.toLowerCase()); if (r.endedAt > a.lastPlayed) a.lastPlayed = r.endedAt;
    map.set(key, a);
  }
  return [...map.values()].map(({tracks, ...a}) => ({...a, uniqueTracks: tracks.size}))
    .sort((a, b) => b.plays - a.plays || b.ms - a.ms || a.name.localeCompare(b.name));
}

/** Rank movement versus the previous window of the same length: a number (+ moved up), 'new', or null for all time. */
function withChanges(current, previous, limit) {
  const before = previous ? new Map(previous.map((item, i) => [item.key, i + 1])) : null;
  return current.slice(0, limit).map((item, i) => {
    const rank = i + 1, old = before?.get(item.key);
    return {...item, rank, change: before ? (old ? old - rank : 'new') : null};
  });
}
function top(rankFn, records, {range = 'short', source = 'all', limit = 50, now} = {}) {
  const pool = bySource(records, source), at = now ?? latestListen(pool);
  const win = windowOf(range, at);
  const current = rankFn(inWindow(pool, win));
  const days = RANGES[range].days;
  const previous = days === null ? null : rankFn(inWindow(pool, {from: win.from - days * DAY, to: win.from}));
  return withChanges(current, previous && previous.length ? previous : null, limit);
}
export const topTracks = (records, options) => top(rankTracks, records, options);
export const topArtists = (records, options) => top(rankArtists, records, options);

export function recentlyPlayed(records, {source = 'all', limit = 50} = {}) {
  return bySource(records, source).filter(r => r.ms >= PLAY_MS)
    .sort((a, b) => b.endedAt - a.endedAt).slice(0, limit)
    .map(({artist, title, spotifyId, cover, endedAt, ms, source: from}) => ({artist, title, spotifyId, cover: cover || '', endedAt, ms, source: from}));
}

/** Minutes by hour of day (0–23) and weekday (0 = Sunday), in the device's time zone. */
export function listeningClock(records, {range = 'long', source = 'all', now} = {}) {
  const pool = bySource(records, source), win = windowOf(range, now ?? latestListen(pool));
  const hours = Array(24).fill(0), weekdays = Array(7).fill(0);
  for (const r of inWindow(pool, win)) {
    const d = new Date(r.endedAt - r.ms / 2); // Middle of the listen.
    hours[d.getHours()] += r.ms / 60000; weekdays[d.getDay()] += r.ms / 60000;
  }
  const peak = hours.indexOf(Math.max(...hours));
  return {hours, weekdays, peakHour: hours[peak] ? peak : null};
}

const dayKey = t => new Date(t).toLocaleDateString('en-CA');
export function streaks(records, {source = 'all'} = {}) {
  const days = [...new Set(bySource(records, source).filter(r => r.ms >= PLAY_MS).map(r => dayKey(r.endedAt)))].sort();
  let longest = 0, run = 0, prev = null;
  for (const d of days) {
    run = prev && Date.parse(d) - Date.parse(prev) === DAY ? run + 1 : 1;
    longest = Math.max(longest, run); prev = d;
  }
  return {longest, current: run, lastDay: prev};
}

/** One call for the Rewind "Top" screen. */
export function statsOverview(records, {range = 'short', source = 'all', limit = 50, now} = {}) {
  const pool = bySource(records, source), at = now ?? latestListen(pool), win = windowOf(range, at);
  const listens = inWindow(pool, win);
  const minutes = listens.reduce((n, r) => n + r.ms, 0) / 60000;
  return {
    range, label: RANGES[range].label, source, asOf: at || null,
    minutes, plays: listens.filter(r => r.ms >= PLAY_MS).length,
    tracks: topTracks(pool, {range, source: 'all', limit, now: at}),
    artists: topArtists(pool, {range, source: 'all', limit, now: at}),
    recent: recentlyPlayed(pool, {limit: 20}),
    clock: listeningClock(pool, {range, source: 'all', now: at}),
    streaks: streaks(pool),
  };
}
