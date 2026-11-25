// NativeAudioEngine.swift — Path 3: iOS Native Microbridge Single Audio Engine (~130 LOC)
// Owns the single authoritative AVQueuePlayer + AVAudioSession + MPNowPlayingInfoCenter +
// MPRemoteCommandCenter so playback continues seamlessly even when WKWebView is suspended.

import AVFoundation
import Foundation
import MediaPlayer

struct BridgeTrack: Codable {
    let id: String
    let title: String
    let artist: String
    let album: String
    let artworkUrl: String?
    let streamUrl: String?
    let durationSec: Double
}

struct BridgePlaylist: Codable {
    let id: String
    let name: String
    let tracks: [BridgeTrack]
}

final class NativeAudioEngine: NSObject {
    static let shared = NativeAudioEngine()

    private let player = AVQueuePlayer()
    private(set) var queue: [BridgeTrack] = []
    private(set) var currentIndex: Int = -1
    private(set) var likedTracks: [BridgeTrack] = []
    private(set) var playlists: [BridgePlaylist] = []

    var onStateSync: (([String: Any]) -> Void)?

    private override init() {
        super.init()
        configureAudioSession()
        configureRemoteCommands()
        observeAudioNotifications()
    }

    private func configureAudioSession() {
        let session = AVAudioSession.sharedInstance()
        try? session.setCategory(.playback, mode: .default, policy: .longFormAudio)
        try? session.setActive(true)
    }

    private func observeAudioNotifications() {
        let nc = NotificationCenter.default
        nc.addObserver(self, selector: #selector(handleInterruption(_:)), name: AVAudioSession.interruptionNotification, object: nil)
        nc.addObserver(self, selector: #selector(handleRouteChange(_:)), name: AVAudioSession.routeChangeNotification, object: nil)
        nc.addObserver(self, selector: #selector(handleTrackEnded(_:)), name: .AVPlayerItemDidPlayToEndTime, object: nil)
    }

    private func configureRemoteCommands() {
        let cc = MPRemoteCommandCenter.shared()
        cc.playCommand.addTarget { [weak self] _ in self?.play(); return .success }
        cc.pauseCommand.addTarget { [weak self] _ in self?.pause(); return .success }
        cc.nextTrackCommand.addTarget { [weak self] _ in self?.next(); return .success }
        cc.previousTrackCommand.addTarget { [weak self] _ in self?.previous(); return .success }
        cc.changePlaybackPositionCommand.addTarget { [weak self] event in
            guard let ev = event as? MPChangePlaybackPositionCommandEvent else { return .commandFailed }
            self?.seek(to: ev.positionTime)
            return .success
        }
        // Keep CarPlay / Lock Screen showing track skip buttons instead of ±15s buttons.
        cc.skipForwardCommand.isEnabled = false
        cc.skipBackwardCommand.isEnabled = false
    }

    func setQueue(_ tracks: [BridgeTrack], startIndex: Int = 0, autoplay: Bool = true) {
        queue = tracks
        currentIndex = max(0, min(startIndex, tracks.count - 1))
        loadCurrent(autoplay: autoplay)
    }

    func loadCurrent(autoplay: Bool) {
        guard queue.indices.contains(currentIndex) else { return }
        let track = queue[currentIndex]
        guard let raw = track.streamUrl, let url = URL(string: raw), url.scheme == "https" else {
            emitState("ERROR")
            return
        }
        player.removeAllItems()
        player.insert(AVPlayerItem(url: url), after: nil)
        updateNowPlaying(track)
        if autoplay { play() } else { emitState("PAUSED") }
    }

    func play() {
        try? AVAudioSession.sharedInstance().setActive(true)
        player.play()
        emitState("PLAYING")
    }

    func pause() {
        player.pause()
        emitState("PAUSED")
    }

    func next() {
        guard currentIndex + 1 < queue.count else { return }
        currentIndex += 1
        loadCurrent(autoplay: true)
    }

    func previous() {
        if player.currentTime().seconds > 3.0 {
            seek(to: 0)
            return
        }
        guard currentIndex > 0 else { return }
        currentIndex -= 1
        loadCurrent(autoplay: true)
    }

    func seek(to seconds: Double) {
        let clamped = max(0, seconds)
        player.seek(to: CMTime(seconds: clamped, preferredTimescale: 600))
        emitState(player.timeControlStatus == .playing ? "PLAYING" : "PAUSED")
    }

    func updateLibrary(likes: [BridgeTrack], playlists: [BridgePlaylist]) {
        self.likedTracks = likes
        self.playlists = playlists
    }

    private func updateNowPlaying(_ track: BridgeTrack) {
        MPNowPlayingInfoCenter.default().nowPlayingInfo = [
            MPMediaItemPropertyTitle: track.title,
            MPMediaItemPropertyArtist: track.artist,
            MPMediaItemPropertyAlbumTitle: track.album,
            MPMediaItemPropertyPlaybackDuration: track.durationSec,
            MPNowPlayingInfoPropertyElapsedPlaybackTime: player.currentTime().seconds,
            MPNowPlayingInfoPropertyPlaybackRate: player.rate,
        ]
    }

    @objc private func handleInterruption(_ note: Notification) {
        guard let info = note.userInfo,
              let rawType = info[AVAudioSessionInterruptionTypeKey] as? UInt,
              let type = AVAudioSession.InterruptionType(rawValue: rawType) else { return }
        if type == .began {
            emitState("PAUSED")
        } else if type == .ended {
            let rawOpts = info[AVAudioSessionInterruptionOptionKey] as? UInt ?? 0
            if AVAudioSession.InterruptionOptions(rawValue: rawOpts).contains(.shouldResume) {
                play()
            }
        }
    }

    @objc private func handleRouteChange(_ note: Notification) {
        guard let info = note.userInfo,
              let rawReason = info[AVAudioSessionRouteChangeReasonKey] as? UInt,
              let reason = AVAudioSession.RouteChangeReason(rawValue: rawReason) else { return }
        // CarPlay or Bluetooth disconnected: always pause instead of playing from phone speaker.
        if reason == .oldDeviceUnavailable {
            pause()
        }
    }

    @objc private func handleTrackEnded(_ note: Notification) {
        if currentIndex + 1 < queue.count {
            next()
        } else {
            emitState("ENDED")
        }
    }

    private func emitState(_ state: String) {
        onStateSync?([
            "state": state,
            "positionSec": max(0, player.currentTime().seconds.isFinite ? player.currentTime().seconds : 0),
            "index": currentIndex,
            "route": currentRouteName(),
        ])
    }

    private func currentRouteName() -> String {
        let outputs = AVAudioSession.sharedInstance().currentRoute.outputs
        if outputs.contains(where: { $0.portType == .carAudio }) { return "carplay" }
        if outputs.contains(where: { $0.portType == .airPlay }) { return "airplay" }
        if outputs.contains(where: { $0.portType == .bluetoothA2DP || $0.portType == .bluetoothHFP }) { return "bluetooth" }
        return "speaker"
    }
}
