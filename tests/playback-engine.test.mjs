import test from 'node:test';
import assert from 'node:assert/strict';
import { browserMocks, storageMock, settle } from './helpers.mjs';

browserMocks();

test('PlaybackTelemetry records stage timestamps, p50/p95/p99, and separates play() from audible proxy', async () => {
  const { PlaybackTelemetry } = await import('../js/playback-telemetry.js');
  const t = new PlaybackTelemetry();
  t.beginGeneration(1, { trackId: 'a', cold: true });
  t.markStage(1, 'resolveStart');
  t.markStage(1, 'resolveEnd', { cacheLayer: 'network', sourceKind: 'invidious', instance: 'https://inv.test' });
  t.markStage(1, 'mediaInit');
  t.markStage(1, 'playResolved');
  t.markStage(1, 'firstAudible');

  t.beginGeneration(2, { trackId: 'b', prepared: true, cold: false });
  t.markStage(2, 'resolveEnd', { cacheLayer: 'warmed-buffer', prepared: true, cold: false });
  t.markStage(2, 'mediaInit');
  t.markStage(2, 'firstAudible');

  const snap = t.snapshot();
  assert.equal(snap.counters.startsAttempted, 2);
  assert.equal(snap.counters.startsSucceeded, 2);
  assert.equal(snap.counters.preparedTransitions, 1);
  assert.equal(snap.latencies.coldStartupMs.n, 1);
  assert.equal(snap.latencies.preparedTransitionMs.n, 1);
  assert.equal(snap.lastAudit.audibleProxy, 'playing-event-with-decode');
});

test('SourceRouter penalizes failing fast endpoints, trips circuit breakers with exponential backoff, and recovers via half-open probe', async () => {
  const { SourceRouter, validateSourceCandidate, isVerifiedEquivalent } = await import('../js/source-router.js');
  const router = new SourceRouter(storageMock());
  let now = 1_000_000;

  // Endpoint A responds fast with HTTP 403 failures; Endpoint B takes 150ms but succeeds consistently
  router.recordResolution('https://fast-fail.example', 25, false, { now });
  router.recordResolution('https://fast-fail.example', 30, false, { now });
  router.recordResolution('https://reliable.example', 150, true, { now });
  router.recordResolution('https://reliable.example', 140, true, { now });

  // Circuit breaker for fast-fail should be open now -> reliable ranks first and fast-fail is filtered out
  assert.equal(router.isAvailable('https://fast-fail.example', now), false);
  assert.deepEqual(
    router.rank(['https://fast-fail.example', 'https://reliable.example'], { now }),
    ['https://reliable.example']
  );

  // After 15s cooldown -> half-open probe allowed; failing it doubles cooldown to 30s
  now += 15_001;
  assert.equal(router.isAvailable('https://fast-fail.example', now), true);
  router.claimHalfOpen('https://fast-fail.example', now);
  router.recordResolution('https://fast-fail.example', 30, false, { now });
  assert.equal(router.isAvailable('https://fast-fail.example', now + 16_000), false);
  assert.equal(router.isAvailable('https://fast-fail.example', now + 30_001), true);

  // Half-open probe succeeds -> breaker closes
  router.recordResolution('https://fast-fail.example', 90, true, { now: now + 30_002 });
  assert.equal(router.hosts.get('https://fast-fail.example').circuit, 'closed');

  // Compatibility checks
  const expired = `https://cdn.example/audio?expire=${Math.floor((Date.now() - 120_000) / 1000)}`;
  assert.equal(validateSourceCandidate({ url: expired, mime: 'audio/mp4' }).reason, 'expired_url');
  assert.equal(validateSourceCandidate({ url: 'ftp://bad.example/a.mp3', mime: 'audio/mpeg' }).reason, 'invalid_url');
  assert.equal(validateSourceCandidate({ url: 'https://ok.example/a.m4a', mime: 'audio/mp4' }, { canPlay: () => false }).reason, 'unsupported_codec');

  // Verified equivalence refuses remixes or silent 30s previews
  const track = { id: '1', title: 'Blinding Lights', artist: 'The Weeknd', duration: 200 };
  assert.equal(isVerifiedEquivalent(track, { title: 'Blinding Lights', channel: 'The Weeknd - Topic', duration: 201 }), true);
  assert.equal(isVerifiedEquivalent(track, { title: 'Blinding Lights (Slowed + Reverb Remix)', channel: 'Remix Guy', duration: 240 }), false);
  assert.equal(isVerifiedEquivalent(track, { title: 'Blinding Lights', preview: true, url: 'https://dzcdn.net/p.mp3' }), false);
});

