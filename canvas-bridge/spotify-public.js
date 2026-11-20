// Public Spotify pages, read without any login: a playlist's tracks (including a
// listener's own "On Repeat", "Repeat Rewind", "Your Top Songs" and daylist, which are
// viewable by link) and a user's public profile (name, photo, public playlists).
// Only these two page types, only open.spotify.com, only parsed fields come back.
import {boundedText} from './spotify-stats.js';
const headers = {'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json; charset=utf-8', 'X-Content-Type-Options': 'nosniff'};
const json = (data, status = 200, age = 0) => new Response(JSON.stringify(data), {status, headers: {...headers, 'Cache-Control': age ? 'public, max-age=' + age : 'no-store'}});
const id22 = value => /^[A-Za-z0-9]{22}$/.test(value || '');
const username = value => /^[A-Za-z0-9._-]{1,64}$/.test(value || '');
const str = (value, max = 300) => typeof value === 'string' ? value.replace(/ /g, ' ').slice(0, max) : '';
const safeImage = url => { try { const u = new URL(url); return u.protocol === 'https:' && /(^|\.)(scdn\.co|spotifycdn\.com)$/.test(u.hostname) ? u.href : ''; } catch { return ''; } };
const image = sources => (Array.isArray(sources) ? sources : []).filter(s => safeImage(s?.url)).sort((a, b) => (b?.width || b?.maxWidth || 0) - (a?.width || a?.maxWidth || 0)).map(s => safeImage(s.url))[0] || '';

