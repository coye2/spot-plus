# Spot+ · Winter Pine

An installable music web app with Spotify-inspired desktop and phone navigation, true-black AMOLED surfaces, and a deep winter pine accent (`#1B5E46`). The supplied Spot+ logo has been recolored to match. The original ZIP is unchanged.

## Use it

Open [Spot+](https://coye2.github.io/spot-plus/) on your phone or computer. Listening and optional AI run in the browser, so a PC does not need to remain on. Your library stays in that browser. Use Settings → Export backup when moving devices.

- **Theme Studio:** Profile → Theme Studio, or Settings → Appearance. Six color worlds, custom accent/surface/control tints, AMOLED, corner shape, circular artwork, density, text size, reduced motion, session undo, saved themes, and theme import/export. Surface tints stay dark and foreground contrast adjusts automatically.
- **Playlist folders:** Create → Create a folder. Add existing local or saved Spotify playlists, create a playlist inside a folder, rename/pin folders, and move playlists through their options menus. Library search also finds playlists inside folders. Removing a folder keeps its playlists. Folders are included in backups and organize Spot+ only; they do not write to Spotify. One folder level is supported.
- **Spotify collections:** Home, Search, Create, or Settings. Selected verified Spotify editorial and This Is playlists, plus any supported shared Spotify playlist/album/artist/track URL. Spotify's official embed owns its playback, queue, preview/sign-in restrictions, and availability.
- **Spotify account companion (beta):** Settings → Spotify account. A browser-side userscript reads a signed-in free Spotify account's Liked Songs, playlists, saved albums and followed artists. Safari + Userscripts on iPhone; Firefox + Tampermonkey on Android; Chrome/Edge/Firefox + Tampermonkey on computers. The device-specific three-step setup opens Spotify for your normal sign-in, reads the library, and sends it back for review when the browser permits. A user-started refresh replaces the separate Spotify copy, with a file fallback when browsers isolate tabs. Credentials stay on Spotify. See [setup, privacy and verification limits](ACCOUNT-CONNECTION.md). Real account/device sign-in is not yet verified.
- **Artist radio:** Artist page → Radio or Featuring artist. Playable Deezer artist-radio mixes in Spot+. Verified This Is links appear for Tame Impala, Drake, and Taylor Swift; other artists have Deezer essentials and a Spotify search link.
- **Spotify library import:** Spotify collections → Get my Spotify data. Request **Account data**, then import the downloaded ZIP or YourLibrary.json/Playlist*.json. Review counts before merging. Processing happens locally in a worker. Existing music is preserved; re-import merges additions. Imported metadata is matched to the selected audio provider when played.
- **DJ:** Speak or type requests; playback commands use the real queue. **Enable live DJ** adds dynamic conversation and newly synthesized speech in the selected host voice, with After Hours (deep, relaxed M3) as the default. A one-time download is about 600 MB; subsequent sessions reuse cached models. No paid AI service or running PC is needed. The tiny local conversation model can misunderstand or produce weak answers; it is not Spotify's proprietary DJ. English is supported. Device memory and speed determine whether live mode runs comfortably. Without live mode, music requests and text feedback still work. Three small host auditions are the only recorded speech. Browser recognition can use its speech service; the language model and speech synthesis run on the device.
- **Video loops:** Open the full player → **Loops**. Spotify Canvas is tried first; matching music-video footage is the fallback. Loops are muted and independent of the song. Full-frame H.264 up to 720p avoids the old portrait crop. Choose **Cover** to turn them off. Availability depends on each recording and provider.
- **Player:** Play/pause/seek, next/previous, shuffle, repeat, editable queue, play next, sleep timer, lyrics, alternative audio matches, saved tracks/albums/artists, local playlists and audio files, downloads where providers permit them, and browser Media Session controls. Swipe down on the artwork or top handle to dismiss the phone player; short drags snap back.

## Spotify setup with PowerShell

From this project folder, use the connection helper or the optional export helper in PowerShell:

```powershell
.\scripts\Setup-SpotifyConnection.ps1
.\scripts\Setup-SpotifyLibrary.ps1 -RequestData
.\scripts\Setup-SpotifyLibrary.ps1 -SpotifyExport 'C:\Downloads\my_spotify_data.zip'
```

`Setup-SpotifyConnection.ps1` opens the hosted account setup page. It cannot install extensions or finish your sign-in. `Setup-SpotifyLibrary.ps1` without arguments opens a file picker; `-RequestData` opens Spotify's data-request page. The export helper converts only music metadata from selected ZIP/JSON files to a Spot+ import file, without extracting the ZIP. It never asks for passwords, cookies, or tokens and does not change execution policy. Spotify controls sign-in and export preparation. Import the resulting JSON in Spot+. Direct ZIP import also works on phones; this helper is optional.

## Run and maintain

Node.js is needed only for local development, checks, and packaging:

```sh
npm ci
npm run dev
npm run check
npm run lint
npm test
npm run build
```

Local preview: `http://127.0.0.1:8080`. Serve `dist/` over HTTPS for installation/offline support. No build-time secrets or paid AI API keys are required. The original pure-JavaScript architecture is retained; there is no TypeScript compiler stage.

## Architecture and performance

Metadata and audio remain separate, following the same broad idea as Spotube. This is a browser implementation, not the current native Spotube codebase or its complete plugin architecture. Deezer provides discovery metadata, Piped/Invidious instances resolve matching audio, and LRCLib provides lyrics. Spotify embeds and local export imports supplement that flow.

The resolver races providers, remembers working sources and selected matches, reuses successful resolutions briefly, and prepares the next queued song while the current song plays. Preparation is optional and skipped on data-saving/2G connections. Tests confirm prepared songs avoid a repeated resolver request. Public-server health still determines actual startup time; universal instant playback is not promised.

## Verification and limits

Automated tests cover queue persistence/races, cancellation, shuffle removal, storage failures, imports, theme validation/contrast, stream-cache behavior, account-reader pagination and transfer validation. Run the commands above for current results.

See [the rebuild audit](REBUILD-AUDIT.md) for the requirement-by-requirement result, reference evidence, and remaining external verification.

Browser checks covered desktop, iPhone/Android-sized layouts, phone landscape, theme persistence, real Deezer previews, one full-length Invidious stream, local WAV playback, an actual local-model request, official Spotify embed rendering, export import, and a 50-track artist-radio list. These were browser tests, not physical iOS/Android device tests.

The Spotify export import is **not account login**. The new browser companion provides an experimental one-way account-library refresh using Spotify's changing web interface; it needs real-account and physical-phone verification. No continuous background or two-way Spotify sync, automatic full official-playlist mirror, Connect, Jam, Blend, or Spotify's proprietary AI DJ is implemented. Saved Spotify album/artist entries open the official player rather than mirroring their tracks. Spotify embeds may offer previews only. Crossfade, gapless playback, and an equalizer remain future work. Browser/OS restrictions can affect background audio, downloads, installation, and audio-output controls.

Editable Figma designs were created for the main desktop and phone flows. The connection reached its Starter-plan call quota before the last Winter Pine/theme additions could be applied. The separate `figma-design-sync` package provides a local plugin workaround; its syntax was checked, but it has not been executed in Figma.

## Code and licenses

- `js/app.js`: views, navigation, menus, theme/import UI.
- `js/api.js`, `js/player.js`: metadata, audio matching, playback and downloads.
- `js/store.js`, `js/library.js`: library, preferences, backup and projections.
- `js/dj.js`, `js/local-model.js`, `js/model-worker.js`: lighter and browser-AI DJ.
- `js/themes.js`, `css/themes.css`: Winter Pine and Theme Studio.
- `js/spotify*.js`: official embeds, URL validation, bounded export import.
- `sw.js`: cached app shell; audio and model caches remain separate.
- Inter license: `fonts/LICENSE.txt`. fflate license is included in `js/vendor/`.
- Host recordings: `audio/dj/NOTICE.txt`, with Supertonic model/code license notices. Only rendered clips ship; no voice model or runtime download is needed. Host voices are AI-generated and do not impersonate Spotify's DJ.

## References checked during this rebuild

- [Spotify Web Player](https://open.spotify.com/) — live desktop reference, 14 November 2026.
- [Spotify mobile playlist-folder update](https://newsroom.spotify.com/2026-05-28/playlist-folders-mobile-queue-controls-updates/) — 28 May 2026.
- [Spotify mobile Home controls](https://newsroom.spotify.com/2026-11-12/home-feed-updates/) — official promotional mobile demonstration, 12 November 2026.
- [Spotify embeds](https://developer.spotify.com/documentation/embeds/tutorials/creating-an-embed).
- [Understanding your Spotify data](https://support.spotify.com/us/article/understanding-your-data/).
- [Spotify API migration guide](https://developer.spotify.com/documentation/web-api/tutorials/february-2026-migration-guide).
- [Spotube source](https://github.com/team-spotube/spotube).
- [Transformers.js](https://huggingface.co/docs/transformers.js).

## Mobile release and GitHub Pages

- App-style scroll containment, restrained elastic edges, reduced-motion support, iPhone safe areas, a short startup splash and the supplied Pine logo for installation. iOS may override zoom restrictions for accessibility.
- First launch offers Spotify setup, exploring first, or importing a Spot+ backup. To move from the previous hosted app, export a backup there and import it here; browser storage is separate for each site. Downloaded audio and AI models are not included in library backups.
- Next-song audio is prepared in one spare native audio element. It is handed directly to the player even when only the beginning is buffered. Data Saver and the preload setting disable speculative work. First-time playback still depends on external sources and cannot be guaranteed instantaneous.
- Install from this GitHub Pages URL in Safari using Share → Add to Home Screen. Existing iOS shortcuts may retain their old icon; add the new URL after transferring your library. Android/desktop use the browser install option.
- Loops automatically plays Spotify Canvas first, then a matching music-video excerpt if Canvas is missing or unavailable. Music continues independently. Choose Cover to turn loops off or Loops to turn them back on. Reduced Motion and Data Saver start with loops off unless you explicitly enable them.
- Source updates to `main` run checks and publish the static `dist` folder through `.github/workflows/pages.yml`. No server, paid AI API, Spotify password or token is stored in this repository.

## Canvas workaround

Spotify's public Web API does not offer Canvas. Spot+ uses the public [AuraMusic Canvas metadata service](https://github.com/TeamAuraMusic/AuraMusicCanvasServer) through a narrowly scoped Cloudflare Worker at `https://spot-plus-canvas.pwr97pnmkn.workers.dev/canvas`. This is an unofficial, availability-dependent integration. It matches a Spotify track ID, or the song title, artist, album and duration. No listener sign-in, developer app, Premium subscription, cookie or personal account token is sent. Lookup metadata goes to the bridge and AuraMusic; the video streams directly from Spotify's `canvaz.scdn.co` CDN. Disable Canvas to stop new lookups and video requests. Track matches can differ between releases, and many songs have no Canvas.

Only Canvas metadata is cached (24 hours for a match, one hour for a confirmed missing clip; at most 150 entries in the browser). Errors are not cached as missing clips. Loops are never placed in the offline audio cache. Lookup runs after opening Now Playing, never on the audio-start path. The video is muted, looping and inline; closing the player, opening lyrics/queue, switching to Cover or hiding the app releases it. Music pause freezes the loop. iOS power-saving or autoplay policies may require tapping Loops.

When Canvas is absent, the same public Invidious/Piped architecture searches for matching music videos or visualizers. Matching checks title and artist and rejects unrelated songs, covers, lyric/static-audio uploads and unrequested live/remix versions. The fallback selects H.264 up to 720p/30fps (480p on slower connections; 360p with Data Saver), then repeats an eight-second excerpt past the opening. It is labelled **Music video loop**, with a link to the source video. Matching sends public song/artist metadata to the video providers; video bytes come from the selected media host. Matches remain in memory for five minutes (30 entries maximum). Lookup has a 12-second deadline, and failed video loading can try another source with bounded retries. Video waits until music is playing with eight seconds buffered (or buffered to its end), and yields when music needs data. Missing matches leave the cover visible. Physical iOS/Android devices still need verification beyond browser layout checks.

## November 15: playback, color and Rewind

- Audio candidates match artist, title, edition and duration. Compatible formats are ranked across AAC/Opus. A four-request pool advances through up to ten Invidious and ten Piped servers plus matching verified, publicly streamable Audius releases; gated releases are excluded. Direct media links avoid broken relay paths. Alternate formats, relay URLs and provider retries recover failures; stalled media retries after eight seconds. Public services cannot guarantee every recording, the best mastering, or zero-latency cold starts.
- Next-song preparation starts after the current song has 12 seconds buffered. The same native element is reused on Next, with stale-event protection and cancellation. No full-file Blob download is required before playback starts.
- Player and lyrics colors come from a small artwork sample with readable white text. Canvas frames update colors every four seconds when pixel access is permitted; inaccessible video uses artwork. Browser chrome and the top safe area track the theme or mobile player. The actual cover stays in Media Session. iOS/Android control lock-screen and notification tint; a PWA cannot force it.
- The mobile player options sheet now sits above the player and restores focus when closed.
- **Your Rewind:** Home or Profile → Your Rewind. Spot+ records actual media progress, excluding seeks and paused time. Import Spotify Streaming History or Extended Streaming History JSON/ZIP for account history by month/year/source, minutes, 30-second plays, rankings and monthly bars. Processing and IndexedDB storage stay on-device. Export Rewind separately; the general library backup excludes history. Identical imports deduplicate. Use one export format for overlapping periods to avoid precision-related overlap. The library companion does not automatically supply listening history.
- **Spotify counters:** Public artist pages provide monthly listeners and featured-track play totals. A credential-free Worker caches whitelisted numbers for six hours. Wikidata maps Deezer to Spotify artist IDs only when unique. Song matching across catalogs also checks exact title and duration. Many songs lack a public count, and some artists lack a mapping; missing figures stay unavailable. Deezer fans are labelled separately. This is independent Spot+ Rewind, not Spotify Wrapped.

Individual desktop-browser observations: Blinding Lights started in **554 ms** locally and **5.34 seconds** on a fresh live-site check; a repeat start took **220 ms** and prepared Next to The Hills **10 ms**. A 1280×720 muted loop played independently, and real monthly listeners and song totals appeared. These are samples on this connection, not benchmarks or phone guarantees. Rewind import/filter checks used a separate local fixture; production has no seeded statistics.

Research: [native media preload](https://web.dev/articles/fast-playback-with-preload), [WebKit media policies](https://webkit.org/blog/6784/new-video-policies-for-ios/), [Audius API](https://docs.audius.co/api/), [Spotify exports](https://support.spotify.com/article/understanding-your-data/), [Media Session metadata](https://developer.mozilla.org/en-US/docs/Web/API/MediaMetadata).

The bridge source is in `canvas-bridge/`. It accepts bounded public music identifiers, permits only the fixed metadata service, validates the returned Spotify CDN URL, bounds upstream responses to 64 KB and uses an 8.5-second deadline. It forwards no request cookies or authorization headers and is not an open URL proxy. Deploy with Wrangler from that directory; no upstream secrets are required. The frontend remains on GitHub Pages. Cloudflare and the upstream service have their own availability and usage limits. No PC needs to stay on after deployment.

## November 15: release polish

- **Jam:** listen together in real time. Start a Jam from Create or Connect, share the code, link or QR code; listeners follow the host on their own phones, add songs and (if allowed) play, pause and skip. **No server and no accounts:** devices meet on several public Nostr relays at once using throwaway keys and ephemeral (never stored) events, and every message is end-to-end encrypted with AES-GCM using a key derived from the Jam code (`js/jam-mesh.js`). The host's device runs the room.
- **Search by lyrics:** type a line you remember. Candidates come from the bridge (`/lyrics-search`, Genius) or YouTube lyric videos, then each is verified against its real lyrics (LRCLIB) and shown with the matching line.
- **Canvas, Spotify-style:** loops fill the whole player in portrait on phones. Clips for the current and next two songs are downloaded ahead and kept on the device (`js/canvas-cache.js`), so they start instantly; music-video loops use up to 1080p on fast connections.
- **Themes:** Light, Dark and Auto modes; 19 presets including Material-style tonal palettes and light themes. Status bar and browser chrome follow the theme.
- **Artist pages** match Spotify mobile (full-bleed photo, monthly listeners, Popular, Popular releases, Fans also like, About). Profile pictures follow your Spotify photo.
- **Speed:** catalog pages are cached on the device and refreshed in the background; artists/albums start loading on touch; the production build minifies every module, merges all CSS into one file and preloads the startup modules.
- **First-launch tutorial** (also shown on the first launch from the Home Screen), simpler DJ screen, two-step setup on iPhone, Android and computer, and a full copy pass.
- Fixed the black strip under the tab bar on iPhone (the layout no longer sizes itself from `visualViewport`).

### Deploy the bridge (optional: faster lyrics search)

From `canvas-bridge/` with Node installed:

```
npx wrangler login
npx wrangler deploy
```

Check `https://<your-worker>.workers.dev/health` shows `"lyrics":true`. Without it, lyrics search uses YouTube lyric videos instead.

## November 15 (later): automatic Rewind and serverless Jam

- **Rewind is fully automatic.** Spot+ creates a private link key and passes it to the Spotify helper once (in the connection link's `#fragment`, which never reaches Spotify). From then on, whenever Spotify's website is open in a browser with the helper (any device), it publishes an encrypted, compressed snapshot of your top tracks/artists (4 weeks, 6 months, all time) and last 50 plays every 30 minutes to several public Nostr relays as a NIP-78 replaceable event (`js/relay-sync.js`). Spot+ fetches the newest on launch and when you return to the app (about 1 second), merges it with your Spot+ listening, and adds the recent plays to your history, so Rewind keeps growing with no files. Relays store only ciphertext.
- **Rewind is instant:** listening history stays in memory, is preloaded at idle, and artwork fills in after the page appears.
- **Play your Rewind:** a full-screen story (minutes, top genre, top artist, top songs, listening personality, streak) with the #1 song's preview playing softly, ending in a shareable 1080×1920 image.
- **Jam needs no server and no account.** It now runs over the same public relay network with throwaway keys and ephemeral events; messages are end-to-end encrypted (AES-GCM, key derived from the Jam code), and the host's device runs the room (`js/jam-mesh.js`). Verified live: join in under 2 s, track changes reach listeners in about 0.3 s.

## November 15 (evening): Spotify links, no login

Spotify publishes each listener's taste as personal playlists that anyone with the link can view (On Repeat = most played lately, Repeat Rewind, Your Top Songs YYYY, daylist, Discover Weekly…) and a public profile (name, photo, public playlists). Users paste those links once (Share → Copy link in the Spotify app, any device). The bridge's `/spotify-public` endpoint reads only those two public page types (`canvas-bridge/spotify-public.js`); Spot+ re-reads them every few hours (`js/spotify-links.js`), keeps a daily snapshot of On Repeat, and builds Rewind from the snapshots: last 4 weeks = current On Repeat (with movement vs the previous snapshot), 6 months = rank-weighted snapshots, all time = snapshots + yearly Top Songs, plus daylist moods. Home gets "Made for you" and "Your Spotify playlists"; linked playlists open at `#/linked/<id>` and play in Spot+. No login, no helper, no Spotify API quota. The helper remains optional for Liked Songs, and `js/lastfm.js` is ready for an optional Last.fm connection once an API key is added.

Deploy the bridge once after this update (`npx wrangler deploy` in `canvas-bridge/`); `/health` should show `"spotifyPublic":true`.
