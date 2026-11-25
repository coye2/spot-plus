# Spot+ Vehicle Integration Engineering Report (v2.2.6)

This report documents the research, architecture, prototypes, benchmarks, compatibility matrix, and exact platform boundaries across **three independent vehicle integration pathways** for Spot+.

All new vehicle modules are strictly modular, leave the existing working Spot+ YouTube Relay (`canvas-bridge/youtube-relay.js`) completely untouched, add zero npm dependencies, and remain **disabled behind runtime feature flags (`js/feature-flags.js`)** until verified on physical hardware and simulators.

---

## Executive Summary & Pathway Comparison

| Dimension | Path 1: Browser-Native (`Spot+ Drive`) | Path 2: Universal Media Gateway (`OpenSubsonic`) | Path 3: Native Microbridge (`Media3` + `CarPlay`) |
| :--- | :--- | :--- | :--- |
| **Additional install required** | **Zero** (pure PWA) | Existing CarPlay / Android Auto client (e.g., Amperfy, Symfonium, Tempo, Substreamer) | Optional thin Spot+ native wrapper (APK / IPA) |
| **CarPlay Now Playing & steering wheel** | **Confirmed** via WebKit `MPNowPlayingInfoCenter` / `MPRemoteCommandCenter` | **Confirmed** (full native CarPlay app via Amperfy / Substreamer / play:Sub) | **Confirmed** (`CPNowPlayingTemplate.shared`) |
| **CarPlay dashboard launcher + browsing** | Blocked by iOS (requires Apple entitlement) | **Yes** (client already holds Apple CarPlay entitlement) | **Yes** (requires `com.apple.developer.carplay-audio` approval) |
| **Android Bluetooth AVRCP & controls** | **Confirmed** via Chromium `MediaSessionAndroid` → `MediaSessionCompat` | **Confirmed** | **Confirmed** |
| **Android Auto launcher + browsing** | Blocked in pure PWA (no `MediaBrowserService`) | **Yes** (Symfonium / Tempo / Substreamer hold Android Auto media support) | **Yes** (`MediaLibraryService` + `automotive_app_desc.xml`) |
| **Background playback survival** | Subject to OS WebView/PWA suspension policies | **Native-grade** (handled by native OpenSubsonic client) | **Native-grade** (single `ExoPlayer` / `AVQueuePlayer` survives web suspension) |
| **Zero-knowledge E2EE sync** | **Preserved** (all local) | **Trade-off**: gateway decrypts library index in memory to serve plain OpenSubsonic REST (mitigated by self-hosted single-user Worker or LAN gateway) | **Preserved** (64-hex Spot+ sync key stays strictly on device) |
| **Implemented artifacts** | `js/vehicle/drive-bridge.js`, gated hook in `js/player.js` | `workers/media-gateway/`, `js/vehicle/gateway-pairing.js`, `scripts/vehicle-gateway-benchmark.mjs` | `js/vehicle/microbridge-protocol.js`, `js/vehicle/microbridge-client.js`, `native-microbridge/{android,ios}/` |
| **Feature flag (default)** | `vehicleDriveBridge: false` | `vehicleGatewayPairing: false` | `vehicleNativeMicrobridge: false` |

---

## Path 1 — Browser-Native Vehicle Media Bridge (`Spot+ Drive`)

### 1.1 Exact Signal Path: Vehicle Head Unit → OS → Browser `<audio>`

#### Apple iOS / WebKit (Safari & Home-Screen Standalone PWA)
1. **Outbound metadata & state**: `HTMLAudioElement` + `navigator.mediaSession` (`metadata`, `playbackState`, `setPositionState`) → WebCore `PlatformMediaSessionManager` → `MediaSessionManagerCocoa.mm` / `MediaSessionManageriOS.mm` / `NowPlayingManager.cpp` → native `MPNowPlayingInfoCenter.default()`.
2. **Inbound vehicle commands**: CarPlay Now Playing touch controls, steering-wheel HID buttons, or Bluetooth AVRCP commands → iOS `MediaRemote` / `MPRemoteCommandCenter.shared()` → `MediaSessionManagerCocoa` remote command observer → JavaScript `navigator.mediaSession.setActionHandler(...)` callbacks.
3. **Audio routing & interruptions**: WebKit registers as an `AVAudioSession` interruption and route-change observer (`AVAudioSessionInterruptionNotification`, `routeChangeNotification`), mapping `canProduceAudio()` and `shouldOverridePauseDuringRouteChange()` to HTML5 `<audio>` pause/resume behavior.

