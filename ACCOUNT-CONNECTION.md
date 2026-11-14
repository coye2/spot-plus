# Spotify account connection

The experimental phone companion reads the library of the Spotify account signed in to the phone's browser. It requires neither Spotify Premium nor a developer Client ID. It is **one-way, user-initiated refresh**, not continuous background sync or Spotify audio playback. A real signed-in account and physical Android/iPhone tests are still required to verify it end to end.

Open Spot+ → Settings → Spotify account. The same screen contains installation links and a file fallback. The GitHub Pages app is public at https://coye2.github.io/spot-plus/. Your music library is stored in your own browser.

## iPhone, without a PC

1. Install [Userscripts](https://github.com/quoid/userscripts#installation) using the project's official App Store link. Open the app once, then enable its extension in Safari.
2. In Safari, open the **Spot+ companion** link in the Spot+ account screen. In Safari's extensions menu, open Userscripts and install the script.
3. Allow the extension on `open.spotify.com`. Open Spot+ in Safari, choose **Open Spotify to connect**, and sign in on Spotify itself.
4. Open Your Library on Spotify. In the companion panel, choose **Read library**. Keep the Spotify tab open until it finishes, then choose **Send to Spot+**.
5. Return to Spot+ and review/apply the library. If the tabs cannot communicate, choose **Save library file** on Spotify, save it to Files, and use **Choose companion file** in Spot+.

## Android, without a PC

1. Use Firefox and install [Tampermonkey](https://www.tampermonkey.net/index.php?browser=firefox) from its official Firefox extension link.
2. Open the companion link from Spot+'s account screen and install it.
3. Choose **Open Spotify to connect**. Keep sign-in in Firefox; request the desktop site if Spotify redirects to its native app.
4. Open Your Library, then **Read library → Send to Spot+** in the companion panel. Return to Spot+ to review/apply it. The same file fallback works here.

For a home-screen app, use Safari/Firefox for the connection step. Browser and installed-web-app storage can differ, so import the companion file in the app where you want to keep the music.

## What refreshes

- Liked Songs and accessible playlist track lists appear as Spotify copies in the Spot+ library and use Spot+'s existing metadata-to-audio matching.
- Saved albums and followed artists appear as Spotify links. They open the official Spotify embed; their track lists are not mirrored by this connector.
- A completed refresh replaces only the Spotify copy, reflecting removals as well as additions. Local Spot+ playlists/likes are untouched. Use **Make editable copy** to keep an independent playlist.
- Inaccessible playlists keep their prior tracks and are labelled unavailable. Failed, interrupted, rate-limited, structurally invalid or older refreshes do not overwrite a saved account copy.
- Episodes, audiobooks, unavailable/local-only Spotify tracks and unsupported items may be skipped and counted. Limits: 10,000 items per collection, 1,000 playlists/albums/artists each, 20,000 tracks overall, 12 MB transfer. Browser storage capacity can be smaller; a failed save keeps the previous copy.
- Remove connection deletes this device's Spotify copy. It does not sign out of Spotify. Disable/uninstall the companion separately to remove its access on Spotify's page.

## Privacy and implementation

The script runs only on `https://open.spotify.com/`. It observes the authorization headers Spotify's own web player already uses for its music queries, holds them only in page memory, and makes four allowlisted **read** queries. It never reads cookies, asks for passwords, exports session tokens, sends credentials to Spot+, writes Spotify playlists, or extracts Spotify audio. No external executable dependency, token broker, third-party account or PC server is involved.

Only a whitelist of music metadata and the Spotify display name/username is transferred. Direct transfer requires the precise Spotify origin, the window opened by Spot+, and a random 128-bit nonce expiring after 30 minutes. All incoming metadata is validated again before review and storage. Refreshes are applied only after the user's review. Account copies live in this browser's storage and are included in Settings → Export backup. Backups contain music metadata, never Spotify session credentials. Restoring keeps an existing newer copy or a different account's copy and tells you when it does so. To deliberately switch accounts, use the account setup page and review the incoming library there.

Spotify's private web interface can change. The adapter observes current query hashes when the web player sends the relevant read requests, with versioned fallback hashes checked against the [unofficial Spotube Spotify plugin](https://github.com/sonic-liberation/spotube-plugin-spotify). This is an independently written browser adapter; no Kotlin implementation was copied. It is not an official Spotify integration, nor a port of the full native Spotube plugin.

The userscript is assembled from `js/spotify-reader.js` and `scripts/spotify-companion-entry.js`. Run `node scripts/build-companion.mjs` after editing either; the production build does this automatically. On a different hosting domain, update the companion's exact `targetOrigin` and namespace before rebuilding. Local previews support the file handoff; direct transfer intentionally targets only the deployed Site.

ListenBrainz was investigated but is not used: its current Spotify track-import implementation uploads a public playlist. The companion avoids that publication side effect.

## Windows helper

```powershell
.\scripts\Setup-SpotifyConnection.ps1
```

Opens the hosted account setup screen. `-ShowFiles` locates the bundled companion. It does not install an extension, change execution policy, read credentials, or complete sign-in. Phone installation and Spotify sign-in still happen on each phone.

## Verification

Automated fixtures cover pagination, failed/truncated reads, account changes during a refresh, secret-field removal, invalid image URLs, old snapshots, message origin/window/nonce checks and storage failure. Fixture validation is not evidence of a successful Spotify login. The browser interface and import/refresh flow are tested separately; physical-device and real-account authentication remain unverified until the user completes the setup.

Primary references: [Userscripts installation](https://github.com/quoid/userscripts#installation), [Firefox Android extensions](https://support.mozilla.org/en-US/kb/find-and-install-add-ons-firefox-android), [Tampermonkey](https://www.tampermonkey.net/index.php?browser=firefox), [Spotify developer-mode changes](https://developer.spotify.com/documentation/web-api/tutorials/february-2026-migration-guide), [ListenBrainz import source](https://github.com/metabrainz/listenbrainz-server/blob/master/listenbrainz/troi/import_ms.py), [Troi serialization source](https://github.com/metabrainz/troi-recommendation-playground/blob/main/troi/playlist.py).
