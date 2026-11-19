// /sc: full songs from SoundCloud's official API (registered app credentials, client_credentials grant).
// Returns a direct audio link the app's own <audio> plays straight from the tap: no ads, no extra tap.
// Off until the secrets SC_CLIENT_ID and SC_CLIENT_SECRET are set on the worker.
const headers = {'Content-Type': 'application/json; charset=utf-8', 'X-Content-Type-Options': 'nosniff'};
const reply = (data, status = 200, maxAge = 0) => new Response(JSON.stringify(data), {status, headers: {...headers, 'Cache-Control': maxAge ? `public, max-age=${maxAge}` : 'no-store'}});
const API = 'https://api.soundcloud.com';
const TOKEN_URL = 'https://secure.soundcloud.com/oauth/token';
const TOKEN_KEY = 'https://soundcloud.internal/token';

const fold = (s) => String(s || '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\([^)]*\)|\[[^\]]*\]/g, ' ').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
const NOT_THE_SONG = /\b(cover|karaoke|instrumental|8d|slowed|sped ?up|nightcore|reverb|bass ?boost|remix|mashup|edit|bootleg|flip|type beat|live)\b/i;

/** Best SoundCloud track for the song: same title, the artist named, a close length, no remix or cover. */
export function pickTrack(items, want) {
  const title = fold(want.title), artists = fold(want.artist).split(' ').filter((w) => w.length > 2);
  const own = `${want.title} ${want.album || ''}`;
  const wantMs = (Number(want.duration) || 0) * 1000;
  const scored = [];
  for (const x of items || []) {
    if (!x || x.access !== 'playable' || x.streamable === false || x.policy === 'SNIP' || x.policy === 'BLOCK') continue;
    const name = fold(x.title), who = fold(`${x.user?.username || ''} ${x.publisher_metadata?.artist || ''} ${x.title}`);
    if (!title || !name.includes(title)) continue;
    if (artists.length && !artists.some((w) => who.includes(w))) continue;
    if (NOT_THE_SONG.test(x.title) && !NOT_THE_SONG.test(own)) continue;
    const ms = Number(x.full_duration || x.duration) || 0;
    if (wantMs && ms && Math.abs(ms - wantMs) > Math.max(6000, wantMs * 0.06)) continue;
    let score = 0;
    if (name === title || name.endsWith(` ${title}`) || name.startsWith(`${title} `)) score += 3;
    if (x.user?.verified || x.publisher_metadata?.artist) score += 2;
    if (wantMs && ms) score += 2 - Math.min(2, Math.abs(ms - wantMs) / 3000);
    score += Math.min(2, Math.log10((Number(x.playback_count) || 0) + 1) / 3);
    scored.push({x, score});
  }
  scored.sort((a, b) => b.score - a.score);
  return scored[0]?.x || null;
}

async function token(env, {fetcher, cache, waitUntil}) {
  const cached = await cache?.match(TOKEN_KEY);
  if (cached) return (await cached.json()).access_token;
  const r = await fetcher(TOKEN_URL, {
    method: 'POST',
    headers: {Authorization: 'Basic ' + btoa(`${env.SC_CLIENT_ID}:${env.SC_CLIENT_SECRET}`), 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json'},
    body: 'grant_type=client_credentials',
  });
  if (!r.ok) throw new Error('SoundCloud sign-in failed (' + r.status + ')');
  const data = await r.json();
  if (!data.access_token) throw new Error('SoundCloud sign-in failed');
  // SoundCloud allows few new tokens per hour, so every worker instance shares one through the edge cache.
  const life = Math.max(60, (Number(data.expires_in) || 3600) - 120);
  if (cache) waitUntil(cache.put(TOKEN_KEY, new Response(JSON.stringify({access_token: data.access_token}), {headers: {'Cache-Control': `max-age=${life}`}})).catch(() => {}));
  return data.access_token;
}

export async function soundcloud(request, {env = {}, fetcher = fetch, cache, waitUntil = () => {}} = {}) {
  if (!env.SC_CLIENT_ID || !env.SC_CLIENT_SECRET) return reply({error: 'SoundCloud is not set up'}, 503, 300);
  const url = new URL(request.url);
  const want = {title: (url.searchParams.get('title') || '').slice(0, 200), artist: (url.searchParams.get('artist') || '').slice(0, 200), album: (url.searchParams.get('album') || '').slice(0, 200), duration: Number(url.searchParams.get('duration')) || 0};
  if (!want.title || !want.artist) return reply({error: 'Title and artist are needed'}, 400);
  const key = new Request(`${url.origin}/sc?v=1&t=${encodeURIComponent(fold(want.title))}&a=${encodeURIComponent(fold(want.artist))}&d=${Math.round(want.duration)}`);
  const hit = await cache?.match(key);
  if (hit) return hit;
  try {
    const auth = {Authorization: 'OAuth ' + await token(env, {fetcher, cache, waitUntil}), Accept: 'application/json'};
    const firstArtist = want.artist.split(/\s*(?:,|&|\bfeat\.?|\bft\.?)\s*/i)[0];
    const search = await fetcher(`${API}/tracks?q=${encodeURIComponent(`${firstArtist} ${want.title}`)}&access=playable&limit=20&linked_partitioning=true`, {headers: auth});
    if (!search.ok) return reply({error: 'SoundCloud search failed'}, 502);
    const found = await search.json();
    const track = pickTrack(found.collection || found, want);
    if (!track) return reply({error: 'Not on SoundCloud'}, 404, 3600);
    const id = track.urn || `soundcloud:tracks:${track.id}`;
    const streams = await fetcher(`${API}/tracks/${encodeURIComponent(id)}/streams`, {headers: auth});
    if (!streams.ok) return reply({error: 'SoundCloud stream unavailable'}, 502);
    const links = await streams.json();
    const api = links.http_mp3_128_url;
    if (!api) return reply({error: 'No progressive stream'}, 404, 3600);
    // The API link needs the token; follow it once here and hand the app the signed CDN link it redirects to.
    const go = await fetcher(api, {headers: auth, redirect: 'manual'});
    const media = go.headers.get('location');
    if (!media || !/^https:\/\//.test(media)) return reply({error: 'SoundCloud stream unavailable'}, 502);
    const expires = Number((media.match(/Expires=(\d+)/) || [])[1]) || 0;
    const ttl = expires ? Math.max(0, Math.min(1800, expires - Math.floor(Date.now() / 1000) - 120)) : 600;
    const result = reply({url: media, mime: 'audio/mpeg', bitrate: 128000, title: track.title, artist: track.publisher_metadata?.artist || track.user?.username || '', duration: Math.round((Number(track.full_duration || track.duration) || 0) / 1000), permalink: track.permalink_url, expires}, 200, ttl);
    if (cache && ttl > 60) waitUntil(cache.put(key, result.clone()).catch(() => {}));
    return result;
  } catch (error) {
    return reply({error: String(error.message || 'SoundCloud unavailable').slice(0, 120)}, 503);
  }
}
