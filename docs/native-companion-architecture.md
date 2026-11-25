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

- **Phase A (Shipped in v2.2.3–v2.2.5)**: Full PWA reliability — AirPlay 2, W3C Remote Playback, `setSinkId`, hardened Lock Screen & Bluetooth AVRCP metadata/controls, durable OS-termination recovery checkpoints, and truthful CarPlay/Android Auto guidance in Settings & Connect.
- **Phase B (Isolated Optional Android Companion PoC)**: Build the thin Android Media3 `MediaLibraryService` wrapper (can be tested immediately via Google's Desktop Head Unit emulator without Apple entitlement approval).
- **Phase C (Isolated Optional iOS Companion PoC)**: Apply for Apple's `com.apple.developer.carplay-audio` entitlement and ship the minimal Swift `CPTemplateApplicationSceneDelegate` companion.

---

## 4. Isolated Phase B Proof-of-Concept Blueprints (Non-Production Reference)

The snippets below are intentionally isolated reference blueprints for future native companion packages and do **not** alter Spot+'s zero-install PWA production architecture.

### 4.1 Android Media3 (`SpotPlusMediaService.kt` + Manifest)

```xml
<!-- AndroidManifest.xml (isolated native companion module) -->
<meta-data
    android:name="com.google.android.gms.car.application"
    android:resource="@xml/automotive_app_desc" />

<service
    android:name=".SpotPlusMediaService"
    android:exported="true"
    android:foregroundServiceType="mediaPlayback">
    <intent-filter>
        <action android:name="androidx.media3.session.MediaLibraryService" />
        <action android:name="android.media.browse.MediaBrowserService" />
    </intent-filter>
</service>
```

```xml
<!-- res/xml/automotive_app_desc.xml -->
<automotiveApp>
    <uses name="media" />
</automotiveApp>
```

```kotlin
// SpotPlusMediaService.kt (Jetpack Media3 1.4+)
class SpotPlusMediaService : MediaLibraryService() {
    private lateinit var player: ExoPlayer
    private lateinit var session: MediaLibrarySession

    override fun onCreate() {
        super.onCreate()
        val attrs = AudioAttributes.Builder()
            .setUsage(C.USAGE_MEDIA)
            .setContentType(C.AUDIO_CONTENT_TYPE_MUSIC)
            .build()
        player = ExoPlayer.Builder(this)
            .setAudioAttributes(attrs, /* handleAudioFocus= */ true)
            .setHandleAudioBecomingNoisy(true)
            .build()
        session = MediaLibrarySession.Builder(this, player, LibraryCallback()).build()
    }

    override fun onGetSession(controllerInfo: MediaSession.ControllerInfo) = session

    private inner class LibraryCallback : MediaLibrarySession.Callback {
        override fun onGetLibraryRoot(
            session: MediaLibrarySession,
            browser: MediaSession.ControllerInfo,
            params: LibraryParams?
        ): ListenableFuture<LibraryResult<MediaItem>> {
            val root = MediaItem.Builder()
                .setMediaId("spotplus:root")
                .setMediaMetadata(
                    MediaMetadata.Builder()
                        .setTitle("Spot+")
                        .setIsBrowsable(true)
                        .setIsPlayable(false)
                        .build()
                ).build()
            return Futures.immediateFuture(LibraryResult.ofItem(root, params))
        }
        // onGetChildren() -> returns Liked Songs, Playlists, Recent, Downloads from Spot+ Sync snapshot
        // onAddMediaItems() -> resolves playable URI via existing Spot+ /match & /yta contracts
    }

    override fun onDestroy() {
        session.release()
        player.release()
        super.onDestroy()
    }
}
```

### 4.2 iOS CarPlay (`CarPlaySceneDelegate.swift` + Entitlements)

```xml
<!-- SpotPlusCarPlay.entitlements -->
<key>com.apple.developer.carplay-audio</key>
<true/>
```

```swift
// CarPlaySceneDelegate.swift (iOS 16+, CarPlay.framework + AVFoundation + MediaPlayer)
import CarPlay
import AVFoundation
import MediaPlayer

final class CarPlaySceneDelegate: UIResponder, CPTemplateApplicationSceneDelegate {
    private var interfaceController: CPInterfaceController?

    func templateApplicationScene(
        _ templateApplicationScene: CPTemplateApplicationScene,
        didConnect interfaceController: CPInterfaceController
    ) {
        self.interfaceController = interfaceController
        try? AVAudioSession.sharedInstance().setCategory(.playback, mode: .default)
        try? AVAudioSession.sharedInstance().setActive(true)

        let libraryTab = CPListTemplate(title: "Library", sections: [])
        let recentTab = CPListTemplate(title: "Recent", sections: [])
        let tabBar = CPTabBarTemplate(templates: [libraryTab, recentTab])
        interfaceController.setRootTemplate(tabBar, animated: true, completion: nil)
    }

    func templateApplicationScene(
        _ templateApplicationScene: CPTemplateApplicationScene,
        didDisconnectInterfaceController interfaceController: CPInterfaceController
    ) {
        self.interfaceController = nil
    }
}
```

