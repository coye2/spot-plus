import test from 'node:test';
import assert from 'node:assert/strict';
import {Jam,newJamCode,validJamCode,expectedPosition} from '../js/jam.js';
import {MeshSocket,roomKeys,seal,open,signEvent} from '../js/jam-mesh.js';
import {schnorr} from '../js/vendor/nostr-sign.js';

// In-memory Nostr relays: REQ subscriptions filtered by kind and #t, EVENT fan-out.
function relayNetwork({down = []} = {}) {
  const relays = new Map(), log = [];
  class FakeRelay {
    constructor(url) {
      this.url = url; this.subs = [];
      const hub = relays.get(url) || relays.set(url, new Set()).get(url);
      queueMicrotask(() => { if (down.includes(url)) { this.onclose?.(); return; } hub.add(this); this.onopen?.(); });
      this.hub = hub;
    }
    send(raw) {
      const m = JSON.parse(raw);
      if (m[0] === 'REQ') this.subs.push(m[2]);
      if (m[0] === 'EVENT') {
        const e = m[1]; log.push(e);
        assert.ok(schnorr.verify(e.sig, e.id, e.pubkey), 'events are validly signed');
        for (const client of this.hub) for (const f of client.subs) if (f.kinds.includes(e.kind) && e.tags.some(([k, v]) => k === 't' && f['#t'].includes(v))) queueMicrotask(() => client.onmessage?.({data: JSON.stringify(['EVENT', 'jam', e])}));
      }
    }
    close() { this.hub.delete(this); }
  }
  return {FakeRelay, log};
}
function fakePlayer() {
  const listeners = {state: new Set(), time: new Set()};
  const p = {state: {queue: [], index: -1, loading: false}, el: {currentTime: 0}, playing: false,
    on: (ev, fn) => listeners[ev].add(fn), emit: ev => listeners[ev].forEach(fn => fn()),
    current: () => p.state.queue[p.state.index] || null, isPlaying: () => p.playing,
    playList(list, i) { p.state.queue = list.slice(); p.state.index = i; p.playing = true; p.emit('state'); },
    toggle() { p.playing = !p.playing; p.emit('state'); }, next() { p.state.index++; p.emit('state'); }, prev() { p.state.index--; p.emit('state'); },
    seek(t) { p.el.currentTime = t; }, addToQueue(list) { p.state.queue.push(...list); p.emit('state'); }};
  return p;
}
const wait = ms => new Promise(r => setTimeout(r, ms));
async function until(check, ms = 3000) { const end = Date.now() + ms; while (Date.now() < end) { if (check()) return true; await wait(10); } return false; }
const song = n => ({id: String(n), title: 'Song ' + n, artist: 'Artist', duration: 200});

test('codes are unambiguous 6-character room names', () => {
  for (let i = 0; i < 50; i++) { const c = newJamCode(); assert.ok(validJamCode(c), c); assert.doesNotMatch(c, /[01IO]/); }
  assert.equal(validJamCode('abc'), false);
});
test('expected position advances only while playing', () => {
  assert.equal(expectedPosition({position: 10, playing: true, at: 1000}, 3000), 12);
  assert.equal(expectedPosition({position: 10, playing: false, at: 1000}, 3000), 10);
});
test('messages are end-to-end encrypted and bound to the room code', async () => {
  const a = await roomKeys('ABC234'), b = await roomKeys('ABC235');
  const sealed = await seal(a.key, {type: 'state', title: 'Secret Song'});
  assert.doesNotMatch(sealed, /Secret Song/);
  assert.deepEqual(await open(a.key, sealed), {type: 'state', title: 'Secret Song'});
  await assert.rejects(open(b.key, sealed));
  assert.notEqual(a.topic, b.topic); assert.doesNotMatch(a.topic, /ABC234/);
  const e = signEvent(schnorr.utils.randomPrivateKey(), {kind: 25890, tags: [['t', a.topic]], content: sealed});
  assert.ok(schnorr.verify(e.sig, e.id, e.pubkey));
});

test('host and listener sync over the relay mesh with no server, even with a relay down', async () => {
  const {FakeRelay, log} = relayNetwork({down: ['wss://b']});
  class TestMesh extends MeshSocket { constructor(url) { super(url, {relays: ['wss://a', 'wss://b', 'wss://c'], WebSocketImpl: FakeRelay}); } }
  const toasts = [], hostPlayer = fakePlayer(), guestPlayer = fakePlayer();
  const host = new Jam(hostPlayer, {WebSocketImpl: TestMesh, onToast: m => toasts.push(m)});
  const guest = new Jam(guestPlayer, {WebSocketImpl: TestMesh, onToast: m => toasts.push(m)});
  try {
    hostPlayer.playList([song(1), song(2), song(3)], 0); hostPlayer.el.currentTime = 42;
    const code = host.start({name: 'Coye'});
    assert.ok(await until(() => host.status === 'live'), 'host goes live');
    guest.join(code, {name: 'Sam'});
    assert.ok(await until(() => guest.status === 'live' && guestPlayer.current()), 'listener joins');
    assert.equal(guestPlayer.current().id, '1');
    assert.ok(Math.abs(guestPlayer.el.currentTime - 42) < 1.5, 'listener starts at the host’s position');
    assert.ok(await until(() => host.members.length === 2), 'host sees the listener');
    assert.ok(toasts.includes('Sam joined the Jam'));
    assert.ok(log.every(e => !e.content.includes('Song')), 'relays never see song titles');

    hostPlayer.next();
    assert.ok(await until(() => guestPlayer.current()?.id === '2'), 'track changes follow the host');
    guest.add(song(9));
    assert.ok(await until(() => hostPlayer.state.queue.at(-1)?.id === '9'), 'listener’s song reaches the host queue');
    const was = hostPlayer.playing; guest.control('toggle');
    assert.ok(await until(() => hostPlayer.playing === !was), 'listener controls playback');
    host.setGuestControl(false); await wait(80);
    const before = hostPlayer.playing; guest.control('toggle'); await wait(150);
    assert.equal(hostPlayer.playing, before, 'host can lock controls');

    host.leave();
    assert.ok(await until(() => guest.status === 'idle'), 'ending the Jam reaches listeners');
  } finally { host.leave({silent: true}); guest.leave({silent: true}); }
});

test('joining a code with no host fails cleanly', async () => {
  const {FakeRelay} = relayNetwork();
  class TestMesh extends MeshSocket { constructor(url) { super(url, {relays: ['wss://a'], WebSocketImpl: FakeRelay}); } }
  const toasts = [], guest = new Jam(fakePlayer(), {WebSocketImpl: TestMesh, onToast: m => toasts.push(m)});
  guest.join('ABC234', {name: 'Sam'});
  assert.ok(await until(() => guest.status === 'idle', 12000));
  assert.match(toasts[0], /Couldn’t join/);
});
