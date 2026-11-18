// /stream: resolve a YouTube video id to a direct audio URL from Cloudflare's edge.
// Browser clients can no longer rely on public Invidious/Piped CORS mirrors (most are
// down or return 403). The bridge talks to YouTube InnerTube (ANDROID_VR) and, as a
// fallback, server-side Invidious/Piped — then returns a short-lived googlevideo URL.
const headers = {
  'Content-Type': 'application/json; charset=utf-8',
  'X-Content-Type-Options': 'nosniff',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
};
const reply = (data, status = 200, maxAge = 0) => new Response(JSON.stringify(data), {
  status,
  headers: {...headers, 'Cache-Control': maxAge ? `public, max-age=${maxAge}` : 'no-store'},
});

const ANDROID_VR_VERSION = '1.65.10';
const ANDROID_VR_UA = `com.google.android.apps.youtube.vr.oculus/${ANDROID_VR_VERSION} (Linux; U; Android 12L; eureka-user Build/SQ3A.220605.009.A1) gzip`;
const PLAYER = 'https://www.youtube.com/youtubei/v1/player';
const VISITOR = 'https://youtubei.googleapis.com/youtubei/v1/visitor_id';

// Prefer AAC for InstantPlay on iPhone; Opus is fine elsewhere when the client asks.
export const AUDIO_ITAGS = {aac: 140, opus: 251, opus70: 250, opus50: 249};

let visitorData = '';
let visitorFetched = 0;

function clientContext() {
  const client = {
    clientName: 'ANDROID_VR',
    clientVersion: ANDROID_VR_VERSION,
    deviceMake: 'Oculus',
    deviceModel: 'Quest 3',
    androidSdkVersion: 32,
    osName: 'Android',
    osVersion: '12L',
    userAgent: ANDROID_VR_UA,
    hl: 'en',
    gl: 'US',
    timeZone: 'UTC',
    utcOffsetMinutes: 0,
  };
  if (visitorData) client.visitorData = visitorData;
  return {client};
}

export async function ensureVisitor(fetcher = fetch, {force = false} = {}) {
  if (visitorData && !force && Date.now() - visitorFetched < 6 * 3600e3) return visitorData;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 4000);
  try {
    const response = await fetcher(VISITOR, {
      method: 'POST',
      signal: controller.signal,
      headers: {'Content-Type': 'application/json', 'User-Agent': ANDROID_VR_UA},
      body: JSON.stringify({context: {client: {clientName: 'ANDROID_VR', clientVersion: ANDROID_VR_VERSION}}}),
    });
    if (!response.ok) return visitorData;
    const data = await response.json();
    const next = data?.responseContext?.visitorData || '';
    if (next) { visitorData = next; visitorFetched = Date.now(); }
    return visitorData;
  } catch { return visitorData; }
  finally { clearTimeout(timer); }
}

export function pickAudioFormat(formats, {preferAac = false} = {}) {
  const direct = (formats || []).filter(f =>
    typeof f?.url === 'string' && f.url.startsWith('https://') &&
    String(f.mimeType || f.type || '').toLowerCase().startsWith('audio/'));
  if (!direct.length) return null;
  const order = preferAac
    ? [AUDIO_ITAGS.aac, AUDIO_ITAGS.opus, AUDIO_ITAGS.opus70, AUDIO_ITAGS.opus50]
    : [AUDIO_ITAGS.opus, AUDIO_ITAGS.aac, AUDIO_ITAGS.opus70, AUDIO_ITAGS.opus50];
  for (const itag of order) {
    const hit = direct.find(f => Number(f.itag) === itag);
    if (hit) return hit;
  }
  return direct.sort((a, b) => (Number(b.bitrate) || 0) - (Number(a.bitrate) || 0))[0];
}

export function shapeStream(format, videoId, engine = 'bridge') {
  const mime = String(format.mimeType || format.type || 'audio/mp4');
  return {
    url: format.url,
    mime,
    bitrate: Number(format.bitrate) || (Number(format.itag) === 251 ? 160000 : 128000),
    itag: Number(format.itag) || null,
    videoId,
    kind: 'bridge',
    instance: 'https://spot-plus-canvas.pwr97pnmkn.workers.dev',
    engine,
    fast: true,
    alternatives: [],
  };
}

