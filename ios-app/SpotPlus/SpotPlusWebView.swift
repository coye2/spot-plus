import SwiftUI
import WebKit

/// Spot+ in a web view that may start sound without a tap inside each player.
/// Safari requires a tap inside YouTube's own player before it makes sound; an app is allowed to lift that rule.
struct SpotPlusWebView: UIViewRepresentable {
    let url: URL

    func makeCoordinator() -> Coordinator { Coordinator(home: url) }

    func makeUIView(context: Context) -> WKWebView {
        let config = WKWebViewConfiguration()
        config.allowsInlineMediaPlayback = true
        config.mediaTypesRequiringUserActionForPlayback = []   // the key setting: InstantPlay with no extra tap
        config.allowsPictureInPictureMediaPlayback = true
        config.applicationNameForUserAgent = "SpotPlusApp/1.0"  // lets the web app know it can autoplay
        config.websiteDataStore = .default()

        let webView = WKWebView(frame: .zero, configuration: config)
        webView.navigationDelegate = context.coordinator
        webView.uiDelegate = context.coordinator
        webView.isOpaque = false
        webView.backgroundColor = .black
        webView.scrollView.backgroundColor = .black
        webView.scrollView.contentInsetAdjustmentBehavior = .never
        webView.allowsBackForwardNavigationGestures = false
        context.coordinator.webView = webView
        webView.load(URLRequest(url: url))
        return webView
    }

    func updateUIView(_ webView: WKWebView, context: Context) {}

    final class Coordinator: NSObject, WKNavigationDelegate, WKUIDelegate {
        let home: URL
        weak var webView: WKWebView?
        init(home: URL) { self.home = home }

        // Spot+ pages and YouTube's player stay inside the app; any other link opens in Safari.
        func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction,
                     decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
            guard let target = action.request.url else { return decisionHandler(.allow) }
            let isMainFrame = action.targetFrame?.isMainFrame ?? true
            let inApp = target.host == home.host || target.scheme == "about" || target.scheme == "blob" || target.scheme == "data"
            if !isMainFrame || inApp { return decisionHandler(.allow) }
            if ["http", "https"].contains(target.scheme ?? "") {
                UIApplication.shared.open(target)
                return decisionHandler(.cancel)
            }
            decisionHandler(.allow)
        }

        // window.open / target=_blank: open in Safari.
        func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration,
                     for action: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
            if let target = action.request.url { UIApplication.shared.open(target) }
            return nil
        }

        // If the page fails to load (offline at launch), try again shortly.
        func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
            DispatchQueue.main.asyncAfter(deadline: .now() + 3) { [weak webView] in
                guard let webView else { return }
                webView.load(URLRequest(url: self.home))
            }
        }
    }
}
