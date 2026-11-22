import { createServer } from 'node:http';
import { Readable } from 'node:stream';
import { readFile, stat } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { handle as canvasBridge } from '../canvas-bridge/worker.js';
import { handleSpotifyRelay } from '../workers/spotify-relay/src/index.js';

const root = resolve(process.argv[2] || '.');
const port = Number(process.env.PORT || 3000);
const types = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
  '.wasm': 'application/wasm',
  '.txt': 'text/plain; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml',
  '.wav': 'audio/wav',
  '.mp3': 'audio/mpeg',
};

// Allowlisted Spot+ worker hosts proxied through the dev/preview server so
// preview origins (not in the production worker's Origin allowlist) stream audio
// and metadata identically to production without altering committed app code.
const WORKER_HOSTS = new Set([
  'spot-plus-canvas.pwr97pnmkn.workers.dev',
  'spot-plus-relay-eu.pwr97pnmkn.workers.dev',
  'spot-plus-relay-de.pwr97pnmkn.workers.dev',
  'spot-plus-relay-asia.pwr97pnmkn.workers.dev',
  'spot-plus-relay-west.pwr97pnmkn.workers.dev',
]);
// Matches single-quoted worker URL literals in /js/*.js and replaces them with a
// runtime browser-origin expression so reverse proxies (Cloud Run / nginx) never
// bake http://localhost:3000 into preview bundles.
const WORKER_LITERAL_RE = /'https:\/\/(spot-plus-(?:canvas|relay-(?:eu|de|asia|west))\.pwr97pnmkn\.workers\.dev)([^']*)'/g;
const PREVIEW_PREFIX = '/__preview_worker/';
const SPOTIFY_RELAY_PREFIX = '/__spotify_relay';
const FORWARD_RES_HEADERS = [
  'content-type',
  'content-length',
  'content-range',
  'accept-ranges',
  'cache-control',
  'etag',
  'last-modified',
  'retry-after',
  'x-spotplus-source',
  'x-spotplus-duration',
  'x-spotplus-itag',
  'x-spotplus-video',
];

// Dev/preview service worker: immediately clears stale shell caches from earlier
// sessions and passes all fetches straight to the network so preview never gets
// stuck on cached js/api.js or stale CSS. Production dist/sw.js is unaffected.
const PREVIEW_SW = `// Spot+ preview pass-through service worker (dev server only).
self.addEventListener('install', () => { self.skipWaiting(); });
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('spotplus-shell-')).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});
self.addEventListener('fetch', () => {});
`;

// Dev/preview-only runtime shim (never included in dist/ or GitHub Pages):
// 1. AI Studio preview URLs (https://ais-dev-*.run.app) sit behind an auth proxy that
//    requires same-origin session cookies. Spot+ passes credentials:'omit' and
//    crossOrigin:'anonymous' for cross-origin production workers; in preview those
//    same-origin /__preview_worker/* requests must send credentials:'same-origin' /
//    crossOrigin:'use-credentials' so the preview proxy does not reject them.
// 2. Clears any stale service workers, shell caches, and poisoned relay scores left
//    over from earlier preview sessions.
const PREVIEW_SHIM = `(function(){
  try {
    if ('serviceWorker' in navigator && navigator.serviceWorker.getRegistrations) {
      navigator.serviceWorker.getRegistrations().then(function(regs){
        regs.forEach(function(r){ try { r.unregister(); } catch(e){} });
      }).catch(function(){});
    }
    if ('caches' in window && caches.keys) {
      caches.keys().then(function(keys){
        keys.forEach(function(k){ if (k.indexOf('spotplus-shell-') === 0) caches.delete(k); });
      }).catch(function(){});
    }
    if (!localStorage.getItem('spotplus.previewShimV1')) {
      localStorage.removeItem('spotplus.relayRegions');
      localStorage.removeItem('spotplus.regionsChecked');
      localStorage.removeItem('spotplus.instanceSpeed');
      localStorage.setItem('spotplus.previewShimV1', '1');
    }
  } catch (e) {}

  function isPreviewRoute(u) {
    if (!u) return false;
    var s = String(u);
    return s.indexOf('/__preview_worker/') !== -1 || s.indexOf('/__spotify_relay/') !== -1;
  }

  if (typeof window.fetch === 'function') {
    var origFetch = window.fetch.bind(window);
    window.fetch = function(input, init) {
      var url = typeof input === 'string' ? input : (input instanceof URL ? input.href : (input && input.url) || '');
      if (isPreviewRoute(url)) {
        var nextInit = init ? Object.assign({}, init, { credentials: 'same-origin' }) : { credentials: 'same-origin' };
        return origFetch(input, nextInit);
      }
      return origFetch(input, init);
    };
  }

  if (typeof HTMLMediaElement !== 'undefined') {
    var proto = HTMLMediaElement.prototype;
    var srcDesc = Object.getOwnPropertyDescriptor(proto, 'src');
    var corsDesc = Object.getOwnPropertyDescriptor(proto, 'crossOrigin');
    var origSetAttr = Element.prototype.setAttribute;

    if (srcDesc && srcDesc.set) {
      Object.defineProperty(proto, 'src', {
        configurable: true,
        enumerable: true,
        get: srcDesc.get,
        set: function(val) {
          var cur = this.getAttribute('crossorigin');
          if (isPreviewRoute(val) && cur === 'anonymous') {
            origSetAttr.call(this, 'crossorigin', 'use-credentials');
          } else if (!isPreviewRoute(val) && cur === 'use-credentials') {
            origSetAttr.call(this, 'crossorigin', 'anonymous');
          }
          return srcDesc.set.call(this, val);
        }
      });
    }

    if (corsDesc && corsDesc.set) {
      Object.defineProperty(proto, 'crossOrigin', {
        configurable: true,
        enumerable: true,
        get: corsDesc.get,
        set: function(val) {
          if (val === 'anonymous' && isPreviewRoute(this.getAttribute('src') || this.currentSrc || '')) {
            return corsDesc.set.call(this, 'use-credentials');
          }
          return corsDesc.set.call(this, val);
        }
      });
    }

    proto.setAttribute = function(name, value) {
      var lower = String(name || '').toLowerCase();
      if (lower === 'src') {
        var cur = this.getAttribute('crossorigin');
        if (isPreviewRoute(value) && cur === 'anonymous') {
          origSetAttr.call(this, 'crossorigin', 'use-credentials');
        } else if (!isPreviewRoute(value) && cur === 'use-credentials') {
          origSetAttr.call(this, 'crossorigin', 'anonymous');
        }
      } else if (lower === 'crossorigin' && value === 'anonymous' && isPreviewRoute(this.getAttribute('src') || this.currentSrc || '')) {
        value = 'use-credentials';
      }
      return origSetAttr.call(this, name, value);
    };
  }
})();
`;

