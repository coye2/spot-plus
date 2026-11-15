// Spot+ Jam: listen together in real time. The host's queue and playback are the
// source of truth; listeners follow along on their own device and can add songs or
// (if the host allows) play, pause and skip. Rooms live on the Spot+ Cloudflare worker.
export const JAM_ENDPOINT = 'wss://spot-plus-canvas.pwr97pnmkn.workers.dev/jam/';
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const validJamCode = code => /^[A-HJ-NP-Z2-9]{6}$/.test(String(code || '').toUpperCase());
export function newJamCode(random = n => crypto.getRandomValues(new Uint8Array(n))) {
  return [...random(6)].map(b => ALPHABET[b % ALPHABET.length]).join('');
}
export function jamLink(code, base = location.origin + location.pathname) { return base + '#/jam/' + code; }
const slim = t => t && ({id: t.id, title: t.title, artist: t.artist, album: t.album, cover: t.cover, coverXl: t.coverXl, duration: t.duration, searchTitle: t.searchTitle, artistId: t.artistId, albumId: t.albumId, spotifyId: t.spotifyId, explicit: t.explicit, preview: t.preview});
/** Where the host's playback is right now, given the last state and how long ago it was sent. */
export function expectedPosition(state, now = Date.now()) {
  if (!state) return 0;
  return state.position + (state.playing ? Math.max(0, now - state.at) / 1000 : 0);
}

export class Jam {
  constructor(player, {onChange = () => {}, onToast = () => {}, endpoint = JAM_ENDPOINT, WebSocketImpl = null} = {}) {
    Object.assign(this, {player, onChange, onToast, endpoint, WebSocketImpl});
    this.code = ''; this.host = false; this.members = []; this.status = 'idle'; this.guestControl = true; this.remote = null;
    this.applying = false; this.lastSent = '';
    player.on('state', () => this.hostSync());
    player.on('time', () => this.followerDrift());
  }
  get active() { return this.status === 'live' || this.status === 'connecting'; }
  start(profile) { return this.connect(newJamCode(), true, profile); }
  join(code, profile) { return this.connect(String(code).toUpperCase(), false, profile); }
  connect(code, host, {name = 'Listener', avatar = ''} = {}) {
    if (!validJamCode(code)) throw new Error('That Jam code isn’t valid.');
    this.leave({silent: true});
    Object.assign(this, {code, host, status: 'connecting', members: [], profile: {name, avatar}, retries: 0, ended: false});
    this.open();
    this.onChange();
    return code;
  }
  open() {
    const params = new URLSearchParams({name: this.profile.name.slice(0, 40)});
    if (this.profile.avatar) params.set('avatar', this.profile.avatar);
    if (this.host) params.set('host', '1');
    const ws = new (this.WebSocketImpl || globalThis.WebSocket)(this.endpoint + this.code + '?' + params);
    this.ws = ws;
    ws.onopen = () => { this.retries = 0; this.status = 'live'; this.onChange(); if (this.host) this.hostSync(true); this.keepAlive(); };
    ws.onmessage = event => { try { this.receive(JSON.parse(event.data)); } catch { /* Ignore malformed messages. */ } };
    ws.onclose = event => {
      if (this.ws !== ws) return;
      clearInterval(this.pinger);
      if (this.ended || event.code === 1000) { this.finish(this.host ? '' : 'The Jam has ended.'); return; }
      if (event.code === 1006 && this.status === 'connecting' && this.retries === 0) { this.finish(this.host ? 'Couldn’t start a Jam right now. Check your connection and try again.' : 'Couldn’t join that Jam. Check the code and try again.'); return; }
      // Network blip or app switch: reconnect with backoff (the room waits 45 s for the host).
      if (this.retries++ < 6) { this.status = 'connecting'; this.onChange(); this.retryTimer = setTimeout(() => this.open(), Math.min(8000, 600 * 2 ** this.retries)); }
      else this.finish('Lost connection to the Jam.');
    };
  }
  keepAlive() { clearInterval(this.pinger); this.pinger = setInterval(() => this.send({type: 'ping'}), 25000); }
  send(message) { if (this.ws?.readyState === 1) this.ws.send(JSON.stringify(message)); }
  finish(message) {
    clearInterval(this.pinger); clearTimeout(this.retryTimer);
    this.status = 'idle'; this.code = ''; this.members = []; this.remote = null; this.ws = null;
    if (message) this.onToast(message);
    this.onChange();
  }
  leave({silent = false} = {}) {
    if (!this.ws && !this.code) return;
    const ws = this.ws; this.ended = true;
    if (this.host) this.send({type: 'end'});
    this.ws = null;
    try { ws?.close(1000, 'Bye'); } catch { /* Closed. */ }
    this.finish(silent ? '' : this.host ? 'Jam ended.' : 'You left the Jam.');
  }
  setGuestControl(on) { this.guestControl = !!on; this.hostSync(true); this.onChange(); }

