# Spotify account connection

The experimental browser companion reads the library of the Spotify account signed in to the device's browser. It requires neither Spotify Premium nor a developer Client ID. It is **one-way, user-initiated refresh**, not continuous background sync or Spotify audio playback. A real signed-in account and physical Android/iPhone tests are still required to verify it end to end.

Open Spot+ → Settings → Spotify account → **Set up helper**. This opens the full in-app setup page at `#/spotify-account/helper`, keeping the instructions visible while you work in the extension. The GitHub Pages app is public at https://coye2.github.io/spot-plus/. Your music library is stored in your own browser.

## iPhone, without a PC

1. Install [Userscripts](https://github.com/quoid/userscripts#installation) using the project's official App Store link. Open the app once, then enable its extension in Safari.
2. In Spot+, choose **Set up helper → iPhone → Download helper file**, then save it into the folder selected in Userscripts. The setup page also offers installation through Safari's extensions menu.
3. Allow the extension on `open.spotify.com`. Open Spot+ in Safari, choose **Connect Spotify → Copy Spotify browser link**, paste it into Safari’s address bar, and sign in on Spotify itself.
4. Keep Spotify open. After sign-in, the helper attempts to read the library and send it back automatically. If it does not start, open Your Library and choose **Read library**, then **Send to Spot+**.
5. Return to Spot+ and review/apply the library. If the tabs cannot communicate, choose **Save library file** on Spotify, save it to Files, and use **Import library file** in Spot+.

## Android, without a PC

1. Use Firefox and install [Tampermonkey](https://www.tampermonkey.net/index.php?browser=firefox) from its official Firefox extension link.
2. Choose **Set up helper → Copy install link**. In Tampermonkey, open **Dashboard → Utilities → Import from URL**, paste the link, and confirm installation. The automatic file link is an optional alternative; direct import also works when link detection fails or only code appears.
3. Choose **Connect Spotify → Copy Spotify browser link** and paste it into Firefox’s address bar. Request Desktop site if needed.
4. Keep Spotify open while the helper reads your library and sends it back for review. If nothing arrives, open Your Library → **Read library → Send to Spot+**. The file fallback works here too.

For a home-screen app, use Safari/Firefox for the connection step. Browser and installed-web-app storage can differ, so import the companion file in the app where you want to keep the music.

## Computer (Windows, macOS or Linux)

1. In Chrome, Edge or Firefox, install [Tampermonkey](https://www.tampermonkey.net/) from its official extension-store link. Chrome/Edge may require **Allow User Scripts** in the extension's Details.
2. Choose **Set up helper → Copy install link**. In Tampermonkey, open **Dashboard → Utilities → Import from URL**, paste the link, and confirm installation. The setup page keeps these steps and a selectable copy of the URL visible. If clipboard access is denied, it selects the URL for manual copying and does not report success. The helper runs on Spotify's website, not its desktop app.
3. Choose **Connect Spotify**, sign in on Spotify itself, and keep both tabs open. The helper reads the library and sends it for review. If the automatic step fails, use **Read library → Send to Spot+** or the file fallback.

Both Tampermonkey and Safari Userscripts explicitly run the helper in the page context. There is no blob-injection branch. Sign-in with a real account is still unverified. Use a regular browser with its userscript extension enabled; installing an extension in Chrome does not install it in a separate embedded browser.

## What refreshes

- Your Spotify display name, username, profile photo (when returned), and profile link appear on the connected-account page and your Spot+ profile. Refreshing updates them, and backups preserve them. Older copies without a photo show an initial. Email, billing details and session credentials are not copied. Spotify Messages are not synchronized.
- Liked Songs and accessible playlist track lists appear as Spotify copies in the Spot+ library and use Spot+'s existing metadata-to-audio matching.
- Saved albums and followed artists appear as Spotify links. They open the official Spotify embed; their track lists are not mirrored by this connector.
- A completed refresh replaces only the Spotify copy, reflecting removals as well as additions. Local Spot+ playlists/likes are untouched. Use **Make editable copy** to keep an independent playlist.
- Inaccessible playlists keep their prior tracks and are labelled unavailable. Failed, interrupted, rate-limited, structurally invalid or older refreshes do not overwrite a saved account copy.
- Episodes, audiobooks, unavailable/local-only Spotify tracks and unsupported items may be skipped and counted. Limits: 10,000 items per collection, 1,000 playlists/albums/artists each, 20,000 tracks overall, 12 MB transfer. Browser storage capacity can be smaller; a failed save keeps the previous copy.
- Remove connection deletes this device's Spotify copy. It does not sign out of Spotify. Disable/uninstall the companion separately to remove its access on Spotify's page.

## Privacy and implementation

The script runs only on `https://open.spotify.com/`. It observes the authorization headers Spotify's own web player already uses for its music queries, holds them only in page memory, and makes four allowlisted **read** queries. It never reads cookies, asks for passwords, exports session tokens, sends credentials to Spot+, writes Spotify playlists, or extracts Spotify audio. No external executable dependency, token broker, third-party account or PC server is involved.

Only a whitelist of music metadata and the Spotify display name, username, photo URL and profile link is transferred. Automatic reading requires a fresh explicit Connect Spotify launch, a mounted companion, and an observed Spotify request authorization header. It makes one attempt, with a new-session retry after a sign-in error; cancellation prevents automatic retries. Direct transfer requires the precise Spotify origin, the window opened by Spot+, and a random 128-bit nonce expiring after 30 minutes. All incoming metadata is validated again before review and storage. Refreshes are applied only after the user's review. Account copies live in this browser's storage and are included in Settings → Export backup. Backups contain profile/music metadata, never Spotify session credentials. Restoring keeps an existing newer copy or a different account's copy and tells you when it does so. To deliberately switch accounts, use the account setup page and review the incoming library there.

Spotify's private web interface can change. The adapter observes current query hashes when the web player sends the relevant read requests, with versioned fallback hashes checked against the [unofficial Spotube Spotify plugin](https://github.com/sonic-liberation/spotube-plugin-spotify). This is an independently written browser adapter; no Kotlin implementation was copied. It is not an official Spotify integration, nor a port of the full native Spotube plugin.

The userscript is assembled from `js/spotify-reader.js` and `scripts/spotify-companion-entry.js`. Run `node scripts/build-companion.mjs` after editing either; the production build does this automatically. On a different hosting domain, update the companion's exact `targetOrigin` and namespace before rebuilding. Local previews support the file handoff; direct transfer targets only the exact allowlisted GitHub Pages and previous Site origins.

ListenBrainz was investigated but is not used: its current Spotify track-import implementation uploads a public playlist. The companion avoids that publication side effect.

## Windows helper

```powershell
.\scripts\Setup-SpotifyConnection.ps1
```

Opens the hosted account setup screen. `-ShowFiles` locates the bundled companion. It does not install an extension, change execution policy, read credentials, or complete sign-in. Helper installation and Spotify sign-in happen in each device’s browser.

## Verification

Helper **1.3.4** handles unavailable playlist entries in `libraryV3` and HTTP-200 `playlistV2` responses carrying `__typename: NotFound`. An explicit `currentUserCapabilities.canView: false` also marks a playlist unavailable. These cases keep the playlist identity, allow the other collections to finish, and preserve an existing same-account copy (including its name, cover and owner). Unknown response types, malformed/partial pages, network/auth/rate failures and mismatched playlist identities still abort the read. The review screen discloses unavailable playlists before applying a refresh. Retained tracks are revalidated against the total limits.

The cases match independently recorded response shapes in [Spotifly](https://github.com/ralph/Spotifly/blob/d0e592a00aed80be20aba9dcc7227833a81f6911/plans/done/playlist-not-found-answers-500.md) and [Sonora](https://github.com/sonorahq/sonora/blob/cf394e9fed20afd07d0684d4fed25cab732def5f/crates/music/src/spotify/pathfinder/library.rs). This reproduces a known cause of the generic “Spotify playlist” failure; the user’s actual response was not inspected. Regression cases cover missing entries, disappearing playlists between pages, preserved metadata, genuine empty playlists and failures that must still stop a refresh.

Helper **1.3.3** adds the profile photo and profile link using the existing profile read; it retains the library-reading fix described below. Photo URLs are restricted to HTTPS on Spotify image hosts, and profile links are built from usernames. Copies/backups include only these whitelisted profile fields and music metadata.

Helper **1.3.2** fixes the Liked Songs reader: Spotify's recorded response puts the page at `data.me.library.tracks` and the track ID at `track._uri`, outside `track.data`. The previous reader expected a direct page and a track-local URI, reproducing the reported “Spotify changed its library response” error and missing the song IDs. Both the current nested shape and older direct-page shape are supported. Malformed pages and broken music records abort the transfer instead of replacing the saved library. Errors identify the affected collection, and the Spotify panel now displays the helper version.

Update the installed script as well as the app: in Tampermonkey, import the helper URL again and confirm the update; in Userscripts, replace the helper file in its scripts folder. Reload Spotify and confirm **Helper 1.3.4** in the panel. Refreshing Spot+ alone does not update an installed userscript.

The v39 app retains the dedicated setup page introduced in v35. Desktop/Android setup defaults to Tampermonkey's documented Import from URL path rather than assuming that a direct userscript link opens an installer. Copying a link never marks the helper installed or the account connected. On iPhone, select a scripts folder in Userscripts, download the helper from the setup page, and save the `.user.js` into that folder. The Safari Extensions → Userscripts → Install method remains an alternative. Allow Userscripts on the relevant websites.

The blank install page was reproduced: the v33 service worker treated a navigation to the `.user.js` file as an app route and returned `index.html`. Its relative assets then resolved below `/js/`, leaving an unstyled, unusable white page. Since v34, installer/update files are fetched directly, bypassing stale caches, and the cached app document is used only for actual app entry URLs. Regression tests cover install navigation, update fetch, offline failure, offline app entry, and missing-file responses. No library reset or browsing-data deletion is needed.

The helper explicitly runs in the page context so Safari Userscripts can observe Spotify’s authorized requests. Connect first opens instructions inside Spot+ instead of immediately launching the native app. Computer sign-in starts at accounts.spotify.com. If the original tab connection is lost, Send to Spot+ opens a visible receiving page with an origin/window/nonce handshake. On iPhone Home Screen installations, use the file handoff when Safari storage is separate. Listening statistics use the separate streaming-history import in Your Rewind.

Automated fixtures cover current/legacy response layouts, wrapped song IDs, pagination, failed/truncated reads, account changes during a refresh, secret-field removal, invalid image URLs, old snapshots, message origin/window/nonce checks and storage failure. The parser was also checked against [public Spotify response recordings in Spotube's plugin](https://github.com/sonic-liberation/spotube-plugin-spotify/tree/3d1e83b74dce0ba8495f81c083d51d447d09c729/spotify_gql_client/src/commonTest/resources): 3 liked songs, 25 playlist tracks, 2 playlists, 1 album and 1 artist parsed successfully. The 25-track fixture represents only the first page of a 50-track playlist; it is not evidence of a complete live account sync. Synthetic regression fixtures contain no real account data. Fixture validation is not evidence of a successful Spotify login. The browser interface and import/refresh flow are tested separately; physical-device and real-account authentication remain unverified until the user completes the setup.

Primary references: [Userscripts installation](https://github.com/quoid/userscripts#installation), [Firefox Android extensions](https://support.mozilla.org/en-US/kb/find-and-install-add-ons-firefox-android), [Tampermonkey](https://www.tampermonkey.net/index.php?browser=firefox), [Spotify developer-mode changes](https://developer.spotify.com/documentation/web-api/tutorials/february-2026-migration-guide), [ListenBrainz import source](https://github.com/metabrainz/listenbrainz-server/blob/master/listenbrainz/troi/import_ms.py), [Troi serialization source](https://github.com/metabrainz/troi-recommendation-playground/blob/main/troi/playlist.py).