function spotifyCallbackHtml(query) {
  const payload = JSON.stringify({
    type: 'SPOTPLUS_SPOTIFY_OAUTH',
    code: query.get('code') || '',
    state: query.get('state') || '',
    error: query.get('error') || '',
  }).replace(/</g, '\\u003c');
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Spot+ · Spotify Sign-In</title>
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#0a0a0d;color:#fff;font:15px/1.5 -apple-system,BlinkMacSystemFont,sans-serif;text-align:center;padding:24px}</style>
</head>
<body>
<div><h2>Completing Spotify sign-in…</h2><p>You can close this window if it does not close automatically.</p></div>
<script>
(function(){
  var data = ${payload};
  try {
    if (window.opener && !window.opener.closed) {
      window.opener.postMessage(data, '*');
      window.close();
      return;
    }
  } catch (e) {}
  try {
    var qs = new URLSearchParams();
    if (data.code) qs.set('spotify_code', data.code);
    if (data.state) qs.set('spotify_state', data.state);
    if (data.error) qs.set('spotify_error', data.error);
    window.location.replace('/?' + qs.toString() + '#/settings');
  } catch (e) {}
})();
</script>
</body></html>`;
}

function previewCorsHeaders(req) {
  const origin = req.headers.origin;
  if (origin) {
    return {
      'Access-Control-Allow-Origin': origin,
      'Access-Control-Allow-Credentials': 'true',
      Vary: 'Origin',
    };
  }
  return { 'Access-Control-Allow-Origin': '*' };
}

async function proxyWorker(req, res, pathname, search) {
  const cors = previewCorsHeaders(req);
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      ...cors,
      'Access-Control-Allow-Methods': 'GET, HEAD, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Range, If-Range, Content-Type, Accept, Authorization',
    });
    res.end();
    return;
  }
  const rest = pathname.slice(PREVIEW_PREFIX.length);
  const slash = rest.indexOf('/');
  const targetHost = slash === -1 ? rest : rest.slice(0, slash);
  const targetPath = slash === -1 ? '/' : rest.slice(slash);
  if (!WORKER_HOSTS.has(targetHost)) {
    res.writeHead(403, { 'Content-Type': 'application/json', ...cors });
    res.end(JSON.stringify({ error: 'Host not allowed' }));
    return;
  }

  const ctl = new AbortController();
  res.on('close', () => { if (!res.writableEnded) ctl.abort(); });

  // Build clean upstream headers (never forward preview cookies to Cloudflare Workers).
  const headers = {
    Origin: 'https://coye2.github.io',
    Accept: req.headers.accept || '*/*',
  };
  if (req.headers.range) headers.Range = req.headers.range;
  if (req.headers['if-range']) headers['If-Range'] = req.headers['if-range'];
  if (req.headers['content-type']) headers['Content-Type'] = req.headers['content-type'];
  if (req.headers['user-agent']) headers['User-Agent'] = req.headers['user-agent'];

  let body;
  if (req.method === 'POST') {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    body = Buffer.concat(chunks);
  }

  try {
    const upstream = await fetch(`https://${targetHost}${targetPath}${search}`, {
      method: req.method,
      headers,
      body,
      signal: ctl.signal,
      redirect: 'follow',
    });
    const outHeaders = {
      ...cors,
      'Access-Control-Expose-Headers': 'Content-Range, Content-Length, Accept-Ranges, X-Spotplus-Source, X-Spotplus-Duration, X-Spotplus-Itag, X-Spotplus-Video',
      'Cross-Origin-Resource-Policy': 'cross-origin',
    };
    for (const key of FORWARD_RES_HEADERS) {
      const val = upstream.headers.get(key);
      if (val != null) outHeaders[key] = val;
    }
    res.writeHead(upstream.status, outHeaders);
    if (req.method === 'HEAD' || !upstream.body) {
      res.end();
      return;
    }
    const stream = Readable.fromWeb(upstream.body);
    stream.on('error', () => { if (!res.writableEnded) res.end(); });
    stream.pipe(res);
  } catch (err) {
    if (err?.name === 'AbortError' || res.writableEnded) return;
    res.writeHead(502, { 'Content-Type': 'application/json', ...cors });
    res.end(JSON.stringify({ error: 'Preview worker proxy error' }));
  }
}

