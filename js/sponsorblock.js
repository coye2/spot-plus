// SponsorBlock "non-music" skipping, as in Spotube: when a song plays from a YouTube upload that has a spoken
// intro, a skit or a long outro, jump over the parts the SponsorBlock community marked as not music.
const API = 'https://sponsor.ajay.app/api/skipSegments';
const KEY = 'spotplus.sponsorblock';
const DAY = 864e5;
const memory = new Map();

function readStore(storage) {
  try { return JSON.parse(storage?.getItem(KEY) || '{}') || {}; } catch { return {}; }
}

/** Non-music segments for a YouTube video: [[start, end], ...] in seconds (cached for a week). */
export async function segmentsFor(videoId, {fetcher = globalThis.fetch, storage = globalThis.localStorage, now = Date.now()} = {}) {
  if (!/^[\w-]{11}$/.test(String(videoId || ''))) return [];
  if (memory.has(videoId)) return memory.get(videoId);
  const stored = readStore(storage)[videoId];
  if (stored && now - stored.at < 7 * DAY) { memory.set(videoId, stored.s); return stored.s; }
  let list = [];
  try {
    const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), 4000);
    const r = await fetcher(`${API}?videoID=${videoId}&categories=${encodeURIComponent('["music_offtopic"]')}`, {signal: ctl.signal, credentials: 'omit'}).finally(() => clearTimeout(timer));
    if (r.ok) list = (await r.json()).map((x) => x?.segment).filter((s) => Array.isArray(s) && s[1] - s[0] >= 1).map(([a, b]) => [Math.max(0, +a), +b]);
    else if (r.status !== 404) return []; // try again next time; 404 means "no segments" and is cached
  } catch { return []; }
  memory.set(videoId, list);
  try {
    const all = readStore(storage);
    all[videoId] = {at: now, s: list};
    const ids = Object.keys(all);
    if (ids.length > 800) for (const id of ids.slice(0, ids.length - 800)) delete all[id];
    storage?.setItem(KEY, JSON.stringify(all));
  } catch { /* storage full */ }
  return list;
}

/**
 * Where to jump to from `time`, or null to keep playing. A segment that runs to (nearly) the end of the
 * upload returns Infinity: the song is over.
 */
export function skipTarget(segments, time, duration) {
  for (const [start, end] of segments || []) {
    if (time >= start && time < end - 0.3) return duration && end >= duration - 1 ? Infinity : end;
  }
  return null;
}
