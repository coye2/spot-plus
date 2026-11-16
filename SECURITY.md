# Security policy

## Reporting a vulnerability

Please **don't open a public issue** for security problems. Report them privately through
[GitHub's private vulnerability reporting](https://github.com/coye2/spot-plus/security/advisories/new).
You'll get a reply as soon as possible, and credit when the fix ships if you'd like it.

## How Spot+ protects people

- **No accounts and no passwords.** Spot+ never asks for a Spotify password, cookie or token. It reads only public Spotify pages.
- **Data stays on the device.** Libraries, history and settings live in the browser. Nothing is sent to a Spot+ server.
- **End-to-end encryption.** Jam sessions and synced stats are encrypted on the device (AES-GCM) before they travel through public relays. Relays only see encrypted data.
- **Content Security Policy.** The app may only run its own scripts plus two named sources (Deezer's catalog and the CDN for the optional on-device AI). It blocks plugins, outside forms and being framed by other sites.
- **Locked-down bridge.** The Cloudflare worker only answers the Spot+ app and Spotify's web player, rate-limits each visitor, only accepts short, validated requests, never follows redirects, caps response sizes and sends strict security headers.
- **Helper safety.** The optional Spotify helper only sends data to the official Spot+ site, after a one-time code check, and only metadata (song names, not credentials).
- **Supply chain.** Few dependencies, vendored libraries with their licenses, CodeQL scanning, `npm audit` and Dependabot updates on every change.

## Supported versions

Only the live version at https://coye2.github.io/spot-plus/ is supported. It updates itself automatically.
