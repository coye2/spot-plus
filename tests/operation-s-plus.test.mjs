import test from 'node:test';
import assert from 'node:assert/strict';
import { browserMocks, settle, storageMock } from './helpers.mjs';

browserMocks();

test('Feature flags can independently toggle Operation S+ capabilities and reset cleanly', async () => {
  const flags = await import('../js/feature-flags.js');
  flags.resetFeatureFlags();
  assert.equal(flags.isFeatureEnabled('sPlusStateMachine'), true);
  assert.equal(flags.isFeatureEnabled('sPlusRecoveryCheckpoint'), true);
  assert.equal(flags.isFeatureEnabled('sPlusAdaptivePreload'), true);
  assert.equal(flags.isFeatureEnabled('sPlusCrossfadeGuard'), true);
  assert.equal(flags.isFeatureEnabled('sPlusGracefulDegradation'), true);

  flags.setFeatureFlag('sPlusAdaptivePreload', false);
  assert.equal(flags.isFeatureEnabled('sPlusAdaptivePreload'), false);
  assert.equal(flags.isFeatureEnabled('sPlusStateMachine'), true);

  flags.reloadFeatureFlags();
  assert.equal(flags.isFeatureEnabled('sPlusAdaptivePreload'), false);
  flags.resetFeatureFlags();
  assert.equal(flags.isFeatureEnabled('sPlusAdaptivePreload'), true);
});

test('Playback policy computes network-aware timeouts, adaptive preloading, and iOS/AirPlay crossfade protection', async () => {
  const { networkTimeoutMs, shouldPreloadNext, canSafelyCrossfade } = await import('../js/playback-policy.js');

  assert.equal(networkTimeoutMs('match', { effectiveType: '4g', rtt: 50, downlink: 10 }), 3500);
  assert.ok(networkTimeoutMs('match', { effectiveType: '3g', rtt: 250, downlink: 1.0 }) > 4000);
  assert.ok(networkTimeoutMs('match', { effectiveType: '2g', saveData: true }) > networkTimeoutMs('match', { effectiveType: '3g' }));

  // Adaptive preloading: healthy 4G enables Stage A + Stage B
  const healthy = shouldPreloadNext({
    remainingSec: 40,
    bufferedSec: 8,
    connection: { effectiveType: '4g', downlink: 10, saveData: false },
    relayLatencyMs: 350,
    isRapidSkipping: false,
    deviceMemoryGb: 4,
    queueStable: true,
    pressureLevel: 'normal',
  });
  assert.equal(healthy.stageA, true);
  assert.equal(healthy.stageB, true);

  // Save-Data / 2G disables preloading completely
  const saveData = shouldPreloadNext({ connection: { effectiveType: '4g', saveData: true } });
  assert.equal(saveData.stageA, false);
  assert.equal(saveData.stageB, false);

  // Critical Worker pressure stops preloading completely
  const critical = shouldPreloadNext({ pressureLevel: 'critical' });
  assert.equal(critical.stageA, false);
  assert.equal(critical.stageB, false);

  // Low memory (1 GB) allows Stage A metadata/link warm only, never Stage B double-buffering
  const lowMem = shouldPreloadNext({ deviceMemoryGb: 1, bufferedSec: 12, pressureLevel: 'normal' });
  assert.equal(lowMem.stageA, true);
  assert.equal(lowMem.stageB, false);

  // Rapid skipping defers Stage B
  const rapid = shouldPreloadNext({ isRapidSkipping: true, bufferedSec: 12 });
  assert.equal(rapid.stageB, false);
  assert.ok(rapid.delayMs >= 900);

  // Crossfade guard: iOS background & AirPlay strictly disable crossfade to protect native audio session
  assert.equal(canSafelyCrossfade({ isIOS: true, documentHidden: true, mixSeconds: 6, canWebAudio: true }).allowed, false);
  assert.equal(canSafelyCrossfade({ isIOS: true, wirelessActive: true, mixSeconds: 6, canWebAudio: true }).allowed, false);
  assert.equal(canSafelyCrossfade({ isIOS: true, documentHidden: false, wirelessActive: false, mixSeconds: 6, canWebAudio: true }).mode, 'webaudio');
  assert.equal(canSafelyCrossfade({ isIOS: false, documentHidden: false, wirelessActive: false, mixSeconds: 6, elementVolumeSupported: true, canWebAudio: false }).mode, 'element');
});

