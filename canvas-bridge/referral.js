// Friend-install unlock. The code is created by one device and redeemed by a
// later, different install. The 60s hold is a real open app, not a single request.
import { DISCORD } from '../js/access-policy.js';
import { isOwnerProof } from '../js/maintenance.js';
import {
  CODE_ALPHABET, HOLD_MS, browserKey, hardwareKey, isGuildMember, judgeReferral, normalizeCode, platformFamily, screenBucket,
} from '../js/referral.js';

const HEADERS = {
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
};
const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: HEADERS });

function validDevice(id) {
  return /^[a-f0-9]{32}$/.test(String(id || ''));
}

function newCode() {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  return [...bytes].map((b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join('');
}

function hexId(size = 8) {
  const bytes = new Uint8Array(size);
  crypto.getRandomValues(bytes);
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function readSignals(body) {
  const signals = body?.signals && typeof body.signals === 'object' ? body.signals : {};
  return {
    ua: String(signals.ua || '').slice(0, 180),
    platform: String(signals.platform || '').slice(0, 40),
    timezone: String(signals.timezone || '').slice(0, 64),
    language: String(signals.language || '').slice(0, 20),
    cores: Number(signals.cores) || 0,
    memory: Number(signals.memory) || 0,
    touch: Number(signals.touch) || 0,
    width: Number(signals.width) || 0,
    height: Number(signals.height) || 0,
    dpr: Number(signals.dpr) || 1,
    color: Number(signals.color) || 0,
  };
}

async function profileOf(body, ipHash, hash) {
  const signals = readSignals(body);
  const secret = String(body?.secret || '');
  return {
    device: String(body?.device || ''),
    secret: /^[a-f0-9]{32}$/.test(secret) ? await hash(secret) : '',
    hardware: await hash(hardwareKey(signals)),
    browser: await hash(browserKey(signals)),
    family: platformFamily(signals.ua, signals.platform),
    screen: screenBucket(signals.width, signals.height, signals.dpr),
    ip: ipHash || '',
  };
}

export async function handleReferral(request, ctx) {
  if (request.method !== 'POST') return json({ error: 'Use POST' }, 405);
  const body = await request.json().catch(() => ({}));
  const device = String(body.device || '');
  if (!validDevice(device)) return json({ ok: false, reason: 'invalid' }, 400);
  const url = new URL(request.url);
  if (url.pathname === '/access/refer/code') return createCode(body, device, ctx);
  if (url.pathname === '/access/refer/redeem') return redeemCode(body, device, ctx);
  return json({ error: 'Not found' }, 404);
}

async function createCode(body, device, { storage, now, ipHash, hash }) {
  const day = new Date(now).toISOString().slice(0, 10);
  const tallyKey = `refday:${day}:${device}`;
  const tally = Number(await storage.get(tallyKey)) || 0;
  if (tally >= 5) return json({ ok: false, reason: 'rate-limited' }, 429);
  const profile = await profileOf(body, ipHash, hash);
  let code = '';
  for (let i = 0; i < 5 && !code; i++) {
    const next = newCode();
    if (!(await storage.get('ref:' + next))) code = next;
  }
  if (!code) return json({ ok: false, reason: 'unavailable' }, 503);
  const previous = await storage.get('refby:' + device);
  const record = { ...profile, created: now, expires: now + 14 * 86400000, used: false };
  const put = { ['ref:' + code]: record, ['refby:' + device]: code, [tallyKey]: tally + 1 };
  if (typeof previous === 'string' && previous !== code) put['ref:' + previous] = { used: true, device: '', expires: 0 };
  await storage.put(put);
  return json({ ok: true, code, expires: record.expires });
}

async function redeemCode(body, device, ctx) {
  const { storage, now, ipHash, hash, unlock } = ctx;
  const house = /^[a-f0-9]{32}$/.test(ctx.household || '') ? ctx.household : '';
  if (await storage.get('own:' + device) || (house && await storage.get('house:' + house)) || isOwnerProof(ctx.ownerProof, { origin: ctx.origin, now })) {
    return json({ ok: false, reason: 'excluded' }, 200);
  }
  const code = normalizeCode(body.code);
  if (!code) return json({ ok: false, reason: 'invalid' }, 400);
  const record = await storage.get('ref:' + code);
  if (!record?.device || record.used) return json({ ok: false, reason: record?.used ? 'taken' : 'invalid' }, 200);
  if (record.expires && now > record.expires) return json({ ok: false, reason: 'expired' }, 200);
  if (await storage.get('friend:' + device)) return json({ ok: false, reason: 'used' }, 200);
  const friend = await profileOf(body, ipHash, hash);
  const seenKey = 'seen:' + device;
  const firstSeen = Number(await storage.get(seenKey)) || 0;
  const verdict = judgeReferral({
    referrer: record,
    friend,
    codeCreatedAt: record.created,
    friendFirstSeen: firstSeen,
    standalone: body.standalone === true || body.signals?.standalone === true,
  });
  if (!verdict.ok) return json({ ok: false, reason: verdict.reason });
  if (!firstSeen) await storage.put({ [seenKey]: now });

  const holdKey = 'hold:' + device;
  const hold = await storage.get(holdKey);
  const challenge = String(body.challenge || '');
  if (!hold || hold.code !== code || hold.hardware !== friend.hardware) {
    const challengeId = hexId(8);
    await storage.put({ [holdKey]: { code, challenge: challengeId, at: now, hardware: friend.hardware } });
    return json({ ok: false, reason: 'hold', waitMs: HOLD_MS, challenge: challengeId });
  }
  const waitMs = HOLD_MS - (now - hold.at);
  if (challenge !== hold.challenge || waitMs > 0) {
    return json({ ok: false, reason: 'hold', waitMs: Math.max(0, waitMs), challenge: hold.challenge });
  }

  const saved = await unlock(record.device, 'friend:' + device, 'a friend');
  if (!saved?.ok) return json({ ok: false, reason: saved?.reason || 'unavailable' });
  await storage.put({
    ['ref:' + code]: { ...record, used: true, friend: device, redeemed: now },
    ['friend:' + device]: code,
  });
  return json({ ok: true, reason: 'ok', thanked: true });
}

export async function discordGuildId(storage, fetcher, envGuild, signal) {
  if (/^\d{5,25}$/.test(String(envGuild || ''))) return String(envGuild);
  const cached = await storage.get('discord:guild');
  if (/^\d{5,25}$/.test(String(cached || ''))) return String(cached);
  const response = await fetcher(`https://discord.com/api/v10/invites/${DISCORD.code}`, {
    headers: { Accept: 'application/json', 'User-Agent': 'SpotPlus (https://coye2.github.io/spot-plus/)' },
    signal,
  });
  if (!response.ok) return '';
  const data = await response.json();
  const id = String(data?.guild?.id || '');
  if (/^\d{5,25}$/.test(id)) await storage.put({ 'discord:guild': id });
  return id;
}

export { isGuildMember };
