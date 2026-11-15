/* global WebSocketPair */
// Spot+ Jam: one Durable Object per room code, relaying a small, validated set of
// messages between the host and up to 32 listeners over WebSockets. The host's
// player is the source of truth; the room only remembers the latest state so late
// joiners start in sync. Uses the hibernation API, so idle rooms cost nothing.
const MAX_MEMBERS = 32, MAX_MESSAGE = 96 * 1024, MAX_QUEUE = 100;
export const validCode = code => /^[A-HJ-NP-Z2-9]{6}$/.test(code || '');
const text = (value, max) => typeof value === 'string' ? value.replace(/[\u0000-\u001f]/g, '').slice(0, max) : '';
const safeURL = value => { try { const u = new URL(value); return u.protocol === 'https:' && !u.username && !u.password ? u.href.slice(0, 500) : ''; } catch { return ''; } };
export function cleanTrack(t) {
  if (!t || typeof t !== 'object') return null;
  const id = text(String(t.id ?? ''), 80), title = text(t.title, 200), artist = text(t.artist, 200);
  if (!id || !title || !artist) return null;
  return {id, title, artist, album: text(t.album, 200), cover: safeURL(t.cover), coverXl: safeURL(t.coverXl), duration: Number.isFinite(t.duration) ? Math.max(0, Math.min(36000, t.duration)) : 0,
    searchTitle: text(t.searchTitle, 200), artistId: t.artistId == null ? null : text(String(t.artistId), 40), albumId: t.albumId == null ? null : text(String(t.albumId), 40),
    spotifyId: /^[A-Za-z0-9]{22}$/.test(t.spotifyId || '') ? t.spotifyId : '', explicit: !!t.explicit, preview: safeURL(t.preview)};
}
export function cleanState(s) {
  if (!s || typeof s !== 'object' || !Array.isArray(s.queue)) return null;
  const queue = s.queue.slice(0, MAX_QUEUE).map(cleanTrack).filter(Boolean);
  const index = Number.isInteger(s.index) ? Math.max(0, Math.min(queue.length - 1, s.index)) : 0;
  return {queue, index, position: Number.isFinite(s.position) ? Math.max(0, s.position) : 0, playing: !!s.playing, at: Date.now(), guestControl: s.guestControl !== false};
}
export class JamRoom {
  constructor(ctx) { this.ctx = ctx; }
  members() {
    return this.ctx.getWebSockets().map(ws => ws.deserializeAttachment()).filter(Boolean).map(({id, name, host, avatar}) => ({id, name, host, avatar}));
  }
  broadcast(message, except) {
    const data = JSON.stringify(message);
    for (const ws of this.ctx.getWebSockets()) if (ws !== except) { try { ws.send(data); } catch { /* Closed. */ } }
  }
  async fetch(request) {
    if (request.headers.get('Upgrade') !== 'websocket') return new Response('Expected a WebSocket', {status: 426});
    const url = new URL(request.url);
    const sockets = this.ctx.getWebSockets();
    if (sockets.length >= MAX_MEMBERS) return new Response('This Jam is full', {status: 409});
    const host = url.searchParams.get('host') === '1';
    const hasHost = sockets.some(ws => ws.deserializeAttachment()?.host);
    if (host && hasHost) return new Response('This Jam already has a host', {status: 409});
    if (!host && !hasHost && !(await this.ctx.storage.get('state'))) return new Response('This Jam has ended', {status: 404});
    const pair = new WebSocketPair(), [client, server] = Object.values(pair);
    const member = {id: crypto.randomUUID().slice(0, 8), name: text(url.searchParams.get('name'), 40) || 'Listener', host, avatar: safeURL(url.searchParams.get('avatar') || '')};
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment(member);
    const state = await this.ctx.storage.get('state');
    server.send(JSON.stringify({type: 'welcome', you: member, state: state || null, members: this.members()}));
    this.broadcast({type: 'members', members: this.members(), joined: member.name}, server);
    return new Response(null, {status: 101, webSocket: client});
  }
  async webSocketMessage(ws, raw) {
    if (typeof raw !== 'string' || raw.length > MAX_MESSAGE) return;
    let msg; try { msg = JSON.parse(raw); } catch { return; }
    const me = ws.deserializeAttachment(); if (!me) return;
    if (msg.type === 'state' && me.host) {
      const state = cleanState(msg.state); if (!state) return;
      await this.ctx.storage.put('state', state);
      this.broadcast({type: 'state', state}, ws);
    } else if (msg.type === 'add') {
      const track = cleanTrack(msg.track); if (!track) return;
      this.broadcast({type: 'add', track, by: me.name}, ws);
    } else if (msg.type === 'control' && ['toggle', 'next', 'prev'].includes(msg.action)) {
      const state = await this.ctx.storage.get('state');
      if (!me.host && state && state.guestControl === false) return;
      this.broadcast({type: 'control', action: msg.action, by: me.name}, ws);
    } else if (msg.type === 'react' && typeof msg.emoji === 'string' && [...msg.emoji].length <= 2) {
      this.broadcast({type: 'react', emoji: msg.emoji, by: me.name});
    } else if (msg.type === 'end' && me.host) {
      await this.ctx.storage.deleteAll();
      this.broadcast({type: 'ended'});
      for (const socket of this.ctx.getWebSockets()) try { socket.close(1000, 'Jam ended'); } catch { /* Closed. */ }
    } else if (msg.type === 'ping') ws.send('{"type":"pong"}');
  }
  async webSocketClose(ws) {
    const me = ws.deserializeAttachment();
    try { ws.close(1000, 'Bye'); } catch { /* Already closed. */ }
    if (me?.host) {
      // Give the host 45 seconds to come back (app switch, network change) before ending.
      await this.ctx.storage.setAlarm(Date.now() + 45000);
    }
    this.broadcast({type: 'members', members: this.members(), left: me?.name || ''}, ws);
  }
  async webSocketError(ws) { await this.webSocketClose(ws); }
  async alarm() {
    if (this.ctx.getWebSockets().some(ws => ws.deserializeAttachment()?.host)) return;
    await this.ctx.storage.deleteAll();
    this.broadcast({type: 'ended'});
    for (const socket of this.ctx.getWebSockets()) try { socket.close(1000, 'Jam ended'); } catch { /* Closed. */ }
  }
}
export function jamRoute(request, env) {
  const match = new URL(request.url).pathname.match(/^\/jam\/([A-Z0-9]{6})$/);
  if (!match || !validCode(match[1])) return new Response('Unknown Jam', {status: 404});
  if (!env?.JAM) return new Response('Jam is not enabled on this bridge', {status: 503});
  return env.JAM.get(env.JAM.idFromName(match[1])).fetch(request);
}
