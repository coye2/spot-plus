// /mono: Monochrome's lossless audio with an honest label. Monochrome sends FLAC as application/octet-stream,
// which Safari may refuse to play; this passes the bytes (and the Range the player asked for) straight
// through, natively piped, labelled audio/flac. No YouTube involved, so no bot checks.
const MONO = 'https://tracks.monochrome.st/track/';
const fail = (status, error) => new Response(JSON.stringify({error}), {status, headers: {'Content-Type': 'application/json', 'Cache-Control': 'no-store'}});

const SEARCH = 'https://tracks.monochrome.st/search/tracks?q=';

export async function monochromeAudio(request, {fetcher = fetch} = {}) {
  const url = new URL(request.url);
  // /mono?q=…: Monochrome's search sends no CORS header, so browsers can't read it directly.
  const q = (url.searchParams.get('q') || '').trim();
  if (q) {
    if (q.length > 200) return fail(400, 'Search too long');
    const r = await fetcher(SEARCH + encodeURIComponent(q), {headers: {Accept: 'application/json'}});
    if (!r.ok) return fail(502, 'Monochrome search unavailable (' + r.status + ')');
    const data = await r.json().catch(() => null);
    const tracks = (Array.isArray(data?.tracks) ? data.tracks : []).slice(0, 15).map((t) => ({id: String(t.id || ''), title: String(t.title || ''),
      artistNames: Array.isArray(t.artistNames) ? t.artistNames.map(String).slice(0, 6) : [], duration: Number(t.duration) || 0, playable: t.playable !== false}));
    return new Response(JSON.stringify({tracks}), {headers: {'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=3600'}});
  }
  const id = url.searchParams.get('id') || '';
  if (!/^\d{6,24}$/.test(id)) return fail(400, 'Provide a Monochrome track id');
  const range = request.headers.get('Range');
  const upstream = await fetcher(MONO + id, {headers: range ? {Range: range} : {}, redirect: 'follow'});
  if (!upstream.ok) return fail(502, 'Monochrome refused the audio (' + upstream.status + ')');
  const headers = new Headers({'Content-Type': 'audio/flac', 'Accept-Ranges': 'bytes', 'Cache-Control': 'private, max-age=3600', 'X-Spotplus-Source': 'monochrome'});
  for (const name of ['Content-Range', 'Content-Length']) { const v = upstream.headers.get(name); if (v) headers.set(name, v); }
  return new Response(upstream.body, {status: upstream.status, headers});
}