test('RequestScheduler enforces priority tiers 1-8 and sheds nonessential traffic under 429/outage pressure', async () => {
  const { RequestScheduler, PRIORITY, PRESSURE } = await import('../js/request-scheduler.js');
  const sched = new RequestScheduler({ elevatedWindowMs: 10_000, criticalWindowMs: 30_000 });
  const now = 1_700_000_000_000;

  assert.equal(sched.getPressure(now), PRESSURE.NORMAL);
  assert.equal(sched.canRun(PRIORITY.ANALYTICS, { now }), true);
  assert.equal(sched.canRun(PRIORITY.DECORATIVE, { now }), true);

  // Two 503s -> elevated pressure: sheds decorative (7) & analytics (8) while keeping playback (1-4) & lyrics (5)
  sched.noteStatus(503, 120, now);
  sched.noteStatus(503, 120, now + 100);
  assert.equal(sched.getPressure(now + 200), PRESSURE.ELEVATED);
  assert.equal(sched.canRun(PRIORITY.PLAYING_AUDIO, { now: now + 200 }), true);
  assert.equal(sched.canRun(PRIORITY.TRACK_CHANGE, { now: now + 200 }), true);
  assert.equal(sched.canRun(PRIORITY.RECOVERY, { now: now + 200 }), true);
  assert.equal(sched.canRun(PRIORITY.SEARCH_METADATA, { now: now + 200 }), true);
  assert.equal(sched.canRun(PRIORITY.DECORATIVE, { now: now + 200 }), false);
  assert.equal(sched.canRun(PRIORITY.ANALYTICS, { now: now + 200 }), false);

  // 429 -> critical pressure: also sheds recommendations (6), keeps tiers 1-4 untouched
  sched.noteStatus(429, 50, now + 300);
  assert.equal(sched.getPressure(now + 400), PRESSURE.CRITICAL);
  assert.equal(sched.canRun(PRIORITY.PLAYING_AUDIO, { now: now + 400 }), true);
  assert.equal(sched.canRun(PRIORITY.RECOMMENDATIONS, { now: now + 400 }), false);

  const shedResult = await sched.schedule(PRIORITY.ANALYTICS, async () => 'sent', { fallbackValue: 'shed', now: now + 400 });
  assert.equal(shedResult, 'shed');
  assert.equal(sched.snapshot(now + 400).shed, 1);

  // Cooldown restores normal pressure automatically
  assert.equal(sched.getPressure(now + 35_000), PRESSURE.NORMAL);
  assert.equal(sched.canRun(PRIORITY.ANALYTICS, { now: now + 35_000 }), true);

  // Negative cache TTL expires cleanly
  sched.negativeCache.set('match:missing', 5000, now);
  assert.equal(sched.negativeCache.has('match:missing', now + 1000), true);
  assert.equal(sched.negativeCache.has('match:missing', now + 6000), false);
});

test('PlaybackTelemetry separates upstream vs network vs client failures and tracks requests per completed track', async () => {
  const { PlaybackTelemetry } = await import('../js/playback-telemetry.js');
  const t = new PlaybackTelemetry();
  t.beginGeneration(1, { trackId: 't1' });
  t.recordRelayRequest('match');
  t.recordRelayRequest('yta-get');
  t.markStage(1, 'firstAudible');
  t.recordTrackCompleted();
  t.recordFailure('upstream');
  t.recordFailure('network');
  t.recordFailure('client');
  t.recordShedRequest();
  t.recordCheckpoint('save');
  t.recordCheckpoint('restore');

  const snap = t.snapshot();
  assert.equal(snap.counters.tracksCompleted, 1);
  assert.equal(snap.counters.totalWorkerRequests, 2);
  assert.equal(snap.counters.requestsPerCompletedTrack, 2);
  assert.equal(snap.counters.failureBreakdown.upstream, 1);
  assert.equal(snap.counters.failureBreakdown.network, 1);
  assert.equal(snap.counters.failureBreakdown.client, 1);
  assert.equal(snap.counters.shedRequests, 1);
  assert.equal(snap.counters.checkpointSaves, 1);
  assert.equal(snap.counters.checkpointRestores, 1);
});

