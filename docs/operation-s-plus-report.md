# Spot+ — Operation S+ Engineering Report (v2.2.5)

**Release:** `v2.2.5` (`spotplus-shell-v153`)  
**Baseline:** `v2.2.4` (`spotplus-shell-v152`, 377 tests: 373 passed, 0 failed, 4 skipped)  
**Target Production:** `https://coye2.github.io/spot-plus/`  
**Relay Architecture:** Preserved existing Spot+ YouTube Relay (`canvas-bridge/youtube-relay.js`) untouched; zero paid APIs or framework migrations introduced.

---

## 1. Executive Summary

Operation S+ elevates Spot+ across six engineering workstreams while keeping its vanilla-ES-module PWA architecture, free accessibility, existing UI/themes, user library/sync data, and working YouTube Relay completely intact:

1. **S+ Playback Reliability (`js/player.js`, `js/playback-policy.js`, `js/playback-telemetry.js`)** — Deterministic state machine with explicit `PAUSED` and `SEEKING` lifecycle phases, transition validation (`VALID_TRANSITIONS` / `canTransition`), network-aware timeouts (`networkTimeoutMs`), negative match caching, and root-cause failure accounting separating **upstream**, **network**, **codec**, and **client** failures.
2. **S+ Background Playback (`js/player.js`)** — Full lifecycle coverage (`visibilitychange`, `pagehide`, `pageshow`, `focus`, `blur`, `freeze`, `resume`, `offline`, `online`, `connection.change`), persistent single authoritative `<audio>` controller, and durable **Recovery Checkpoints** (`spotplus.recoveryCheckpoint.v1`) persisted cleanly without silent-loop hacks or misleading uninterrupted-playback claims after OS termination.
3. **S+ Vehicle Integration (`js/connectivity.js`, `js/player.js`, `docs/native-companion-architecture.md`)** — Phase A PWA-native Bluetooth AVRCP, steering-wheel controls, multi-size Media Session metadata, AirPlay 2 & W3C Remote Playback, plus isolated Phase B native companion blueprints for Android Media3 (`MediaLibraryService`) and Apple CarPlay (`com.apple.developer.carplay-audio`).
4. **S+ Playback Transitions (`js/playback-policy.js`, `js/player.js`)** — Capability-driven crossfade protection (`canSafelyCrossfade`) prioritizing uninterrupted native playback over crossfade on iOS background and wireless AirPlay routes, plus adaptive next-track preloading (`shouldPreloadNext`) gated on remaining duration, buffer headroom, network tier, relay latency, skip velocity, device memory, queue stability, and server pressure.
5. **S+ Infrastructure Scalability (`js/request-scheduler.js`, `js/api.js`, `js/canvas.js`, `js/live-stats.js`, `canvas-bridge/worker.js`, `canvas-bridge/youtube-match.js`, `scripts/capacity-benchmark.mjs`)** — Client priority request scheduler (tiers 1–8) with automatic graceful degradation under Worker load, layered CGNAT-safe burst + sustained rate limiting, malformed-request rejection (`400`/`414`), cache-busting normalization, `stale-while-revalidate` caching, and a deterministic 100–10,000 concurrent listener benchmark harness.
6. **Zero-Regression Engineering (`js/feature-flags.js`, `tests/operation-s-plus.test.mjs`)** — Independent runtime feature flags (`spotplus.flags.v1`) allowing any S+ capability to be disabled immediately without code rollback.

---

## 2. Technical Research Basis

- **WebKit & Safari Media Lifecycle**: Safari 17+ introduced `ManagedMediaSource` for lower-power MSE streaming with AirPlay compatibility, while standalone iOS PWAs still suspend Web Audio `AudioContext` instances in the background and enforce hardware volume read-only constraints. Spot+ therefore keeps active playback on a single DOM-attached `<audio>` element, hands off Web Audio to a plain element on iOS background/AirPlay, and enforces `canSafelyCrossfade()` so crossfade never destabilizes background or AirPlay audio.
- **Android Auto & Jetpack Media3**: Native in-dash Android Auto browsing requires a `MediaLibraryService` (extending `MediaSessionService`) in Android Media3 (`androidx.media3:media3-session`) with `<meta-data android:name="com.google.android.gms.car.application" .../>`. Pure web PWAs and standard TWAs cannot host `MediaLibraryService` without native Android code; they instead deliver audio, metadata, and steering-wheel/head-unit playback controls via the Media Session API + Bluetooth AVRCP.
- **Apple CarPlay**: Native CarPlay template apps require an iOS binary signed with Apple's **`com.apple.developer.carplay-audio`** entitlement implementing `CPTemplateApplicationSceneDelegate`, `AVAudioSession`, `MPNowPlayingInfoCenter`, and `MPRemoteCommandCenter`. PWAs integrate honestly via iOS Now Playing + Bluetooth/CarPlay audio routing without fake native connect buttons.
- **Cloudflare Workers Pricing & Quotas (2025/2026)**:
  - **Free Plan**: `$0/month`, `100,000 requests/day` pooled across all scripts (resets 00:00 UTC), `10 ms` CPU time/request, `$0` bandwidth/egress.
  - **Paid Plan**: `$5.00/month` base including `10,000,000 requests/month` + `$0.30` per additional `1,000,000 requests`, `30M` CPU ms included + `$0.02/M` CPU ms, `$0` bandwidth/egress (network I/O wait does not count toward CPU ms).

