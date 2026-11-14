// Spot+ service worker: offline app shell + cached cover art. Audio downloads live in their own cache.
const SHELL_CACHE = 'spotplus-shell-v10';
const IMG_CACHE = 'spotplus-img-v1';
const KEEP = [SHELL_CACHE, IMG_CACHE, 'spotplus-audio-v1'];
const SHELL = [
  './css/app-shell.css','./css/dj-voice.css','./js/shell.js','./js/dj-voice.js','./js/voice-worker.js','./js/audio-buffer.js',
  './js/folders.js',
  './css/account.css', './js/spotify-account.js', './js/spotify-reader.js',
  './', './index.html', './css/style.css', './css/experience.css', './css/themes.css', './css/refinements.css', './css/fonts.css', './fonts/inter-latin-wght-normal.woff2', './js/app.js', './js/api.js', './js/player.js', './js/store.js', './js/library.js', './js/dj.js', './js/local-model.js', './js/model-worker.js', './js/themes.js', './js/spotify.js', './js/spotify-import.js', './js/spotify-import-worker.js', './js/vendor/fflate.js',
  './manifest.webmanifest', './icons/icon-192.png', './icons/icon-512.png', './icons/maskable-512.png', './icons/apple-touch-icon.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(SHELL_CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
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

  // App files: update online, use the complete cached shell when offline.
  if (url.origin === self.location.origin) {
    if (url.pathname.includes('/__offline/')) return;
    e.respondWith((async () => {
      const cache = await caches.open(SHELL_CACHE);
      const hit = await cache.match(req, { ignoreSearch: true }) || (req.mode === 'navigate' ? await cache.match('./index.html') : null);
      try {const res=await fetch(req);if(res.ok){await cache.put(req,res.clone());return res;}return hit||res;}catch{return hit||new Response('Offline',{status:503});}
    })());
    return;
  }

  // Cover art from Deezer's CDN: cache-first so your library looks right offline.
  if (/(^|\.)dzcdn\.net$/.test(url.hostname) && req.destination === 'image') {
    e.respondWith((async () => {
      const cache = await caches.open(IMG_CACHE);
      const hit = await cache.match(req);
      if (hit) return hit;
      try {
        const res = await fetch(req);
        cache.put(req, res.clone()).then(() => trim(IMG_CACHE, 600));
        return res;
      } catch { return Response.error(); }
    })());
  }
  // Everything else (Deezer API, audio streams, lyrics) goes straight to the network.
});
