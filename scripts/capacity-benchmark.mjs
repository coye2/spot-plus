// scripts/capacity-benchmark.mjs — Deterministic mocked load & resilience benchmark for Spot+ Operation S+.
// Exercises real canvas-bridge/worker.js secureHandle() + client RequestScheduler with mocked upstream
// responses ONLY. Never sends traffic to production or third-party servers.
import { performance } from 'node:perf_hooks';
import { secureHandle, resetRateLimits } from '../canvas-bridge/worker.js';
import { RequestScheduler, PRIORITY } from '../js/request-scheduler.js';

function createMemoryCache() {
  const store = new Map();
  let hits = 0;
  let misses = 0;
  return {
    async match(req) {
      const k = typeof req === 'string' ? req : req.url;
      const hit = store.get(k);
      if (hit) {
        hits++;
        return hit.clone();
      }
      misses++;
      return undefined;
    },
    async put(req, res) {
      const k = typeof req === 'string' ? req : req.url;
      store.set(k, res.clone());
    },
    stats() {
      const total = hits + misses;
      return { hits, misses, hitRate: total ? Math.round((hits / total) * 1000) / 1000 : 0, size: store.size };
    },
    clear() {
      store.clear();
      hits = 0;
      misses = 0;
    },
  };
}

function percentile(values, p) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return Math.round(sorted[idx] * 1000) / 1000;
}

const SAMPLE_SONGS = [
  'The Weeknd Blinding Lights',
  'Daft Punk Instant Crush',
  'SZA Kill Bill',
  'Kendrick Lamar Not Like Us',
  'Tame Impala The Less I Know The Better',
  'Frank Ocean Nights',
  'Radiohead Weird Fishes',
  'Billie Eilish Birds of a Feather',
  'Arctic Monkeys Do I Wanna Know',
  'Dua Lipa Levitating',
  'Travis Scott 90210',
  'Lana Del Rey Cinnamon Girl',
  'Tyler The Creator See You Again',
  'Deftones Sextape',
  'Fleetwood Mac Dreams',
  'Mac Miller Self Care',
  'Playboi Carti Sky',
  'Bad Bunny Monaco',
  'Paramore Still Into You',
  'Gorillaz Feel Good Inc',
];

function mockYoutubeSearchResponse(song) {
  const id = 'vid' + String(Math.abs([...song].reduce((a, c) => ((a << 5) - a + c.charCodeAt(0)) | 0, 7))).padStart(8, '0').slice(0, 8);
  return new Response(JSON.stringify({
    contents: {
      twoColumnSearchResultsRenderer: {
        primaryContents: {
          sectionListRenderer: {
            contents: [{
              itemSectionRenderer: {
                contents: [{
                  videoRenderer: {
                    videoId: id,
                    title: { runs: [{ text: song }] },
                    ownerText: { runs: [{ text: song.split(' ')[0] + ' - Topic' }] },
                    lengthText: { simpleText: '3:20' },
                    ownerBadges: [{}],
                  },
                }],
              },
            }],
          },
        },
      },
    },
  }), { status: 200, headers: { 'Content-Type': 'application/json' } });
}

/**
 * Compute realistic Cloudflare Workers monthly cost projection (2025/2026 pricing):
 * - Free tier: 100,000 requests/day (~3M/month hard cap per account)
 * - Paid plan: $5/month includes 10M requests + $0.30 per additional 1M requests (zero bandwidth/egress cost)
 */
export function estimateCloudflareCost({ concurrentListeners, avgTracksPerHour = 16, workerReqsPerTrack = 2.6, activeHoursPerDay = 2.0 }) {
  const dailyTrackPlays = concurrentListeners * avgTracksPerHour * activeHoursPerDay;
  // Assume ~15% edge-cache hit / client-memo hit on metadata, plus ~1.1 relay GET + 0.5 HEAD + 0.3 match + 0.2 stats/canvas per completed track.
  const dailyWorkerReqs = Math.round(dailyTrackPlays * workerReqsPerTrack);
  const monthlyWorkerReqs = dailyWorkerReqs * 30;
  const fitsFreePlan = dailyWorkerReqs <= 100_000;
  const overageMillions = Math.max(0, (monthlyWorkerReqs - 10_000_000) / 1_000_000);
  const paidMonthlyUsd = Math.round((5 + overageMillions * 0.30) * 100) / 100;
  return {
    concurrentListeners,
    dailyWorkerReqs,
    monthlyWorkerReqs,
    fitsFreePlan,
    paidMonthlyUsd,
  };
}