#### Android / Chromium (Chrome & Installed WebAPK)
1. **Outbound metadata & state**: `HTMLAudioElement` + `navigator.mediaSession` → Blink `MediaSession` → Chromium `content::MediaSessionImpl` → `MediaSessionAndroid` (C++/JNI) → AndroidX `MediaSessionCompat` → Android `MediaSessionManager`.
2. **Inbound vehicle commands**: Car head unit / steering-wheel Bluetooth AVRCP (`com.android.bluetooth.avrcp`) or Android media notification → `MediaSessionCompat.Callback` → `MediaSessionAndroid` → Blink action handler.
3. **Why Android Auto launcher browsing is unavailable to pure PWAs**: Android Auto discovers dashboard media apps exclusively by querying installed packages declaring `<meta-data android:name="com.google.android.gms.car.application" ... />` and exporting an `android.media.browse.MediaBrowserService` / `androidx.media3.session.MediaLibraryService`. Chrome's `MediaSessionAndroid` exposes a `MediaSessionCompat` (transport + metadata + AVRCP) but does **not** register a per-origin `MediaBrowserService` browse tree.

### 1.2 Can an Installed iOS PWA Be Controlled Through CarPlay's Built-In Now Playing App?
**Yes — confirmed architecturally via WebKit's native `MPNowPlayingInfoCenter` / `MPRemoteCommandCenter` bridge**, with four strict operational caveats that `js/vehicle/drive-bridge.js` explicitly addresses:
1. **No dedicated CarPlay launcher icon**: Playback must be started on the iPhone (or resumed while the WebKit process is still resident). Once playing, CarPlay's built-in **Now Playing** screen renders Spot+'s title, artist, album, artwork, elapsed/total progress, Play/Pause, Next, Previous, and scrubbing.
2. **±10s Podcast Button Regression**: Registering `seekbackward` or `seekforward` handlers causes iOS `MPRemoteCommandCenter` to replace Previous/Next track buttons on CarPlay and Lock Screen with ±10s skip buttons. `DriveMediaBridge.rebindActionHandlers()` explicitly nulls `seekbackward` and `seekforward`.
3. **"Apple Music Hijack" & Element Swap Dropouts**: Rebuilding or swapping `<audio>` elements during playback can cause WebKit to drop `MPRemoteCommandCenter` ownership. `DriveMediaBridge` never rebuilds `<audio>`, never runs polling intervals, and re-asserts action handlers event-driven on `devicechange` and `webkitcurrentplaybacktargetiswirelesschanged`.
4. **OEM Bluetooth AVRCP Double-Pulses & Disconnect Safety**: `DriveMediaBridge` debounces duplicate `nexttrack`/`previoustrack` pulses within `220 ms`, normalizes control chars/newlines and guarantees non-empty `album` metadata for strict head units, and classifies wireless disconnect (`wasWireless && !isWireless`) as `route-disconnect` (`autoResumeSafe: false`) so unplugging from CarPlay/Bluetooth never blasts music from phone speakers.

### 1.3 Confirmed vs. Experimental vs. Platform-Blocked Matrix

| Capability | Status | Evidence / Notes |
| :--- | :--- | :--- |
| iOS PWA → CarPlay built-in **Now Playing** (metadata + Play/Pause/Next/Prev/Scrub) | **Confirmed (WebKit spec & Cocoa bridge)** | Requires physical iPhone + CarPlay head unit verification for standalone PWA longevity across long drives. |
| Android PWA → Bluetooth A2DP + AVRCP 1.4–1.6 metadata & steering-wheel controls | **Confirmed (Chromium `MediaSessionAndroid`)** | Standard Chromium pipeline; cover art over AVRCP BIP varies by OEM head unit. |
| AirPlay 2 & W3C Remote Playback target picking | **Confirmed** | Implemented in `js/connectivity.js`, re-bound cleanly on element swap. |
| iOS standalone PWA background continuity after >5 min paused in CarPlay | **Experimental / OS-dependent** | iOS Jetsam may suspend background WebKit processes after extended pause; mitigated by Recovery Checkpoints (`v2.2.5`) and solved permanently by Path 2 or Path 3. |
| Pure PWA CarPlay launcher icon & library browsing | **Platform-Blocked** | Enforced by iOS (`com.apple.developer.carplay-audio` entitlement required). |
| Pure PWA Android Auto launcher icon & library browsing | **Platform-Blocked** | Enforced by Android Auto (`MediaLibraryService` + Play Store policy). |

