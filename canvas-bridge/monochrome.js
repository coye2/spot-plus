// /mono: Monochrome's lossless audio with an honest label. Monochrome sends FLAC as application/octet-stream,
// which Safari may refuse to play; this passes the bytes (and the Range the player asked for) straight
// through, natively piped, labelled audio/flac. No YouTube involved, so no bot checks.
const MONO = 'https://tracks.monochrome.st/track/';
const fail = (status, error) => new Response(JSON.stringify({error}), {status, headers: {'Content-Type': 'application/json', 'Cache-Control': 'no-store'}});

export async function monochromeAudio(request, {fetcher = fetch} = {}) {
  const id = new URL(request.url).searchParams.get('id') || '';
  if (!/^\d{6,24}$/.test(id)) return fail(400, 'Provide a Monochrome track id');
  const range = request.headers.get('Range');
  const upstream = await fetcher(MONO + id, {headers: range ? {Range: range} : {}, redirect: 'follow'});
  if (!upstream.ok) return fail(502, 'Monochrome refused the audio (' + upstream.status + ')');
  const headers = new Headers({'Content-Type': 'audio/flac', 'Accept-Ranges': 'bytes', 'Cache-Control': 'private, max-age=3600', 'X-Spotplus-Source': 'monochrome'});
  for (const name of ['Content-Range', 'Content-Length']) { const v = upstream.headers.get(name); if (v) headers.set(name, v); }
  return new Response(upstream.body, {status: upstream.status, headers});
}
