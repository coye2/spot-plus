# Spot+ Native Companion Architecture (CarPlay & Android Auto)

This document defines the minimal, optional native companion architecture required if Spot+ ever adds **native in-dash Apple CarPlay** and **Android Auto** template browsing in the future.

## Why a Native Companion Is Required

| Platform | Pure PWA Capabilities (Current Spot+ v2.2.3) | Native-Only Capabilities |
| :--- | :--- | :--- |
| **Apple CarPlay** | Streams audio over CarPlay/Bluetooth speakers; displays title, artist, album, and artwork in iOS Now Playing; supports Play, Pause, Next, Previous, and scrubbing via `navigator.mediaSession` -> `MPRemoteCommandCenter`. | CarPlay dashboard app icon, template browsing (Library, Playlists, Search, Up Next), and voice-guided browsing require a native iOS app binary signed with Apple's **`com.apple.developer.carplay-audio`** entitlement. |
| **Android Auto** | Streams audio over car Bluetooth (AVRCP) and Android media controls; displays metadata and accepts Play, Pause, Next, Previous, Seek via `navigator.mediaSession` -> Android `MediaSession`. | Android Auto dashboard app browsing requires a native Android **`MediaLibraryService`** (`androidx.media3.session.MediaLibraryService`) declaring `android.media.browse.MediaBrowserService` in `AndroidManifest.xml`. Bubblewrap TWAs cannot host this service alone without native Kotlin/Java code. |

Spot+ intentionally refuses to display fake "Connect CarPlay" or "Connect Android Auto" buttons inside the PWA.

---

## Shared Backend & Data Contract (Zero Extra Paid Infrastructure)

Both companions reuse existing Spot+ contracts without adding paid servers:

1. **Account & Sync**: Reuse existing Spot+ Sync (`js/sync.js`) snapshots (Liked Songs, Playlists, Recently Played, Settings) over the user's existing sync token.
2. **Catalog & Track Resolution**: Reuse the same metadata providers and existing Spot+ YouTube Relay endpoints (`/match`, `/yta`) with identical single-flight coalescing and bounded retry rules so Cloudflare Worker usage does not multiply.
3. **Offline Cache**: Store downloaded tracks in platform-native app storage (iOS `Application Support` / Android `filesDir`) using the same track key schema (`track.id`).

---

## 1. Lightweight iOS Companion (`SpotPlusCarPlay`)

- **Target**: iOS 16+, SwiftUI + CarPlay Framework (`CarPlay.framework`, `AVFoundation`, `MediaPlayer`).
- **Required Entitlements**:
  - `com.apple.developer.carplay-audio` (requested via Apple Developer Portal for audio apps).
  - `UIBackgroundModes`: `audio`.
- **Core Components**:
  1. `AudioSessionController`: Configures `AVAudioSession.Category.playback`, handles `interruptionNotification` & `routeChangeNotification`, drives `AVQueuePlayer` for gapless native playback and AirPlay 2 (`AVRoutePickerView`).
  2. `NowPlayingBridge`: Updates `MPNowPlayingInfoCenter.default()` and binds `MPRemoteCommandCenter.shared()` (play, pause, nextTrack, previousTrack, changePlaybackPosition).
  3. `CarPlaySceneDelegate` (`CPTemplateApplicationSceneDelegate`):
     - Root `CPTabBarTemplate`:
       - **Library** (`CPListTemplate`: Liked Songs, Playlists, Downloads)
       - **Recent** (`CPListTemplate`: Recently Played & Quick Mixes)
       - **Now Playing** (`CPNowPlayingTemplate.shared`)
  4. **PWA Shell Option**: The main phone UI can remain a thin `WKWebView` or native SwiftUI shell sharing the same `AVQueuePlayer` engine so users keep one consistent library.

---

## 2. Lightweight Android Companion (`SpotPlusAuto`)

- **Target**: Android 9+ (API 28+), Kotlin + Jetpack Media3 (`media3-exoplayer`, `media3-session`).
- **Manifest Declarations**:
  - `<meta-data android:name="com.google.android.gms.car.application" android:resource="@xml/automotive_app_desc" />` (`<uses name="media" />`).
  - Foreground service `SpotPlusMediaService` extending `MediaLibraryService` with `FOREGROUND_SERVICE_MEDIA_PLAYBACK`.
- **Core Components**:
  1. `SpotPlusMediaService` (`MediaLibraryService`):
     - Owns an `ExoPlayer` instance configured with `AudioAttributes` (`USAGE_MEDIA`, `CONTENT_TYPE_MUSIC`), audio focus handling, and `setHandleAudioBecomingNoisy(true)`.
     - Exposes `MediaLibrarySession` with a `MediaLibrarySession.Callback` implementing:
       - `onGetLibraryRoot()` -> returns browse root (`__ROOT__`)
       - `onGetChildren()` -> returns `Liked Songs`, `Playlists`, `Recent`, `Downloads`
       - `onSearch()` & `onGetSearchResult()` -> queries Spot+ catalog API for Google Assistant voice requests
       - `onAddMediaItems()` -> resolves playable audio URI via existing Spot+ source router / relay
  2. **TWA / PWA Coexistence**:
     - Can be shipped inside the same Play Store APK alongside a Trusted Web Activity (TWA) hosting `https://coye2.github.io/spot-plus/`, sharing an offline IndexedDB/SharedPreferences sync bridge or Sync code.

---

## 3. Rollout Guidance

- **Phase A (Shipped in v2.2.3)**: Full PWA reliability — AirPlay, W3C Remote Playback, `setSinkId`, hardened Lock Screen & Bluetooth AVRCP metadata/controls, and truthful CarPlay/Android Auto guidance in Settings & Connect.
- **Phase B (Optional Future Milestone)**: Build the thin Android Media3 `MediaLibraryService` wrapper (can be tested immediately via Google's Desktop Head Unit emulator without Apple entitlement approval).
- **Phase C (Optional Future Milestone)**: Apply for Apple's `com.apple.developer.carplay-audio` entitlement and ship the minimal Swift `CPTemplateApplicationSceneDelegate` companion.
