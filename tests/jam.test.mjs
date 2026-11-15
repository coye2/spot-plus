import test from 'node:test';
import assert from 'node:assert/strict';
import {JamRoom,cleanTrack,cleanState,validCode} from '../canvas-bridge/jam.js';
import {Jam,newJamCode,validJamCode,expectedPosition} from '../js/jam.js';

// --- In-memory Durable Object + WebSocket harness (each test file runs in its own process).
globalThis.Response = class { constructor(body, init = {}) { this.status = init.status ?? 200; this.webSocket = init.webSocket; this.body = body; } };
class End { constructor() { this.peer = null; this.attachment = null; this.inbox = []; this.readyState = 1; this.deliver = data => this.inbox.push(data); }
  send(data) { const peer = this.peer; queueMicrotask(() => peer.deliver(data)); }
  serializeAttachment(v) { this.attachment = structuredClone(v); } deserializeAttachment() { return this.attachment; }
  close(code = 1000) { if (this.readyState === 3) return; this.readyState = 3; const peer = this.peer; queueMicrotask(() => peer.closed(code)); } }
globalThis.WebSocketPair = class { constructor() { const a = new End(), b = new End(); a.peer = b; b.peer = a; this[0] = a; this[1] = b; } };
function makeRoom() {
  const sockets = [], store = new Map();
  const ctx = {acceptWebSocket: ws => { sockets.push(ws); ws.deliver = data => room.webSocketMessage(ws, data); ws.closed = () => { sockets.splice(sockets.indexOf(ws), 1); room.webSocketClose(ws); }; },
    getWebSockets: () => sockets.filter(ws => ws.readyState === 1),
    storage: {get: async k => store.get(k), put: async (k, v) => { store.set(k, v); }, deleteAll: async () => store.clear(), setAlarm: async () => {}}};
  const room = new JamRoom(ctx);
  return room;
}
function socketFor(room) {
  return class FakeSocket {
    constructor(url) {
      this.readyState = 0;
      queueMicrotask(async () => {
        const response = await room.fetch({url, headers: {get: h => h === 'Upgrade' ? 'websocket' : null}});
        if (response.status !== 101) { this.readyState = 3; this.onclose?.({code: 1006}); return; }
        const end = response.webSocket; this.end = end;
        end.closed = code => { this.readyState = 3; this.onclose?.({code}); };
        this.readyState = 1; this.onopen?.();
        end.deliver = data => this.onmessage?.({data}); for (const data of end.inbox.splice(0)) end.deliver(data);
      });
    }
    send(data) { this.end.send(data); }
    close(code = 1000) { this.end.close(code); }
  };
}
function fakePlayer() {
  const listeners = {state: new Set(), time: new Set()};
  const p = {state: {queue: [], index: -1, loading: false}, el: {currentTime: 0}, playing: false, seeks: [],
    on: (ev, fn) => listeners[ev].add(fn), emit: ev => listeners[ev].forEach(fn => fn()),
    current: () => p.state.queue[p.state.index] || null, isPlaying: () => p.playing,
    playList(list, i) { p.state.queue = list.slice(); p.state.index = i; p.playing = true; p.emit('state'); },
    toggle() { p.playing = !p.playing; p.emit('state'); }, next() { p.state.index++; p.emit('state'); }, prev() { p.state.index--; p.emit('state'); },
    seek(t) { p.seeks.push(t); p.el.currentTime = t; }, addToQueue(list) { p.state.queue.push(...list); p.emit('state'); }};
  return p;
}
const tick = (ms = 5) => new Promise(r => setTimeout(r, ms));
const song = n => ({id: String(n), title: 'Song ' + n, artist: 'Artist', duration: 200, cover: 'https://e-cdns-images.dzcdn.net/x.jpg'});

test('codes are unambiguous 6-character room names', () => {
  for (let i = 0; i < 50; i++) { const c = newJamCode(); assert.ok(validJamCode(c) && validCode(c), c); assert.doesNotMatch(c, /[01IO]/); }
  assert.equal(validJamCode('abc'), false);
});

test('room input is sanitized', () => {
  assert.equal(cleanTrack({id: 'x', title: '', artist: 'a'}), null);
  const t = cleanTrack({...song(1), cover: 'javascript:alert(1)', title: 'A\u0000B'});
  assert.equal(t.cover, ''); assert.equal(t.title, 'AB');
  const s = cleanState({queue: Array.from({length: 150}, (_, i) => song(i)), index: 999, position: -4, playing: 1});
  assert.equal(s.queue.length, 100); assert.equal(s.index, 99); assert.equal(s.position, 0); assert.equal(s.playing, true);
});

test('expected position advances only while playing', () => {
  assert.equal(expectedPosition({position: 10, playing: true, at: 1000}, 3000), 12);
  assert.equal(expectedPosition({position: 10, playing: false, at: 1000}, 3000), 10);
});

test('host and listener stay in sync; listener adds and controls go through the host', async () => {
  const room = makeRoom(), WS = socketFor(room), toasts = [];
  const hostPlayer = fakePlayer(), guestPlayer = fakePlayer();
  const host = new Jam(hostPlayer, {WebSocketImpl: WS, endpoint: 'wss://x/jam/', onToast: m => toasts.push(m)});
  const guest = new Jam(guestPlayer, {WebSocketImpl: WS, endpoint: 'wss://x/jam/', onToast: m => toasts.push(m)});
  hostPlayer.playList([song(1), song(2), song(3)], 0); hostPlayer.el.currentTime = 42;
  const code = host.start({name: 'Coye'}); await tick();
  assert.equal(host.status, 'live');
  guest.join(code, {name: 'Sam'}); await tick(20);
  assert.equal(guest.status, 'live');
  assert.deepEqual(guest.members.map(m => m.name).sort(), ['Coye', 'Sam']);
  assert.equal(guestPlayer.current().id, '1', 'listener starts on the host’s song');
  assert.ok(Math.abs(guestPlayer.el.currentTime - 42) < 1.5, 'listener jumps to the host’s position');
  assert.ok(toasts.includes('Sam joined the Jam'));

  hostPlayer.next(); await tick(20);
  assert.equal(guestPlayer.current().id, '2', 'track changes follow the host');

  guest.add(song(9)); await tick(20);
  assert.equal(hostPlayer.state.queue.at(-1).id, '9', 'listener’s song lands in the host queue');
  await tick(20);
  assert.ok(guestPlayer.state.queue.some(t => t.id === '9'), 'and the shared queue reaches the listener');

  const wasPlaying = hostPlayer.playing;
  guest.control('toggle'); await tick(20);
  assert.equal(hostPlayer.playing, !wasPlaying, 'listener play/pause controls the host');

  host.setGuestControl(false); await tick(20);
  const before = hostPlayer.playing; guest.control('toggle'); await tick(20);
  assert.equal(hostPlayer.playing, before, 'host can lock controls');

  host.leave(); await tick(30);
  assert.equal(guest.status, 'idle', 'ending the Jam disconnects listeners');
  assert.ok(toasts.some(t => /ended/i.test(t)));
});

test('joining a room with no host fails cleanly', async () => {
  const room = makeRoom(), toasts = [];
  const guest = new Jam(fakePlayer(), {WebSocketImpl: socketFor(room), endpoint: 'wss://x/jam/', onToast: m => toasts.push(m)});
  guest.join('ABC234', {name: 'Sam'}); await tick(20);
  assert.equal(guest.status, 'idle');
  assert.match(toasts[0], /Couldn’t join/);
});
