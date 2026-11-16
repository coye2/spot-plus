/* Spot+ notifications: app updates, new releases from saved artists, a weekly listening recap.
   Built to stay quiet: one notification per kind at most, a daily cap, quiet hours, and nothing
   until the person turns notifications on. */
const KEY = 'spotplus.notify';
const DAY = 86400000, WEEK = 7 * DAY;
export const DAILY_CAP = 2;
export const QUIET = { start: 22, end: 8 };

export function loadState(storage = globalThis.localStorage) {
  try { return JSON.parse(storage.getItem(KEY)) || {}; } catch { return {}; }
}
export function saveState(state, storage = globalThis.localStorage) {
  try { storage.setItem(KEY, JSON.stringify(state)); } catch { /* storage full or blocked */ }
}

export const isQuiet = (now = Date.now()) => { const h = new Date(now).getHours(); return h >= QUIET.start || h < QUIET.end; };

/** Whether a notification of this kind may be sent now. Updates ignore quiet hours only when the app is open. */
export function canSend(state, kind, now = Date.now(), { visible = false } = {}) {
  const sent = (state.sent || []).filter(t => t > now - DAY);
  if (sent.length >= DAILY_CAP) return false;
  if (!visible && isQuiet(now)) return false;
  const gap = { update: DAY, release: DAY, stats: 6 * DAY }[kind] ?? DAY;
  return !(state.last?.[kind] > now - gap);
}
export function markSent(state, kind, now = Date.now()) {
  return { ...state, sent: [...(state.sent || []).filter(t => t > now - DAY), now], last: { ...state.last, [kind]: now } };
}

/** Releases newer than what was already seen, from the last 14 days. First sight of an artist only records, never notifies. */
export function pickNewReleases(seen = {}, releasesByArtist = {}, now = Date.now()) {
  const fresh = [], nextSeen = { ...seen };
  for (const [artistId, releases] of Object.entries(releasesByArtist)) {
    const dated = releases.filter(r => /^\d{4}-\d{2}-\d{2}$/.test(r.released) && Date.parse(r.released) <= now);
    if (!dated.length) continue;
    const newest = dated.reduce((a, r) => (r.released > a ? r.released : a), '');
    if (seen[artistId] !== undefined) {
      for (const r of dated) if (r.released > seen[artistId] && Date.parse(r.released) > now - 14 * DAY) fresh.push(r);
    }
    nextSeen[artistId] = seen[artistId] && seen[artistId] > newest ? seen[artistId] : newest;
  }
  fresh.sort((a, b) => b.released.localeCompare(a.released));
  return { fresh, seen: nextSeen };
}

export function releaseMessage(fresh) {
  if (!fresh.length) return null;
  const [first] = fresh, kind = first.type === 'single' ? 'single' : first.type === 'ep' ? 'EP' : 'album';
  if (fresh.length === 1) return { title: `New ${kind} from ${first.artist}`, body: first.title, url: `#/album/${first.id}`, image: first.cover };
  const names = [...new Set(fresh.map(r => r.artist))];
  return { title: `${fresh.length} new releases`, body: `${names.slice(0, 2).join(', ')}${names.length > 2 ? ' and more' : ''}`, url: '#/library', image: first.cover };
}

/** A short weekly recap from listening records ({endedAt, ms, artist}). */
export function weeklyRecap(records = [], now = Date.now()) {
  const week = records.filter(r => r.endedAt > now - WEEK && r.endedAt <= now);
  const minutes = Math.round(week.reduce((n, r) => n + (r.ms || 0), 0) / 60000);
  if (minutes < 30) return null;
  const counts = new Map();
  for (const r of week) counts.set(r.artist, (counts.get(r.artist) || 0) + (r.ms || 0));
  const top = [...counts].sort((a, b) => b[1] - a[1])[0]?.[0];
  return { title: 'Your week in music', body: `${minutes.toLocaleString()} minutes${top ? ` · Most played: ${top}` : ''}`, url: '#/rewind' };
}

export const supported = () => typeof Notification !== 'undefined' && 'serviceWorker' in navigator;
export const permission = () => (supported() ? Notification.permission : 'unsupported');

export async function show({ title, body, url = '#/home', image = '' }, tag) {
  if (permission() !== 'granted') return false;
  try {
    const reg = await navigator.serviceWorker.ready;
    await reg.showNotification(title, { body, tag: 'spotplus-' + tag, renotify: false, icon: image || 'icons/icon-192.png', badge: 'icons/icon-192.png', data: { url } });
    return true;
  } catch { return false; }
}
