// Last.fm bridge for Rewind. Last.fm's official "Spotify Scrobbling" connection
// records everything a user plays in Spotify on any device. Spot+ reads it back from
// Last.fm's public API (CORS-enabled), so Rewind fills itself with no helper, no
// extension and nothing to install. Users only give Spot+ their Last.fm username.
//
// The API key identifies Spot+ (not the user) and is safe to publish.
export const LASTFM_API_KEY = '';
const API = 'https://ws.audioscrobbler.com/2.0/';
export const LASTFM_PERIODS = Object.freeze({short_term: '1month', medium_term: '6month', long_term: 'overall'});
export const lastfmReady = (key = LASTFM_API_KEY) => /^[a-f0-9]{32}$/.test(key);
export const validLastfmUser = name => /^[A-Za-z][\w-]{1,14}$/.test(String(name || '').trim());

const text = (value, max = 300) => typeof value === 'string' ? value.slice(0, max) : typeof value?.['#text'] === 'string' ? value['#text'].slice(0, max) : '';
const image = list => { const url = Array.isArray(list) ? [...list].reverse().map(i => i?.['#text']).find(u => u && !u.includes('2a96cbd8b46e442fc41c2b86b821562f')) : ''; return /^https:\/\//.test(url || '') ? url : ''; };

export async function call(method, params, {key = LASTFM_API_KEY, fetcher = fetch, signal} = {}) {
  if (!lastfmReady(key)) throw new Error('Last.fm isn’t set up in this version of Spot+ yet.');
  const url = API + '?' + new URLSearchParams({method, api_key: key, format: 'json', ...params});
  const response = await fetcher(url, {signal, credentials: 'omit', referrerPolicy: 'no-referrer'});
  const data = await response.json().catch(() => null);
  if (data?.error === 6) throw new Error('No Last.fm user with that name.');
  if (data?.error === 17) throw new Error('That Last.fm profile is private. Turn off “Hide recent listening” in Last.fm privacy settings.');
  if (data?.error === 29) throw new Error('Last.fm is busy. Try again in a minute.');
  if (!response.ok || !data || data.error) throw new Error(data?.message || 'Last.fm didn’t respond.');
  return data;
}

/** Profile check used when connecting. */
export async function lastfmProfile(user, options) {
  const u = (await call('user.getinfo', {user}, options)).user;
  return {name: text(u?.name, 40), realname: text(u?.realname, 80), playcount: Number(u?.playcount) || 0, avatar: image(u?.image), registered: Number(u?.registered?.unixtime || u?.registered?.['#text']) * 1000 || 0};
}

/** Scrobbles as Rewind history records (newest first). `since` is a ms timestamp. */
export function scrobblesToHistory(tracks) {
  return (Array.isArray(tracks) ? tracks : []).flatMap(t => {
    if (t?.['@attr']?.nowplaying) return [];
    const at = Number(t?.date?.uts) * 1000, artist = text(t?.artist?.name || t?.artist), title = text(t?.name);
    if (!at || !artist || !title) return [];
    // Last.fm doesn't send song length here; a typical track length keeps minutes realistic.
    return [{id: 'lfm:' + at + ':' + artist.toLowerCase() + '|' + title.toLowerCase(), source: 'spotify', endedAt: at, ms: 210000, artist, title, album: text(t?.album), spotifyId: '', cover: image(t?.image), estimated: true}];
  });
}
export async function fetchScrobbles(user, {since = 0, maxPages = 15, onProgress = () => {}, ...options} = {}) {
  const records = []; let nowPlaying = null;
  for (let page = 1; page <= maxPages; page++) {
    const data = await call('user.getrecenttracks', {user, limit: 200, page, extended: 0, ...(since ? {from: Math.floor(since / 1000) + 1} : {})}, options);
    const list = data?.recenttracks?.track; const tracks = Array.isArray(list) ? list : list ? [list] : [];
    if (page === 1) { const np = tracks.find(t => t?.['@attr']?.nowplaying); if (np) nowPlaying = {artist: text(np.artist?.name || np.artist), title: text(np.name), cover: image(np.image)}; }
    records.push(...scrobblesToHistory(tracks));
    const total = Number(data?.recenttracks?.['@attr']?.totalPages) || 1;
    onProgress(Math.min(page, total), total);
    if (page >= total) break;
  }
  return {records, nowPlaying};
}

/** Top tracks/artists for Rewind's three ranges, with Last.fm play counts. */
export async function fetchTopLists(user, options) {
  const top = {};
  for (const [range, period] of Object.entries(LASTFM_PERIODS)) {
    const [tracks, artists] = await Promise.all([
      call('user.gettoptracks', {user, period, limit: 50}, options),
      call('user.gettopartists', {user, period, limit: 50}, options),
    ]);
    top[range] = {
      tracks: (tracks?.toptracks?.track || []).map(t => ({title: text(t.name), artist: text(t.artist?.name), plays: Number(t.playcount) || 0, cover: '', spotifyId: ''})).filter(t => t.title && t.artist),
      artists: (artists?.topartists?.artist || []).map(a => ({name: text(a.name, 200), plays: Number(a.playcount) || 0, cover: '', id: '', genres: []})).filter(a => a.name),
    };
  }
  return top;
}

/* ---------------- Saved connection ---------------- */
const KEY = 'spotplus.lastfm';
export function lastfmState() { try { return JSON.parse(localStorage.getItem(KEY) || 'null'); } catch { return null; } }
export function saveLastfmState(state) { try { if (state) localStorage.setItem(KEY, JSON.stringify(state)); else localStorage.removeItem(KEY); } catch { /* Private mode. */ } }
/** True when scrobbles have stopped for a while, which usually means Last.fm's Spotify link needs reconnecting. */
export function connectionStale(state, now = Date.now()) { return !!state?.lastScrobble && now - state.lastScrobble > 5 * 86400000; }

/** Bring Spot+ up to date with Last.fm. Returns the new history records. */
export async function syncLastfm({saveHistory, onProgress, ...options} = {}) {
  const state = lastfmState(); if (!state?.user) return null;
  const first = !state.lastScrobble;
  const {records, nowPlaying} = await fetchScrobbles(state.user, {since: state.lastScrobble || 0, maxPages: first ? 15 : 5, onProgress, ...options});
  if (records.length) await saveHistory(records);
  let top = state.top;
  if (!state.topAt || Date.now() - state.topAt > 6 * 3600000 || records.length) { try { top = await fetchTopLists(state.user, options); } catch { /* Keep the last lists. */ } }
  const lastScrobble = Math.max(state.lastScrobble || 0, ...records.map(r => r.endedAt));
  saveLastfmState({...state, lastScrobble, nowPlaying, top, topAt: top === state.top ? state.topAt : Date.now(), syncedAt: Date.now()});
  return records;
}
