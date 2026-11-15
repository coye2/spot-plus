// Automatic Spotify stats sync, with no Spot+ server and no account.
// Spot+ and the Spotify helper share a random link key (passed once, in the
// connection link's #fragment, which never reaches Spotify's servers). Whenever a
// Spotify web tab is open, the helper publishes an encrypted, compressed snapshot of
// your top music and recent plays to several public Nostr relays as a NIP-78
// "application data" event. The key derives a fixed signing key and a hidden address,
// so each new snapshot *replaces* the last one. Spot+ fetches the newest on launch.
// Relays only ever store random-looking bytes.
import {schnorr, sha256, bytesToHex, hexToBytes} from './vendor/nostr-sign.js';

export const SYNC_RELAYS = ['wss://relay.primal.net', 'wss://nos.lol', 'wss://relay.damus.io', 'wss://nostr.mom', 'wss://relay.nostr.band'];
const KIND = 30078, enc = new TextEncoder(), dec = new TextDecoder();
export const validSyncKey = key => /^[a-f0-9]{64}$/.test(key || '');
export function newSyncKey() { return bytesToHex(crypto.getRandomValues(new Uint8Array(32))); }
const b64 = bytes => { let s = ''; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000)); return btoa(s); };
const unb64 = text => Uint8Array.from(atob(text), c => c.charCodeAt(0));

export async function syncIdentity(syncKey) {
  if (!validSyncKey(syncKey)) throw new Error('Invalid sync key');
  const raw = hexToBytes(syncKey);
  const secret = sha256(new Uint8Array([...enc.encode('spotplus-sync-sign:'), ...raw]));
  const address = bytesToHex(sha256(new Uint8Array([...enc.encode('spotplus-sync-address:'), ...raw]))).slice(0, 40);
  const key = await crypto.subtle.importKey('raw', sha256(new Uint8Array([...enc.encode('spotplus-sync-encrypt:'), ...raw])), 'AES-GCM', false, ['encrypt', 'decrypt']);
  return {secret, pubkey: bytesToHex(schnorr.getPublicKey(secret)), address, key};
}
async function gzip(bytes, mode) {
  const stream = new Blob([bytes]).stream().pipeThrough(mode === 'c' ? new CompressionStream('gzip') : new DecompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}
export async function sealSnapshot(identity, value) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const packed = await gzip(enc.encode(JSON.stringify(value)), 'c');
  const data = new Uint8Array(await crypto.subtle.encrypt({name: 'AES-GCM', iv}, identity.key, packed));
  return b64(iv) + '.' + b64(data);
}
export async function openSnapshot(identity, text) {
  const [iv, data] = String(text).split('.');
  const packed = new Uint8Array(await crypto.subtle.decrypt({name: 'AES-GCM', iv: unb64(iv)}, identity.key, unb64(data)));
  if (packed.length > 2_000_000) throw new Error('Snapshot too large');
  const json = dec.decode(await gzip(packed, 'd'));
  if (json.length > 4_000_000) throw new Error('Snapshot too large');
  return JSON.parse(json);
}
function signed(identity, content, created_at = Math.floor(Date.now() / 1000)) {
  const tags = [['d', identity.address]];
  const id = bytesToHex(sha256(enc.encode(JSON.stringify([0, identity.pubkey, created_at, KIND, tags, content]))));
  return {id, pubkey: identity.pubkey, created_at, kind: KIND, tags, content, sig: bytesToHex(schnorr.sign(id, identity.secret))};
}
function talk(url, WebSocketImpl, onOpen, onMessage, timeout) {
  return new Promise(resolve => {
    let ws, done = false;
    const finish = value => { if (done) return; done = true; clearTimeout(timer); try { ws?.close(); } catch { /* Closed. */ } resolve(value); };
    const timer = setTimeout(() => finish(null), timeout);
    try { ws = new (WebSocketImpl || globalThis.WebSocket)(url); } catch { return finish(null); }
    ws.onopen = () => onOpen(ws);
    ws.onmessage = e => { try { const m = JSON.parse(e.data); const r = onMessage(m); if (r !== undefined) finish(r); } catch { /* Ignore. */ } };
    ws.onerror = () => finish(null); ws.onclose = () => finish(null);
  });
}
/** Publish a snapshot to every relay. Resolves with how many relays accepted it. */
export async function publishSnapshot(syncKey, value, {relays = SYNC_RELAYS, WebSocketImpl = null, timeout = 8000} = {}) {
  const identity = await syncIdentity(syncKey), event = signed(identity, await sealSnapshot(identity, value));
  const results = await Promise.all(relays.map(url => talk(url, WebSocketImpl, ws => ws.send(JSON.stringify(['EVENT', event])), m => m[0] === 'OK' && m[1] === event.id ? !!m[2] : undefined, timeout)));
  return results.filter(Boolean).length;
}
/** Fetch the newest snapshot from all relays (null when none). */
export async function fetchSnapshot(syncKey, {relays = SYNC_RELAYS, WebSocketImpl = null, timeout = 6000, settle = 450} = {}) {
  const identity = await syncIdentity(syncKey);
  const filter = {kinds: [KIND], authors: [identity.pubkey], '#d': [identity.address], limit: 1};
  const valid = e => {
    if (!e || e.kind !== KIND || e.pubkey !== identity.pubkey || !e.tags?.some(([k, v]) => k === 'd' && v === identity.address)) return false;
    const id = bytesToHex(sha256(enc.encode(JSON.stringify([0, e.pubkey, e.created_at, e.kind, e.tags, e.content]))));
    try { return id === e.id && schnorr.verify(e.sig, e.id, e.pubkey); } catch { return false; }
  };
  // Answer as soon as the first relay has a copy (plus a short window for a newer one),
  // instead of waiting for slow or unreachable relays.
  const found = await new Promise(resolve => {
    const events = []; let pending = relays.length, timer = null;
    const done = () => { clearTimeout(timer); resolve(events); };
    const hardStop = setTimeout(done, timeout);
    for (const url of relays) {
      let newest = null;
      talk(url, WebSocketImpl, ws => ws.send(JSON.stringify(['REQ', 'sync', filter])), m => {
        if (m[0] === 'EVENT' && valid(m[2]) && (!newest || m[2].created_at > newest.created_at)) newest = m[2];
        return m[0] === 'EOSE' || m[0] === 'CLOSED' ? newest : undefined;
      }, timeout).then(event => {
        if (event) { events.push(event); if (!timer) timer = setTimeout(() => { clearTimeout(hardStop); done(); }, settle); }
        if (--pending === 0) { clearTimeout(hardStop); done(); }
      });
    }
  });
  for (const e of found.sort((a, b) => b.created_at - a.created_at)) { try { return await openSnapshot(identity, e.content); } catch { /* Try another copy. */ } }
  return null;
}
