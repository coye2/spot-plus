// /images: more background pictures beside Alpha Coders, with no keys.
//   ?q=words[&device=phone][&page=n]  Wallhaven (safe-for-work wallpapers) and Openverse (openly licensed photos and
//                                      art from Flickr, Wikimedia and others), shaped for the screen.
//   ?link=URL                          one picture from a link you paste: a Pinterest pin, a Google Images result,
//                                      or a direct image address. Only that page's own preview image is read.
// Pinterest and Google have no public search for other apps, so their pictures come in by link.
const headers = {'Content-Type': 'application/json; charset=utf-8', 'X-Content-Type-Options': 'nosniff'};
const reply = (data, status = 200, age = 0) => new Response(JSON.stringify(data), {status, headers: {...headers, 'Cache-Control': age ? 'public, max-age=' + age : 'no-store'}});
const UA = 'SpotPlus/2.0 (+https://coye2.github.io/spot-plus/)';
const httpsUrl = (u) => { try { const x = new URL(u); return x.protocol === 'https:' && !x.username && !x.password ? x.href : ''; } catch { return ''; } };
const text = (v, n = 140) => String(v || '').replace(/\s+/g, ' ').trim().slice(0, n);
const hash = (s) => { let h = 2166136261; for (const c of String(s)) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return (h >>> 0).toString(36); };

export function wallhavenItems(data) {
  return (data?.data || []).map((w) => {
    const full = httpsUrl(w.path), thumb = httpsUrl(w.thumbs?.large || w.thumbs?.original);
    return full && /^[a-z0-9]{1,12}$/.test(w.id || '') ? {src: 'wallhaven', id: 'wh-' + w.id, full, thumb: thumb || full, w: Number(w.dimension_x) || 0, h: Number(w.dimension_y) || 0,
      name: text((w.tags || []).map((t) => t.name).slice(0, 3).join(', ')) || 'Wallhaven ' + w.id, category: 'Wallhaven', page: httpsUrl(w.url)} : null;
  }).filter(Boolean);
}
export function openverseItems(data) {
  return (data?.results || []).map((r) => {
    const full = httpsUrl(r.url), thumb = httpsUrl(r.thumbnail);
    const id = String(r.id || '').replace(/[^a-f0-9]/gi, '').slice(0, 24);
    return full && id ? {src: 'openverse', id: 'ov-' + id, full, thumb: thumb || full, w: Number(r.width) || 0, h: Number(r.height) || 0,
      name: text(r.title) || 'Openverse image', category: text(r.creator ? `Openverse · ${r.creator}` : 'Openverse', 60), page: httpsUrl(r.foreign_landing_url), license: text(r.license, 20)} : null;
  }).filter(Boolean);
}

