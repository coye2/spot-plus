import SwiftUI
import AVFoundation

@main
struct SpotPlusApp: App {
    init() {
        // Music app: play with the silent switch on and keep playing in the background.
        try? AVAudioSession.sharedInstance().setCategory(.playback, mode: .default, options: [])
        try? AVAudioSession.sharedInstance().setActive(true)
    }

    var body: some Scene {
        WindowGroup {
            SpotPlusWebView(url: URL(string: "https://coye2.github.io/spot-plus/")!)
                .ignoresSafeArea()
                .background(Color.black)
                .preferredColorScheme(.dark)
        }
    }
}
