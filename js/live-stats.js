// Live counters from the Spot+ bridge: installs (each device counted once) and people listening now.
import { scheduler, PRIORITY } from './request-scheduler.js';
export const STATS_URL = 'https://spot-plus-canvas.pwr97pnmkn.workers.dev';
const DEVICE = 'spotplus.device', COUNTED = 'spotplus.installCounted';
export function deviceId(storage = globalThis.localStorage) {
  try {
    let id = storage.getItem(DEVICE);
    if (!/^[a-f0-9]{32}$/.test(id || '')) { id = [...crypto.getRandomValues(new Uint8Array(16))].map(b => b.toString(16).padStart(2, '0')).join(''); storage.setItem(DEVICE, id); }
    return id;
  } catch { return ''; }
}
const post = (path, body) => scheduler.schedule(
  PRIORITY.ANALYTICS,
  () => fetch(STATS_URL + path, {method: 'POST', body: JSON.stringify(body), credentials: 'omit'})
    .then(r => { scheduler.noteStatus(r.status); return r.ok ? r.json() : null; })
    .catch(() => null),
  { fallbackValue: null },
);

/** Count this device once, the first time Spot+ runs as an installed app. */
export async function countInstall({standalone, storage = globalThis.localStorage} = {}) {
  try { if (!standalone || storage.getItem(COUNTED)) return null; } catch { return null; }
  const id = deviceId(storage); if (!id) return null;
  const data = await post('/installs', {device: id});
  if (data) try { storage.setItem(COUNTED, '1'); } catch { /* storage blocked */ }
  return data;
}
let lastBeat = 0, lastPlaying = null;
/** Check in while music plays (about every 4 minutes), and once when it stops. */
export function heartbeat(playing) {
  const now = Date.now();
  if (playing === lastPlaying && now - lastBeat < 230_000) return null;
  if (!playing && !lastPlaying) return null;
  if (!scheduler.canRun(PRIORITY.ANALYTICS)) return null;
  lastBeat = now; lastPlaying = playing;
  const id = deviceId(); if (!id) return null;
  return post('/listening', {device: id, playing});
}
export async function stats() {
  if (!scheduler.canRun(PRIORITY.ANALYTICS)) return null;
  try {
    const r = await fetch(STATS_URL + '/stats', {credentials: 'omit'});
    scheduler.noteStatus(r.status);
    return r.ok ? await r.json() : null;
  } catch { return null; }
}
export const formatCount = n => Number(n || 0).toLocaleString('en-US');
