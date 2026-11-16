// Your library on all your devices, and playlists shared with friends. No accounts:
// everything is encrypted on the device and stored on public relays under a secret key
// that only your devices (or people with the share link) know.
import {publishSnapshot, fetchSnapshot} from './relay-sync.js';

const hex = buf => [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
/** A separate 64-hex key per purpose, derived from a secret. */
export async function derive(secret, label) { return hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`spotplus:${label}:${secret}`))); }

const byId = list => new Map((list || []).filter(x => x && x.id != null).map(x => [String(x.id), x]));
function unionBy(a = [], b = []) { const out = byId(a); for (const [id, x] of byId(b)) if (!out.has(id)) out.set(id, x); return [...out.values()]; }

/** Combine two libraries without losing anything (used when linking a device, or after edits on both). */
export function mergeLibraries(local, remote) {
  const playlists = byId(local.playlists);
  for (const [id, p] of byId(remote.playlists)) {
    const mine = playlists.get(id);
    if (!mine) playlists.set(id, p);
    else if ((p.updated || 0) > (mine.updated || 0)) playlists.set(id, {...p, tracks: unionBy(p.tracks, mine.updated > (p.syncedAt || 0) ? mine.tracks : [])});
  }
  return {likes: unionBy(remote.likes, local.likes), playlists: [...playlists.values()], albums: unionBy(remote.albums, local.albums),
    artists: unionBy(remote.artists, local.artists), folders: unionBy(remote.folders, local.folders)};
}

/* ---------------- Device sync ---------------- */
const STATE = 'spotplus.librarySync';
export function syncState(storage = globalThis.localStorage) { try { return JSON.parse(storage.getItem(STATE) || 'null'); } catch { return null; } }
function saveState(value, storage = globalThis.localStorage) { try { value ? storage.setItem(STATE, JSON.stringify(value)) : storage.removeItem(STATE); } catch { /* storage blocked */ } }
export const pairLink = (base, key) => `${base}#/pair/${key}`;

/**
 * One sync round. Pulls the newest copy; if another device changed things since we last synced,
 * adopts or merges it; if we changed things, publishes ours.
 */
export async function syncLibrary({secret, store, dirty, fetcher = fetchSnapshot, publisher = publishSnapshot, now = Date.now()}) {
  const key = await derive(secret, 'library'), state = syncState() || {syncedAt: 0};
  const remote = await fetcher(key).catch(() => null);
  let changed = false;
  if (remote?.updatedAt > state.syncedAt) {
    const next = dirty ? mergeLibraries(store.librarySnapshot(), remote.library) : remote.library;
    store.replaceLibrary(next); changed = true;
  }
  if (dirty || !remote) {
    await publisher(key, {updatedAt: now, library: store.librarySnapshot()});
  }
  saveState({syncedAt: Math.max(now, remote?.updatedAt || 0)});
  return changed;
}
export const stopSync = () => saveState(null);

/* ---------------- Shared playlists ---------------- */
const ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';
export function newShareCode() { return [...crypto.getRandomValues(new Uint8Array(12))].map(b => ALPHABET[b % ALPHABET.length]).join(''); }
export const validShareCode = code => /^[a-z2-9]{12}$/.test(code || '');
export const shareLink = (base, code) => `${base}#/collab/${code}`;

export async function publishShared(code, playlist, {publisher = publishSnapshot, now = Date.now()} = {}) {
  return publisher(await derive(code, 'collab'), {updatedAt: now, name: playlist.name, tracks: playlist.tracks});
}
export async function fetchShared(code, {fetcher = fetchSnapshot} = {}) { return fetcher(await derive(code, 'collab')); }

/** Bring a shared playlist up to date. Edits made here since the last sync are kept and sent back. */
export function applyShared(local, remote) {
  const localEdited = (local.updated || 0) > (local.syncedAt || 0);
  if (!remote || (remote.updatedAt || 0) <= (local.syncedAt || 0)) return {playlist: local, publish: localEdited};
  const tracks = localEdited ? unionBy(remote.tracks, local.tracks) : remote.tracks;
  return {playlist: {...local, name: remote.name || local.name, tracks, syncedAt: remote.updatedAt, updated: localEdited ? Date.now() : remote.updatedAt}, publish: localEdited};
}
