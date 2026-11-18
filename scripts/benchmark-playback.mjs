// benchmark-playback.mjs — Reproducible playback-engine benchmark harness for Spot+.
// Measures resolution latency, warm vs cold startup, local/cached startup, prepared
// next-track transition, rapid-skip cancellation, failure recovery, and heap usage
// across deterministic network profiles.
import { performance } from 'node:perf_hooks';
import { storageMock, FakeAudio } from '../tests/helpers.mjs';

function percentile(sorted, p) {
  if (!sorted.length) return 0;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return Number(sorted[idx].toFixed(2));
}

function summarize(samples) {
  const s = [...samples].sort((a, b) => a - b);
  const sum = s.reduce((a, b) => a + b, 0);
  return {
    n: s.length,
    mean: Number((sum / Math.max(1, s.length)).toFixed(2)),
    p50: percentile(s, 50),
    p95: percentile(s, 95),
    p99: percentile(s, 99),
    min: Number((s[0] || 0).toFixed(2)),
    max: Number((s.at(-1) || 0).toFixed(2)),
  };
}

class BenchAudio extends FakeAudio {
  constructor(profileRef) {
    super();
    this._profileRef = profileRef;
    this.readyState = 0;
    this.networkState = 0;
    this.playbackRate = 1;
    this.defaultPlaybackRate = 1;
    this.buffered = { length: 0, start: () => 0, end: () => 0 };
    this._loadGen = 0;
  }
  load() {
    if (!this.src || this.src.startsWith('data:')) {
      this.readyState = 0;
      return;
    }
    const gen = ++this._loadGen;
    const isBlob = this.src.startsWith('blob:');
    const delay = isBlob ? 2 : (this._profileRef.mediaInitMs ?? 25);
    setTimeout(() => {
      if (gen !== this._loadGen) return;
      this.readyState = 4;
      this.duration = 200;
      this.buffered = { length: 1, start: () => 0, end: () => 45 };
      this.dispatchEvent(new Event('loadedmetadata'));
      this.dispatchEvent(new Event('canplay'));
    }, delay).unref?.();
  }
  async play() {
    if (this.src && !this.src.startsWith('data:') && this.readyState < 3) {
      await new Promise(resolve => {
        const timer = setTimeout(resolve, this.src.startsWith('blob:') ? 2 : (this._profileRef.mediaInitMs ?? 25));
        timer.unref?.();
      });
      this.readyState = 4;
      this.duration = 200;
      this.buffered = { length: 1, start: () => 0, end: () => 45 };
      this.dispatchEvent(new Event('loadedmetadata'));
      this.dispatchEvent(new Event('canplay'));
    }
    this.paused = false;
    this.dispatchEvent(new Event('play'));
    this.dispatchEvent(new Event('playing'));
  }
}

const profileState = { mediaInitMs: 20 };

function setupEnv() {
  globalThis.localStorage = storageMock();
  globalThis.Audio = class extends BenchAudio {
    constructor() { super(profileState); }
  };
  globalThis.window = { addEventListener() {}, dispatchEvent() {}, caches: {} };
  globalThis.document = {
    getElementById: () => null,
    head: { appendChild() {}, append() {} },
    createElement: (tag) => tag === 'audio' ? new BenchAudio(profileState) : { tagName: tag.toUpperCase(), src: '', setAttribute() {}, addEventListener() {}, remove() {} }
  };
  globalThis.location = { href: 'http://127.0.0.1:3000/', origin: 'http://127.0.0.1:3000' };
  Object.defineProperty(globalThis, 'navigator', { value: { connection: { effectiveType: '4g', downlink: 10, saveData: false } }, configurable: true });
  const saved = new Map();
  globalThis.caches = {
    open: async () => ({
      match: async key => saved.has(key) ? new Response(saved.get(key)) : null,
      put: async (key, res) => saved.set(key, await res.blob()),
      delete: async key => saved.delete(key)
    }),
    keys: async () => []
  };
  if (!URL.createObjectURL) URL.createObjectURL = () => 'blob:http://127.0.0.1:3000/bench-' + Math.random().toString(36).slice(2);
  if (!URL.revokeObjectURL) URL.revokeObjectURL = () => {};
  return saved;
}

