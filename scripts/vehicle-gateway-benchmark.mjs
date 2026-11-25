// scripts/vehicle-gateway-benchmark.mjs — Deterministic Path 2 OpenSubsonic Gateway Benchmark.
// Measures real local request latency, throughput, direct-302 bandwidth savings, auth rejection,
// and Cloudflare Workers Free/Paid cost projections across 100 -> 10,000 concurrent car listeners.

import { performance } from 'node:perf_hooks';
import { handleGatewayRequest, resetGatewayRateLimits } from '../workers/media-gateway/src/gateway.js';

const ORIGIN = 'https://gateway.spotplus.bench';
const ENV = {
  SPOTPLUS_GATEWAY_USER: 'sp_bench',
  SPOTPLUS_GATEWAY_API_KEY: 'bench-api-key-spotplus-vehicle-01',
  GATEWAY_ALLOW_TEST_AUDIO: 'true',
};

// Realistic 1-hour commute OpenSubsonic client request profile per listener:
//  - 1 ping + 1 getOpenSubsonicExtensions + 1 getPlaylists + 2 getPlaylist + 1 search3 = 6 browse calls
//  - ~15 tracks/hour × (1 /rest/stream 302 redirect + 1 /rest/scrobble + 0.3 uncached cover art 302) = ~35 calls
//  - Total = ~41 lightweight control-plane requests / listening hour (~0 KB/s media egress on gateway!).
const REQUESTS_PER_LISTENING_HOUR = 41;
const AVG_LISTENING_HOURS_PER_MONTH = 22; // ~45 min/day commute × 30 days
const WORKER_FREE_DAILY_LIMIT = 100_000;
const WORKER_PAID_BASE_USD = 5.0;
const WORKER_PAID_INCLUDED_REQS = 10_000_000;
const WORKER_PAID_EXTRA_PER_M = 0.30;

function percentile(sorted, p) {
  if (!sorted.length) return 0;
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return Number(sorted[idx].toFixed(3));
}

async function runProfile(concurrentListeners) {
  resetGatewayRateLimits();
  const endpoints = [
    `/rest/ping?apiKey=${ENV.SPOTPLUS_GATEWAY_API_KEY}&f=json`,
    `/rest/getPlaylists?apiKey=${ENV.SPOTPLUS_GATEWAY_API_KEY}&f=json`,
    `/rest/getPlaylist?id=pl-drive-mix&apiKey=${ENV.SPOTPLUS_GATEWAY_API_KEY}&f=json`,
    `/rest/search3?query=CarPlay&apiKey=${ENV.SPOTPLUS_GATEWAY_API_KEY}&f=json`,
    `/rest/stream?id=test-track-523&apiKey=${ENV.SPOTPLUS_GATEWAY_API_KEY}`,
    `/rest/scrobble?id=test-track-523&submission=true&apiKey=${ENV.SPOTPLUS_GATEWAY_API_KEY}`,
  ];

  // Sample realistic wave scaled deterministically up to 600 live handler invocations per tier
  const sampleReqs = Math.min(600, Math.max(120, concurrentListeners));
  const latencies = [];
  let redirects302 = 0;
  let ok200 = 0;
  let errors = 0;
  let controlBytesOut = 0;

  const t0 = performance.now();
  const waveSize = 20;
  for (let i = 0; i < sampleReqs; i += waveSize) {
    const batch = [];
    for (let j = i; j < Math.min(sampleReqs, i + waveSize); j++) {
      const path = endpoints[j % endpoints.length];
      const ip = `203.0.113.${(j % 250) + 1}`;
      batch.push((async () => {
        const s = performance.now();
        const res = await handleGatewayRequest(
          new Request(`${ORIGIN}${path}`, { headers: { 'CF-Connecting-IP': ip } }),
          { env: ENV },
        );
        const body = await res.arrayBuffer();
        latencies.push(performance.now() - s);
        controlBytesOut += body.byteLength;
        if (res.status === 302) redirects302 += 1;
        else if (res.status === 200) ok200 += 1;
        else errors += 1;
      })());
    }
    await Promise.all(batch);
  }
  const elapsedSec = (performance.now() - t0) / 1000;
  latencies.sort((a, b) => a - b);

  // Cloudflare monthly economics (control-plane direct-302 mode)
  const dailyRequests = Math.round(concurrentListeners * REQUESTS_PER_LISTENING_HOUR * (AVG_LISTENING_HOURS_PER_MONTH / 30));
  const monthlyRequests = Math.round(concurrentListeners * REQUESTS_PER_LISTENING_HOUR * AVG_LISTENING_HOURS_PER_MONTH);
  const fitsFreePlan = dailyRequests <= WORKER_FREE_DAILY_LIMIT;
  const overageMillions = Math.max(0, (monthlyRequests - WORKER_PAID_INCLUDED_REQS) / 1_000_000);
  const paidMonthlyUsd = Number((WORKER_PAID_BASE_USD + overageMillions * WORKER_PAID_EXTRA_PER_M).toFixed(2));

  return {
    concurrentListeners,
    measuredSampleRequests: sampleReqs,
    ok200,
    redirects302,
    errors,
    throughputReqPerSec: Math.round(sampleReqs / Math.max(0.001, elapsedSec)),
    p50Ms: percentile(latencies, 50),
    p95Ms: percentile(latencies, 95),
    avgControlPayloadBytes: Math.round(controlBytesOut / sampleReqs),
    gatewayMediaEgressMbps: 0, // 302 direct playback bypasses gateway for audio bytes
    projectedDailyRequests: dailyRequests,
    projectedMonthlyRequests: monthlyRequests,
    fitsCloudflareFreePlan: fitsFreePlan,
    estimatedPaidMonthlyUsd: paidMonthlyUsd,
  };
}

async function runAbuseChecks() {
  resetGatewayRateLimits();
  let blockedBadAuth = 0;
  for (let i = 0; i < 40; i++) {
    const res = await handleGatewayRequest(
      new Request(`${ORIGIN}/rest/ping?apiKey=wrong-${i}`, { headers: { 'CF-Connecting-IP': '198.51.100.9' } }),
      { env: ENV },
    );
    if (res.status === 401) blockedBadAuth += 1;
  }

  resetGatewayRateLimits();
  let throttled429 = 0;
  for (let i = 0; i < 100; i++) {
    const res = await handleGatewayRequest(
      new Request(`${ORIGIN}/rest/ping?apiKey=${ENV.SPOTPLUS_GATEWAY_API_KEY}`, { headers: { 'CF-Connecting-IP': '198.51.100.77' } }),
      { env: ENV },
    );
    if (res.status === 429) throttled429 += 1;
  }

  return { blockedBadAuth, throttled429 };
}

const tiers = [100, 500, 1000, 5000, 10000];
const results = [];
for (const tier of tiers) {
  results.push(await runProfile(tier));
}
const abuse = await runAbuseChecks();

const summary = {
  benchmark: 'Spot+ Path 2 OpenSubsonic Universal Media Gateway (Direct-302 Mode)',
  assumptions: {
    requestsPerListeningHour: REQUESTS_PER_LISTENING_HOUR,
    avgListeningHoursPerMonth: AVG_LISTENING_HOURS_PER_MONTH,
    cloudflareWorkersPricing: 'Free: 100k req/day ($0 egress); Paid: $5/mo includes 10M req/mo + $0.30/additional 1M ($0 egress)',
  },
  tiers: results,
  abuseResilience: abuse,
};

console.log(JSON.stringify(summary, null, 2));
if (results.some((r) => r.errors > 0) || abuse.blockedBadAuth !== 40 || abuse.throttled429 < 15) {
  process.exit(1);
}
