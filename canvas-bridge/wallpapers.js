// /wallpapers: searches all of Alpha Coders (free text or a tag) and returns one page of desktop
// wallpapers with the fields the app's picker needs. Results are cached at Cloudflare's edge.
const headers = {'Content-Type':'application/json; charset=utf-8','X-Content-Type-Options':'nosniff'};
const reply = (data,status=200,maxAge=0) => new Response(JSON.stringify(data),{status,headers:{...headers,'Cache-Control':maxAge?'public, max-age='+maxAge:'no-store'}});
const SITE = 'https://alphacoders.com';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';
const decode = s => String(s||'').replace(/&#0*39;|&apos;/g,"'").replace(/&quot;/g,'"').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&amp;/g,'&');
const meta = (block, prop) => decode((block.match(new RegExp('itemprop="'+prop+'" content="([^"]*)"'))||[])[1]||'');

/** Desktop wallpapers only (images*.alphacoders.com); avatars, GIFs, and phone files are skipped. */
export function parseWallpapers(html) {
  const out = [], seen = new Set();
  for (const block of String(html||'').split('itemprop="associatedMedia"').slice(1)) {
    const m = meta(block,'contentUrl').match(/^https:\/\/(images\d*)\.alphacoders\.com\/(\d+)\/(\d+)\.(jpe?g|png|webp)$/i);
    if (!m || seen.has(m[3])) continue;
    seen.add(m[3]);
    const w = Number(meta(block,'width'))||0, h = Number(meta(block,'height'))||0;
    if (w && h && w < h) continue; // portrait art does not fit the app's landscape crop
    const tags = meta(block,'keywords').split(',').map(x=>x.trim()).filter(x=>x && !/wallpaper|background|^hd$|ultra hd|^4k|^8k|^5k/i.test(x));
    out.push({id:m[3],host:m[1],folder:m[2],ext:m[4].toLowerCase(),name:meta(block,'name').replace(/\s*[-–|]\s*(Download Free )?HD Wallpaper$/i,'').slice(0,140)||'Wallpaper',w,h,category:tags[0]||'Alpha Coders'});
  }
  return out;
}

export async function wallpapers(request, {fetcher = fetch, cache, waitUntil = () => {}} = {}) {
  const url = new URL(request.url);
  const q = (url.searchParams.get('q') || '').replace(/\s+/g,' ').trim().toLowerCase();
  const page = Math.max(1, Math.min(200, Number(url.searchParams.get('page')) || 1));
  if (q.length < 2 || q.length > 80) return reply({error:'Type at least two letters'},400);
  const key = new Request(url.origin + '/wallpapers?q=' + encodeURIComponent(q) + '&page=' + page);
  const cached = await cache?.match(key); if (cached) return cached;
  const get = async (target) => {
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 6000);
    try { return await fetcher(target,{signal:controller.signal,redirect:'manual',headers:{'User-Agent':UA,'Accept':'text/html'}}); }
    finally { clearTimeout(timer); }
  };
  try {
    let response = await get(SITE + '/search/view?q=' + encodeURIComponent(q) + '&page=' + page);
    // An exact tag redirects to its own page, which drops the page number; ask the tag page directly.
    const moved = response.headers.get('location') || '';
    if (response.status >= 300 && response.status < 400) {
      const slug = (new URL(moved, SITE).pathname.match(/^\/([a-z0-9-]{1,80})$/) || [])[1];
      if (!slug) return reply({error:'Search unavailable'},502);
      response = await get(SITE + '/' + slug + '?page=' + page);
    }
    if (!response.ok) return reply({error:'Search unavailable'},503);
    const html = await response.text();
    if (html.length > 4_000_000) return reply({error:'Search unavailable'},502);
    const items = parseWallpapers(html);
    // Raw page size before filtering tells the app whether another page exists.
    const raw = (html.match(/itemprop="associatedMedia"/g) || []).length;
    const result = reply({q, page, items, more: raw >= 15}, 200, items.length ? 86400 : 3600);
    if (cache) waitUntil(cache.put(key, result.clone()).catch(() => {}));
    return result;
  } catch { return reply({error:'Search unavailable'},503); }
}
