// /wallpapers: searches all of Alpha Coders (free text or a tag) and returns one page of wallpapers shaped
// for the device: landscape desktop wallpapers, or (device=phone) portrait phone wallpapers, which Alpha
// Coders keeps on a separate page per tag. Results are cached at Cloudflare's edge.
const headers = {'Content-Type':'application/json; charset=utf-8','X-Content-Type-Options':'nosniff'};
const reply = (data,status=200,maxAge=0) => new Response(JSON.stringify(data),{status,headers:{...headers,'Cache-Control':maxAge?'public, max-age='+maxAge:'no-store'}});
const SITE = 'https://alphacoders.com';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';
const decode = s => String(s||'').replace(/&#0*39;|&apos;/g,"'").replace(/&quot;/g,'"').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&amp;/g,'&');
const meta = (block, prop) => decode((block.match(new RegExp('itemprop="'+prop+'" content="([^"]*)"'))||[])[1]||'');

const slugOf = s => String(s||'').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'').slice(0,80);
const tagsOf = block => meta(block,'keywords').split(',').map(x=>x.trim()).filter(x=>x && !/wallpaper|background|^hd$|ultra hd|^4k|^8k|^5k|^i?phone$|^mobile$/i.test(x));

/** Wallpapers for one kind of screen. Desktop: landscape files (images*.alphacoders.com). Phone: phone
 *  wallpapers (mfiles.alphacoders.com) and any portrait art. Avatars and GIFs are always skipped. */
export function parseWallpapers(html, {device = 'desktop'} = {}) {
  const out = [], seen = new Set();
  for (const block of String(html||'').split('itemprop="associatedMedia"').slice(1)) {
    const m = meta(block,'contentUrl').match(/^https:\/\/(images\d*|mfiles)\.alphacoders\.com\/(\d+)\/(\d+)\.(jpe?g|png|webp)$/i);
    if (!m || seen.has(m[3])) continue;
    seen.add(m[3]);
    const w = Number(meta(block,'width'))||0, h = Number(meta(block,'height'))||0;
    const portrait = m[1] === 'mfiles' || (w > 0 && h > w);
    const landscape = m[1] !== 'mfiles' && !(w && h && w < h);
    if (device === 'phone' ? !portrait : !landscape) continue;
    const name = meta(block,'name').replace(/\s*[-–|]\s*(Download Free )?HD Wallpaper$/i,'').replace(/\s+(i?Phone|Mobile)\s+Wallpaper$/i,'');
    out.push({id:m[3],host:m[1],folder:m[2],ext:m[4].toLowerCase(),name:name.slice(0,140)||'Wallpaper',w,h,category:tagsOf(block)[0]||'Alpha Coders'});
  }
  return out;
}

/** The tag most of a free-text search's results share: its phone page stands in for the search on phones. */
export function commonTag(html) {
  const count = new Map();
  for (const block of String(html||'').split('itemprop="associatedMedia"').slice(1)) {
    for (const tag of new Set(tagsOf(block).map(slugOf))) if (tag) count.set(tag, (count.get(tag)||0) + 1);
  }
  return [...count].sort((a, b) => b[1] - a[1])[0]?.[0] || '';
}

export async function wallpapers(request, {fetcher = fetch, cache, waitUntil = () => {}} = {}) {
  const url = new URL(request.url);
  const q = (url.searchParams.get('q') || '').replace(/\s+/g,' ').trim().toLowerCase();
  const page = Math.max(1, Math.min(200, Number(url.searchParams.get('page')) || 1));
  const device = url.searchParams.get('device') === 'phone' ? 'phone' : 'desktop';
  if (q.length < 2 || q.length > 80) return reply({error:'Type at least two letters'},400);
  const key = new Request(url.origin + '/wallpapers?q=' + encodeURIComponent(q) + '&page=' + page + (device === 'phone' ? '&device=phone' : ''));
  const cached = await cache?.match(key); if (cached) return cached;
  const get = async (target) => {
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 6000);
    try { return await fetcher(target,{signal:controller.signal,redirect:'manual',headers:{'User-Agent':UA,'Accept':'text/html'}}); }
    finally { clearTimeout(timer); }
  };
  const read = async (response) => {
    if (!response.ok) return null;
    const html = await response.text();
    return html.length > 4_000_000 ? null : html;
  };
  try {
    let response = await get(SITE + '/search/view?q=' + encodeURIComponent(q) + (device === 'phone' ? '' : '&page=' + page));
    // An exact tag redirects to its own page, which drops the page number; ask the tag page directly.
    const moved = response.headers.get('location') || '';
    let slug = '';
    if (response.status >= 300 && response.status < 400) {
      slug = (new URL(moved, SITE).pathname.match(/^\/([a-z0-9-]{1,80})$/) || [])[1] || '';
      if (!slug) return reply({error:'Search unavailable'},502);
      if (device === 'desktop') response = await get(SITE + '/' + slug + '?page=' + page);
    }
    let html = null;
    if (device === 'phone') {
      // Phone wallpapers live on "<tag>-phone-wallpapers". Free text that is not a tag: try it as a tag,
      // then the tag most of its results share.
      const searched = slug ? null : await read(response);
      for (const tag of [...new Set([slug || slugOf(q), searched ? commonTag(searched) : ''])].filter(Boolean)) {
        const phonePage = await get(SITE + '/' + tag + '-phone-wallpapers?page=' + page);
        const found = phonePage.status === 200 ? await read(phonePage) : null;
        if (found && parseWallpapers(found, {device}).length) { html = found; break; }
      }
      if (!html) html = searched || '';
    } else {
      html = await read(response);
      if (html === null) return reply({error:'Search unavailable'},503);
    }
    const items = parseWallpapers(html, {device});
    // Raw page size before filtering tells the app whether another page exists.
    const raw = (html.match(/itemprop="associatedMedia"/g) || []).length;
    const more = device === 'phone' ? items.length >= 15 : raw >= 15;
    const result = reply({q, page, device, items, more}, 200, items.length ? 86400 : 3600);
    if (cache) waitUntil(cache.put(key, result.clone()).catch(() => {}));
    return result;
  } catch { return reply({error:'Search unavailable'},503); }
}
