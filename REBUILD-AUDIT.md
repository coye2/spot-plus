# Spot+ rebuild audit

Updated 14 November 2026. This records implemented behavior separately from provider limits and unverified device behavior.

## Reference and design

The original ZIP remains unchanged. The rebuild retains its browser-only JavaScript architecture: Deezer discovery metadata, Piped/Invidious audio matching, LRCLib lyrics, local library storage, and a service worker. It is not a port of the native Spotube application or its complete plugin system.

The live [Spotify Web Player](https://open.spotify.com/) was inspected in its signed-out desktop state on 14 November 2026. The saved reference shows the black outer canvas, rounded content panels, persistent top search, left library, artwork shelves, circular artist portraits, and bold/secondary typography. The implementation follows those patterns while using the user's requested AMOLED Winter Pine palette. Authenticated Spotify screens and physical-phone screenshots were unavailable, so exact parity with every Spotify account, region, native app, or experiment is not claimed.

Official mobile references were also checked: Spotify's [May 2025 navigation update](https://newsroom.spotify.com/2025-05-07/experience-a-new-dimension-of-music-discovery-with-more-controls-and-enhanced-tools/) places Your Library third and Create at bottom-right, matching Spot+'s navigation. Its [May 2026 update](https://newsroom.spotify.com/2026-05-28/playlist-folders-mobile-queue-controls-updates/) documents playlist folders on mobile. The [November 2026 Home demonstration](https://newsroom.spotify.com/2026-11-12/home-feed-updates/) shows compact artwork/title rows and a dark bottom action sheet over dimmed content. These are official promotional references, not measurements of a signed-in native app. Spot+ has the corresponding navigation and action-sheet structure, with the requested darker Pine surfaces. Home tile hiding and native playlist bulk selection shown in these updates are not implemented.

[Editable Figma file](https://www.figma.com/design/MxLyFnS7CwC5kG2GNV5gJh): main desktop/mobile flows, reusable components, color variables and text styles were created. The final Winter Pine colors/logo and Theme Studio additions have **not** been applied in Figma: the connector reached its Starter-plan quota, and the embedded viewer did not provide an editing route. The separate `SpotPlus-Figma-Design-Sync.zip` provides a prepared local-plugin update; it was syntax checked but has not run in Figma. The running app already includes Winter Pine.

## Requirement checklist

| Area | Implemented and checked | Limits / remaining work |
| --- | --- | --- |
| Desktop layout | Top search/navigation, resizable/collapsible library, shelves, track lists, menus, queue, persistent player | Follows observed Spotify patterns; not every proprietary screen is reproduced |
| Phone layout | Bottom navigation, mini/full player, bottom sheets, safe-area styles, portrait and landscape layouts | Browser viewport tests, not physical Android/iPhone tests |
| Discovery | Search, artist/album/playlist pages, recent listening, real catalog results, artist radio | Deezer catalog and radio; not Spotify's personalized recommendation engine |
| Spotify collections | Selected verified editorial and This Is links, official embeds, saved shared links | Not a complete mirror of all official playlists; embed restrictions are controlled by Spotify |
| Local library | Likes, playlists/editing, playlist folders with rename/pin/move/remove, saved albums, followed artists, filtering/sorting, local audio, backups | Folders have one level and organize Spot+ only. Stored per browser; backups exclude audio bytes and downloaded AI models |
| Playback | Play/pause/seek, previous/next, shuffle/repeat, queue editing, play next, sleep timer, lyrics, alternate matches, Media Session | Source availability governs full tracks; crossfade, gapless and equalizer are not implemented |
| Startup performance | Parallel source resolution, short-lived stream cache, next-song preparation, cancellation and race handling | Tests verify reuse avoids another resolver call; no universal latency guarantee |
| Themes | Winter Pine #1B5E46 logo/accent, AMOLED, six presets, custom colors, contrast adjustment, artwork shape, spacing/text/motion, save/load/import/export | Final Figma theme sync remains outstanding |
| DJ | Voice/typed requests, captions, playback commands, three bundled AI-generated hosts, simple preferences, optional local SmolLM2 request processing | Host speech uses short recorded responses; arbitrary conversation and spoken song names are not implemented. Browser microphone support varies. This is Spot+ DJ, not Spotify AI DJ |
| Free Spotify account | Beta phone companion, library review/import, manual refresh, metadata-only file fallback, separate read-only Spotify copy | Live sign-in/read has not been verified on either physical phone. No continuous or two-way sync |
| PowerShell setup | Opens hosted account setup; optional music-only Spotify-export preparation | Cannot remotely install a phone extension or complete the user's sign-in |
| Accessibility | Semantic buttons/labels, keyboard focus/shortcuts, reduced motion, larger text, theme contrast tests | No full assistive-technology certification |
| Deployment | Public GitHub Pages at https://coye2.github.io/spot-plus/ with automated checks and publishing | Library storage is separate from the previous private host; export/import a backup when moving |

## Verification evidence

Automated coverage includes player queue/race/cancellation behavior, local storage preservation, library projection, provider-cache reuse, DJ fallback, Spotify export parsing, companion pagination/completeness/account-switch protection, transfer validation, and theme contrast/validation. Additional backup tests cover restoring the Spotify copy, keeping newer or different-account data, and rejecting invalid snapshots before changing the library.

Browser interaction checks used actual controls. They covered playback of a full-length Invidious result, a Deezer preview and a local WAV; a real browser-model request; official embed rendering; artist-radio results; theme persistence; companion-file review/import/removal; and exporting/restoring a general backup containing the test Spotify library. Test fixture results establish the import and storage behavior, **not successful Spotify authentication**. The added theme check saved compact spacing, larger text and reduced motion, changed all three, then loaded the saved theme and verified restoration.

Folder checks exercised creation, adding a local playlist and saved Spotify link, persistence after reload, folder search, rename, pin, creating a playlist inside a folder, moving it out, and removing the folder while retaining its playlists. This also exposed and fixed the Create menu's missing action data, which prevented its playlist/import dialogs from opening. Automated folder tests cover backup restoration, preserving newer organization during merges, failed writes, invalid moves, duplicate membership and missing-playlist counts.

Screenshots are supplied beside the source in `outputs/screenshots/`: the Spotify desktop reference, desktop/phone views, phone landscape, DJ, official embed, Theme Studio and account setup. Figma screenshots show the earlier design state. The account screenshots show setup or clearly named test data, not a connected real account.

## Remaining external verification

The mobile update adds a contained app shell, elastic edge motion, iOS safe-area handling, a brief splash, first-launch Spotify setup, install icons, and bounded next-song audio preparation. A simulated 390 × 844 iPhone viewport with 47 px top and 34 px bottom insets stayed within the viewport. This is a layout test, not physical-device proof.

Observed full-track startup was 4,032 ms on a cold local session and 859 ms on a later queued track on GitHub Pages. These are two observations, not a controlled speed comparison or an instant-playback guarantee. External source health still matters.

DJ voices now ship as 42 small MP3 clips (about 1.6 MB total), generated using Supertonic 3. The old device-voice/Kokoro selectors were removed. Optional language-model controls are tucked under general Settings, separate from host choices. Automated checks cover voice cancellation, volume restoration, microphone dispatch/denial, bundled asset completeness, source-directory latency and bounded audio preloading.

Spotify Canvas is not exposed through the public Web API and is not available for every song. Official Canvas video playback has not been added. No substituted video is labeled as Spotify Canvas.

1. On iPhone Safari + Userscripts and Android Firefox + Tampermonkey, install the companion from the setup page, sign in on Spotify, and try **Read library**. Verify pagination, direct/file handoff and refresh against the actual library. The companion uses Spotify's changing web interface, so real account results may require adjustments.
2. Apply the prepared Figma plugin update in an editable Figma session, then inspect the final desktop/phone frames.
3. Check physical-phone background playback, installation, local-model memory use and browser download behavior.

Spotify Connect, Jam, Blend, proprietary personalized radio/AI DJ, licensed Spotify audio and Premium entitlements are not supplied by this architecture. These are documented as unavailable, rather than represented by fake working controls.
