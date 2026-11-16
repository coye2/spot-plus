// Spot+ service worker: offline app shell + cached cover art. Audio downloads live in their own cache.
// v40 includes version 2 account snapshots and incomplete-collection preservation.
const SHELL_CACHE = 'spotplus-shell-v72';
const IMG_CACHE = 'spotplus-img-v1';
const KEEP = [SHELL_CACHE, IMG_CACHE, 'spotplus-audio-v1', 'spotplus-live-voice-v1'];
const SHELL = [
  './js/audio-selection.js','./js/player-colors.js','./js/spotify-stats.js','./js/listening-history.js','./js/history-import-worker.js','./js/rewind.js','./js/stats-api.js','./js/canvas-cache.js','./js/jam.js','./js/jam-mesh.js','./js/relay-sync.js','./js/spotify-links.js','./js/vendor/nostr-sign.js','./js/onboarding.js','./js/notify.js','./js/landing.js','./js/fx.js','./js/spoken.js','./js/generator.js','./js/mixes.js','./js/library-sync.js','./js/live-stats.js','./js/changelog.js','./js/cors-probe.js','./js/pitch-worklet.js','./js/boot.js','./css/landing.css','./icons/shot-home.webp','./icons/shot-coll.webp','./icons/shot-jam.webp','./js/vendor/qrcode.js','./css/rewind.css','./css/polish.css',
  './js/playback-policy.js',
  './js/canvas.js','./js/video-loops.js','./js/player-gestures.js','./js/account-setup.js','./js/dj-recognition.js','./js/live-voice.js','./js/live-voice-worker.js','./js/dj-dialogue.js','./js/vendor/supertonic-text.js',
  ...['afterhours','daylight','classic'].map(host=>'./audio/dj/'+host+'/preview.mp3'),
  './css/app-shell.css','./css/dj-voice.css','./js/shell.js','./js/dj-voice.js','./js/dj-hosts.js','./js/audio-buffer.js',
  './js/folders.js',
  './css/account.css', './js/spotify-account.js', './js/spotify-reader.js',
  './', './index.html', './css/style.css', './css/experience.css', './css/themes.css', './css/refinements.css', './css/fonts.css', './fonts/inter-latin-wght-normal.woff2', './js/app.js', './js/api.js', './js/player.js', './js/store.js', './js/library.js', './js/dj.js', './js/local-model.js', './js/model-worker.js', './js/themes.js', './js/spotify.js', './js/spotify-import.js', './js/spotify-import-worker.js', './js/vendor/fflate.js',
  './manifest.webmanifest', './icons/icon-192.png', './icons/icon-512.png', './icons/maskable-512.png', './icons/apple-touch-icon.png',
];

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
    if (url.pathname.includes('/__offline/')) return;
    // Opening a userscript is a document navigation too. It must return the
    // actual script, never the app shell (which renders broken at a /js/ URL).
    // Ignore both old cache entries and HTTP cache when installing/updating it.
    const base = new URL('./', self.location.href);
    if (['js/spotplus-spotify.user.js','js/spotplus-spotify.meta.js'].some(path => url.pathname === new URL(path,base).pathname)) {
      e.respondWith(fetch(new Request(req,{cache:'no-store'})).catch(() => new Response('The Spot+ helper could not download. Go back to Spot+, check your connection, and try again.',{status:503,headers:{'Content-Type':'text/plain; charset=utf-8'}})));
      return;
    }
    e.respondWith((async () => {
      const cache = await caches.open(SHELL_CACHE);
      const appDocument = req.mode === 'navigate' && [base.pathname,new URL('index.html',base).pathname].includes(url.pathname);
      const hit = await cache.match(req, { ignoreSearch: true }) || (appDocument ? await cache.match('./index.html') : null);
      if (hit && !(req.mode==='cors' && hit.type==='opaque')) return hit;
      try {const res=await fetch(req);if(res.ok)await cache.put(req,res.clone());return res;}catch{return new Response('Offline',{status:503});}
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
        cache.put(req, res.clone()).then(() => trim(IMG_CACHE, 600));
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
