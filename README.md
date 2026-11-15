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
- **Video clips:** Open the album-cover player → **Video**. When a matching YouTube music video is found, choose a 30-second clip or the full video. Music pauses while you watch. Public provider search can fail; choose a YouTube link as a fallback. Chosen links are saved on this browser. These are YouTube videos, not Spotify Canvas loops, and availability is not guaranteed for every track. No video downloads or background autoplay.
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
- Next-song audio is prepared in one bounded 16 MB memory buffer. Source selection no longer waits for a directory refresh. Data Saver and the preload setting disable speculative work. First-time playback still depends on external sources and cannot be guaranteed instantaneous.
- Install from this GitHub Pages URL in Safari using Share → Add to Home Screen. Existing iOS shortcuts may retain their old icon; add the new URL after transferring your library. Android/desktop use the browser install option.
- Canvas automatically plays a silent, short Spotify loop behind Now Playing while music continues independently. Choose Cover to turn loops off or Canvas to turn them back on. Songs without an available loop retain their artwork. Reduced Motion and Data Saver start with loops off unless you explicitly enable them.
- Source updates to `main` run checks and publish the static `dist` folder through `.github/workflows/pages.yml`. No server, paid AI API, Spotify password or token is stored in this repository.

## Canvas workaround

Spotify's public Web API does not offer Canvas. Spot+ uses the public [AuraMusic Canvas metadata service](https://github.com/TeamAuraMusic/AuraMusicCanvasServer) through a narrowly scoped Cloudflare Worker at `https://spot-plus-canvas.pwr97pnmkn.workers.dev/canvas`. This is an unofficial, availability-dependent integration. It matches a Spotify track ID, or the song title, artist, album and duration. No listener sign-in, developer app, Premium subscription, cookie or personal account token is sent. Lookup metadata goes to the bridge and AuraMusic; the video streams directly from Spotify's `canvaz.scdn.co` CDN. Disable Canvas to stop new lookups and video requests. Track matches can differ between releases, and many songs have no Canvas.

Only metadata is cached (24 hours for a match, one hour for a confirmed missing clip; at most 150 entries in the browser). Errors are not cached as missing clips. Loops are never placed in the offline audio cache. Lookup runs after opening Now Playing, never on the audio-start path. The video is muted, looping and inline; closing the player, opening lyrics/queue, switching to Cover or hiding the app releases it. Music pause freezes the loop. iOS power-saving or autoplay policies may require tapping Canvas.

The bridge source is in `canvas-bridge/`. It accepts bounded public music identifiers, permits only the fixed metadata service, validates the returned Spotify CDN URL, bounds upstream responses to 64 KB and uses an 8.5-second deadline. It forwards no request cookies or authorization headers and is not an open URL proxy. Deploy with Wrangler from that directory; no upstream secrets are required. The frontend remains on GitHub Pages. Cloudflare and the upstream service have their own availability and usage limits. No PC needs to stay on after deployment.
