// WebBridgeViewController.swift — Path 3: Thin WKWebView Host + Microbridge Router (~85 LOC)
// Loads the real Spot+ PWA without duplicating app UI, validates sender origin strictly,
// and forwards `spotplus.microbridge.v1` envelopes to NativeAudioEngine.

import UIKit
import WebKit

final class WebBridgeViewController: UIViewController, WKScriptMessageHandler {
    private static let allowedHost = "coye2.github.io"
    private static let appURL = URL(string: "https://coye2.github.io/spot-plus/")!

    private var webView: WKWebView!

    override func viewDidLoad() {
        super.viewDidLoad()
        let config = WKWebViewConfiguration()
        config.allowsInlineMediaPlayback = true
        config.userContentController.add(self, name: "spotplusBridge")

        webView = WKWebView(frame: view.bounds, configuration: config)
        webView.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        view.addSubview(webView)

        NativeAudioEngine.shared.onStateSync = { [weak self] payload in
            self?.sendToWeb(type: "state.sync", payload: payload)
        }

        webView.load(URLRequest(url: Self.appURL))
    }

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        // Strict origin check: reject any untrusted iframe or external navigation.
        guard message.frameInfo.isMainFrame,
              message.frameInfo.securityOrigin.protocol == "https",
              message.frameInfo.securityOrigin.host == Self.allowedHost,
              let raw = message.body as? String,
              let data = raw.data(using: .utf8),
              let env = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              (env["protocol"] as? String) == "spotplus.microbridge.v1",
              let type = env["type"] as? String else { return }

        let id = env["id"] as? String
        let payload = env["payload"] as? [String: Any] ?? [:]
        let engine = NativeAudioEngine.shared

        switch type {
        case "bridge.hello":
            sendToWeb(type: "bridge.hello_ack", payload: [
                "platform": "ios-avplayer",
                "version": "0.1.0",
                "features": ["carplay-templates", "background-avplayer", "now-playing"],
            ], replyTo: id)
        case "cmd.play": engine.play()
        case "cmd.pause": engine.pause()
        case "cmd.next": engine.next()
        case "cmd.previous": engine.previous()
        case "cmd.seek":
            if let sec = payload["positionSec"] as? Double, sec >= 0, sec <= 86400 { engine.seek(to: sec) }
        default:
            break
        }
    }

    private func sendToWeb(type: String, payload: [String: Any], replyTo: String? = nil) {
        var envelope: [String: Any] = [
            "protocol": "spotplus.microbridge.v1",
            "id": "ios-\(Int(Date().timeIntervalSince1970 * 1000))",
            "type": type,
            "ts": Int(Date().timeIntervalSince1970 * 1000),
            "payload": payload,
        ]
        if let replyTo { envelope["replyTo"] = replyTo }
        DispatchQueue.main.async { [weak self] in
            self?.webView.callAsyncJavaScript(
                "if (typeof window.__spotplusNativeDispatch === 'function') { window.__spotplusNativeDispatch(envelope); }",
                arguments: ["envelope": envelope],
                in: nil,
                in: .page,
                completionHandler: nil
            )
        }
    }
}