---

## 3. Request Audit (Per User / Hour & Per Completed Track)

Assumptions for a typical active listener (`16 tracks/hour`, ~`3.75 min/track`, `2.0 active hours/day`):

| Endpoint / Category | Priority Tier | Before Operation S+ (est. / track) | After Operation S+ (est. / track) | Optimization Mechanism |
| :--- | :---: | :---: | :---: | :--- |
| `/yta` GET (audio stream) | 1 (`PLAYING_AUDIO`) | ~1.2–1.5 | ~1.1 | Single-element continuity + position-preserving refresh |
| `/yta` HEAD (warm/hedge) | 2 (`TRACK_CHANGE`) | ~1.0–1.5 | ~0.5 | Adaptive preloading, max 1 hedge, disabled under `elevated`/`critical` pressure |
| `/match` (YouTube lookup) | 2 (`TRACK_CHANGE`) | ~0.8 | ~0.3 | Single-flight coalescing + 10-min client memo + 60s negative cache + 7-day SWR edge cache |
| `/canvas` (visual loops) | 7 (`DECORATIVE`) | ~0.8 | ~0.2 (0 under load) | 24h local/edge SWR cache + shed automatically under `elevated`/`critical` pressure |
| `/listening` & `/stats` | 8 (`ANALYTICS`) | ~0.4 | ~0.2 (0 under load) | 4-min debounce + shed automatically under `elevated`/`critical` pressure |
| `/health` & `/lyrics-search` | 4–5 | ~0.3 | ~0.3 | 30s/24h SWR edge cache + network-aware timeouts |
| **Total Worker reqs / track** | — | **~4.5–5.3** | **~2.6 (1.9 under load)** | **~42–58% reduction in Worker load** |
| **Total Worker reqs / user / hr** | — | **~72–85** | **~41.6 (~30.4 under load)** | Protects Free tier & minimizes Paid overages |

---

## 4. Reproducible Capacity & Resilience Benchmark (`scripts/capacity-benchmark.mjs`)

All benchmarks run locally against the real `canvas-bridge/worker.js` (`secureHandle` + `handle`) and `js/request-scheduler.js` (`RequestScheduler`) using mocked upstream fetchers only (zero traffic sent to production or third-party hosts). Run via `node scripts/capacity-benchmark.mjs`.

### 4.1 Concurrency Scaling & Cloudflare Cost Projections

| Concurrent Listeners | Sampled Reqs | 200 OK | 429 Limited | Origin Calls | Edge Cache Hit Rate | Measured Throughput | p50 / p95 / p99 Latency | Est. Daily Worker Reqs | Fits Free Plan (100k/day) | Est. Paid Plan / Month |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | :---: | ---: |
| **100** | 100 | 100 | 0 | 20 | 80.0% | 1,120 req/s | 1.79 / 12.51 / 13.87 ms | 8,320 | Yes | $5.00 |
| **500** | 500 | 500 | 0 | 20 | 96.0% | 9,761 req/s | 1.13 / 2.95 / 4.35 ms | 41,600 | Yes | $5.00 |
| **1,000** | 1,000 | 1,000 | 0 | 20 | 98.0% | 12,017 req/s | 0.87 / 2.53 / 3.02 ms | 83,200 | Yes | $5.00 |
| **5,000** | 1,000 | 1,000 | 0 | 20 | 98.0% | 9,068 req/s | 0.81 / 3.70 / 31.93 ms | 416,000 | No | $5.74 |
| **10,000** | 1,000 | 1,000 | 0 | 20 | 98.0% | 10,264 req/s | 0.62 / 4.89 / 14.75 ms | 832,000 | No | $9.49 |

*Cost formula: Cloudflare Workers Paid plan = `$5.00/mo` (includes 10M requests) + `$0.30` per additional 1M requests; `$0` egress. Active usage modeled at 16 tracks/hr × 2 hrs/day × 2.6 Worker requests/track.*

### 4.2 Stress, Abuse & Outage Resilience Results