async function runConcurrencyTier(listeners) {
  resetRateLimits();
  const cache = createMemoryCache();
  let originCalls = 0;
  const fetcher = async (url, init) => {
    originCalls++;
    if (String(url).includes('youtube.com/youtubei')) {
      const body = JSON.parse(init?.body || '{}');
      return mockYoutubeSearchResponse(body.query || 'Song');
    }
    return new Response(JSON.stringify({ success: true, canvasUrl: 'https://canvaz.scdn.co/upload/demo.mp4' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  };

  // Process requests in realistic waves of 20 so edge cache warming reflects live listener overlap.
  const sampleReqs = Math.min(listeners, 1000);
  const latencies = [];
  let ok = 0;
  let limited = 0;
  const t0 = performance.now();

  const waveSize = 20;
  for (let offset = 0; offset < sampleReqs; offset += waveSize) {
    const wave = [];
    for (let i = offset; i < Math.min(sampleReqs, offset + waveSize); i++) {
      const song = SAMPLE_SONGS[i % SAMPLE_SONGS.length];
      const ip = `198.51.${Math.floor(i / 250) % 250}.${(i % 250) + 1}`;
      const req = new Request(`https://bridge.test/match?q=${encodeURIComponent(song)}`, {
        headers: { Origin: 'https://coye2.github.io', 'CF-Connecting-IP': ip },
      });
      wave.push((async () => {
        const start = performance.now();
        const res = await secureHandle(req, { fetcher, cache, waitUntil: (p) => p.catch(() => {}) });
        latencies.push(performance.now() - start);
        if (res.status === 200) ok++;
        else if (res.status === 429) limited++;
      })());
    }
    await Promise.all(wave);
  }
  const totalMs = Math.max(0.01, performance.now() - t0);
  const cacheStats = cache.stats();
  const cost = estimateCloudflareCost({ concurrentListeners: listeners });

  return {
    listeners,
    sampledRequests: sampleReqs,
    ok,
    limited,
    originCalls,
    cacheHitRate: cacheStats.hitRate,
    throughputRps: Math.round((sampleReqs / (totalMs / 1000)) * 10) / 10,
    p50Ms: percentile(latencies, 50),
    p95Ms: percentile(latencies, 95),
    p99Ms: percentile(latencies, 99),
    ...cost,
  };
}

async function runStressScenarios() {
  const results = {};

  // 1. Malformed request flood: 100 bad requests (control chars, >12 params, path traversal, >1200 chars)
  resetRateLimits();
  let originTouched = 0;
  const noopFetcher = async () => { originTouched++; return new Response('{}', { status: 200 }); };
  const malformedUrls = [
    'https://bridge.test/match?q=abc&a=1&b=2&c=3&d=4&e=5&f=6&g=7&h=8&i=9&j=10&k=11&l=12',
    'https://bridge.test/match?q=hello%00world',
    'https://bridge.test/match/%252e%252e/secret',
    'https://bridge.test/match?q=' + 'x'.repeat(1250),
  ];
  let rejected = 0;
  for (let i = 0; i < 80; i++) {
    const r = await secureHandle(new Request(malformedUrls[i % malformedUrls.length], {
      headers: { Origin: 'https://coye2.github.io', 'CF-Connecting-IP': '203.0.113.10' },
    }), { fetcher: noopFetcher });
    if (r.status === 400 || r.status === 414) rejected++;
  }
  results.malformedFlood = { sent: 80, rejected, originTouched };

  // 2. Cache-busting abusive flood + CGNAT fairness check
  resetRateLimits();
  const cache = createMemoryCache();
  let cbOriginCalls = 0;
  const cbFetcher = async () => {
    cbOriginCalls++;
    return mockYoutubeSearchResponse('The Weeknd Blinding Lights');
  };
  let attacker200 = 0;
  let attacker429 = 0;
  const sharedIp = '198.51.100.42';
  const now = 1_700_000_000_000;
  // Single abusive client fires 90 cache-busting requests in 1 second
  for (let i = 0; i < 90; i++) {
    const r = await secureHandle(new Request(`https://bridge.test/match?q=The+Weeknd+Blinding+Lights&cb=${i}&rnd=${i * 7}`, {
      headers: { Origin: 'https://coye2.github.io', 'CF-Connecting-IP': sharedIp, 'X-Spotplus-Client': 'attacker0001' },
    }), { fetcher: cbFetcher, cache, waitUntil: (p) => p.catch(() => {}), now });
    if (r.status === 200) attacker200++;
    else if (r.status === 429) attacker429++;
  }
  // Legitimate listener behind the SAME carrier CGNAT IP with its own client bucket still gets 200!
  const legitRes = await secureHandle(new Request('https://bridge.test/match?q=The+Weeknd+Blinding+Lights', {
    headers: { Origin: 'https://coye2.github.io', 'CF-Connecting-IP': sharedIp, 'X-Spotplus-Client': 'legituser009' },
  }), { fetcher: cbFetcher, cache, waitUntil: (p) => p.catch(() => {}), now });
  results.cacheBustAndCgnat = {
    attackerSent: 90,
    attacker200,
    attacker429,
    originCallsDespiteCacheBusting: cbOriginCalls,
    cgnatLegitimateStatus: legitRes.status,
  };

  // 3. Sudden 5x spike & upstream 503 outage graceful degradation via RequestScheduler
  const sched = new RequestScheduler();
  // Trigger critical pressure (429 / outage)
  sched.noteStatus(429);
  const playbackAllowed = sched.canRun(PRIORITY.PLAYING_AUDIO, { respectFlag: false });
  const trackChangeAllowed = sched.canRun(PRIORITY.TRACK_CHANGE, { respectFlag: false });
  const recoveryAllowed = sched.canRun(PRIORITY.RECOVERY, { respectFlag: false });
  const searchAllowed = sched.canRun(PRIORITY.SEARCH_METADATA, { respectFlag: false });
  const recsAllowed = sched.canRun(PRIORITY.RECOMMENDATIONS, { respectFlag: false });
  const canvasAllowed = sched.canRun(PRIORITY.DECORATIVE, { respectFlag: false });
  const analyticsAllowed = sched.canRun(PRIORITY.ANALYTICS, { respectFlag: false });

  // Simulate 500 mixed requests during critical pressure: 200 core (tiers 1-4) + 300 nonessential (tiers 6-8)
  let coreAdmitted = 0;
  let nonEssentialShed = 0;
  for (let i = 0; i < 200; i++) {
    const tier = (i % 4) + 1;
    const out = await sched.schedule(tier, async () => 'ok', { fallbackValue: 'shed' });
    if (out === 'ok') coreAdmitted++;
  }
  for (let i = 0; i < 300; i++) {
    const tier = 6 + (i % 3);
    const out = await sched.schedule(tier, async () => 'ok', { fallbackValue: 'shed' });
    if (out === 'shed') nonEssentialShed++;
  }
  results.gracefulDegradation = {
    pressure: sched.getPressure(),
    playbackAllowed,
    trackChangeAllowed,
    recoveryAllowed,
    searchAllowed,
    recsAllowed,
    canvasAllowed,
    analyticsAllowed,
    coreAdmitted,
    nonEssentialShed,
  };

  // 4. Upstream 503 outage response latency & clean error handling
  resetRateLimits();
  const failFetcher = async () => new Response('Upstream down', { status: 503 });
  const outageRes = await secureHandle(new Request('https://bridge.test/canvas?song=Test&artist=Artist', {
    headers: { Origin: 'https://coye2.github.io', 'CF-Connecting-IP': '198.51.100.99' },
  }), { fetcher: failFetcher });
  results.upstreamOutage = { status: outageRes.status };

  return results;
}

export async function runAllBenchmarks() {
  const tiers = [];
  for (const n of [100, 500, 1000, 5000, 10000]) {
    tiers.push(await runConcurrencyTier(n));
  }
  const stress = await runStressScenarios();
  return { generatedAt: new Date().toISOString(), tiers, stress };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const report = await runAllBenchmarks();
  console.log(JSON.stringify(report, null, 2));
}
