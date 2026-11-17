// Podcasts (Apple Podcasts directory + each show's public RSS feed) and free public-domain
// audiobooks (LibriVox). Returns clean JSON only, never raw pages, and caches at the edge.
const HEADERS = {'Content-Type': 'application/json; charset=utf-8', 'X-Content-Type-Options': 'nosniff'};
const reply = (data, status = 200, maxAge = 0) => new Response(JSON.stringify(data), {status, headers: {...HEADERS, 'Cache-Control': maxAge ? `public, max-age=${maxAge}` : 'no-store'}});
const httpsUrl = u => { try { const x = new URL(u); return ['https:', 'http:'].includes(x.protocol) ? x.href : ''; } catch { return ''; } };
const MAX = 6_000_000;

async function boundedText(response) {
  const reader = response.body?.getReader(); if (!reader) return '';
  const chunks = []; let size = 0;
  for (;;) { const {done, value} = await reader.read(); if (done) break; size += value.length; if (size > MAX) { reader.cancel(); break; } chunks.push(value); }
  const all = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0)); let at = 0;
  for (const c of chunks) { all.set(c, at); at += c.length; }
  return new TextDecoder().decode(all);
}

/* ---------------- RSS ---------------- */
const decode = s => String(s || '').replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n)).replace(/&amp;/g, '&').trim();
const tag = (xml, name) => decode((xml.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, 'i')) || [])[1]);
const attr = (xml, name, a) => decode((xml.match(new RegExp(`<${name}\\b[^>]*\\b${a}="([^"]*)"`, 'i')) || [])[1]);
const strip = html => decode(html).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
export function durationSeconds(v) {
  const s = String(v || '').trim(); if (!s) return 0;
  if (/^\d+$/.test(s)) return Number(s);
  return s.split(':').reduce((n, p) => n * 60 + (Number(p) || 0), 0);
}
export function parseFeed(xml, feedUrl = '') {
  const channel = xml.split(/<item[\s>]/i)[0];
  const show = {title: tag(channel, 'title').slice(0, 200), author: (tag(channel, 'itunes:author') || tag(channel, 'author')).slice(0, 120),
    image: httpsUrl(attr(channel, 'itunes:image', 'href') || tag(tag(channel, 'image'), 'url')), description: strip(tag(channel, 'description')).slice(0, 600), feed: feedUrl};
  const items = xml.match(/<item[\s>][\s\S]*?<\/item>/gi) || [];
  show.episodes = items.slice(0, 300).map(item => {
    const url = httpsUrl(attr(item, 'enclosure', 'url'));
    if (!url) return null;
    const guid = tag(item, 'guid') || url;
    return {id: guid.slice(0, 300), title: tag(item, 'title').slice(0, 300), date: Date.parse(tag(item, 'pubDate')) || 0,
      duration: durationSeconds(tag(item, 'itunes:duration')), url, type: attr(item, 'enclosure', 'type') || 'audio/mpeg',
      image: httpsUrl(attr(item, 'itunes:image', 'href')) || show.image, description: strip(tag(item, 'description') || tag(item, 'itunes:summary')).slice(0, 500)};
  }).filter(Boolean);
  return show;
}

/* ---------------- Directory ---------------- */
const showFromItunes = r => ({id: String(r.collectionId), title: r.collectionName, author: r.artistName, image: r.artworkUrl600 || r.artworkUrl100 || '', feed: httpsUrl(r.feedUrl), genre: r.primaryGenreName || '', episodes: r.trackCount || 0});
const showFromFyyd = r => ({id: String(r.id), title: r.title || '', author: r.author || '', image: httpsUrl(r.imgURL || r.layoutImageURL || r.thumbImageURL), feed: httpsUrl(r.xmlURL), genre: '', episodes: r.episode_count || 0});

async function fetchJSON(fetcher, url, ms = 6500) {
  const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), ms);
  try {
    const r = await fetcher(url, {signal: ctl.signal, headers: {Accept: 'application/json', 'User-Agent': 'SpotPlus/2.0 (https://coye2.github.io/spot-plus/)'}});
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return await r.json();
  } finally { clearTimeout(timer); }
}

async function cached(request, cache, waitUntil, build, maxAge) {
  const key = new Request(request.url);
  const hit = await cache?.match(key); if (hit) return hit;
  const res = await build();
  if (res.ok && cache) waitUntil(cache.put(key, res.clone()).catch(() => {}));
  return res;
}

