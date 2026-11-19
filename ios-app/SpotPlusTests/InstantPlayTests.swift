import XCTest
import WebKit
@testable import SpotPlus

/// Runs in the iPhone Simulator (same WebKit and autoplay rules as an iPhone). Nothing here taps the screen:
/// every song must start with sound from code alone, exactly as after a single tap on a song in the app.
final class InstantPlayTests: XCTestCase {

    /// Collects messages the page posts to `window.webkit.messageHandlers.probe`.
    final class Probe: NSObject, WKScriptMessageHandler {
        var last: [String: Any] = [:]
        func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
            if let body = message.body as? [String: Any] { last.merge(body) { _, new in new } }
        }
    }

    private func makeWebView(_ config: WKWebViewConfiguration, probe: Probe, startScript: String? = nil) -> WKWebView {
        config.userContentController.add(probe, name: "probe")
        if let startScript {
            config.userContentController.addUserScript(WKUserScript(source: startScript, injectionTime: .atDocumentStart, forMainFrameOnly: true))
        }
        let window = UIWindow(frame: UIScreen.main.bounds)
        let webView = WKWebView(frame: window.bounds, configuration: config)
        let host = UIViewController()
        host.view.addSubview(webView)
        window.rootViewController = host
        window.makeKeyAndVisible()
        return webView
    }

    private func wait(seconds: Double, until done: () -> Bool) -> Bool {
        let end = Date().addingTimeInterval(seconds)
        while Date() < end {
            if done() { return true }
            RunLoop.main.run(until: Date().addingTimeInterval(0.1))
        }
        return done()
    }

    /// A YouTube player with autoplay: plays with sound in the app's web view, but not under Safari's rules.
    private let youTubePage = """
    <html><body style="margin:0;background:#000">
    <iframe id="yt" width="320" height="180" allow="autoplay; encrypted-media"
      src="https://www.youtube.com/embed/dQw4w9WgXcQ?enablejsapi=1&autoplay=1&playsinline=1&origin=https%3A%2F%2Fcoye2.github.io"></iframe>
    <script>
      const f = document.getElementById('yt');
      const ping = setInterval(() => f.contentWindow.postMessage(JSON.stringify({event:'listening',id:1,channel:'widget'}), '*'), 400);
      addEventListener('message', e => {
        try {
          const d = JSON.parse(e.data), i = d.info || {};
          const out = {};
          if (typeof i.currentTime === 'number') out.time = i.currentTime;
          if (typeof i.muted === 'boolean') out.muted = i.muted;
          if (typeof i.playerState === 'number') out.state = i.playerState;
          if (d.event === 'onError') out.error = Number(d.info) || -1;
          if (Object.keys(out).length) window.webkit.messageHandlers.probe.postMessage(out);
        } catch (_) {}
      });
    </script></body></html>
    """

    func testAppWebViewPlaysYouTubeWithSoundWithoutATap() {
        let probe = Probe()
        let webView = makeWebView(SpotPlusWebView.makeConfiguration(), probe: probe)
        webView.loadHTMLString(youTubePage, baseURL: URL(string: "https://coye2.github.io/spot-plus/"))
        let played = wait(seconds: 40) { ((probe.last["time"] as? Double) ?? 0) > 2 }
        print("APP CONFIG:", probe.last)
        XCTAssertTrue(played, "YouTube's player did not start on its own in the app: \(probe.last)")
        XCTAssertNotEqual(probe.last["muted"] as? Bool, true, "It started muted")
    }

    /// Control: with Safari's rule (a tap is required), the same page does not play with sound.
    func testSafariRulesBlockTheSamePage() {
        let probe = Probe()
        let config = SpotPlusWebView.makeConfiguration()
        config.mediaTypesRequiringUserActionForPlayback = .all
        let webView = makeWebView(config, probe: probe)
        webView.loadHTMLString(youTubePage, baseURL: URL(string: "https://coye2.github.io/spot-plus/"))
        _ = wait(seconds: 20) { false }
        print("SAFARI RULES:", probe.last)
        let audible = ((probe.last["time"] as? Double) ?? 0) > 2 && (probe.last["muted"] as? Bool) != true
        XCTAssertFalse(audible, "Expected Safari's rule to stop audible autoplay: \(probe.last)")
    }

    /// The real Spot+ site, songs started from code only (no tap anywhere). Includes songs whose official
    /// uploads are blocked outside YouTube, which used to end as 30-second clips.
    func testRealSpotPlusSongsStartWithNoTapAndPlayFullSongs() throws {
        let songs: [(String, String, Int)] = [
            ("Never Gonna Give You Up", "Rick Astley", 213),
            ("Blinding Lights", "The Weeknd", 200),
            ("Uptown Funk (feat. Bruno Mars)", "Mark Ronson, Bruno Mars", 270),
            ("the cure", "Olivia Rodrigo", 297),
        ]
        let probe = Probe()
        let skipIntro = """
        try { localStorage.setItem('spotplus.landing','1'); localStorage.setItem('spotplus.onboarded.v2','1');
              localStorage.setItem('spotplus.onboarded.v2.installed','1'); localStorage.setItem('spotplus.seenVersion','9.9.9'); } catch (_) {}
        window.__ytLog = [];
        addEventListener('message', e => {
          if (!/youtube/.test(e.origin)) return;
          try { const d = JSON.parse(e.data);
            if (d.event === 'onError') window.__ytLog.push('error ' + d.info);
            if (d.event === 'infoDelivery' && d.info && d.info.videoData && d.info.videoData.errorCode) window.__ytLog.push('videoData error ' + d.info.videoData.errorCode);
          } catch (_) {}
        });
        const realFetch = window.fetch;
        window.fetch = async (...args) => {
          const url = String(args[0] && args[0].url || args[0]);
          try { const r = await realFetch(...args);
            if (/workers\.dev\/match/.test(url)) { const c = r.clone(); c.json().then(j => window.__ytLog.push('match ' + r.status + ' ' + (j.items || []).length + ' items')).catch(() => window.__ytLog.push('match ' + r.status)); }
            return r;
          } catch (err) { if (/workers\.dev/.test(url)) window.__ytLog.push('match failed ' + err); throw err; }
        };
        """
        let webView = makeWebView(SpotPlusWebView.makeConfiguration(), probe: probe, startScript: skipIntro)
        webView.load(URLRequest(url: URL(string: "https://coye2.github.io/spot-plus/#/home")!))
        XCTAssertTrue(wait(seconds: 30) { !webView.isLoading }, "site did not load")
        RunLoop.main.run(until: Date().addingTimeInterval(5)) // the app boots YouTube's player in the background

        var failures: [String] = []
        for (index, song) in songs.enumerated() {
            let started = Date()
            let start = expectation(description: "start \(song.0)")
            webView.callAsyncJavaScript("""
                const P = await import('./js/player.js');
                window.__P = P;
                P.playList([{id: 'sim-\(index)-' + Date.now(), title: title, artist: artist, duration: duration}], 0);
                return true;
                """, arguments: ["title": song.0, "artist": song.1, "duration": song.2], in: nil, in: .page) { _ in start.fulfill() }
            wait(for: [start], timeout: 20)

            var status: [String: Any] = [:]
            var firstSound: Double = -1
            let ok = wait(seconds: 45) {
                let poll = self.expectation(description: "poll")
                webView.callAsyncJavaScript("""
                    const P = window.__P, s = P.state;
                    return {phase: s.phase, kind: s.source?.kind || '', preview: !!s.source?.preview, pos: P.position(), tap: !!s.needsTap, log: (window.__ytLog || []).slice(-12).join(' | ')};
                    """, arguments: [:], in: nil, in: .page) { result in
                    if case .success(let value) = result, let dict = value as? [String: Any] { status = dict }
                    poll.fulfill()
                }
                self.wait(for: [poll], timeout: 5)
                let pos = (status["pos"] as? Double) ?? 0
                if firstSound < 0 && pos > 0 && (status["phase"] as? String) == "PLAYING" { firstSound = Date().timeIntervalSince(started) }
                return pos > 3 && (status["phase"] as? String) == "PLAYING"
            }
            print(String(format: "SONG %@ — %@: first sound %.2fs, status %@", song.1, song.0, firstSound, status.description))
            _ = webView.callAsyncJavaScript("window.__ytLog = []; return 1;", arguments: [:], in: nil, in: .page) { _ in }
            if !ok { failures.append("\(song.0) did not play: \(status)") }
            if (status["preview"] as? Bool) == true { failures.append("\(song.0) played a 30-second clip") }
            if (status["tap"] as? Bool) == true { failures.append("\(song.0) asked for a tap") }
        }
        XCTAssertTrue(failures.isEmpty, failures.joined(separator: "\n"))
    }
}
