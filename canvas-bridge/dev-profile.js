// /dev: the developer's current Discord name and picture (from the public server invite), plus
// the server's member counts. Cached for 10 minutes so a new profile picture shows up quickly.
export const INVITE = 'DbhTQD7jW';
const headers = {'Content-Type': 'application/json; charset=utf-8', 'X-Content-Type-Options': 'nosniff'};
export function profileFromInvite(d, invite = INVITE) {
  const u = d?.inviter || {};
  const avatar = /^(a_)?[a-f0-9]{32}$/.test(u.avatar || '') && /^\d{5,25}$/.test(u.id || '')
    ? `https://cdn.discordapp.com/avatars/${u.id}/${u.avatar}.${u.avatar.startsWith('a_') ? 'gif' : 'png'}?size=256` : '';
  return {name: String(u.global_name || u.username || 'Spot+ developer').slice(0, 60), username: String(u.username || '').slice(0, 40), avatar,
    server: String(d?.guild?.name || 'Spot+').slice(0, 80), members: Number(d?.approximate_member_count) || 0, online: Number(d?.approximate_presence_count) || 0,
    invite: `https://discord.gg/${invite}`};
}
export async function devProfile(request, {fetcher = fetch, cache, waitUntil = () => {}} = {}) {
  const key = new Request(new URL(request.url).origin + '/dev');
  const cached = await cache?.match(key); if (cached) return cached;
  try {
    const r = await fetcher(`https://discord.com/api/v10/invites/${INVITE}?with_counts=true`, {headers: {Accept: 'application/json'}, redirect: 'manual'});
    if (!r.ok) return new Response(JSON.stringify({error: 'Discord unavailable'}), {status: 503, headers});
    const res = new Response(JSON.stringify(profileFromInvite(await r.json())), {headers: {...headers, 'Cache-Control': 'public, max-age=600'}});
    if (cache) waitUntil(cache.put(key, res.clone()).catch(() => {}));
    return res;
  } catch { return new Response(JSON.stringify({error: 'Discord unavailable'}), {status: 503, headers}); }
}