async function innertubeStream(videoId, {fetcher, preferAac}) {
  await ensureVisitor(fetcher);
  const attempt = async () => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    try {
      const response = await fetcher(PLAYER, {
        method: 'POST',
        signal: controller.signal,
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': ANDROID_VR_UA,
          'X-YouTube-Client-Name': '28',
          'X-YouTube-Client-Version': ANDROID_VR_VERSION,
          'Accept-Language': 'en-US,en;q=0.9',
        },
        body: JSON.stringify({
          context: clientContext(),
          videoId,
          contentCheckOk: true,
          racyCheckOk: true,
        }),
      });
      if (!response.ok) return {error: `HTTP ${response.status}`};
      const data = await response.json();
      const status = data?.playabilityStatus?.status || '';
      if (status && status !== 'OK') {
        return {error: status, reason: data?.playabilityStatus?.reason || '', login: status === 'LOGIN_REQUIRED'};
      }
      const formats = data?.streamingData?.adaptiveFormats || data?.streamingData?.formats || [];
      const picked = pickAudioFormat(formats, {preferAac});
      if (!picked) return {error: 'No direct audio URL'};
      return {stream: shapeStream(picked, videoId, 'innertube')};
    } catch (error) {
      return {error: String(error?.message || error).slice(0, 160)};
    } finally { clearTimeout(timer); }
  };
  let result = await attempt();
  if (result.login) {
    await ensureVisitor(fetcher, {force: true});
    result = await attempt();
  }
  return result;
}

const MIRROR_BASES = [
  ['invidious', 'https://yt.chocolatemoo53.com'],
  ['invidious', 'https://inv.nadeko.net'],
  ['invidious', 'https://invidious.nerdvpn.de'],
  ['invidious', 'https://yewtu.be'],
  ['piped', 'https://pipedapi.adminforge.de'],
  ['piped', 'https://api.piped.private.coffee'],
  ['piped', 'https://pipedapi.kavin.rocks'],
  ['piped', 'https://pipedapi.reallyaweso.me'],
];

async function mirrorStream(videoId, {fetcher, preferAac}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10000);
  try {
    const attempts = MIRROR_BASES.map(async ([kind, base]) => {
      if (kind === 'invidious') {
        const response = await fetcher(`${base}/api/v1/videos/${videoId}?fields=adaptiveFormats,title,error`, {
          signal: controller.signal,
          headers: {'Accept': 'application/json', 'User-Agent': ANDROID_VR_UA},
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const data = await response.json();
        const formats = (data.adaptiveFormats || [])
          .filter(f => String(f.type || '').startsWith('audio/'))
          .map(f => ({
            url: f.url || `${base}/latest_version?id=${videoId}&itag=${f.itag}&local=true`,
            mimeType: f.type,
            bitrate: Number(f.bitrate) || 0,
            itag: Number(f.itag) || 0,
          }));
        const picked = pickAudioFormat(formats, {preferAac});
        if (!picked) throw new Error('No audio');
        return shapeStream(picked, videoId, base);
      }
      const response = await fetcher(`${base}/streams/${videoId}`, {
        signal: controller.signal,
        headers: {'Accept': 'application/json', 'User-Agent': ANDROID_VR_UA},
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json();
      const formats = (data.audioStreams || []).map(s => ({
        url: s.url,
        mimeType: s.mimeType || '',
        bitrate: Number(s.bitrate) || 0,
        itag: Number(s.itag) || 0,
      }));
      const picked = pickAudioFormat(formats, {preferAac});
      if (!picked) throw new Error('No audio');
      return shapeStream(picked, videoId, base);
    });
    return {stream: await Promise.any(attempts.map(p => p.then(stream => {
      if (!stream?.url) throw new Error('empty');
      return stream;
    })))};
  } catch (error) {
    return {error: String(error?.message || error).slice(0, 160)};
  } finally { clearTimeout(timer); }
}

export async function youtubeStream(request, {fetcher = fetch, cache, waitUntil = () => {}} = {}) {
  const url = new URL(request.url);
  const id = (url.searchParams.get('id') || '').trim();
  if (!/^[\w-]{11}$/.test(id)) return reply({error: 'Provide a YouTube video id'}, 400);
  const preferAac = url.searchParams.get('aac') === '1' || url.searchParams.get('format') === 'aac';
  const key = new Request(`${url.origin}/stream?id=${id}&aac=${preferAac ? '1' : '0'}`);
  const cached = await cache?.match(key);
  if (cached) return cached;

  const innertube = await innertubeStream(id, {fetcher, preferAac});
  const resolved = innertube.stream ? innertube : await mirrorStream(id, {fetcher, preferAac});
  if (!resolved.stream) return reply({error: 'No audio server answered', detail: resolved.error || innertube.error || ''}, 503);

  const result = reply(resolved.stream, 200, 300);
  if (cache) waitUntil(cache.put(key, result.clone()).catch(() => {}));
  return result;
}