test('PlaybackMemoryEngine enforces expiry and hydrates L1 cleanly from L2 store', async () => {
  const { PlaybackMemoryEngine } = await import('../js/memory-engine.js');
  const persisted = new Map();
  const fakeIdb = {
    open() {
      const req = { result: null, onupgradeneeded: null, onsuccess: null, onerror: null, onblocked: null };
      queueMicrotask(() => {
        req.result = {
          objectStoreNames: { contains: () => true },
          createObjectStore() {},
          transaction() {
            const tx = {
              oncomplete: null,
              onerror: null,
              onabort: null,
              objectStore() {
                return {
                  put(val, key) { persisted.set(key, val); },
                  delete(key) { persisted.delete(key); },
                  openCursor() {
                    const iter = [...persisted.entries()];
                    let idx = 0;
                    const cReq = { onsuccess: null, onerror: null, result: null };
                    const step = () => {
                      if (idx >= iter.length) { cReq.result = null; cReq.onsuccess?.(); return; }
                      const [key, value] = iter[idx++];
                      cReq.result = { key, value, continue: () => queueMicrotask(step) };
                      cReq.onsuccess?.();
                    };
                    queueMicrotask(step);
                    return cReq;
                  }
                };
              }
            };
            queueMicrotask(() => tx.oncomplete?.());
            return tx;
          }
        };
        req.onsuccess?.();
      });
      return req;
    }
  };

  const mem1 = new PlaybackMemoryEngine({ idb: fakeIdb });
  const now = 1_800_000_000_000;
  mem1.putStream('k1', { url: 'https://cdn.example/a.m4a', kind: 'invidious', instance: 'https://inv.example' }, now);
  mem1.putStream('k-exp', { url: `https://cdn.example/b.m4a?expire=${Math.floor((now - 10_000) / 1000)}`, kind: 'invidious' }, now);
  await mem1.flush();

  // Expired URL is rejected immediately on getStream
  assert.equal(mem1.getStream('k-exp', now), null);

  // Fresh engine cold-boots from L2 IDB into L1 synchronous map
  const mem2 = new PlaybackMemoryEngine({ idb: fakeIdb });
  await mem2.ready();
  const hit = mem2.getStream('k1', now + 1000);
  assert.equal(hit?.url, 'https://cdn.example/a.m4a');
});

test('AdaptiveBufferEngine classifies stalls, adapts to unstable/constrained networks, and inspects buffered seeks', async () => {
  const { AdaptiveBufferEngine, classifyFailure, inspectSeek, selectTransport, FAILURE_CATEGORY } = await import('../js/buffer-engine.js');
  const engine = new AdaptiveBufferEngine();
  assert.equal(engine.profile({ effectiveType: '4g', downlink: 10, saveData: false }).condition, 'fast');
  assert.equal(engine.profile({ saveData: true }).condition, 'constrained');
  assert.equal(engine.profile({ saveData: true }).preloadStageB, false);

  engine.recordStall();
  engine.recordStall();
  const unstable = engine.profile({ effectiveType: '4g', downlink: 5 });
  assert.equal(unstable.condition, 'unstable');
  assert.ok(unstable.headroomSec >= 14);

  assert.equal(classifyFailure({ userPaused: true }).category, FAILURE_CATEGORY.USER_PAUSED);
  assert.equal(classifyFailure({ httpStatus: 403 }).category, FAILURE_CATEGORY.URL_EXPIRED);
  assert.equal(classifyFailure({ mediaError: { code: 3 } }).category, FAILURE_CATEGORY.DECODER_ERROR);
  assert.equal(classifyFailure({ mediaError: { code: 4 } }).category, FAILURE_CATEGORY.UNSUPPORTED_CODEC);
  assert.equal(classifyFailure({ mediaError: { code: 2 }, online: false }).category, FAILURE_CATEGORY.NETWORK_STARVATION);

  const media = {
    duration: 180,
    buffered: { length: 1, start: () => 10, end: () => 50 },
    seekable: { length: 1, start: () => 0, end: () => 180 },
  };
  assert.equal(inspectSeek(media, 30).inBuffer, true);
  assert.equal(inspectSeek(media, 120).inBuffer, false);

  assert.equal(selectTransport({ url: 'https://x/stream.m3u8', mime: 'application/vnd.apple.mpegurl' }, { probe: { canPlayType: () => 'maybe' } }).mode, 'native-hls');
  assert.equal(selectTransport({ url: 'https://x/audio.m4a', mime: 'audio/mp4' }).mode, 'progressive-http');
});