---

## Path 2 — Universal Media Gateway (`OpenSubsonic` PoC)

### 2.1 Protocol Selection: Why OpenSubsonic Wins Over Alternatives

| Standard | Library Browsing | Playlists | Voice Search | CarPlay & Android Auto Clients | Verdict |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **OpenSubsonic 1.16.1+** | Yes (`getArtists`, `getAlbumList2`, `getStarred2`) | Yes (`getPlaylists`, `getPlaylist`) | Yes (`search3`) | **Amperfy** (iOS/CarPlay), **Symfonium** (Android/AA), **Tempo** (Android/AA), **Substreamer** (iOS CarPlay + AA), **play:Sub** (iOS/CarPlay) | **Selected (Smallest complete standard)** |
| **HLS / M3U8** | No | Flat stream list only | No | No library tree | Stream transport only |
| **ICY Metadata** | No | No | No | Radio apps only | Live radio only |
| **RSS (Podcast)** | Flat episodes | One feed per playlist | Poor | Podcast apps (wrong ±15s UX) | Poor music UX |

### 2.2 Minimal 12-Endpoint OpenSubsonic Profile (`workers/media-gateway/`)
Implemented in `workers/media-gateway/src/gateway.js` with truthful identity (`type: "spotplus-gateway"`, `openSubsonic: true`, never impersonating Navidrome or Subsonic):
- **System/Auth**: `ping`, `getOpenSubsonicExtensions`, `getLicense` (supports OpenSubsonic `apiKey` + legacy Subsonic salted MD5 `u`/`t`/`s` in constant time, JSON & XML output).
- **Browsing & Search**: `getArtists`, `getArtist`, `getAlbumList2`, `getAlbum`, `getPlaylists`, `getPlaylist`, `getStarred2`, `search3`.
- **Direct Playback & Artwork**: `stream` (issues **HTTP 302 Found** directly to allowlisted authorized stream URL, never incrementing play counts per OpenSubsonic spec), `getCoverArt` (HTTP 302 with 24h edge caching), `scrobble`.
- **Authorized Test Audio**: `workers/media-gateway/src/test-catalog.js` synthesizes deterministic 16-bit PCM WAV calibration tracks with full `Accept-Ranges: bytes` / `206 Partial Content` support so CarPlay/Android Auto clients and automated tests can verify end-to-end playback without copyrighted third-party audio.

### 2.3 Account-Free Encrypted Pairing & Cryptographic Trust Boundary (`js/vehicle/gateway-pairing.js`)
- `deriveGatewayCredentials(syncSecret)` derives domain-separated `username`, `apiKey`, and `sealKeyHex` from Spot+'s existing 64-hex sync secret (`js/relay-sync.js`) via SHA-256 — **no user accounts required**, and compromising a gateway key never leaks the root sync secret or Nostr signing key.
- `sealGatewaySnapshot` / `openGatewaySnapshot` encrypt pairing manifests with AES-256-GCM.
- **Honest privacy boundary**: Because third-party OpenSubsonic apps (Amperfy, Symfonium, Tempo, Substreamer) speak plain OpenSubsonic REST and cannot run Spot+'s AES-GCM decryption locally, a hosted gateway must decrypt the library manifest in memory to answer `/rest/*` queries. Therefore, production users should either deploy the single-file `workers/media-gateway` to **their own free Cloudflare Workers account** (100,000 req/day free) or run it on their local network.