export async function podcasts(request, {fetcher = fetch, cache, waitUntil = () => {}} = {}) {
  const url = new URL(request.url), path = url.pathname;
  return cached(request, cache, waitUntil, async () => {
    try {
      if (path === '/podcasts') {
        const q = (url.searchParams.get('q') || '').trim().slice(0, 100);
        if (!q) { // Top shows right now
          let shows = [];
          try {
            const top = await fetchJSON(fetcher, 'https://itunes.apple.com/us/rss/toppodcasts/limit=30/json');
            const ids = (top?.feed?.entry || []).map(e => e?.id?.attributes?.['im:id']).filter(id => /^\d+$/.test(id)).slice(0, 30);
            if (ids.length) {
              const look = await fetchJSON(fetcher, `https://itunes.apple.com/lookup?id=${ids.join(',')}&entity=podcast`);
              shows = (look.results || []).filter(r => r.feedUrl).map(showFromItunes);
            }
          } catch { /* fall back to fyyd */ }
          if (!shows.length) {
            const fyyd = await fetchJSON(fetcher, 'https://api.fyyd.de/0.2/feature/podcast/hot?count=30');
            shows = (fyyd?.data || []).filter(r => r?.xmlURL).map(showFromFyyd);
          }
          if (!shows.length) return reply({error: 'Source unavailable'}, 503);
          return reply({shows}, 200, 6 * 3600);
        }
        let shows = [];
        try {
          const data = await fetchJSON(fetcher, `https://itunes.apple.com/search?media=podcast&limit=24&term=${encodeURIComponent(q)}`);
          shows = (data.results || []).filter(r => r.feedUrl).map(showFromItunes);
        } catch { /* fall back to fyyd */ }
        if (!shows.length) {
          const fyyd = await fetchJSON(fetcher, `https://api.fyyd.de/0.2/search/podcast?count=24&title=${encodeURIComponent(q)}`);
          shows = (fyyd?.data || []).filter(r => r?.xmlURL).map(showFromFyyd);
        }
        return reply({shows}, 200, 3600);
      }
      if (path === '/podcast') {
        const feed = httpsUrl(url.searchParams.get('feed'));
        if (!feed) return reply({error: 'Provide a feed'}, 400);
        const r = await fetcher(feed, {headers: {Accept: 'application/rss+xml, application/xml, text/xml'}});
        if (!r.ok) return reply({error: 'Feed unavailable'}, 502);
        const xml = await boundedText(r);
        if (!/<rss|<feed|<channel/i.test(xml.slice(0, 5000))) return reply({error: 'Not a podcast feed'}, 422);
        return reply(parseFeed(xml, feed), 200, 1800);
      }
      if (path === '/audiobooks') {
        // LibriVox recordings, via the Internet Archive: full-text search, sorted by popularity.
        const q = (url.searchParams.get('q') || '').replace(/[^\p{L}\p{N}' -]/gu, ' ').trim().slice(0, 80), id = url.searchParams.get('id') || '';
        if (id) {
          if (!/^[\w.-]{3,100}$/.test(id)) return reply({error: 'Bad book id'}, 400);
          const meta = await (await fetcher(`https://archive.org/metadata/${id}`)).json();
          const m = meta?.metadata || {}, files = (meta?.files || []).filter(f => f.format === '64Kbps MP3' || f.format === 'VBR MP3');
          const best = files.some(f => f.format === '64Kbps MP3') ? files.filter(f => f.format === '64Kbps MP3') : files;
          const chapters = best.sort((x, y) => x.name.localeCompare(y.name, 'en', {numeric: true})).map((f, i) => ({id: `${id}/${f.name}`, title: decode(f.title || `Part ${i + 1}`), url: `https://archive.org/download/${id}/${encodeURIComponent(f.name)}`, duration: durationSeconds(f.length)}));
          return reply({book: {id, title: decode([].concat(m.title)[0] || id), author: decode([].concat(m.creator)[0] || ''), description: strip([].concat(m.description)[0] || '').slice(0, 800), image: `https://archive.org/services/img/${id}`, chapters}}, 200, 7 * 86400);
        }
        const query = `collection:librivoxaudio AND mediatype:audio${q ? ` AND (${q})` : ''}`;
        const data = await (await fetcher(`https://archive.org/advancedsearch.php?q=${encodeURIComponent(query)}&fl[]=identifier&fl[]=title&fl[]=creator&fl[]=downloads&sort[]=downloads+desc&rows=30&output=json`)).json();
        return reply({books: (data?.response?.docs || []).map(d => ({id: d.identifier, title: decode([].concat(d.title)[0] || ''), author: decode([].concat(d.creator)[0] || ''), image: `https://archive.org/services/img/${d.identifier}`, downloads: d.downloads || 0}))}, 200, q ? 86400 : 7 * 86400);
      }
      return reply({error: 'Not found'}, 404);
    } catch { return reply({error: 'Source unavailable'}, 503); }
  });
}