const savedCache = setupEnv();
const store = await import('../js/store.js');
const api = await import('../js/api.js');
const player = await import('../js/player.js');

const sleep = ms => new Promise(r => setTimeout(r, ms));

function waitForPlaying(targetTrackId, timeoutMs = 6000) {
  return new Promise((resolve, reject) => {
    const start = performance.now();
    const timer = setTimeout(() => reject(new Error(`Timed out waiting for ${targetTrackId}`)), timeoutMs);
    const check = () => {
      if (player.current()?.id === targetTrackId && player.isPlaying() && !player.state.loading) {
        clearTimeout(timer);
        resolve(performance.now() - start);
      }
    };
    player.on('state', check);
    check();
  });
}

function makeNetworkMock({ rttMs = 30, deadRatio = 0.5, matchMs = 35, streamBodyMs = 20 }) {
  let reqCount = 0;
  const instances = {
    t: Date.now(),
    piped: ['https://p-dead1.example', 'https://p-dead2.example', 'https://p-ok.example', 'https://p-ok2.example'],
    invidious: ['https://i-dead1.example', 'https://i-dead2.example', 'https://i-ok.example', 'https://i-ok2.example'],
  };
  localStorage.setItem('spotplus.instances', JSON.stringify(instances));
  const fetcher = async (url, init = {}) => {
    reqCount++;
    const u = String(url);
    const delay = u.includes('/match') ? matchMs : rttMs + (u.includes('dead') ? rttMs : streamBodyMs);
    await new Promise((resolve, reject) => {
      const t = setTimeout(resolve, delay);
      t.unref?.();
      init?.signal?.addEventListener('abort', () => { clearTimeout(t); reject(new DOMException('Aborted', 'AbortError')); }, { once: true });
    });
    if (u.includes('/match')) {
      return new Response(JSON.stringify({ items: [{ id: 'vid12345678', title: 'Artist - Song', channel: 'Artist - Topic', duration: 200 }] }));
    }
    const isDead = u.includes('dead') && deadRatio > 0;
    if (isDead) return new Response('Unavailable', { status: 503 });
    if (u.includes('/streams/')) {
      return new Response(JSON.stringify({ title: 'Artist - Song', uploader: 'Artist - Topic', duration: 200, audioStreams: [{ url: 'https://cdn-ok.example/audio.m4a', mimeType: 'audio/mp4', bitrate: 128000 }] }));
    }
    if (u.includes('/api/v1/videos/')) {
      return new Response(JSON.stringify({ title: 'Artist - Song', author: 'Artist', lengthSeconds: 200, adaptiveFormats: [{ url: 'https://cdn-ok.example/audio.m4a', type: 'audio/mp4', bitrate: 128000, itag: 140 }] }));
    }
    return new Response('[]', { status: 404 });
  };
  return { fetcher, getReqCount: () => reqCount, resetReqCount: () => { reqCount = 0; } };
}

async function runScenario(name, iterations, fn) {
  const samples = [];
  for (let i = 0; i < iterations; i++) {
    samples.push(await fn(i));
  }
  return { name, ...summarize(samples) };
}

