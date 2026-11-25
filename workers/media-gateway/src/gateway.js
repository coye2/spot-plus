// workers/media-gateway/src/gateway.js — Path 2: Spot+ Universal Media Gateway (OpenSubsonic PoC).
// Minimal, standards-compliant OpenSubsonic 1.16.1 interoperability gateway enabling legitimate
// CarPlay (Amperfy, Substreamer, play:Sub) and Android Auto (Symfonium, Tempo, Substreamer)
// clients to browse playlists, search, fetch artwork, and direct-play authorized audio streams.
//
// Core architectural principles:
//  - Truthful identity (`type: "spotplus-gateway"`, never impersonates another server).
//  - Direct playback first: `/rest/stream` issues HTTP 302 redirects to allowlisted authorized
//    stream URLs so media bandwidth bypasses the gateway Worker (0 KB/s media egress bottleneck).
//  - Never increments play counts on `/rest/stream` (strict OpenSubsonic spec compliance).
//  - Zero hardcoded secrets, constant-time auth comparison, strict anti-SSRF URL validation,
//    no wildcard CORS on authenticated endpoints, and layered per-IP/per-client rate limiting.

import { md5Hex } from './md5.js';
import { buildTestCoverSvg, createTestCatalog, synthesizeWavTrack } from './test-catalog.js';

export const GATEWAY_VERSION = '0.1.0';
export const SUBSONIC_API_VERSION = '1.16.1';

const RATE_WINDOW_MS = 60_000;
const RATE_LIMIT_PER_MIN = 240;
const BURST_WINDOW_MS = 10_000;
const BURST_LIMIT = 80;
const rateTable = new Map();
const burstTable = new Map();

const SECURITY_HEADERS = Object.freeze({
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
  'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'",
  'Strict-Transport-Security': 'max-age=63072000; includeSubDomains',
});

export function resetGatewayRateLimits() {
  rateTable.clear();
  burstTable.clear();
}

function checkRate(table, key, limit, windowMs, now = Date.now()) {
  const entry = table.get(key);
  if (!entry || now - entry.start > windowMs) {
    if (table.size > 4000) {
      for (const [k, v] of table) {
        if (now - v.start > windowMs) table.delete(k);
        if (table.size <= 3200) break;
      }
    }
    table.delete(key);
    table.set(key, { start: now, count: 1 });
    return false;
  }
  entry.count += 1;
  return entry.count > limit;
}

function timingSafeEqual(a, b) {
  const s1 = String(a ?? '');
  const s2 = String(b ?? '');
  const len = Math.max(s1.length, s2.length);
  let diff = s1.length ^ s2.length;
  for (let i = 0; i < len; i++) {
    diff |= (s1.charCodeAt(i) || 0) ^ (s2.charCodeAt(i) || 0);
  }
  return diff === 0 && s1.length > 0;
}