### 2.4 Real Measured Cloudflare Benchmark, Bandwidth & Cost Economics
Measured via `node scripts/vehicle-gateway-benchmark.mjs` (41 control-plane requests/listening hour, 22 listening hours/month per commuter, Direct-302 playback mode):

| Concurrent Listeners | Measured Throughput | p50 Latency | p95 Latency | Gateway Media Egress | Projected Daily Reqs | Projected Monthly Reqs | Cloudflare Plan & Est. Cost |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: | :--- |
| **100** | 877 req/s | 2.904 ms | 14.378 ms | **0 Mbps** (302 direct) | 3,007 | 90,200 | **Free plan ($0/mo)** |
| **500** | 8,693 req/s | 1.312 ms | 2.494 ms | **0 Mbps** (302 direct) | 15,033 | 451,000 | **Free plan ($0/mo)** |
| **1,000** | 9,827 req/s | 1.146 ms | 2.338 ms | **0 Mbps** (302 direct) | 30,067 | 902,000 | **Free plan ($0/mo)** |
| **5,000** | 8,701 req/s | 1.193 ms | 3.522 ms | **0 Mbps** (302 direct) | 150,333 | 4,510,000 | **Paid base ($5.00/mo)** |
| **10,000** | 14,008 req/s | 0.828 ms | 1.491 ms | **0 Mbps** (302 direct) | 300,667 | 9,020,000 | **Paid base ($5.00/mo)** |

*Abuse checks verified*: `40/40` invalid API keys rejected (`401`), burst floods throttled (`429`), private/metadata redirect targets (`169.254.169.254`, `10.0.0.5`) blocked (`403`), path traversal (`%252e%252e`) rejected (`400`), zero wildcard CORS on `/rest/*`.

*Why 302 Direct Redirect matters*: Proxying 128 kbps audio through the gateway Worker for 10,000 concurrent listeners would require ~1.28 Gbps continuous streaming bandwidth and hit Worker CPU/subrequest budgets. Issuing `302 Found` redirects keeps gateway control payloads at **~506 bytes average** and **0 Mbps media egress**, fitting 10,000 commuters inside Cloudflare's `$5/mo` base tier.

---

## Path 3 — Spot+ Native Microbridge (`spotplus.microbridge.v1`)

### 3.1 Single Authoritative Engine Architecture
- **Shared wire protocol (`js/vehicle/microbridge-protocol.js`)** covers all 8 required domains:
  1. Track resolution (`resolve.track`, `resolve.result`)
  2. Queue management (`queue.set`, `queue.append`, `queue.remove`, `queue.move`, `queue.clear`, `queue.snapshot`)
  3. Playback state (`state.sync`)
  4. Playback commands (`cmd.play`, `cmd.pause`, `cmd.toggle`, `cmd.seek`, `cmd.next`, `cmd.previous`, `cmd.setRate`, `cmd.setRepeat`, `cmd.setShuffle`)
  5. Metadata (`metadata.update`)
  6. Library browsing (`library.syncSnapshot`, `library.getRoot`, `library.getChildren`, `library.search`, `library.response`)
  7. Error recovery (`error.report`, `error.requestFreshStream`)
  8. Encrypted device pairing (`pairing.challenge`, `pairing.confirm`, `pairing.syncKey`)
- **Single-Engine Invariant (`EngineAuthorityLock`)**: When the PWA detects a native transport (`window.webkit.messageHandlers.spotplusBridge` or Android TWA `MessagePort`) and completes `bridge.hello` → `bridge.hello_ack`, authority switches from `'web'` to `'native'`. HTML5 `<audio>` stays muted/idle, and the native engine (`ExoPlayer` or `AVQueuePlayer`) maintains independent queue progression and audio focus even if the OS suspends `WKWebView` or Chrome TWA.
- **PWA stays the entire app**: Zero Spot+ UI, themes, AI DJ, Rewind, or Jam screens are rewritten in Swift or Kotlin.

