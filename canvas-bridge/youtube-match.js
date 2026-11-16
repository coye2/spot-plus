// /match: finds YouTube recordings for a song with one fast search, cached at Cloudflare's edge
// so every Spot+ user after the first gets the answer instantly. Returns candidates only;
// the app still checks each match itself before playing it.
const headers = {'Content-Type':'application/json; charset=utf-8','X-Content-Type-Options':'nosniff'};
const reply = (data,status=200,maxAge=0) => new Response(JSON.stringify(data),{status,headers:{...headers,'Cache-Control':maxAge?'public, max-age='+maxAge:'no-store'}});
const SEARCH = 'https://www.youtube.com/youtubei/v1/search?prettyPrint=false';
const seconds = text => String(text||'').split(':').reduce((n,p)=>n*60+(Number(p)||0),0);

export function parseSearch(data, limit = 8) {
  const out = [];
  const walk = node => {
    if (out.length >= limit || !node || typeof node !== 'object') return;
    if (Array.isArray(node)) { for (const item of node) walk(item); return; }
    const r = node.videoRenderer;
    if (r?.videoId && /^[\w-]{11}$/.test(r.videoId)) {
      out.push({
        id: r.videoId,
        title: r.title?.runs?.[0]?.text || '',
        channel: (r.ownerText || r.longBylineText)?.runs?.[0]?.text || '',
        duration: seconds(r.lengthText?.simpleText),
        verified: Array.isArray(r.ownerBadges) && r.ownerBadges.length > 0,
      });
      return;
    }
    for (const value of Object.values(node)) walk(value);
  };
  walk(data?.contents);
  return out.filter(x => x.title && x.duration > 0);
}

export async function youtubeMatch(request, {fetcher = fetch, cache, waitUntil = () => {}} = {}) {
  const url = new URL(request.url);
  const q = (url.searchParams.get('q') || '').replace(/\s+/g,' ').trim();
  if (q.length < 2 || q.length > 200) return reply({error:'Provide a song and artist'},400);
  const key = new Request(url.origin + '/match?q=' + encodeURIComponent(q.toLowerCase()));
  const cached = await cache?.match(key); if (cached) return cached;
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 4000);
  try {
    const response = await fetcher(SEARCH, {method:'POST',signal:controller.signal,redirect:'manual',headers:{'Content-Type':'application/json'},
      body: JSON.stringify({context:{client:{clientName:'WEB',clientVersion:'2.20251110.01.00',hl:'en',gl:'US'}},query:q + ' audio'})});
    if (!response.ok) return reply({error:'Search unavailable'},503);
    const text = await response.text();
    if (text.length > 3_000_000) return reply({error:'Search unavailable'},502);
    const items = parseSearch(JSON.parse(text));
    const result = reply({items}, 200, items.length ? 7 * 86400 : 3600);
    if (cache) waitUntil(cache.put(key, result.clone()).catch(() => {}));
    return result;
  } catch { return reply({error:'Search unavailable'},503); }
  finally { clearTimeout(timer); }
}
