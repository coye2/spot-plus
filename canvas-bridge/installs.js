// Live counters for Spot+: total installs (one per device, stored for good) and people listening
// right now (players check in while music plays; kept in memory, counted over the last ~3 minutes).
const LIVE_WINDOW = 200_000;
export class InstallCounter {
  constructor(state) { this.state = state; this.live = new Map(); this.ipDay = new Map(); }
  liveCount(now = Date.now()) { for (const [id, at] of this.live) if (now - at > LIVE_WINDOW) this.live.delete(id); return this.live.size; }
  async fetch(request) {
    const url = new URL(request.url), now = Date.now();
    const installs = async () => (await this.state.storage.get('installs')) || 0;
    if (request.method === 'POST') {
      const body = await request.json().catch(() => ({}));
      const device = String(body.device || '');
      if (!/^[a-f0-9]{32}$/.test(device)) return Response.json({error: 'bad device'}, {status: 400});
      // Ratings: one per device (changing your rating replaces it). Kept as a running sum and count.
      if (url.pathname === '/rate') {
        const stars = Math.round(Number(body.stars));
        if (!(stars >= 1 && stars <= 5)) return Response.json({error: 'stars must be 1-5'}, {status: 400});
        const rk = 'r:' + device, prev = Number(await this.state.storage.get(rk)) || 0;
        const r = (await this.state.storage.get('ratings')) || {sum: 0, count: 0, dist: [0, 0, 0, 0, 0]};
        if (prev) { r.sum -= prev; r.count -= 1; r.dist[prev - 1] = Math.max(0, r.dist[prev - 1] - 1); }
        r.sum += stars; r.count += 1; r.dist[stars - 1] += 1;
        await this.state.storage.put({[rk]: stars, ratings: r});
        return Response.json({rating: summary(r), yours: stars});
      }
      if (url.pathname === '/listening') {
        if (body.playing) this.live.set(device, now); else this.live.delete(device);
        return Response.json({listening: this.liveCount(now), installs: await installs()});
      }
      // Installs: once per device, at most 3 new devices per network per day (stops casual inflation).
      const key = 'd:' + device;
      if (!(await this.state.storage.get(key))) {
        const ipKey = (request.headers.get('X-Client') || '') + ':' + new Date(now).toISOString().slice(0, 10);
        const fromIp = this.ipDay.get(ipKey) || 0;
        if (fromIp < 3) {
          this.ipDay.set(ipKey, fromIp + 1); if (this.ipDay.size > 20000) this.ipDay.clear();
          const total = (await installs()) + 1;
          await this.state.storage.put({[key]: now, installs: total});
        }
      }
      return Response.json({installs: await installs(), listening: this.liveCount(now)});
    }
    return Response.json({installs: await installs(), listening: this.liveCount(now), rating: summary(await this.state.storage.get('ratings'))});
  }
}
const summary = (r) => (r?.count ? {average: Math.round((r.sum / r.count) * 10) / 10, count: r.count, dist: r.dist} : {average: 0, count: 0, dist: [0, 0, 0, 0, 0]});

const HEADERS = {'Content-Type': 'application/json; charset=utf-8', 'X-Content-Type-Options': 'nosniff'};
/** /stats (GET), /installs (POST {device}), /listening (POST {device, playing}), /rate (POST {device, stars}). */
export async function liveStats(request, env, hash) {
  if (!env?.INSTALLS) return new Response(JSON.stringify({error: 'Counters not set up'}), {status: 503, headers: HEADERS});
  const stub = env.INSTALLS.get(env.INSTALLS.idFromName('global'));
  const url = new URL(request.url);
  const init = request.method === 'POST'
    ? {method: 'POST', body: await request.text().then(t => t.slice(0, 300)), headers: {'X-Client': await hash(request.headers.get('CF-Connecting-IP') || '')}}
    : {};
  const res = await stub.fetch('https://counter' + url.pathname, init);
  const data = await res.text();
  return new Response(data, {status: res.status, headers: {...HEADERS, 'Cache-Control': request.method === 'GET' ? 'public, max-age=15' : 'no-store'}});
}
