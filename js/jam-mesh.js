// Serverless Jam transport. No Spot+ server and no accounts: devices meet on several
// public Nostr relays at once (an open, decentralized relay network) using throwaway
// keys made on the device, and talk with *ephemeral* events that relays forward but
// never store. Every message is end-to-end encrypted (AES-GCM) with a key derived
// from the Jam code, so relays only ever see random-looking bytes.
//
// MeshSocket looks like a WebSocket to Jam (onopen/onmessage/onclose/send/close), and
// the host's device runs the room itself: it keeps the member list, welcomes
// newcomers with the current state, and ends the room when it leaves.
import {schnorr, sha256, bytesToHex} from './vendor/nostr-sign.js';

export const RELAYS = ['wss://relay.primal.net', 'wss://nos.lol', 'wss://relay.damus.io', 'wss://nostr.mom', 'wss://relay.nostr.band'];
const KIND = 25890; // Ephemeral range (20000–29999): forwarded, never stored.
const enc = new TextEncoder(), dec = new TextDecoder();
const b64 = bytes => { let s = ''; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000)); return btoa(s); };
const unb64 = text => Uint8Array.from(atob(text), c => c.charCodeAt(0));

/** Room topic and encryption key, both derived from the code (the topic reveals nothing about the key). */
export async function roomKeys(code) {
  const topic = bytesToHex(sha256(enc.encode('spotplus-jam-topic:' + code))).slice(0, 32);
  const base = await crypto.subtle.importKey('raw', enc.encode('spotplus-jam:' + code), 'PBKDF2', false, ['deriveKey']);
  const key = await crypto.subtle.deriveKey({name: 'PBKDF2', salt: enc.encode('spotplus-jam-v1'), iterations: 150000, hash: 'SHA-256'}, base, {name: 'AES-GCM', length: 256}, false, ['encrypt', 'decrypt']);
  return {topic, key};
}
export async function seal(key, value) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = new Uint8Array(await crypto.subtle.encrypt({name: 'AES-GCM', iv}, key, enc.encode(JSON.stringify(value))));
  return b64(iv) + '.' + b64(data);
}
export async function open(key, text) {
  const [iv, data] = String(text).split('.');
  return JSON.parse(dec.decode(await crypto.subtle.decrypt({name: 'AES-GCM', iv: unb64(iv)}, key, unb64(data))));
}
export function signEvent(secret, {kind, tags, content, created_at = Math.floor(Date.now() / 1000)}) {
  const pubkey = bytesToHex(schnorr.getPublicKey(secret));
  const id = bytesToHex(sha256(enc.encode(JSON.stringify([0, pubkey, created_at, kind, tags, content]))));
  return {id, pubkey, created_at, kind, tags, content, sig: bytesToHex(schnorr.sign(id, secret))};
}

/** One relay connection with automatic reconnects. */
class Relay {
  constructor(url, {onEvent, onState, WebSocketImpl}) { Object.assign(this, {url, onEvent, onState, WebSocketImpl}); this.ready = false; this.closed = false; this.tries = 0; this.queue = []; }
  connect(filter) {
    this.filter = filter;
    let ws;
    try { ws = new (this.WebSocketImpl || globalThis.WebSocket)(this.url); } catch { return this.retry(); }
    this.ws = ws;
    ws.onopen = () => { this.ready = true; this.tries = 0; ws.send(JSON.stringify(['REQ', 'jam', {...this.filter, since: Math.floor(Date.now() / 1000) - 30}])); for (const m of this.queue.splice(0)) ws.send(m); this.onState(); };
    ws.onmessage = e => { try { const m = JSON.parse(e.data); if (m[0] === 'EVENT' && m[2]) this.onEvent(m[2]); } catch { /* Ignore. */ } };
    ws.onclose = () => { if (this.ws !== ws) return; this.ready = false; this.onState(); if (!this.closed) this.retry(); };
    ws.onerror = () => { try { ws.close(); } catch { /* Closing. */ } };
  }
  retry() { if (this.closed || this.tries > 8) return; clearTimeout(this.timer); this.timer = setTimeout(() => this.connect(this.filter), Math.min(15000, 800 * 2 ** this.tries++)); }
  publish(event) { const m = JSON.stringify(['EVENT', event]); if (this.ready) this.ws.send(m); else if (this.queue.length < 20) this.queue.push(m); }
  close() { this.closed = true; clearTimeout(this.timer); try { this.ws?.close(); } catch { /* Closed. */ } }
}