async function main() {
  const heapStart = process.memoryUsage().heapUsed;
  const results = [];

  // 1. Cold start under typical Wi-Fi (dead + live instances)
  profileState.mediaInitMs = 15;
  const wifiNet = makeNetworkMock({ rttMs: 25, matchMs: 30, streamBodyMs: 15 });
  globalThis.fetch = wifiNet.fetcher;
  localStorage.setItem('spotplus.settings', JSON.stringify({ source: 'auto', quality: 'high', preloadNext: true }));
  results.push(await runScenario('cold_start_wifi_mixed_health', 8, async (i) => {
    api.clearStreamCache();
    localStorage.removeItem('spotplus.streams.v2');
    localStorage.removeItem('spotplus.goodInstance');
    localStorage.removeItem('spotplus.vcache');
    const track = { id: `cold-wifi-${i}`, title: 'Song', artist: 'Artist', duration: 200 };
    const t0 = performance.now();
    player.playList([track]);
    await waitForPlaying(track.id);
    return performance.now() - t0;
  }));

  // 2. Cold start under high-latency cellular (dead proxies + 180ms RTT)
  profileState.mediaInitMs = 40;
  const cellNet = makeNetworkMock({ rttMs: 180, matchMs: 150, streamBodyMs: 40 });
  globalThis.fetch = cellNet.fetcher;
  results.push(await runScenario('cold_start_high_latency_cellular', 6, async (i) => {
    api.clearStreamCache();
    localStorage.removeItem('spotplus.streams.v2');
    localStorage.removeItem('spotplus.goodInstance');
    localStorage.removeItem('spotplus.vcache');
    const track = { id: `cold-cell-${i}`, title: 'Song', artist: 'Artist', duration: 200 };
    const t0 = performance.now();
    player.playList([track]);
    await waitForPlaying(track.id);
    return performance.now() - t0;
  }));

  // 3. Warm playable-source startup (remembered URL in stream cache / L1-L2)
  profileState.mediaInitMs = 15;
  globalThis.fetch = wifiNet.fetcher;
  const warmTrack = { id: 'warm-track-1', title: 'Song', artist: 'Artist', duration: 200 };
  player.playList([warmTrack]);
  await waitForPlaying(warmTrack.id);
  results.push(await runScenario('warm_source_repeat_startup', 12, async () => {
    player.pause();
    await sleep(5);
    const t0 = performance.now();
    player.playList([warmTrack]);
    await waitForPlaying(warmTrack.id);
    return performance.now() - t0;
  }));

  // 4. Cached offline / local track startup
  const localTrack = { id: 'local-bench-1', title: 'Local Song', artist: 'Local Artist', duration: 200, local: true };
  const offlineUrl = new URL(`./__offline/${encodeURIComponent(localTrack.id)}`, location.href).href;
  await (await caches.open(player.AUDIO_CACHE)).put(offlineUrl, new Response(new Blob(['x'.repeat(65536)], { type: 'audio/mpeg' })));
  results.push(await runScenario('cached_local_track_startup', 12, async () => {
    player.pause();
    await sleep(5);
    const t0 = performance.now();
    player.playList([localTrack]);
    await waitForPlaying(localTrack.id);
    return performance.now() - t0;
  }));

  // 5. Prepared next-track transition (Player A -> prepared Player B)
  const queueTracks = [
    { id: 'seq-1', title: 'Song', artist: 'Artist', duration: 200 },
    { id: 'seq-2', title: 'Song', artist: 'Artist', duration: 200 },
  ];
  results.push(await runScenario('prepared_next_track_transition', 8, async () => {
    player.playList(queueTracks, 0);
    await waitForPlaying('seq-1');
    await sleep(450); // Allow prefetch + warm to complete
    const t0 = performance.now();
    player.next(true);
    await waitForPlaying('seq-2');
    return performance.now() - t0;
  }));

  // 6. Rapid-skip cancellation (5 rapid taps -> final track starts cleanly without stale wins)
  const rapidQueue = Array.from({ length: 6 }, (_, i) => ({ id: `rapid-${i}`, title: 'Song', artist: 'Artist', duration: 200 }));
  results.push(await runScenario('rapid_skip_final_track_startup', 6, async () => {
    api.clearStreamCache();
    localStorage.removeItem('spotplus.streams.v2');
    const t0 = performance.now();
    player.playList(rapidQueue, 0);
    for (let k = 1; k < rapidQueue.length; k++) {
      await sleep(12);
      player.playIndex(k);
    }
    await waitForPlaying('rapid-5');
    return performance.now() - t0;
  }));

  const heapEnd = process.memoryUsage().heapUsed;
  const report = {
    timestamp: new Date().toISOString(),
    node: process.version,
    savedOfflineEntries: savedCache.size,
    heapDeltaKB: Number(((heapEnd - heapStart) / 1024).toFixed(1)),
    scenarios: results,
    telemetry: typeof player.getMetrics === 'function' ? player.getMetrics() : null,
  };
  console.log(JSON.stringify(report, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