| Scenario | Measured Result | Verdict |
| :--- | :--- | :---: |
| **Malformed Request Flood** (80 requests: `>12` params, `%00` null bytes, `%252e%252e` traversal, `>1200` char query) | **80 / 80 rejected** (`400`/`414`), **0 upstream origin calls** | PASS |
| **Cache-Busting Flood + Shared CGNAT Fairness** (90 requests with random `&cb=`/`&rnd=` from attacker + 1 legit user on same IP) | **1 origin call total** (cache-busting stripped), **30 attacker requests blocked with 429**, **legitimate CGNAT listener returned 200 OK** | PASS |
| **Critical Load Graceful Degradation** (500 mixed requests during `429` critical pressure) | **200 / 200** core tiers 1–4 admitted (`PLAYING_AUDIO`, `TRACK_CHANGE`, `RECOVERY`, `SEARCH_METADATA`); **300 / 300** tiers 6–8 shed (`RECOMMENDATIONS`, `DECORATIVE`, `ANALYTICS`) | PASS |
| **Upstream 503 Outage** (`/canvas` upstream returns `503`) | Clean `503` response without crash or cache poisoning; client records `upstream` failure separately from client errors | PASS |

---

## 5. Browser, Device & Vehicle Compatibility Matrix

| Capability | iOS Safari / Installed iOS PWA | Android Chrome / PWA | Desktop Chrome / Edge | Desktop Safari (macOS) | Desktop Firefox |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **YouTube Relay Streaming** | Supported (AAC 128k / Low) | Supported (Opus 160k / AAC) | Supported (Opus 160k) | Supported (AAC 128k) | Supported (Opus 160k) |
| **Background Audio + Lock Screen** | Supported (single `<audio>` + plain handoff when FX on) | Supported (Media Session + Web Audio) | Supported | Supported | Supported |
| **OS-Termination Checkpoint Restore** | Supported (restores queue/pos honestly on relaunch) | Supported | Supported | Supported | Supported |
| **Crossfade / AutoMix** | Foreground Web Audio only (disabled in bg/AirPlay for stability) | Supported (Web Audio + Element) | Supported (Web Audio + Element) | Supported (Foreground Web Audio) | Supported (Web Audio + Element) |
| **AirPlay 2 Target Picker** | Native (`webkitShowPlaybackTargetPicker`) | N/A | N/A | Native | N/A |
| **W3C Remote Playback / Cast** | Fallback to AirPlay | Supported (`remote.prompt()`) | Supported where available | Fallback to AirPlay | Not exposed by browser |
| **Audio Output Device (`setSinkId`)** | Not exposed by WebKit | Limited | Supported | Not exposed | Supported where enabled |
| **Car Bluetooth / Steering Controls** | Supported (AVRCP via Media Session) | Supported (AVRCP via Media Session) | Supported (Media Keys) | Supported (Media Keys) | Supported (Media Keys) |
| **Native CarPlay / Android Auto Dash UI** | Requires Phase B native Swift app (`com.apple.developer.carplay-audio`) | Requires Phase B native Media3 `MediaLibraryService` | N/A | N/A | N/A |

---

## 6. Runtime Feature Flags & Rollback Strategy

Every Operation S+ subsystem is independently controllable via `js/feature-flags.js` (`localStorage` key `spotplus.flags.v1`) without rolling back the release:

```js
// Disable any individual Operation S+ behavior at runtime in DevTools or via hotfix:
localStorage.setItem('spotplus.flags.v1', JSON.stringify({
  sPlusStateMachine: true,
  sPlusRecoveryCheckpoint: true,
  sPlusAdaptivePreload: true,
  sPlusCrossfadeGuard: true,
  sPlusGracefulDegradation: true,
  sPlusNetworkTimeouts: true,
}));
```

### Full Rollback Checklist
1. Revert `package.json` (`2.2.5` → `2.2.4`), `sw.js` (`spotplus-shell-v153` → `spotplus-shell-v152`), and the Operation S+ file diffs.
2. Run `npm run changelog && npm test && npm run build`.
3. Re-deploy Cloudflare Worker `canvas-bridge/worker.js` to previous version via Wrangler if needed (no schema or durable-object storage migrations were introduced, so Worker rollback is instantaneous and lossless).

---

## 7. Honest Verification Boundaries & Platform Limitations

- **Verified Automatically Here**: Full Node unit/integration test suite (`383` tests including `tests/operation-s-plus.test.mjs`), ESLint (`npm run lint`), syntax check (`npm run check`), production bundle (`npm run build`), mocked capacity benchmark (`scripts/capacity-benchmark.mjs`), and live headless Chromium desktop + mobile verification on `http://localhost:3000`.
- **Requires Real Hardware / Post-Push Verification**: Physical iPhone standalone PWA lock-screen/AirPlay audio routing, Android Bluetooth AVRCP / car head-unit testing, and live `https://coye2.github.io/spot-plus/` smoke testing must be performed after pushing `v2.2.5` to GitHub (the container workspace does not include a `.git` repository or physical mobile hardware).