const HEARTBEAT = 12000, HOST_TIMEOUT = 45000, MEMBER_TIMEOUT = 40000, JOIN_TIMEOUT = 9000;
/** A WebSocket-shaped Jam room over the relay mesh. URL: mesh:CODE?name=…&avatar=…&host=1 */
export class MeshSocket {
  constructor(url, {relays = RELAYS, WebSocketImpl = null, now = () => Date.now()} = {}) {
    const parsed = new URL(url.replace(/^mesh:/, 'https://jam/'));
    this.code = parsed.pathname.slice(1); this.host = parsed.searchParams.get('host') === '1';
    this.me = {id: crypto.randomUUID().slice(0, 8), name: (parsed.searchParams.get('name') || 'Listener').slice(0, 40), host: this.host, avatar: parsed.searchParams.get('avatar') || ''};
    Object.assign(this, {relayURLs: relays, WebSocketImpl, now});
    this.readyState = 0; this.members = new Map([[this.me.id, {...this.me, seen: now()}]]); this.seen = new Set(); this.state = null; this.hostSeen = now();
    this.secret = schnorr.utils.randomPrivateKey();
    this.start();
  }
  async start() {
    try { Object.assign(this, await roomKeys(this.code)); } catch { return this.fail(); }
    this.relays = this.relayURLs.map(url => new Relay(url, {WebSocketImpl: this.WebSocketImpl, onEvent: e => this.receive(e), onState: () => this.relayState()}));
    for (const r of this.relays) r.connect({kinds: [KIND], '#t': [this.topic]});
    this.joinTimer = setTimeout(() => { if (this.readyState === 0) this.fail(); }, this.host ? 12000 : JOIN_TIMEOUT);
  }
  relayState() {
    if (this.readyState !== 0 || !this.relays.some(r => r.ready)) return;
    if (this.host) { this.opened(); this.deliver({type: 'welcome', you: this.me, state: null, members: this.memberList()}); }
    else if (!this.helloSent) { this.helloSent = true; this.post({type: 'hello', member: this.me}); this.helloTimer = setInterval(() => this.readyState === 0 && this.post({type: 'hello', member: this.me}), 2500); }
  }
  opened() {
    clearTimeout(this.joinTimer); clearInterval(this.helloTimer);
    this.readyState = 1; this.onopen?.();
    this.beat = setInterval(() => this.tick(), HEARTBEAT);
  }
  fail() { if (this.readyState === 3) return; this.readyState = 3; this.teardown(); this.onclose?.({code: 1006}); }
  teardown() { clearTimeout(this.joinTimer); clearInterval(this.helloTimer); clearInterval(this.beat); for (const r of this.relays || []) r.close(); }
  memberList() { return [...this.members.values()].map(({id, name, host, avatar}) => ({id, name, host, avatar})); }
  deliver(message) { queueMicrotask(() => this.onmessage?.({data: JSON.stringify(message)})); }
  async post(message) {
    if (!this.key) return;
    const event = signEvent(this.secret, {kind: KIND, tags: [['t', this.topic]], content: await seal(this.key, {...message, from: this.me.id, at: this.now()})});
    this.seen.add(event.id);
    for (const r of this.relays) r.publish(event);
  }
  tick() {
    this.post({type: 'beat', member: this.me});
    const now = this.now();
    if (this.host) {
      let changed = false, left = '';
      for (const [id, m] of this.members) if (id !== this.me.id && now - m.seen > MEMBER_TIMEOUT) { this.members.delete(id); changed = true; left = m.name; }
      if (changed) { this.post({type: 'members', members: this.memberList(), left}); this.deliver({type: 'members', members: this.memberList(), left}); }
      if (this.state) this.post({type: 'state', state: {...this.state, position: this.state.position + (this.state.playing ? (now - this.state.sentAt) / 1000 : 0)}});
    } else if (now - this.hostSeen > HOST_TIMEOUT) { this.deliver({type: 'ended'}); this.close(1000); }
  }
  async receive(event) {
    if (!event?.id || this.seen.has(event.id)) return;
    this.seen.add(event.id); if (this.seen.size > 2000) this.seen = new Set([...this.seen].slice(-1000));
    let msg; try { msg = await open(this.key, event.content); } catch { return; } // Not ours or tampered.
    if (!msg || msg.from === this.me.id || this.now() - msg.at > 120000) return;
    const sender = this.members.get(msg.from); if (sender) sender.seen = this.now();
    if (msg.member?.host || msg.fromHost) this.hostSeen = this.now();
    if (this.host) return this.hostReceive(msg);
    // Listener.
    if (msg.type === 'welcome' && msg.to === this.me.id && this.readyState === 0) { this.hostSeen = this.now(); this.opened(); this.deliver({type: 'welcome', you: this.me, state: msg.state ? {...msg.state, at: this.now()} : null, members: msg.members}); }
    else if (this.readyState !== 1) return;
    else if (msg.type === 'state') { this.hostSeen = this.now(); this.deliver({type: 'state', state: {...msg.state, at: this.now()}}); }
    else if (msg.type === 'members') { this.hostSeen = this.now(); this.deliver({type: 'members', members: msg.members, joined: msg.joined, left: msg.left}); }
    else if (msg.type === 'react') this.deliver({type: 'react', emoji: msg.emoji, by: msg.by});
    else if (msg.type === 'ended') { this.deliver({type: 'ended'}); this.close(1000); }
  }
  hostReceive(msg) {
    if (msg.type === 'hello' || msg.type === 'beat') {
      const isNew = !this.members.has(msg.from);
      if (msg.member && typeof msg.member.name === 'string') this.members.set(msg.from, {id: msg.from, name: msg.member.name.slice(0, 40), host: false, avatar: typeof msg.member.avatar === 'string' ? msg.member.avatar.slice(0, 500) : '', seen: this.now()});
      if (msg.type === 'hello') {
        if (isNew && this.members.size > 32) { this.members.delete(msg.from); return; }
        const state = this.state ? {...this.state, position: this.state.position + (this.state.playing ? (this.now() - this.state.sentAt) / 1000 : 0)} : null;
        this.post({type: 'welcome', to: msg.from, state, members: this.memberList(), fromHost: true});
        if (isNew) { this.post({type: 'members', members: this.memberList(), joined: msg.member?.name, fromHost: true}); this.deliver({type: 'members', members: this.memberList(), joined: msg.member?.name}); }
      }
    } else if (msg.type === 'add' && msg.track) this.deliver({type: 'add', track: msg.track, by: msg.by || 'Someone'});
    else if (msg.type === 'control') this.deliver({type: 'control', action: msg.action, by: msg.by || 'Someone'});
    else if (msg.type === 'react') this.deliver({type: 'react', emoji: msg.emoji, by: msg.by});
  }
  /* WebSocket surface used by Jam. */
  send(data) {
    let msg; try { msg = JSON.parse(data); } catch { return; }
    if (msg.type === 'ping') return;
    if (msg.type === 'state' && this.host) { this.state = {...msg.state, sentAt: this.now()}; this.post({type: 'state', state: msg.state, fromHost: true}); }
    else if (msg.type === 'end' && this.host) this.post({type: 'ended', fromHost: true});
    else if (['add', 'control'].includes(msg.type)) this.post({...msg, by: this.me.name});
    else if (msg.type === 'react') { this.post({...msg, by: this.me.name}); this.deliver({type: 'react', emoji: msg.emoji, by: this.me.name}); }
  }
  close(code = 1000) {
    if (this.readyState === 3) return;
    const wasHost = this.host && this.readyState === 1;
    this.readyState = 3;
    // Let a final "ended" from the host reach the relays before disconnecting.
    setTimeout(() => this.teardown(), wasHost ? 600 : 0);
    queueMicrotask(() => this.onclose?.({code}));
  }
}
