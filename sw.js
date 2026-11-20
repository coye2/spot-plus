// Spot+ service worker: offline app shell, cached cover art, and HTTP Range support for cached audio.
// v40 includes version 2 account snapshots and incomplete-collection preservation.
const SHELL_CACHE = 'spotplus-shell-v129';
const IMG_CACHE = 'spotplus-img-v1';
const AUDIO_CACHE = 'spotplus-audio-v1';
const KEEP = [SHELL_CACHE, IMG_CACHE, AUDIO_CACHE, 'spotplus-live-voice-v1'];
const SHELL = [
  './js/gate.js', './js/maintenance.js',
  './js/playback-telemetry.js', './js/source-router.js', './js/memory-engine.js', './js/buffer-engine.js', './js/predictive-pipeline.js',
  './js/profile-photo.js', './js/backgrounds.js', './js/background-catalog.js', './css/backgrounds.css',
  './js/audio-selection.js','./js/player-colors.js','./js/spotify-stats.js','./js/listening-history.js','./js/history-import-worker.js','./js/rewind.js','./js/stats-api.js','./js/canvas-cache.js','./js/jam.js','./js/jam-mesh.js','./js/relay-sync.js','./js/spotify-links.js','./js/vendor/nostr-sign.js','./js/onboarding.js','./js/notify.js','./js/landing.js','./js/fx.js','./js/spoken.js','./js/generator.js','./js/mixes.js','./js/library-sync.js','./js/live-stats.js','./js/changelog.js','./js/cors-probe.js','./js/pitch-worklet.js','./js/boot.js','./css/landing.css','./icons/shot-home.webp','./icons/shot-coll.webp','./icons/shot-jam.webp','./js/vendor/qrcode.js','./css/rewind.css','./css/polish.css',
  './js/playback-policy.js',
  './js/canvas.js','./js/video-loops.js','./js/player-gestures.js','./js/account-setup.js','./js/dj-recognition.js','./js/live-voice.js','./js/live-voice-worker.js','./js/dj-dialogue.js','./js/vendor/supertonic-text.js',
  ...['afterhours','daylight','classic'].map(host=>'./audio/dj/'+host+'/preview.mp3'),
  './css/app-shell.css','./css/dj-voice.css','./js/shell.js','./js/dj-voice.js','./js/dj-hosts.js','./js/audio-buffer.js',
  './js/folders.js',
  './css/account.css', './js/spotify-account.js', './js/spotify-reader.js',
  './', './index.html', './css/style.css', './css/experience.css', './css/themes.css', './css/refinements.css', './css/fonts.css', './fonts/inter-latin-wght-normal.woff2', './js/app.js', './js/api.js', './js/player.js', './js/yt-embed.js','./js/sponsorblock.js', './js/search-rank.js', './js/feed.js', './js/store.js', './js/library.js', './js/dj.js', './js/local-model.js', './js/model-worker.js', './js/themes.js', './js/spotify.js', './js/spotify-import.js', './js/spotify-import-worker.js', './js/vendor/fflate.js',
  './manifest.webmanifest', './icons/icon-192.png', './icons/icon-512.png', './icons/maskable-512.png', './icons/apple-touch-icon.png',
];
const SHELL_PATHS = new Set(SHELL.map((path) => new URL(path, self.location.href).pathname));

function parseByteRange(header, total) {
  if (!header || !/^bytes=/i.test(header)) return null;
  const spec = header.replace(/^bytes=/i, '').split(',')[0].trim();
  const match = /^(\d*)-(\d*)$/.exec(spec);
  if (!match || (!match[1] && !match[2])) return { invalid: true };
  let start, end;
  if (!match[1]) {
    const suffix = Number(match[2]);
    if (!Number.isFinite(suffix) || suffix <= 0) return { invalid: true };
    start = Math.max(0, total - suffix);
    end = total - 1;
  } else {
    start = Number(match[1]);
    end = match[2] ? Math.min(total - 1, Number(match[2])) : total - 1;
  }
  if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || start >= total || start > end) {
    return { unsatisfiable: true };
  }
  return { start, end };
}