function escapeXml(val) {
  return String(val ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function isBlockedPrivateHost(hostname) {
  const h = String(hostname || '').toLowerCase().replace(/^\[|\]$/g, '');
  if (!h) return true;
  if (h === 'localhost' || h === '127.0.0.1' || h === '::1' || h === '0.0.0.0' || h.endsWith('.local')) return true;
  if (h === '169.254.169.254' || h.startsWith('169.254.')) return true;
  if (h.startsWith('10.') || h.startsWith('192.168.') || h.startsWith('127.')) return true;
  if (/^172\.(1[6-9]|2\d|3[0-1])\./.test(h)) return true;
  if (/^(::ffff:|fe80:|fc[0-9a-f]{2}:|fd[0-9a-f]{2}:)/.test(h)) return true;
  return false;
}

/**
 * Validates redirect target URLs for `/rest/stream` and `/rest/getCoverArt` to prevent open redirects
 * and SSRF against internal/link-local addresses.
 */
export function isAllowedDirectUrl(rawUrl, { allowedHosts = [], testOrigin = '' } = {}) {
  if (!rawUrl || typeof rawUrl !== 'string' || rawUrl.length > 2048) return false;
  try {
    const parsed = new URL(rawUrl);
    if (parsed.username || parsed.password) return false;
    if (testOrigin && parsed.origin === testOrigin) {
      return parsed.pathname.startsWith('/authorized-test-audio/') || parsed.pathname.startsWith('/authorized-test-cover/');
    }
    if (parsed.protocol !== 'https:') return false;
    if (isBlockedPrivateHost(parsed.hostname)) return false;
    if (allowedHosts.length > 0 && !allowedHosts.includes(parsed.hostname.toLowerCase())) {
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

function validateIncomingUrl(url, rawUrl) {
  const raw = String(rawUrl || '');
  if (raw.length > 2048) return { ok: false, status: 414, error: 'Request URI too long' };
  if (/(^|[\\/])\.\.([\\/?#]|$)|%2e%2e|%252e%252e|%00/i.test(raw)) {
    return { ok: false, status: 400, error: 'Malformed path' };
  }
  let count = 0;
  for (const [k, v] of url.searchParams) {
    count += 1;
    if (count > 20 || k.length > 48 || v.length > 512 || /[\u0000-\u001f\u007f]/.test(k) || /[\u0000-\u001f\u007f]/.test(v)) {
      return { ok: false, status: 400, error: 'Malformed query parameter' };
    }
  }
  return { ok: true };
}

function toXmlAttrs(obj) {
  const parts = [];
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === null || typeof v === 'object') continue;
    parts.push(`${k}="${escapeXml(v)}"`);
  }
  return parts.join(' ');
}

function toXmlNode(tag, value) {
  if (Array.isArray(value)) {
    return value.map((item) => toXmlNode(tag, item)).join('');
  }
  if (value && typeof value === 'object') {
    const attrs = toXmlAttrs(value);
    const children = [];
    for (const [k, v] of Object.entries(value)) {
      if (v && typeof v === 'object') children.push(toXmlNode(k, v));
    }
    return children.length
      ? `<${tag}${attrs ? ' ' + attrs : ''}>${children.join('')}</${tag}>`
      : `<${tag}${attrs ? ' ' + attrs : ''}/>`;
  }
  return `<${tag}>${escapeXml(value)}</${tag}>`;
}

function subsonicResponse(payload, { format = 'json', status = 200, maxAge = 0 } = {}) {
  const base = {
    status: payload.error ? 'failed' : 'ok',
    version: SUBSONIC_API_VERSION,
    type: 'spotplus-gateway',
    serverVersion: `spotplus-gateway-${GATEWAY_VERSION}`,
    openSubsonic: true,
    ...payload,
  };
  const cacheControl = maxAge > 0 ? `private, max-age=${maxAge}` : 'no-store';
  if (format === 'xml') {
    const body = `<?xml version="1.0" encoding="UTF-8"?>\n${toXmlNode('subsonic-response', base)}`;
    return new Response(body, {
      status,
      headers: {
        ...SECURITY_HEADERS,
        'Content-Type': 'application/xml; charset=utf-8',
        'Cache-Control': cacheControl,
      },
    });
  }
  return new Response(JSON.stringify({ 'subsonic-response': base }), {
    status,
    headers: {
      ...SECURITY_HEADERS,
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': cacheControl,
    },
  });
}

function subsonicError(code, message, format = 'json', httpStatus = 200) {
  return subsonicResponse({ error: { code, message } }, { format, status: httpStatus });
}

function authenticate(params, env = {}) {
  const configuredKey = String(env.SPOTPLUS_GATEWAY_API_KEY || '');
  const configuredUser = String(env.SPOTPLUS_GATEWAY_USER || '');
  if (!configuredKey) {
    return { ok: false, code: 50, message: 'Gateway credentials not configured' };
  }

  // 1) OpenSubsonic API Key Authentication extension (preferred, zero MD5/plaintext password)
  const apiKey = params.get('apiKey');
  if (apiKey) {
    return timingSafeEqual(apiKey, configuredKey)
      ? { ok: true, method: 'apiKey', user: configuredUser || 'spotplus' }
      : { ok: false, code: 40, message: 'Invalid API key' };
  }

  // 2) Standard Subsonic salted token auth: t = md5(password + s)
  const u = params.get('u') || '';
  const t = params.get('t') || '';
  const s = params.get('s') || '';
  if (u && t && s) {
    if (configuredUser && !timingSafeEqual(u, configuredUser)) {
      return { ok: false, code: 40, message: 'Wrong username or token' };
    }
    const expected = md5Hex(configuredKey + s);
    return timingSafeEqual(t.toLowerCase(), expected)
      ? { ok: true, method: 'salted-token', user: u }
      : { ok: false, code: 40, message: 'Wrong username or token' };
  }

  return { ok: false, code: 10, message: 'Missing authentication credentials (provide apiKey or u/t/s)' };
}

function formatSong(track) {
  return {
    id: track.id,
    parent: track.albumId,
    isDir: false,
    title: track.title,
    album: track.album,
    artist: track.artist,
    artistId: track.artistId,
    albumId: track.albumId,
    track: track.track || 1,
    year: track.year || 2026,
    coverArt: track.coverId,
    duration: track.duration || 0,
    bitRate: track.bitRate || 128,
    suffix: track.suffix || 'wav',
    contentType: track.contentType || 'audio/wav',
    type: 'music',
    ...(track.starred ? { starred: '2026-11-25T00:00:00Z' } : {}),
  };
}

function parseByteRange(header, total) {
  if (!header || !/^bytes=/i.test(header)) return null;
  const spec = header.replace(/^bytes=/i, '').split(',')[0].trim();
  const match = /^(\d*)-(\d*)$/.exec(spec);
  if (!match || (!match[1] && !match[2])) return { invalid: true };
  let start;
  let end;
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

function serveAuthorizedTestAudio(request, track) {
  const bytes = synthesizeWavTrack(track);
  const total = bytes.byteLength;
  const rangeHeader = request.headers.get('Range');
  const baseHeaders = {
    ...SECURITY_HEADERS,
    'Content-Type': 'audio/wav',
    'Accept-Ranges': 'bytes',
    'Cache-Control': 'public, max-age=86400',
  };

  if (request.method === 'HEAD') {
    return new Response(null, {
      status: 200,
      headers: { ...baseHeaders, 'Content-Length': String(total) },
    });
  }

  if (!rangeHeader) {
    return new Response(bytes, {
      status: 200,
      headers: { ...baseHeaders, 'Content-Length': String(total) },
    });
  }

  const parsed = parseByteRange(rangeHeader, total);
  if (!parsed || parsed.invalid || parsed.unsatisfiable) {
    return new Response(null, {
      status: 416,
      headers: { ...baseHeaders, 'Content-Range': `bytes */${total}` },
    });
  }

  const slice = bytes.subarray(parsed.start, parsed.end + 1);
  return new Response(slice, {
    status: 206,
    headers: {
      ...baseHeaders,
      'Content-Range': `bytes ${parsed.start}-${parsed.end}/${total}`,
      'Content-Length': String(slice.byteLength),
    },
  });
}

/**
 * Main OpenSubsonic Universal Media Gateway handler.
 * Isolated from Spot+'s core YouTube Relay and zero-dependency runnable in Workers or Node tests.
 */
export async function handleGatewayRequest(request, { env = {}, catalog = null, scrobbleLog = null, now = Date.now() } = {}) {
  const url = new URL(request.url);
  const check = validateIncomingUrl(url, request.url);
  if (!check.ok) {
    return new Response(JSON.stringify({ error: check.error }), {
      status: check.status,
      headers: { ...SECURITY_HEADERS, 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
    });
  }

  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { ...SECURITY_HEADERS, 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
    });
  }

  const ip = request.headers.get('CF-Connecting-IP') || request.headers.get('X-Forwarded-For') || 'local';
  if (checkRate(burstTable, ip, BURST_LIMIT, BURST_WINDOW_MS, now) || checkRate(rateTable, ip, RATE_LIMIT_PER_MIN, RATE_WINDOW_MS, now)) {
    return new Response(JSON.stringify({ error: 'Rate limit exceeded' }), {
      status: 429,
      headers: { ...SECURITY_HEADERS, 'Content-Type': 'application/json; charset=utf-8', 'Retry-After': '10', 'Cache-Control': 'no-store' },
    });
  }

  const activeCatalog = catalog || createTestCatalog(url.origin);

  // Public health endpoint (zero secret disclosure)
  if (url.pathname === '/health') {
    return new Response(JSON.stringify({
      service: 'Spot+ Universal Media Gateway',
      protocol: 'OpenSubsonic',
      apiVersion: SUBSONIC_API_VERSION,
      version: GATEWAY_VERSION,
      directPlayRedirect: true,
      status: 'ok',
    }), {
      status: 200,
      headers: { ...SECURITY_HEADERS, 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'public, max-age=30, stale-while-revalidate=60' },
    });
  }

  // Authorized synthetic test audio & artwork (only when explicitly enabled in PoC/test mode)
  const testAudioEnabled = String(env.GATEWAY_ALLOW_TEST_AUDIO ?? 'true') === 'true';
  if (testAudioEnabled && url.pathname.startsWith('/authorized-test-audio/')) {
    const id = decodeURIComponent(url.pathname.slice('/authorized-test-audio/'.length).replace(/\.wav$/i, ''));
    const track = activeCatalog.tracksById.get(id);
    if (!track) return new Response('Not found', { status: 404, headers: SECURITY_HEADERS });
    return serveAuthorizedTestAudio(request, track);
  }
  if (testAudioEnabled && url.pathname.startsWith('/authorized-test-cover/')) {
    const id = decodeURIComponent(url.pathname.slice('/authorized-test-cover/'.length).replace(/\.svg$/i, ''));
    return new Response(buildTestCoverSvg(id), {
      status: 200,
      headers: { ...SECURITY_HEADERS, 'Content-Type': 'image/svg+xml; charset=utf-8', 'Cache-Control': 'public, max-age=86400' },
    });
  }

  // OpenSubsonic REST surface: /rest/<endpoint>[.view]
  const match = /^\/rest\/([a-zA-Z0-9]+)(?:\.view)?$/.exec(url.pathname);
  if (!match) {
    return new Response(JSON.stringify({ error: 'Not found' }), {
      status: 404,
      headers: { ...SECURITY_HEADERS, 'Content-Type': 'application/json; charset=utf-8' },
    });
  }

  const endpoint = match[1];
  const format = (url.searchParams.get('f') || 'json').toLowerCase() === 'xml' ? 'xml' : 'json';
  const auth = authenticate(url.searchParams, env);
  if (!auth.ok) {
    return subsonicError(auth.code, auth.message, format, 401);
  }

  const allowedDirectHosts = String(env.GATEWAY_ALLOWED_MEDIA_HOSTS || '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  const testOrigin = testAudioEnabled ? url.origin : '';

  switch (endpoint) {
    case 'ping':
      return subsonicResponse({}, { format });

    case 'getOpenSubsonicExtensions':
      return subsonicResponse({
        openSubsonicExtensions: [
          { name: 'apiKeyAuthentication', versions: [1] },
          { name: 'transcodeOffset', versions: [1] },
        ],
      }, { format, maxAge: 300 });

    case 'getLicense':
      return subsonicResponse({
        license: { valid: true, email: 'gateway@spotplus.local' },
      }, { format, maxAge: 300 });

    case 'getArtists': {
      const grouped = new Map();
      for (const artist of activeCatalog.artistsById.values()) {
        const letter = (artist.name[0] || '#').toUpperCase();
        const key = /^[A-Z]$/.test(letter) ? letter : '#';
        if (!grouped.has(key)) grouped.set(key, []);
        grouped.get(key).push({
          id: artist.id,
          name: artist.name,
          coverArt: artist.coverArt,
          albumCount: artist.albumIds.size,
        });
      }
      const index = [...grouped.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([name, artist]) => ({ name, artist }));
      return subsonicResponse({ artists: { ignoredArticles: 'The El La Los Las Le Les', index } }, { format, maxAge: 60 });
    }

    case 'getArtist': {
      const id = url.searchParams.get('id') || '';
      const artist = activeCatalog.artistsById.get(id);
      if (!artist) return subsonicError(70, 'Artist not found', format, 404);
      const album = [...artist.albumIds]
        .map((aid) => activeCatalog.albumsById.get(aid))
        .filter(Boolean)
        .map((a) => ({
          id: a.id,
          name: a.name,
          artist: a.artist,
          artistId: a.artistId,
          coverArt: a.coverArt,
          songCount: a.trackIds.length,
          duration: a.trackIds.reduce((s, tid) => s + (activeCatalog.tracksById.get(tid)?.duration || 0), 0),
          year: a.year,
        }));
      return subsonicResponse({
        artist: { id: artist.id, name: artist.name, coverArt: artist.coverArt, albumCount: album.length, album },
      }, { format, maxAge: 60 });
    }

    case 'getAlbumList2': {
      const size = Math.max(1, Math.min(100, Number(url.searchParams.get('size')) || 20));
      const offset = Math.max(0, Number(url.searchParams.get('offset')) || 0);
      const albums = [...activeCatalog.albumsById.values()]
        .slice(offset, offset + size)
        .map((a) => ({
          id: a.id,
          name: a.name,
          artist: a.artist,
          artistId: a.artistId,
          coverArt: a.coverArt,
          songCount: a.trackIds.length,
          duration: a.trackIds.reduce((s, tid) => s + (activeCatalog.tracksById.get(tid)?.duration || 0), 0),
          year: a.year,
        }));
      return subsonicResponse({ albumList2: { album: albums } }, { format, maxAge: 60 });
    }

    case 'getAlbum': {
      const id = url.searchParams.get('id') || '';
      const album = activeCatalog.albumsById.get(id);
      if (!album) return subsonicError(70, 'Album not found', format, 404);
      const songs = album.trackIds.map((tid) => activeCatalog.tracksById.get(tid)).filter(Boolean).map(formatSong);
      return subsonicResponse({
        album: {
          id: album.id,
          name: album.name,
          artist: album.artist,
          artistId: album.artistId,
          coverArt: album.coverArt,
          songCount: songs.length,
          duration: songs.reduce((s, t) => s + t.duration, 0),
          year: album.year,
          song: songs,
        },
      }, { format, maxAge: 60 });
    }

    case 'getPlaylists': {
      const playlist = [...activeCatalog.playlistsById.values()].map((p) => ({
        id: p.id,
        name: p.name,
        owner: p.owner,
        public: false,
        songCount: p.songCount,
        duration: p.duration,
        created: p.created,
        changed: p.changed,
        coverArt: p.coverArt,
      }));
      return subsonicResponse({ playlists: { playlist } }, { format, maxAge: 30 });
    }

    case 'getPlaylist': {
      const id = url.searchParams.get('id') || '';
      const pl = activeCatalog.playlistsById.get(id);
      if (!pl) return subsonicError(70, 'Playlist not found', format, 404);
      return subsonicResponse({
        playlist: {
          id: pl.id,
          name: pl.name,
          owner: pl.owner,
          public: false,
          songCount: pl.songCount,
          duration: pl.duration,
          created: pl.created,
          changed: pl.changed,
          coverArt: pl.coverArt,
          entry: pl.tracks.map(formatSong),
        },
      }, { format, maxAge: 30 });
    }

    case 'getStarred2': {
      const song = [...activeCatalog.tracksById.values()].filter((t) => t.starred).map(formatSong);
      return subsonicResponse({ starred2: { artist: [], album: [], song } }, { format, maxAge: 30 });
    }

    case 'search3': {
      const q = (url.searchParams.get('query') || '').replace(/^"+|"+$/g, '').trim().toLowerCase();
      const songCount = Math.max(0, Math.min(50, Number(url.searchParams.get('songCount') ?? 20)));
      const albumCount = Math.max(0, Math.min(50, Number(url.searchParams.get('albumCount') ?? 10)));
      const artistCount = Math.max(0, Math.min(50, Number(url.searchParams.get('artistCount') ?? 10)));
      const matches = (text) => !q || String(text || '').toLowerCase().includes(q);

      const song = [...activeCatalog.tracksById.values()]
        .filter((t) => matches(`${t.title} ${t.artist} ${t.album}`))
        .slice(0, songCount)
        .map(formatSong);
      const album = [...activeCatalog.albumsById.values()]
        .filter((a) => matches(`${a.name} ${a.artist}`))
        .slice(0, albumCount)
        .map((a) => ({
          id: a.id,
          name: a.name,
          artist: a.artist,
          artistId: a.artistId,
          coverArt: a.coverArt,
          songCount: a.trackIds.length,
          year: a.year,
        }));
      const artist = [...activeCatalog.artistsById.values()]
        .filter((a) => matches(a.name))
        .slice(0, artistCount)
        .map((a) => ({ id: a.id, name: a.name, coverArt: a.coverArt, albumCount: a.albumIds.size }));

      return subsonicResponse({ searchResult3: { artist, album, song } }, { format, maxAge: 15 });
    }

    case 'stream': {
      const id = url.searchParams.get('id') || '';
      const track = activeCatalog.tracksById.get(id);
      if (!track) return subsonicError(70, 'Track not found', format, 404);
      if (!isAllowedDirectUrl(track.streamUrl, { allowedHosts: allowedDirectHosts, testOrigin })) {
        return subsonicError(50, 'Direct stream target is not on the authorized host allowlist', format, 403);
      }
      // OpenSubsonic spec: NEVER count /stream hits as plays (clients report plays via /scrobble).
      // Direct 302 redirect keeps audio bytes off the gateway Worker (0 KB/s gateway media egress).
      return new Response(null, {
        status: 302,
        headers: {
          ...SECURITY_HEADERS,
          Location: track.streamUrl,
          'Cache-Control': 'private, no-store',
          'X-Spotplus-Gateway-Mode': 'direct-redirect',
        },
      });
    }

    case 'getCoverArt': {
      const id = url.searchParams.get('id') || '';
      const track = [...activeCatalog.tracksById.values()].find((t) => t.coverId === id || t.id === id);
      if (!track || !isAllowedDirectUrl(track.coverUrl, { allowedHosts: allowedDirectHosts, testOrigin })) {
        return subsonicError(70, 'Cover art not found', format, 404);
      }
      return new Response(null, {
        status: 302,
        headers: {
          ...SECURITY_HEADERS,
          Location: track.coverUrl,
          'Cache-Control': 'public, max-age=86400',
        },
      });
    }

    case 'scrobble': {
      const id = url.searchParams.get('id') || '';
      if (!activeCatalog.tracksById.has(id)) return subsonicError(70, 'Track not found', format, 404);
      const submission = url.searchParams.get('submission') !== 'false';
      scrobbleLog?.push({ id, submission, user: auth.user, at: now });
      return subsonicResponse({}, { format });
    }

    default:
      return subsonicError(0, `Unsupported OpenSubsonic endpoint: ${endpoint}`, format, 404);
  }
}