/** A pasted link → the picture it points at. */
export function linkTarget(raw) {
  const url = httpsUrl(raw.startsWith('http') ? raw : 'https://' + raw);
  if (!url) return null;
  const u = new URL(url);
  // Google Images results carry the picture's address in imgurl=.
  if (/(^|\.)google\.[a-z.]+$/.test(u.hostname)) { const img = httpsUrl(u.searchParams.get('imgurl') || ''); return img ? {kind: 'image', url: img, from: 'Google Images'} : null; }
  if (/(^|\.)pinterest\.[a-z.]+$/.test(u.hostname) && /^\/pin\/[\w-]+\/?$/.test(u.pathname)) return {kind: 'page', url: u.origin + u.pathname, from: 'Pinterest'};
  if (u.hostname === 'pin.it' && /^\/[\w-]{3,20}\/?$/.test(u.pathname)) return {kind: 'page', url: u.href, from: 'Pinterest'};
  if (/\.(jpe?g|png|webp|avif)$/i.test(u.pathname) || u.hostname === 'i.pinimg.com') return {kind: 'image', url: u.href, from: u.hostname === 'i.pinimg.com' ? 'Pinterest' : 'Link'};
  return null;
}
export function ogImage(html) {
  const m = /<meta[^>]+(?:property|name)="og:image"[^>]*content="([^"]+)"/i.exec(html) || /<meta[^>]+content="([^"]+)"[^>]*(?:property|name)="og:image"/i.exec(html);
  const img = httpsUrl((m?.[1] || '').replace(/&amp;/g, '&'));
  // Pinterest's preview is 736 px wide; the same picture at full size lives under /originals/.
  return img.replace(/^https:\/\/i\.pinimg\.com\/\d+x\//, 'https://i.pinimg.com/originals/');
}

export async function images(request, {fetcher = fetch, cache, waitUntil = () => {}} = {}) {
  const url = new URL(request.url);
  const link = (url.searchParams.get('link') || '').trim();
  const q = (url.searchParams.get('q') || '').replace(/\s+/g, ' ').trim().toLowerCase();
  const phone = url.searchParams.get('device') === 'phone';
  const page = Math.max(1, Math.min(50, Number(url.searchParams.get('page')) || 1));
  const get = async (target, accept = 'application/json') => {
    const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), 8000);
    try { return await fetcher(target, {signal: ctl.signal, redirect: 'follow', headers: {'User-Agent': UA, Accept: accept}}); } finally { clearTimeout(timer); }
  };
  if (link) {
    if (link.length > 600) return reply({error: 'That link is too long'}, 400);
    const target = linkTarget(link);
    if (!target) return reply({error: 'Paste a Pinterest pin, a Google Images result, or an image link'}, 400);
    try {
      let img = target.url, title = '';
      if (target.kind === 'page') {
        const r = await get(target.url, 'text/html');
        if (!r.ok) return reply({error: 'That pin couldn’t be opened. It may be private or removed.'}, 404);
        const html = (await r.text()).slice(0, 3_000_000);
        img = ogImage(html);
        title = text(/<meta[^>]+(?:property|name)="og:title"[^>]*content="([^"]+)"/i.exec(html)?.[1]?.replace(/&amp;/g, '&'));
        if (!img) return reply({error: 'No picture found on that pin'}, 404);
      }
      // Make sure it really is a picture (and the full-size one exists; else fall back to the preview).
      let check = await get(img, 'image/*');
      if (!check.ok && /\/originals\//.test(img)) { img = img.replace('/originals/', '/736x/'); check = await get(img, 'image/*'); }
      await check.body?.cancel?.().catch(() => {});
      if (!check.ok || !/^image\//.test(check.headers.get('content-type') || '')) return reply({error: 'That link isn’t a picture we can use'}, 415);
      return reply({items: [{src: target.from === 'Pinterest' ? 'pinterest' : target.from === 'Google Images' ? 'google' : 'link', id: 'ln-' + hash(img), full: img, thumb: img, w: 0, h: 0,
        name: title || `${target.from} picture`, category: target.from, page: target.kind === 'page' ? target.url : ''}]}, 200, 86400);
    } catch { return reply({error: 'That link couldn’t be reached. Try again.'}, 502); }
  }
  if (q.length < 2 || q.length > 80) return reply({error: 'Type at least two letters'}, 400);
  const key = new Request(url.origin + '/images?v=1&q=' + encodeURIComponent(q) + '&page=' + page + (phone ? '&device=phone' : ''));
  const hit = await cache?.match(key); if (hit) return hit;
  const ratios = phone ? '9x16,9x18,9x19.5,9x20,10x16' : '16x9,16x10,21x9';
  const [wh, ov] = await Promise.all([
    get(`https://wallhaven.cc/api/v1/search?q=${encodeURIComponent(q)}&purity=100&categories=111&sorting=relevance&ratios=${ratios}&page=${page}`).then((r) => (r.ok ? r.json() : null)).catch(() => null),
    get(`https://api.openverse.org/v1/images/?q=${encodeURIComponent(q)}&page=${page}&page_size=20&mature=false&size=large&aspect_ratio=${phone ? 'tall' : 'wide'}`).then((r) => (r.ok ? r.json() : null)).catch(() => null),
  ]);
  if (!wh && !ov) return reply({error: 'Image search unavailable'}, 502);
  const a = wallhavenItems(wh).map((x) => (/^Wallhaven /.test(x.name) ? {...x, name: q.replace(/\b\w/g, (c) => c.toUpperCase())} : x)), b = openverseItems(ov), items = [];
  for (let i = 0; i < Math.max(a.length, b.length); i++) { if (a[i]) items.push(a[i]); if (b[i]) items.push(b[i]); }
  const more = (wh?.meta?.last_page || 0) > page || (ov?.page_count || 0) > page;
  const res = reply({items, more}, 200, 21600);
  if (cache) waitUntil(cache.put(key, res.clone()).catch(() => {}));
  return res;
}
