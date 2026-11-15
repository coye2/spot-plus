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
const image = sources => (Array.isArray(sources) ? sources : []).filter(s => safeImage(s?.url)).sort((a, b) => (b?.width || 0) - (a?.width || 0)).map(s => safeImage(s.url))[0] || '';

export function playlistFromEmbed(html) {
  const raw = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/)?.[1];
  if (!raw) return null;
  const e = JSON.parse(raw)?.props?.pageProps?.state?.data?.entity;
  if (!e || e.type !== 'playlist') return null;
  return {
    id: str(e.id, 22), name: str(e.name, 200), owner: str(e.subtitle, 200), cover: image(e.coverArt?.sources),
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
export async function spotifyPublic(request, {fetcher = fetch, cache, waitUntil = () => {}} = {}) {
  const params = new URL(request.url).searchParams, playlist = params.get('playlist'), user = params.get('user');
  if (!!playlist === !!user || (playlist && !id22(playlist)) || (user && !username(user))) return json({error: 'Provide one playlist ID or username'}, 400);
  const key = new Request(new URL(request.url).origin + '/spotify-public?' + (playlist ? 'playlist=' + playlist : 'user=' + user));
  const hit = await cache?.match(key); if (hit) return hit;
  const url = playlist ? 'https://open.spotify.com/embed/playlist/' + playlist : 'https://open.spotify.com/user/' + encodeURIComponent(user);
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 9000);
  try {
    const response = await fetcher(url, {signal: controller.signal, redirect: 'manual', headers: {Accept: 'text/html', 'User-Agent': 'Mozilla/5.0 (compatible; SpotPlus/2.0; +https://coye2.github.io/spot-plus/)'}});
    if (response.status === 404) return json({error: 'Not found'}, 404, 600);
    if (!response.ok) return json({error: 'Spotify unavailable'}, 503);
    const html = await boundedText(response, 2500000);
    const data = playlist ? playlistFromEmbed(html) : profileFromPage(html, user);
    if (!data) return json({error: playlist ? 'That playlist isn’t viewable by link' : 'That profile isn’t public'}, 404, 600);
    // Personal playlists change daily; profiles change rarely.
    const result = json(data, 200, playlist ? 1800 : 21600);
    if (cache) waitUntil(cache.put(key, result.clone()).catch(() => {}));
    return result;
  } catch { return json({error: 'Spotify unavailable'}, 503); }
  finally { clearTimeout(timer); }
}