test('Player state machine transitions through PLAYING, PAUSED, SEEKING and persists/restores recovery checkpoints', async () => {
  const player = await import('../js/player.js');
  const store = storageMock();
  const tracks = [
    { id: 'sp-op-1', title: 'Track One', artist: 'Artist A', duration: 200, local: true },
    { id: 'sp-op-2', title: 'Track Two', artist: 'Artist B', duration: 210, local: true },
  ];

  player.playList(tracks, 0);
  await settle();
  assert.equal(player.state.phase, player.STATES.PLAYING);
  assert.equal(player.canTransition(player.STATES.PLAYING, player.STATES.PAUSED), true);
  assert.equal(player.canTransition(player.STATES.PLAYING, player.STATES.SEEKING), true);

  // Save checkpoint while playing
  const cp = player.saveRecoveryCheckpoint('pagehide', store);
  assert.ok(cp);
  assert.equal(cp.trackId, 'sp-op-1');
  assert.equal(cp.intent, 'playing');

  // Pause enters explicit PAUSED state
  player.pause();
  await settle();
  assert.equal(player.state.phase, player.STATES.PAUSED);

  // Restore checkpoint into idle player marks honest OS-terminated recovery reason without faking playback
  const restored = player.restoreFromCheckpoint({ ifIdle: true, storage: store });
  assert.ok(restored);
  assert.equal(player.getContinuityState().restoredFromCheckpoint, true);
  assert.equal(player.getContinuityState().pauseReason, 'os-terminated-checkpoint');

  // Metrics expose Operation S+ scheduler, flags, and checkpoint state
  const metrics = player.getMetrics();
  assert.ok(metrics.scheduler);
  assert.equal(typeof metrics.flags.sPlusStateMachine, 'boolean');
});

test('Worker rejects malformed requests, strips cache-busting params, protects CGNAT users, and adds SWR headers', async () => {
  const { secureHandle, resetRateLimits, validateRequest, canonicalCacheKey } = await import('../canvas-bridge/worker.js');
  resetRateLimits();

  // Malformed query param flood (>12 params) and path traversal rejected with 400
  const manyParams = new URL('https://bridge.test/match?q=a&p1=1&p2=2&p3=3&p4=4&p5=5&p6=6&p7=7&p8=8&p9=9&p10=10&p11=11&p12=12');
  assert.equal(validateRequest(manyParams).ok, false);
  const badRes = await secureHandle(new Request(manyParams.href, { headers: { Origin: 'https://coye2.github.io' } }));
  assert.equal(badRes.status, 400);

  const traversal = await secureHandle(new Request('https://bridge.test/match/%252e%252e/etc/passwd', { headers: { Origin: 'https://coye2.github.io' } }));
  assert.equal(traversal.status, 400);

  // Canonical cache key ignores cache-busting params
  const k1 = canonicalCacheKey(new URL('https://bridge.test/match?q=Blinding+Lights&cb=123'), ['q', 'type']);
  const k2 = canonicalCacheKey(new URL('https://bridge.test/match?q=blinding   lights&rnd=999'), ['q', 'type']);
  assert.equal(k1, k2);

  // /health includes stale-while-revalidate Cache-Control header
  const health = await secureHandle(new Request('https://bridge.test/health', { headers: { Origin: 'https://coye2.github.io' } }));
  assert.equal(health.status, 200);
  assert.match(health.headers.get('Cache-Control') || '', /stale-while-revalidate=/);

  // CGNAT fairness: abusive client bucket hits burst 429 while separate legitimate client on same IP succeeds
  resetRateLimits();
  const sharedIp = '198.51.100.77';
  const now = 1_700_000_000_000;
  let attackerBlocked = false;
  for (let i = 0; i < 70; i++) {
    const r = await secureHandle(new Request('https://bridge.test/health', {
      headers: { Origin: 'https://coye2.github.io', 'CF-Connecting-IP': sharedIp, 'X-Spotplus-Client': 'badclient01' },
    }), { now });
    if (r.status === 429) attackerBlocked = true;
  }
  assert.equal(attackerBlocked, true);
  const legit = await secureHandle(new Request('https://bridge.test/health', {
    headers: { Origin: 'https://coye2.github.io', 'CF-Connecting-IP': sharedIp, 'X-Spotplus-Client': 'gooduser02' },
  }), { now });
  assert.equal(legit.status, 200);
  resetRateLimits();
});