async function handleLocalSpotifyRelay(req, res, pathname, search) {
  const subPath = pathname.slice(SPOTIFY_RELAY_PREFIX.length) || '/';
  const reqHeaders = new Headers();
  for (const [k, v] of Object.entries(req.headers)) {
    if (typeof v === 'string') reqHeaders.set(k, v);
  }
  let body;
  if (req.method !== 'GET' && req.method !== 'HEAD' && req.method !== 'OPTIONS') {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    body = Buffer.concat(chunks);
  }
  const workerReq = new Request(`http://localhost:${port}${subPath}${search}`, {
    method: req.method,
    headers: reqHeaders,
    body,
  });
  const response = await handleSpotifyRelay(workerReq, {
    env: { ALLOW_PREVIEW_ORIGINS: 'true' },
  });
  res.writeHead(response.status, Object.fromEntries(response.headers));
  res.end(Buffer.from(await response.arrayBuffer()));
}

createServer(async (req, res) => {
  try {
    const parsedUrl = new URL(req.url, 'http://localhost');
    const pathname = decodeURIComponent(parsedUrl.pathname);

    if (pathname.startsWith(PREVIEW_PREFIX)) {
      await proxyWorker(req, res, pathname, parsedUrl.search);
      return;
    }

    if (pathname === SPOTIFY_RELAY_PREFIX || pathname.startsWith(SPOTIFY_RELAY_PREFIX + '/')) {
      await handleLocalSpotifyRelay(req, res, pathname, parsedUrl.search);
      return;
    }

    if (pathname === '/__preview_shim.js') {
      res.writeHead(200, {
        'Content-Type': 'text/javascript; charset=utf-8',
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
      });
      res.end(PREVIEW_SHIM);
      return;
    }

    if (pathname === '/auth/spotify/callback' || pathname === '/auth/spotify/callback/') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(spotifyCallbackHtml(parsedUrl.searchParams));
      return;
    }

    if (pathname === '/sw.js') {
      res.writeHead(200, {
        'Content-Type': 'text/javascript; charset=utf-8',
        'Cache-Control': 'no-store',
        'Service-Worker-Allowed': '/',
      });
      res.end(PREVIEW_SW);
      return;
    }

    if (['/canvas', '/spotify-stats', '/podcasts', '/podcast', '/audiobooks', '/match', '/lyrics-search', '/health', '/dev', '/spotify-public', '/stats', '/installs', '/listening'].includes(pathname)) {
      const response = await canvasBridge(new Request('http://localhost' + req.url));
      res.writeHead(response.status, Object.fromEntries(response.headers));
      res.end(Buffer.from(await response.arrayBuffer()));
      return;
    }

    let file = resolve(root, '.' + pathname);
    if (file !== root && !file.startsWith(root + sep)) throw new Error('Invalid path');
    if ((await stat(file)).isDirectory()) file = resolve(file, 'index.html');
    const ext = extname(file);
    let body = await readFile(file);

    // Inject preview-only credential shim into index.html before app scripts load.
    if (ext === '.html' && (pathname === '/' || pathname === '/index.html')) {
      const html = body.toString('utf8');
      body = Buffer.from(
        html.replace('<script src="js/boot.js"></script>', '<script src="/__preview_shim.js"></script>\n<script src="js/boot.js"></script>'),
        'utf8',
      );
    }

    // Rewrite Spot+ worker string literals in preview JS modules using runtime browser origin.
    if (ext === '.js' && pathname.startsWith('/js/')) {
      const text = body.toString('utf8');
      if (WORKER_LITERAL_RE.test(text)) {
        WORKER_LITERAL_RE.lastIndex = 0;
        body = Buffer.from(
          text.replace(WORKER_LITERAL_RE, "((globalThis.location?.origin||'')+'/__preview_worker/$1$2')"),
          'utf8',
        );
      }
    }

    res.writeHead(200, {
      'Content-Type': types[ext] || 'application/octet-stream',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    });
    res.end(body);
  } catch {
    res.writeHead(404);
    res.end('Not found');
  }
}).listen(port, '0.0.0.0', () => console.log(`Spot+ http://0.0.0.0:${port}`));