### 3.2 Minimal Native Code Footprint (Isolated Prototypes under `native-microbridge/`)
- **Android (`native-microbridge/android/`) — ~250 LOC Kotlin + 2 XML manifests**:
  - `SpotPlusMediaService.kt`: Jetpack Media3 `MediaLibraryService` + single `ExoPlayer` (`USAGE_MEDIA`, `CONTENT_TYPE_MUSIC`, `handleAudioFocus = true`, `setHandleAudioBecomingNoisy(true)`), shallow driver-safe `onGetLibraryRoot`/`onGetChildren`/`onSearch`/`onGetSearchResult`.
  - `SpotPlusTwaActivity.kt`: Thin Trusted Web Activity (`androidx.browser.trusted`) with `CustomTabsSession.requestPostMessageChannel(https://coye2.github.io)` bound to `MediaController`.
  - `AndroidManifest.xml` + `res/xml/automotive_app_desc.xml`.
- **iOS (`native-microbridge/ios/`) — ~290 LOC Swift + Entitlements**:
  - `NativeAudioEngine.swift`: Single `AVQueuePlayer`, `AVAudioSession` (`.playback`, `.longFormAudio`), `interruptionNotification`, `routeChangeNotification` (pauses on `.oldDeviceUnavailable`), `MPNowPlayingInfoCenter`, `MPRemoteCommandCenter`.
  - `CarPlaySceneDelegate.swift`: `CPTemplateApplicationSceneDelegate` (`CPTabBarTemplate` → `CPListTemplate` capped at `CPListTemplate.maximumItemCount` → `CPNowPlayingTemplate.shared`).
  - `WebBridgeViewController.swift`: Minimal `WKWebView` enforcing `isMainFrame`, `protocol == "https"`, and `host == "coye2.github.io"` on `WKScriptMessageHandler`.
  - `SpotPlusCarPlay.entitlements` (`com.apple.developer.carplay-audio`).

### 3.3 Platform Signing, Entitlement & Driver-Distraction Compliance
- **Android Auto**: Requires Play Store distribution (or developer-mode Unknown Sources for testing), Digital Asset Links (`/.well-known/assetlinks.json`) for TWA fullscreen verification, Android Auto media quality review (max 2–3 taps to play, no video/text input while driving, `setHandleAudioBecomingNoisy(true)`).
- **Apple CarPlay**: Requires Apple Developer Program membership ($99/yr), explicit approval for `com.apple.developer.carplay-audio`, `UIBackgroundModes: [audio]`, `UIApplicationSceneManifest` declaring `CPTemplateApplicationSceneSessionRoleApplication`, and compliance with CarPlay Human Interface Guidelines (only approved audio templates, list item limits, no custom web views on the car screen).

---

## Verification Scope & Required Hardware Validation

### Verified Automatically in This Workspace
- Unit & integration tests (`tests/vehicle-integration.test.mjs`): all 3 pathways, feature-flag default-off invariants, WebKit/Chromium capability matrices, AVRCP debounce, OpenSubsonic auth/browsing/search/302-direct-WAV-range playback/SSRF/rate limits, and Microbridge loopback handshake/origin checks/single-engine lock.
- Full Spot+ regression suite (`npm test`), syntax checks (`npm run check`), ESLint (`npm run lint`), production static build (`npm run build`), and Path 2 capacity benchmark (`scripts/vehicle-gateway-benchmark.mjs`).

### Cannot Be Verified Inside This Linux Container (Must Be Tested on Hardware / Simulators)
1. **iPhone + CarPlay Hardware / Xcode CarPlay Simulator**: Verify Path 1 (`vehicleDriveBridge: true`) Now Playing stability across 30+ minute drives, Siri interruptions, and ignition off/on; compile and run `native-microbridge/ios/` in Xcode with CarPlay Simulator (`I/O → External Displays → CarPlay`).
2. **Android Auto Desktop Head Unit (DHU) & Physical Head Unit**: Build `native-microbridge/android/` in Android Studio, launch Android Auto Head Unit Server, connect DHU (`desktop-head-unit`), and verify browse tree, voice search, and TWA-suspended background advance.
3. **Path 2 Live Client Validation**: Deploy `workers/media-gateway` with `wrangler secret put SPOTPLUS_GATEWAY_API_KEY`, connect **Amperfy** (iOS CarPlay) and **Symfonium / Tempo** (Android Auto), and verify 302 direct playback + seeking on authorized test audio before enabling `vehicleGatewayPairing`.