  /* ----- Host: publish the queue and playback ----- */
  hostSync(force = false) {
    if (!this.host || this.status !== 'live') return;
    const s = this.player.state, queue = s.queue.slice(Math.max(0, s.index - 5), s.index + 60);
    const index = Math.min(5, s.index);
    const state = {queue: queue.map(slim), index, position: this.player.el.currentTime || 0, playing: this.player.isPlaying(), guestControl: this.guestControl};
    const signature = JSON.stringify([state.queue.map(t => t.id), index, state.playing, Math.round(state.position / 4)]);
    if (!force && signature === this.lastSent) return;
    this.lastSent = signature;
    this.send({type: 'state', state});
  }
  /* ----- Everyone: messages from the room ----- */
  receive(msg) {
    if (msg.type === 'welcome') { this.me = msg.you; this.members = msg.members || []; if (msg.state && !this.host) this.follow(msg.state); this.onChange(); }
    else if (msg.type === 'members') { this.members = msg.members || []; if (msg.joined) this.onToast(`${msg.joined} joined the Jam`); this.onChange(); }
    else if (msg.type === 'state' && !this.host) this.follow(msg.state);
    else if (msg.type === 'add' && this.host) { this.player.addToQueue([msg.track]); this.onToast(`${msg.by} added “${msg.track.title}”`); }
    else if (msg.type === 'control' && this.host && this.guestControl) { ({toggle: () => this.player.toggle(), next: () => this.player.next(), prev: () => this.player.prev()})[msg.action]?.(); }
    else if (msg.type === 'react') this.onToast(`${msg.by} ${msg.emoji}`);
    else if (msg.type === 'ended') { this.ended = true; if (!this.host) this.finish('The host ended the Jam.'); }
  }
  /* ----- Listener: follow the host ----- */
  follow(state) {
    if (!state?.queue?.length) return;
    this.remote = {...state, at: Date.now() - Math.min(1500, Math.max(0, Date.now() - state.at))};
    this.guestControl = state.guestControl !== false;
    const want = state.queue[state.index], here = this.player.current();
    this.applying = true;
    try {
      if (here?.id !== want.id) this.player.playList(state.queue, state.index);
      else {
        const s = this.player.state;
        s.queue = [...s.queue.slice(0, s.index + 1), ...state.queue.slice(state.index + 1)];
        if (state.playing !== this.player.isPlaying() && !s.loading) this.player.toggle();
      }
    } finally { this.applying = false; }
    this.followerDrift(true);
    this.onChange();
  }
  followerDrift(force = false) {
    if (this.host || !this.remote || this.status !== 'live') return;
    const want = this.remote.queue[this.remote.index];
    if (this.player.current()?.id !== want?.id || this.player.state.loading) return;
    const target = expectedPosition(this.remote), off = Math.abs((this.player.el.currentTime || 0) - target);
    if (off > (force ? 1 : 2.5)) this.player.seek(target);
  }
  /* ----- Listener actions ----- */
  add(track) { if (this.host) this.player.addToQueue([track]); else this.send({type: 'add', track: slim(track)}); }
  control(action) { if (this.host) return false; this.send({type: 'control', action}); return true; }
  react(emoji) { this.send({type: 'react', emoji}); }
}