test('Predictive pipeline tracks upcoming queue targets and adapts delay during rapid skipping', async () => {
  const { predictUpcoming, SkipTracker } = await import('../js/predictive-pipeline.js');
  const queue = [{ id: '1' }, { id: '2' }, { id: '3' }];
  assert.deepEqual(predictUpcoming({ queue, index: 0, repeat: 'off' }).map(x => [x.track.id, x.stage]), [['2', 'B'], ['3', 'A']]);
  assert.deepEqual(predictUpcoming({ queue, index: 2, repeat: 'all' }).map(x => [x.track.id, x.stage]), [['1', 'B'], ['2', 'A']]);
  assert.deepEqual(predictUpcoming({ queue, index: 0, repeat: 'one' }), []);

  const skips = new SkipTracker({ windowMs: 10_000, threshold: 3 });
  assert.equal(skips.isRapidSkipping(1000), false);
  skips.record(1000); skips.record(1200); skips.record(1400);
  assert.equal(skips.isRapidSkipping(1500), true);
  assert.ok(skips.stageBDelayMs(1500) > skips.stageBDelayMs(20_000));
});

test('Player state machine exposes lifecycle phases and telemetry metrics', async () => {
  const player = await import('../js/player.js');
  const tracks = [{ id: 'sm-1', title: 'SM Track', artist: 'SM Artist', duration: 120, local: true }];
  player.playList(tracks);
  await settle();
  assert.equal(player.state.phase, player.STATES.PLAYING);
  const metrics = player.getMetrics();
  assert.ok(metrics.telemetry.counters.startsSucceeded >= 1);
  assert.ok(metrics.buffer.condition);
});

test('bridgeStream 404 cooldown prevents repeated /stream overhead on subsequent tracks', async () => {
  localStorage.setItem('spotplus.goodInstance', JSON.stringify({ invidious: 'https://inv-cool.example' }));
  let streamCalls = 0;
  globalThis.fetch = async (url) => {
    const s = String(url);
    if (s.includes('/stream')) { streamCalls++; return new Response('{"error":"Not found"}', { status: 404 }); }
    if (s.includes('/match')) {
      return new Response(JSON.stringify({ items: [{ id: 'MxEjnYdfLXU', title: 'I Wonder', channel: 'Kanye West', duration: 244, verified: true }] }));
    }
    return new Response('[]');
  };
  const api = await import('../js/api.js');
  const first = await api.resolve({ id: 'bridge-cool-1', title: 'I Wonder', artist: 'Kanye West', duration: 243 });
  assert.match(first.url, /inv-cool\.example/);
  const callsAfterFirst = streamCalls;
  assert.ok(callsAfterFirst <= 1);
  const second = await api.resolve({ id: 'bridge-cool-2', title: 'I Wonder', artist: 'Kanye West', duration: 243 });
  assert.match(second.url, /inv-cool\.example/);
  assert.equal(streamCalls, callsAfterFirst);
});

test('player tries full-length alternatives before ever falling back to a 30s preview', async () => {
  localStorage.clear();
  const api = await import('../js/api.js');
  api.clearStreamCache();
  const player = await import('../js/player.js');
  const prevFetch = globalThis.fetch;
  const originalPlay = globalThis.Audio.prototype.play;
  const triedUrls = [];
  globalThis.fetch = async (url) => {
    const s = String(url);
    if (s.includes('/match')) {
      return new Response(JSON.stringify({ items: [{ id: 'AltVid00001', title: 'Full Alternative', channel: 'Artist', duration: 210, verified: true }] }));
    }
    if (s.includes('/stream?id=AltVid00001')) {
      return new Response(JSON.stringify({
        url: 'https://cdn.example/bad-primary.webm',
        mime: 'audio/webm',
        bitrate: 160000,
        kind: 'bridge',
        videoId: 'AltVid00001',
        alternatives: [
          { url: 'https://cdn.example/good-full.m4a', mime: 'audio/mp4', kind: 'invidious', instance: 'https://inv.example', videoId: 'AltVid00001' },
        ],
      }));
    }
    return new Response('[]', { status: 404 });
  };
  globalThis.Audio.prototype.play = async function () {
    triedUrls.push(this.src);
    if (this.src.includes('bad-primary')) {
      const err = new Error('NotSupportedError');
      err.name = 'NotSupportedError';
      throw err;
    }
    return originalPlay.call(this);
  };
  try {
    const track = {
      id: 'alt-before-preview',
      title: 'Full Alternative',
      artist: 'Artist',
      duration: 210,
      preview: 'https://cdnt-preview.dzcdn.net/stream/short-30s.mp3',
    };
    player.playList([track], 0);
    await settle();
    assert.ok(triedUrls.some((u) => u.includes('good-full.m4a')));
    assert.ok(!triedUrls.some((u) => u.includes('short-30s.mp3')));
    assert.equal(player.state.source?.preview, undefined);
  } finally {
    globalThis.Audio.prototype.play = originalPlay;
    globalThis.fetch = prevFetch;
  }
});
