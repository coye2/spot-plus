# Spot+ for iPhone (app wrapper)

Spot+ as an iPhone app. It opens the same Spot+ you use in Safari, with two things Safari can't do:

- **InstantPlay with no extra tap.** In Safari, Apple requires a tap inside YouTube's own player before it makes sound. This app turns that rule off, so a tap on a song plays it.
- **Background playback.** Music keeps playing with the screen off or in another app.

## Install (Windows PC + iPhone)

1. Download `SpotPlus.ipa` from the latest **iOS app** release on GitHub (or the newest run of the *Build the iPhone app* workflow).
2. Install it with **Sideloadly** (sideloadly.io) or **AltStore** (altstore.io): connect the iPhone by USB, pick the `.ipa`, sign in with your Apple ID.
3. On the iPhone: Settings → General → VPN & Device Management → trust your Apple ID. On iOS 16+, also turn on Settings → Privacy & Security → Developer Mode.

With a free Apple ID, the app must be re-signed every 7 days (AltStore can do this automatically over Wi-Fi). A paid Apple Developer account lasts a year.

## Build

GitHub Actions builds it on a Mac runner (`.github/workflows/ios.yml`): XcodeGen creates the project from `project.yml`, Xcode builds it unsigned, and the `.app` is zipped into an `.ipa`. Sideloadly/AltStore sign it on install.