const embedEntity = (html) => {
  const raw = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/)?.[1];
  try { return raw ? JSON.parse(raw)?.props?.pageProps?.state?.data?.entity : null; } catch { return null; }
};
/** One song from its Spotify embed page: name, artists (with their Spotify IDs), length and cover. */
export function trackFromEmbed(html) {
  const e = embedEntity(html);
  if (!e || e.type !== 'track' || !id22(e.id)) return null;
  const artists = (Array.isArray(e.artists) ? e.artists : []).filter(a => a?.name);
  return {spotifyId: e.id, title: str(e.title || e.name), artist: artists.map(a => str(a.name, 120)).join(', '),
    artistIds: artists.map(a => String(a.uri || '').split(':')[2]).filter(id22), duration: Math.round((Number(e.duration) || 0) / 1000),
    explicit: !!e.isExplicit, cover: image(e.visualIdentity?.image), year: Number(String(e.releaseDate?.isoString || '').slice(0, 4)) || 0};
}
export function playlistFromEmbed(html) {
  const e = embedEntity(html);
  // Albums use the same shape as playlists on Spotify's embed pages.
  if (!e || (e.type !== 'playlist' && e.type !== 'album')) return null;
  return {
    type: e.type, id: str(e.id, 22), name: str(e.name, 200), owner: str(e.subtitle, 200), cover: image(e.coverArt?.sources) || image(e.visualIdentity?.image),
    tracks: (Array.isArray(e.trackList) ? e.trackList : []).slice(0, 100).map(t => {
      const spotifyId = String(t?.uri || '').split(':')[2];
      return id22(spotifyId) && t.title ? {spotifyId, title: str(t.title), artist: str(t.subtitle), duration: Math.round((Number(t.duration) || 0) / 1000), explicit: !!t.isExplicit} : null;
    }).filter(Boolean),
  };
}
export function profileFromPage(html, user) {
  const encoded = html.match(/<script[^>]*id="initialState"[^>]*>([^<]+)<\/script>/)?.[1];
  if (!encoded) return null;
  const bytes = Uint8Array.from(atob(encoded), c => c.charCodeAt(0));
  const u = JSON.parse(new TextDecoder().decode(bytes))?.entities?.items?.['spotify:user:' + user];
  if (!u) return null;
  return {
    id: user, name: str(u.name, 120), avatar: image(u.avatar?.sources),
    playlists: (u.publicPlaylistsV2?.items || []).slice(0, 60).map(p => {
      const id = String(p?._uri || p?.data?.uri || '').split(':')[2];
      return id22(id) ? {id, name: str(p.data?.name, 200), cover: image(p.data?.images?.items?.[0]?.sources), followers: Number(p.data?.followers) || 0} : null;
    }).filter(Boolean),
  };
}
function initialState(html) {
  const encoded = html.match(/<script[^>]*id="initialState"[^>]*>([^<]+)<\/script>/)?.[1];
  if (!encoded) return null;
  try { return JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(encoded), c => c.charCodeAt(0)))); } catch { return null; }
}
const idOf = (uri, type) => { const [, kind, id] = String(uri || '').split(':'); return kind === type && id22(id) ? id : ''; };
const release = r => { const x = r?.releases?.items?.[0] || r; const id = idOf(x?.uri, 'album'); return id ? {id, title: str(x.name, 200), cover: image(x.coverArt?.sources), year: Number(x.date?.year) || 0, type: str(x.type, 20).toLowerCase()} : null; };
const artistRef = a => { const d = a?.data || a; const id = idOf(d?.uri, 'artist'); return id ? {id, name: str(d.profile?.name, 120), picture: image(d.visuals?.avatarImage?.sources)} : null; };
/** A Spotify artist's public page: photo, monthly listeners, followers, popular songs, releases, related artists. */
export function artistFromPage(html, id) {
  const a = initialState(html)?.entities?.items?.['spotify:artist:' + id];
  if (!a?.profile) return null;
  const d = a.discography || {};
  const list = (x, fn, n = 50) => (x?.items || []).slice(0, n).map(fn).filter(Boolean);
  return {
    id, name: str(a.profile.name, 120), picture: image(a.visuals?.avatarImage?.sources), header: image(a.visuals?.headerImage?.sources),
    monthlyListeners: Number(a.stats?.monthlyListeners) || 0, followers: Number(a.stats?.followers) || 0, worldRank: Number(a.stats?.worldRank) || 0,
    bio: str(a.profile.biography?.text, 1500).replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'"),
    verified: !!a.profile.verified,
    top: list(d.topTracks, t => { const x = t?.track; const tid = idOf(x?.uri, 'track'); return tid ? {spotifyId: tid, title: str(x.name), plays: Number(x.playcount) || 0, duration: Math.round((Number(x.duration?.totalMilliseconds) || 0) / 1000), explicit: x.contentRating?.label === 'EXPLICIT',
      artist: (x.artists?.items || []).map(y => str(y.profile?.name, 120)).filter(Boolean).join(', '), artistIds: (x.artists?.items || []).map(y => idOf(y.uri, 'artist')).filter(Boolean), cover: image(x.albumOfTrack?.coverArt?.sources), album: idOf(x.albumOfTrack?.uri, 'album')} : null; }, 10),
    popular: list(d.popularReleasesAlbums, release), albums: list(d.albums, release), singles: list(d.singles, release), compilations: list(d.compilations, release),
    related: list(a.relatedContent?.relatedArtists, artistRef, 20),
    appearsOn: list(a.relatedContent?.appearsOn, release, 20),
    playlists: list(a.profile.playlistsV2, p => { const x = p?.data || p; const pid = idOf(x?.uri, 'playlist'); return pid ? {id: pid, title: str(x.name, 200), cover: image(x.images?.items?.[0]?.sources), by: str(x.ownerV2?.data?.name, 120)} : null; }, 12),
  };
}
/** The full playlist page: who made it (name, username, photo) and each song's artist IDs. */
export function playlistDetails(html, id) {
  const p = initialState(html)?.entities?.items?.['spotify:playlist:' + id];
  if (!p) return null;
  const owner = p.ownerV2?.data || {};
  const songs = {};
  for (const it of p.content?.items || []) {
    const t = it?.itemV2?.data; const tid = idOf(t?.uri, 'track');
    if (!tid) continue;
    songs[tid] = {artistIds: (t.artists?.items || []).map(y => idOf(y.uri, 'artist')).filter(Boolean).slice(0, 10), album: str(t.albumOfTrack?.name, 200), albumId: idOf(t.albumOfTrack?.uri, 'album'), cover: image(t.albumOfTrack?.coverArt?.sources),
      ...(it.addedBy?.data?.name ? {addedBy: {name: str(it.addedBy.data.name, 120), id: String(it.addedBy.data.uri || '').split(':')[2] || '', avatar: image(it.addedBy.data.avatar?.sources)}} : {})};
  }
  return {owner: str(owner.name, 120), ownerId: username(String(owner.uri || '').split(':')[2]) ? String(owner.uri).split(':')[2] : '', ownerAvatar: image(owner.avatar?.sources),
    description: str(p.description, 500).replace(/<[^>]+>/g, ''), followers: Number(p.followers) || 0, total: Number(p.content?.totalCount) || 0, songs};
}
export async function spotifyPublic(request, {fetcher = fetch, cache, waitUntil = () => {}} = {}) {
  const params = new URL(request.url).searchParams, playlist = params.get('playlist'), user = params.get('user'), artist = params.get('artist'), track = params.get('track'), album = params.get('album');
  if ([playlist, user, artist, track, album].filter(Boolean).length !== 1 || [playlist, artist, track, album].some(v => v && !id22(v)) || (user && !username(user))) return json({error: 'Provide one Spotify playlist, album, track or artist ID, or a username'}, 400);
  const which = playlist ? 'playlist=' + playlist : artist ? 'artist=' + artist : track ? 'track=' + track : album ? 'album=' + album : 'user=' + user;
  const key = new Request(new URL(request.url).origin + '/spotify-public?v=2&' + which);
  const hit = await cache?.match(key); if (hit) return hit;
  const url = playlist ? 'https://open.spotify.com/embed/playlist/' + playlist : artist ? 'https://open.spotify.com/artist/' + artist : track ? 'https://open.spotify.com/embed/track/' + track : album ? 'https://open.spotify.com/embed/album/' + album : 'https://open.spotify.com/user/' + encodeURIComponent(user);
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 9000);
  try {
    const response = await fetcher(url, {signal: controller.signal, redirect: 'manual', headers: {Accept: 'text/html', 'User-Agent': 'Mozilla/5.0 (compatible; SpotPlus/2.0; +https://coye2.github.io/spot-plus/)'}});
    if (response.status === 404) return json({error: 'Not found'}, 404, 600);
    if (!response.ok) return json({error: 'Spotify unavailable'}, 503);
    const html = await boundedText(response, 2500000);
    let data = playlist || album ? playlistFromEmbed(html) : artist ? artistFromPage(html, artist) : track ? trackFromEmbed(html) : profileFromPage(html, user);
    if (!data) return json({error: playlist ? 'That playlist isn’t viewable by link' : album ? 'That album couldn’t be read' : track ? 'That song couldn’t be read' : artist ? 'That artist page couldn’t be read' : 'That profile isn’t public'}, 404, 600);
    if (playlist) {
      // The embed has the song list; the full page adds the creator and each song's artists (best effort).
      const page = await fetcher('https://open.spotify.com/playlist/' + playlist, {signal: controller.signal, redirect: 'manual', headers: {Accept: 'text/html', 'User-Agent': 'Mozilla/5.0 (compatible; SpotPlus/2.0; +https://coye2.github.io/spot-plus/)'}})
        .then(r => r.ok ? boundedText(r, 3000000) : '').catch(() => '');
      const more = page ? playlistDetails(page, playlist) : null;
      if (more) data = {...data, owner: more.owner || data.owner, ownerId: more.ownerId, ownerAvatar: more.ownerAvatar, description: more.description, followers: more.followers, total: more.total,
        tracks: data.tracks.map(t => ({...t, ...(more.songs[t.spotifyId] || {})}))};
    }
    // Personal playlists change daily; artist pages hourly-ish; profiles rarely.
    const result = json(data, 200, playlist ? 1800 : artist ? 3600 : 21600);
    if (cache) waitUntil(cache.put(key, result.clone()).catch(() => {}));
    return result;
  } catch { return json({error: 'Spotify unavailable'}, 503); }
  finally { clearTimeout(timer); }
}