async function serveCachedAudioRange(req) {
  const cache = await caches.open(AUDIO_CACHE);
  const hit = await cache.match(req.url);
  if (!hit) return new Response('Not found', { status: 404 });
  const rangeHeader = req.headers?.get?.('Range');
  const contentType = hit.headers?.get?.('Content-Type') || 'audio/mp4';
  if (!rangeHeader) {
    const headers = new Headers(hit.headers);
    headers.set('Accept-Ranges', 'bytes');
    return new Response(hit.body, { status: 200, headers });
  }
  const blob = await hit.blob();
  const total = blob.size;
  const parsed = parseByteRange(rangeHeader, total);
  if (!parsed || parsed.invalid || parsed.unsatisfiable) {
    return new Response(null, {
      status: 416,
      headers: { 'Content-Range': `bytes */${total}`, 'Accept-Ranges': 'bytes' },
    });
  }
  const slice = blob.slice(parsed.start, parsed.end + 1, contentType);
  return new Response(slice, {
    status: 206,
    headers: {
      'Content-Type': contentType,
      'Content-Range': `bytes ${parsed.start}-${parsed.end}/${total}`,
      'Content-Length': String(parsed.end - parsed.start + 1),
      'Accept-Ranges': 'bytes',
    },
  });
}

self.addEventListener('install', (e) => {
  // A new shell must bypass the browser's still-fresh copies from the old release.
  const fresh = SHELL.map(path => new Request(new URL(path,self.location.href),{cache:'reload'}));
  e.waitUntil(caches.open(SHELL_CACHE).then((c) => c.addAll(fresh)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k.startsWith('spotplus-') && !KEEP.includes(k)).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

async function trim(cacheName, max) {
  const c = await caches.open(cacheName);
  const keys = await c.keys();
  for (let i = 0; i < keys.length - max; i++) await c.delete(keys[i]);
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // Versioned app shell: open immediately from cache; a new worker installs the next complete version.
  if (url.origin === self.location.origin) {
    if (url.pathname.includes('/__offline/')) {
      e.respondWith(serveCachedAudioRange(req));
      return;
    }
    // Opening a userscript is a document navigation too. It must return the
    // actual script, never the app shell (which renders broken at a /js/ URL).
    // Ignore both old cache entries and HTTP cache when installing/updating it.
    const base = new URL('./', self.location.href);
    if (['js/spotplus-spotify.user.js','js/spotplus-spotify.meta.js'].some(path => url.pathname === new URL(path,base).pathname)) {
      e.respondWith(fetch(new Request(req,{cache:'no-store'})).catch(() => new Response('The Spot+ helper could not download. Go back to Spot+, check your connection, and try again.',{status:503,headers:{'Content-Type':'text/plain; charset=utf-8'}})));
      return;
    }
    e.respondWith((async () => {
      const appDocument = req.mode === 'navigate' && [base.pathname,new URL('index.html',base).pathname].includes(url.pathname);
      if (!SHELL_PATHS.has(url.pathname) && !appDocument) {
        try { return await fetch(req); } catch { return new Response('Offline', { status: 503 }); }
      }
      const cache = await caches.open(SHELL_CACHE);
      const hit = await cache.match(req, { ignoreSearch: true }) || (appDocument ? await cache.match('./index.html') : null);
      if (hit && !(req.mode==='cors' && hit.type==='opaque')) return hit;
      try {
        const res = await fetch(req);
        if (res.ok) { try { await cache.put(req, res.clone()); } catch { /* iOS quota full */ } }
        return res;
      } catch { return new Response('Offline', { status: 503 }); }
    })());
    return;
  }

  // Cover art from Deezer's CDN: cache-first so your library looks right offline.
  if (/(^|\.)dzcdn\.net$/.test(url.hostname) && req.destination === 'image') {
    e.respondWith((async () => {
      const cache = await caches.open(IMG_CACHE);
      const hit = await cache.match(req);
      if (hit && !(req.mode==='cors' && hit.type==='opaque')) return hit;
      try {
        const res = await fetch(req);
        if (res.ok) cache.put(req, res.clone()).then(() => trim(IMG_CACHE, 600)).catch(() => {});
        return res;
      } catch { return Response.error(); }
    })());
  }
  // Everything else (Deezer API, audio streams, lyrics) goes straight to the network.
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const url = e.notification.data?.url || '#/home';
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
    const win = list[0];
    if (win) { win.postMessage({ type: 'open', url }); return win.focus(); }
    return self.clients.openWindow('./' + url);
  }));
});
