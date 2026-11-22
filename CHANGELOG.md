# Changelog

Every Spot+ update. The app shows the newest ones in its “What’s new” screen.

## 2.2.0 — Spotify — Official Playback & preview streaming fixes
_2026-11-21_

- Added Spotify — Official Playback in Audio sources using standards-compliant OAuth 2.0 PKCE (zero client secrets in browser bundles), official Spotify Web Playback SDK on supported EME browsers, and Spotify Connect remote control for Premium accounts — with truthful availability badges and automatic fallback to Spot+ YouTube Relay.
- Added a dedicated Cloudflare Worker control-plane service (workers/spotify-relay) with per-user & per-IP rate limiting, request coalescing, circuit breaker, bounded retries, short-lived metadata URI resolution, and strict refusal of unauthorized DRM audio proxying.
- Fixed preview-mode audio streaming so relay URLs resolve to the live browser origin without stale service-worker cache interference, defaulted audio-reactive visualizers to off so opening Now Playing never interrupts iOS playback, and prevented Now Playing cover art from overlapping the header on compact viewports.

## 2.1.0 — Spot+ UI, Audio Studio & Live Visualizers
_2026-11-20_

- New Interface Style switcher right inside Theme Studio and Settings: switch live between Original Spot+ and the redesigned Spot+ UI (Liquid Glass floating tab bar, frosted mini-player pill, fluid artwork Now Playing canvas, pause-shrink artwork spring, morphing lyrics header, and centered glass album & playlist headers) with zero page reload and uninterrupted audio playback.
- All 33+ color themes, AMOLED, Light/Dark/Auto/Clear modes, and custom wallpapers work across both interfaces, alongside new customization controls for player background style, glass intensity, blur radius, artwork roundness, typography pairing, animation feel, tab labels, hold-for-2× speed preview, and double-tap artwork seek.
- Audio Studio (Parametric EQ, AutoEq Headphones & DSP): 10-band configurable parametric equalizer with live frequency response curve and custom presets, searchable AutoEq headphone correction database (65+ models + ParametricEQ.txt importer), and toggleable Web Audio DSP (Master Preamp, Loudness Normalization, Dynamics Compressor, True-Peak Limiter, Sub-Bass Warmth, Mid/Side Stereo Width, Headphone Crossfeed, and Channel Balance) alongside existing Speed, Pitch, Reverb, Lo-Fi, 8D, and Vocal Remover effects.
- Upgraded Synced Lyrics: genuine enhanced LRC word-by-word highlight support when timestamps exist (falling back cleanly to line sync without fabricating word timings), progressive soft-focus blur on surrounding lines, configurable Bluetooth timing offset (−200 to +600 ms), adjustable lyrics font size, and cached client-side bilingual/translated lyrics.
- Real audio-reactive Music Visualizers (Fluid Hills, Spectrum Bars, Waveform, Ambient Glow, Artwork Glow, Minimal) driven by a real Web Audio AnalyserNode, plus selectable song-mix fade curves (Equal-Power, Smooth S-Curve, Linear).

## 2.0.7 — Song Mix & stutter-free playback
_2026-11-20_

- Spotify-style Mix right on every playlist and Now Playing: tap Mix to blend songs smoothly with Smart Mix, DJ Blend (equal-power crossfade with bass-swap EQ), or Smooth Fade (2–12 s) — now working on iPhone and iPad too via hardware-timed Web Audio transitions.
- One-tap Mix this playlist, Smooth-order Up Next (spaces out back-to-back tracks by the same artist), and Start song mix on every track, including synced Spotify songs.
- Eliminated audio stuttering: stopped buffering progress events from re-rendering the UI on every chunk, fixed buffer headroom math so the next song waits until the playing song has a real buffer, removed main-thread reverb pre-generation spikes, throttled Canvas color sampling, added zero-gap slice lookahead in the audio relay, and fixed iOS silent-unlock CSP.

## 2.0.6 — Fewer server requests
_2026-11-20_

- Spot+ hit the free server plan’s daily limit (100,000 requests) after a busy day. Each song now asks the servers about half as often: one backup region instead of all of them, the next song warmed in one region, region checks twice a day, and counters remembered on your device.
- If the daily limit is ever reached again, Spot+ says so once with the time music is back, and stops retrying in the meantime.

## 2.0.5 — Open Spotify links, smarter search, a more personal home
_2026-11-20_

- Open Spotify links in Spot+: paste a song, album, playlist or artist link into search (or anywhere in the app) and it opens and plays here. On Android you can also share a Spotify link straight to Spot+ from the share sheet.
- Search suggests as you type: your recent searches, artists whose name starts with what you typed (with photos) and songs, with arrow keys and Enter on a computer.
- Search filters go deep: Songs shows up to 100 songs, and Artists and Albums show a full grid instead of a single row.
- Home greets you and starts with eight tiles of your own music (Liked Songs, your mixes, your playlists, what you just played), then adds Your top artists and Because you listen to… rows.

## 2.0.4 — Share songs
_2026-11-20_

- Share from the ⋯ menu in the player (and on any song): a Spot+ card made for stories, with the album art, the song and the Spot+ logo; the song’s Spotify link; or a Spot+ link that opens it right in Spot+.
- On a phone the card goes straight to the share sheet (Instagram, Messages, Discord…); on a computer it’s saved as a picture.

## 2.0.3 — Smooth Snake
_2026-11-20_

- The snake glides between squares instead of jumping, keeping an even rhythm, and each bite pops in with a little bounce.
- The snake reads like your queue: the song playing now is the head, the next songs follow, and every song you eat joins the tail.

## 2.0.2 — Snake controls on iPhone
_2026-11-20_

- The arrow buttons turn the snake the moment you touch them, and no longer select text or bring up the copy menu.
- Swipe anywhere on the screen to turn, not just on the board.

## 2.0.1 — Snake, for everyone
_2026-11-20_

- Play Snake from Up next: the snake is made of your songs’ covers. The head is the song playing now, every bite is the next song in your queue, and the snake grows one cover at a time.
- Works on every device: swipe or use the buttons on a phone, arrow keys or WASD on a computer, space to pause. It speeds up as you grow and remembers your best score.
- When the game ends you see the songs you ate, and one tap plays them as a queue.

## 2.0.0 — Spot+ 2.0
_2026-11-20_

- Instant playback: the next song is made ready in every relay region while you listen, so skips start in about a fifth of a second, and a tap asks every region at once instead of one by one.
- Spotify, made simple: connect with two links in a minute, or bring your whole library with a clear three-step guide for iPhone, Android and computers, with check-offs and one-line fixes.
- Artist pages that match Spotify: their photo, exact monthly listeners, popular songs with play counts, full discographies, related artists and bio.
- Fourteen new themes: Aurora, Midnight Rose, Golden Hour, Nebula, Tidal, Matcha, Sakura Night, Espresso, Neon City and Arctic, plus Linen, Mint, Lavender and Sky in light mode.
- Rate Spot+: a quick five-star rating that asks rarely, at a good moment, and never on your first days. The live rating sits beside the listener and install counters in Settings.
- Polish everywhere: cover photos for playlists, adding songs to your Spotify playlists, deeper playlist search with playlists built for you, desktop drag-to-scroll rows, clickable artists in the player, and new background sources.

## 1.9.64 — Spotify-accurate artists, deeper playlists, new backgrounds
_2026-11-20_

- Artist pages now look and read like Spotify’s: Spotify’s photo, the exact monthly listener count, Spotify’s popular songs with play counts, Fans also like, Appears on, the artist’s playlists and their bio.
- Full discographies: every release is shown (guardin has 124), with Popular releases, Albums, Singles and EPs, and Compilations, and a Show all page. Releases only on Spotify are added too.
- Artists who aren’t matched to Spotify automatically can be linked once: ⋯ → Link their Spotify page.
- Desktop: clicking the artist in the player opens their page (and the song title opens the album), even for songs from Spotify or YouTube.
- Desktop: drag any row of cards sideways with the mouse. A drag no longer opens the card it started on.
- Playlist search goes much deeper (dozens of playlists, closest matches when none has every word), and any search can become a playlist Spot+ builds for you.
- Spotify playlists show who made them, with their photo. Blends and shared playlists show who added each song (sync your Spotify library again to get this).
- Backgrounds: search also covers Wallhaven and Openverse, and you can add any picture from a Pinterest pin or a Google Images result by pasting its link. Those are kept under From your links.

## 1.9.63 — Playlist photos, and adding to your Spotify playlists
_2026-11-20_

- Give any playlist your own cover photo: tap the photo button on a playlist (your own or a Spotify one you synced) and choose a picture. It’s cropped square and shown everywhere in your library.
- You can now add songs to the Spotify playlists you synced, not just to Spot+ playlists. They’re kept in Spot+ at the end of the playlist (Spotify itself isn’t changed) and stay through refreshes. Remove one from its ⋯ menu.

## 1.9.62 — Instant playback
_2026-11-20_

- The next song is made ready in every relay region while the current one plays, and plays from the first region that has it: songs after the first now start in about 0.2 seconds (measured: Blinding Lights and Pilula went from 8 seconds to 0.2).
- Tapping a song asks all the relay regions at once and plays from whichever answers first, instead of trying them one after another (a refusal used to cost 2 to 4 seconds per region). Measured cold taps: mostly 0.5 to 2 seconds.
- Automatic no longer lets Monochrome start a song before YouTube Relay has had its chance. When every region refuses a song, the backup starts right away instead of after 15 to 20 seconds of retries.
- A refusal is remembered for that song and region only, so one blocked song no longer sidelines a region for the songs after it.

## 1.9.61 — The relay tries other uploads before the backup
_2026-11-19_

- YouTube refuses some uploads of a song from a server while letting others through (measured live: Levitating’s official upload was refused everywhere, but two of its other uploads played from Europe). The relay server now tries up to three other uploads of the song itself, in the same request, before Spot+ falls back to Monochrome.
- The rest of a song always comes from the same upload that started playing, so it never jumps or glitches mid-song.

## 1.9.60 — YouTube Relay goes through Europe first
_2026-11-19_

- Measured live: YouTube let 8 of 10 songs through from Spot+’s European server, against 2 of 10 from the US ones. Songs now ask Europe first, then the other regions, and each phone learns which region works best for it.

## 1.9.59 — Spot+ YouTube Relay in three regions
_2026-11-19_

- Only relay regions that are actually running are used, so a missing one never costs a try.
- YouTube refuses servers in bursts, one address at a time. Spot+ now has relay servers in three regions; when one is refused, the song is asked again through another (each only takes about two seconds to give up), so far more songs come from YouTube instead of the backup.

## 1.9.58 — YouTube Relay waits out refusals
_2026-11-19_

- YouTube refuses the Spot+ server in short bursts that hit every request at once, so asking many times in parallel didn’t help. The server now spreads its tries over about five seconds, which gets through most bursts.
- In Automatic, if YouTube still says no, the song switches straight to the backup (already looked up) instead of trying YouTube a second time.

## 1.9.57 — YouTube Relay asks smarter, backup switches fast
_2026-11-19_

- The Spot+ server now asks YouTube several times at once for every song, each time as a different visitor, and uses the first answer that works. Refusals that used to cost seconds (or the song) now rarely matter.
- The backup source is looked up while YouTube is being asked, and for the next song ahead of time, so when YouTube says no the song switches over in about a second instead of a long wait.

## 1.9.56 — Far fewer skipped songs
_2026-11-19_

- When YouTube refuses a song, Spot+ now keeps trying (up to four times, rotating between uploads and pausing a moment before asking again) instead of giving up after two quick tries. Then HiFi / Monochrome takes over before a song is ever skipped.

## 1.9.55 — Lock screen skips songs, cleaner home and search
_2026-11-19_

- Lock screen and Control Center now show previous / next song buttons instead of 10-second skips.
- Fixed daylist, On Repeat and Discover Weekly not opening.
- Search: a famous artist wins a short search (“just” → Justin Bieber, with his songs beside him), even the first time you search.
- Cleaner home: Your Rewind moved into Made for you, the live counter is off the home screen, and one holiday shelf at a time.

## 1.9.54 — The backup source actually works now
_2026-11-19_

- Fixed HiFi / Monochrome never playing: its search couldn’t be read from a browser at all, so when YouTube refused a song there was no backup. The Spot+ server now relays it, and those songs play in lossless quality instead of being skipped.

## 1.9.53 — A real backup when YouTube says no
_2026-11-19_

- When YouTube refuses a song, Automatic now plays it in lossless quality from HiFi / Monochrome, which iPhone can now play. Before, these songs were skipped.
- Automatic moves to the backup after two refused YouTube uploads instead of three, so you wait less.

## 1.9.52 — Smarter search, better Up next, a livelier home
_2026-11-19_

- Search shows a Top result and puts artists first: type “just” and Justin Bieber comes up, type a song title and the song does. Results appear as you type.
- Up next keeps playing your music: songs you have on repeat and songs from your library by the same or similar artists, mixed with similar songs.
- Home: a daylist that changes through the day, On Repeat, Discover Weekly (every Monday), Release Radar with new music from your artists (every Friday), and holiday playlists.
- Fixed songs being skipped as unavailable: 1.9.51 stopped trying YouTube after a couple of refusals, but the other sources often can’t play on iPhone. Each song now tries three YouTube uploads again.

## 1.9.51 — No more songs stuck at 0:00 when YouTube blocks Spot+
_2026-11-19_

- When YouTube starts refusing the Spot+ server (it does after a while), Automatic now notices after two songs and plays from its other full-song sources for a few minutes, then tries YouTube again. Before, every song sat at 0:00 for up to a minute.
- A refused song moves on after two uploads instead of three.

## 1.9.50 — Fewer songs stuck at 0:00
_2026-11-19_

- Spot+ YouTube Relay now asks YouTube once per song instead of twice. The extra check could pass while the song itself was refused, leaving it stuck at 0:00.
- When YouTube refuses every upload of a song in Automatic, Spot+ now switches to another full-song source instead of skipping the song.

## 1.9.49 — Pause works again, and whole songs from the relay
_2026-11-19_

- Fixed pause: the screen could say paused while music kept playing and the button couldn’t stop it. Pausing now stops every player, and a tap while that happens stops the music.
- Fixed songs from Spot+ YouTube Relay stopping after a fraction of a second: the server cut its own audio stream right after it started.
- Songs YouTube refuses now fail in about 2 seconds instead of 10–15, so Spot+ moves to another upload much sooner.
- Fixed the relay giving up on many songs with a “too many requests” error from Cloudflare.
- The relay asks YouTube as a second app when the first is refused (the version Metrolist uses), so more songs play.
- Now Playing shows “Spot+ YouTube Relay” instead of the server address. Tap it for playback details: server, format, which upload played and why.
- Audio source list cleaned up: Spot+ YouTube Relay, Automatic, HiFi / Monochrome, JioSaavn and Audius (SoundCloud once it’s set up). Piped, Invidious, YouTube player and Deezer previews are gone; if you used one, Spot+ switches you to the closest option.
- Song matching now also tells apart demos, radio edits and extended mixes.

## 1.9.48 — Spot+ YouTube Relay: full-song integrity and iPhone playback
_2026-11-19_

- Spot+ YouTube Relay validates complete upstream audio byte ranges, detects truncation, and avoids accidentally treating a cut-off recording as a completed song.
- Improved iPhone seeking and mid-track continuation, including Safari suffix ranges and safe signed-link refreshes.
- Shows the recording timeline from actual YouTube duration metadata instead of guessing from fragmented audio size, and rejects seriously mismatched recordings.
- Quicker skip cancellation and relay-only source selection, with playback-health reporting and more regression tests.

## 1.9.46 — Lock screen skip, background auto-next, and polished wallpaper cards
_2026-11-19_

- Fixed the iPhone Lock Screen and Notification Center player showing 10-second jump controls instead of full-song Previous and Next buttons.
- Fixed songs stopping at the end when the screen is locked or Spot+ is in the background: the next song now continues automatically on the active audio session.
- Polished Settings and section cards over Clear wallpapers with rounded corners, balanced inner padding, and clean spacing between cards.

## 1.9.45 — Full songs again, the way 1.9.41 played
_2026-11-19_

- Automatic is the 1.9.41 and 1.9.42 player again. A song that the full servers cannot start is skipped, instead of playing a 30-second preview.

## 1.9.44 — Songs start when the relay is blocked
_2026-11-19_

- Automatic still uses Claude’s 1.9.42 player. If YouTube refuses the full-song relay, the song starts from a preview instead of sitting silent.

## 1.9.43 — Spot+ is open again
_2026-11-19_

- The maintenance screen is off. Opening Spot+ loads the app.

## 1.9.42 — Songs recover when a stream drops
_2026-11-19_

- If a song’s stream drops partway, Spot+ retries from the same spot using another upload of the song, instead of giving up on it.

## 1.9.41 — Backgrounds sized for your screen
_2026-11-19_

- On a phone, Backgrounds shows tall phone wallpapers from Alpha Coders; on a computer, wide ones. No more stretched or cropped-to-nothing backgrounds.

## 1.9.40 — Correct song times, and no more stuck playback
_2026-11-19_

- Song times are right again on iPhone. Songs showed 6–9 minutes because Safari guessed the length from the file size; Spot+ now uses the real length from YouTube.
- Fixed songs refusing to play until the app was restarted: one failed check of the Spot+ server (often right after the phone wakes up) switched the YouTube audio off for 5 minutes. It now just checks again.
- Skipping a non-music outro now moves straight to the next song.
- Fixed an error at the start of each song that could leave the play button and song title out of date.

## 1.9.39 — Faster starts when YouTube is picky
_2026-11-19_

- When YouTube is slow to hand over one upload of a song, Spot+ starts trying the next one after 1.5 seconds instead of waiting up to 7, and plays whichever answers first.

## 1.9.38 — Songs no longer cut off
_2026-11-19_

- Fixed songs on iPhone stopping at 0:00 or after the first minute. YouTube changed what it allows in August, and the Spot+ server now asks for audio the way that still gets the whole song.
- Before a song starts, the server checks that YouTube will deliver all of it, so a song never plays partway and stops.
- If YouTube drops the connection in the middle of a song, the server picks up from the same spot without a gap.

## 1.9.37 — More songs play in full
_2026-11-19_

- When YouTube briefly refuses the Spot+ server, it waits out the moment and tries again instead of giving up.
- If the usual uploads of a song aren’t available, Spot+ also tries lyric videos and other uploads of the same song.

## 1.9.36 — Spotube-style audio
_2026-11-19_

- Higher quality: Opus 160 kbps on Android and computers, AAC on iPhone. Data saver in Settings → Playback switches to a light 48 kbps stream.
- Skips the non-music parts of YouTube uploads (spoken intros, skits, long outros) using SponsorBlock, like Spotube.

## 1.9.35 — Maintenance
_2026-11-19_

- Spot+ is down for maintenance while playback is upgraded. It will be back soon.

## 1.9.34 — No 30-second clips
_2026-11-19_

- Automatic never plays a 30-second preview anymore. Every song is the full song.
- Spot+ tries harder to find the full song: more attempts through the Spot+ server, and a song that drops mid-play retries from the same spot.
- In the rare case no full version can be found, Spot+ tells you and moves to the next song instead of playing a clip.

## 1.9.33 — No ads
_2026-11-19_

- Automatic never uses YouTube’s player anymore, so no ads ever play. Every song plays in Spot+’s own player.
- If the Spot+ server is briefly refused by YouTube, Spot+ tries again with more uploads before moving on.
- YouTube’s player is still there if you pick “YouTube player” in Settings → Playback.

## 1.9.32 — Music keeps playing when you leave the app
_2026-11-19_

- Fixed music stopping when you switch away from Spot+ or lock the phone.
- With effects on, the song keeps playing in the background without reverb and bass, at the same spot. Effects come back when you open Spot+ again; speed and pitch keep working.
- Fewer ads: when YouTube briefly refuses the Spot+ server, it retries with a fresh session and tries other uploads before falling back to YouTube’s player.

## 1.9.31 — Full YouTube songs in Spot+’s own player
_2026-11-19_

- New: YouTube audio through the Spot+ server. Full songs play in Spot+’s own player instead of YouTube’s, so there are no ads and no extra tap, on iPhone too.
- Background playback, lock-screen controls and the queue work like any other Spot+ song.
- Spot+ checks that the audio really streams before it plays a song from this source.
- YouTube’s player (with ads) is now only a backup when this doesn’t work.

## 1.9.30 — SoundCloud: full songs, no ads, no extra tap
_2026-11-19_

- New audio source: SoundCloud through its official API. Songs play in Spot+’s own player straight from your tap, with no YouTube box, no ads, and sound in about a third of a second, on iPhone too.
- Automatic tries SoundCloud first and waits for it a moment before YouTube’s player, so most songs play ad-free.
- Turns on once the Spot+ server has a SoundCloud app key.

## 1.9.29 — Spot+ for iPhone app
_2026-11-19_

- New iPhone app: SpotPlus.ipa on the GitHub releases page (ios-latest). In it, one tap on a song plays it, with no tap in the YouTube box, and music keeps playing with the screen off.
- Install it from a computer with Sideloadly or AltStore. With a free Apple ID it needs re-signing every 7 days.

## 1.9.28 — InstantPlay: the next song is ready before you ask
_2026-11-19_

- A hidden second YouTube player loads the next song in your queue (and the song you touch) ahead of time. Skipping swaps players instead of loading, and the next song starts in under a second.
- The YouTube player loads when the app opens, so the first song starts about twice as fast.
- Songs start on YouTube right away instead of waiting for the lossless servers. When a lossless server answers, Spot+ still switches to it mid-song.
- Blocked uploads are found in the background, before you press play.
- Android and computers: one tap on a song plays it. No extra tap.
- iPhone: Apple only lets YouTube’s player start from a tap inside it, so the first song of each session still needs one tap in the YouTube box. After that, songs start on their own.

## 1.9.27 — Full songs on iPhone
_2026-11-19_

- Fixed songs sitting at 0:00. Spot+ was trying shortcut links to public YouTube mirrors that are down, and waiting on each one. Automatic no longer uses them.
- Turned off the worker’s stream links. They only work from Cloudflare’s servers, not from phones.
- On iPhone, a small YouTube box now appears when it needs one tap to start. Tap ▶ in it once; after that, songs start on their own.
- Removed the 30-second preview button from that box.

## 1.9.26 — InstantPlay: full songs, faster starts, lossless upgrades
_2026-11-19_

- Fixed the main cause of 30-second clips. Many labels block their official uploads from playing outside YouTube. Spot+ now tries up to 8 uploads of the same song (music video, lyric video, live) and remembers which ones are blocked, so each blocked upload only costs time once.
- Fixed InstantPlay preloading a 30-second clip for the next song when the lossless servers were busy.
- Songs start on YouTube’s player within about a second. If a lossless server answers afterwards, Spot+ crossfades to lossless at the same spot, mid-song.
- The YouTube player stays loaded between songs and swaps the next one in place, so skipping starts the next song almost at once.
- With effects on, a song that has no effects-friendly server now plays in full without effects, instead of as a clip.

## 1.9.25 — Spot+ is open again
_2026-11-18_

- Maintenance is over. Everyone can open Spot+ again, with full songs and the new wallpaper search.

## 1.9.24 — Search every Alpha Coders wallpaper
_2026-11-18_

- Search on Background now covers all of Alpha Coders, not only the 2,670 wallpapers saved in the app. Results keep loading as you scroll.
- Picking a category keeps going past the saved set. Scroll to the end and more wallpapers from that category load in.
- The wallpaper grid loads in batches as you scroll, so the page opens fast and scrolling stays smooth.
- Tapping a wallpaper sets it in place. The list keeps your spot and your search results.
- A wallpaper you found through search stays set after you close and reopen the app.

## 1.9.23 — Full songs instead of 30-second previews
_2026-11-18_

- Automatic playback no longer falls back to a 30-second preview when the free audio servers are busy. If none of them answers within about 2.5 seconds, the full song plays through YouTube’s official player.
- When the servers have been failing, the next songs go straight to YouTube’s player, so they start almost at once. Spot+ tries the lossless servers again after 10 minutes.
- Audius is no longer part of Automatic. It often returned fan uploads instead of the real song. You can still pick it in Playback settings.
- Previews are now the last resort. They only play when effects are on or no full recording can be found.

## 1.9.22 — The wallpaper list takes the swipe
_2026-11-18_

- On Background, a finger on the wallpaper database moves that list. The rest of the page stays still, including while you search.

## 1.9.21 — Full songs from Monochrome, then a preview that actually starts
_2026-11-18_

- Automatic playback asks Monochrome first. It has the mainstream catalog, including songs the other public servers miss, and it is not the YouTube player.
- JioSaavn, HiFi, Audius, Invidious, and Piped still run beside it. A 30-second preview is only used after those miss, and that preview is fetched fresh so it can start.
- The “could not search for alternatives” message no longer appears when the public match service can still find recordings. The playback failure is shown once.

## 1.9.20 — Background grid scrolling, hardened maintenance gate, Deezer restoration, and Spotube-style multi-source audio
_2026-11-18_

- Turned the Background picker into a responsive visual grid (2 columns on iPhone, multi-column on desktop) whose internal catalog container scrolls independently without dragging the rest of the page, with multi-token search across all 2,670+ wallpapers.
- Hardened the maintenance gate with hashed owner verification (zero plaintext handle in shipped code), origin-bound signed tokens, brute-force lockout, and DOM mutation enforcement.
- Restored Deezer in Playback settings with iTunes AAC preview rescue and added Spotube-style full-track sources: JioSaavn (320 kbps AAC), HiFi / Monochrome Lossless, Audius, updated Piped/Invidious pools, preconnected audio hosts, and fail-fast routing for InstantPlay.

## 1.9.19 — Keep profile photos available when Spot+ is offline & restore original audio playback
_2026-11-18_

- Your photo chooser module is now part of the iPhone PWA offline shell, so launching Spot+ without a connection does not depend on fetching it.
- Restored all 2,670 wallpapers inside an independent iOS scrolling viewport, single-surface search fields, Clear theme, and background full-audio recovery while a preview plays.
- Automatic playback stays on real audio servers (Invidious, Piped, Audius, custom servers, and /stream) without forcing the YouTube embed, auto-starts after the first tap, and auto-advances across the queue.

## 1.9.18 — iPhone wallpaper scrolling, real profile photos, and full-audio recovery
_2026-11-18_

- Search fields are a single clean shape on iPhone, without a nested native input border.
- The complete Alpha Coders wallpaper catalog is reachable in its own scrolling list, with compact phone controls and lazy-loaded thumbnails.
- Clear mode exposes the wallpaper while keeping controls readable and the mini player and tab bar opaque.
- Use your synced Spotify photo or choose an iPhone photo stored only on this device, then switch back any time.
- Automatic playback now stays on real audio servers (Invidious, Piped, Audius, custom servers, and the Spot+ /stream bridge) with 30-second Deezer previews as a last resort while checking full audio in the background.
- Removed premature “Tap play above to start” interruptions, preserved unlocked iOS audio elements, and guaranteed queue continuation across streams, previews, repeat one/all, and Smart Radio.

## 1.9.17 — Search fields and the wallpaper list line up
_2026-11-18_

- Search fields, including Tell DJ what to play, no longer show a box inside the field.
- The wallpaper database scrolls on its own. The rest of the page stays still, and the full wallpaper library is back.
- Clear is still in Appearance, next to Light, Dark, and Auto.

## 1.9.16 — A clearer Clear theme, and a wallpaper grid that scrolls
_2026-11-18_

- Clear keeps the wallpaper visible. Panels, the player, and the tab bar stay readable instead of showing the page through them.
- The wallpaper picker is a grid, and only that grid scrolls.

## 1.9.15 — Your real Spotify photo, and a photo you choose
_2026-11-18_

- A connected Spotify account uses that account’s profile photo.
- Change photo on your profile or in Settings. Use Spotify photo puts the account picture back.

## 1.9.14 — Clear theme and a wallpaper list that stays put
_2026-11-18_

- The wallpaper list is the only thing that scrolls on the background screen. It no longer drags the rest of the app.
- Clear sits with Light, Dark, and Auto. It makes the app transparent over your wallpaper. The full player stays solid.
- The background screen keeps a small crop preview, and search and categories stay at the top of the list.

## 1.9.13 — Show sharp backgrounds and a searchable wallpaper library
_2026-11-18_

- Fixed premature 30-second previews cutting off full-track playback: Spot+ now exhausts full-length alternative streams and YouTube failover before falling back to catalog previews.
- Fixed double playback error alerts and CORS failures on preview fallback by binding error/rejection handling per media attempt and clearing crossorigin when needed.
- Hardened Cloudflare /stream extraction with clean mirror headers, IOS client fallback, companion AAC fallback, and automatic circuit-breaker cooldowns.
- Restored full adaptive InstantPlay memory (L1 LRU + IndexedDB), pause warm retention, non-resetting stall recovery, Web Audio uncaptured spare safety, and scoped service worker caching.

## 1.9.12 — Cleaner playback errors & preview fixes
_2026-11-18_

- Fixed playback errors showing duplicate notifications when an audio source fails.
- Fixed 30-second catalog previews failing when Web Audio effects were enabled.

## 1.9.11 — App & library backgrounds
_2026-11-18_

- Added Background studio (Settings › Appearance › Background) with 4K-class curated wallpapers and custom image uploads with drag-to-crop.

## 1.9.10 — Smooth next-track buffering
_2026-11-18_

- Adjusted warm-buffer thresholds and stall timers to eliminate audio glitches during track starts and transitions.

## 1.9.9 — Faster direct links & pause memory
_2026-11-18_

- Direct mirror streams and AAC mobile selection start playback faster and keep paused songs warm for 90 seconds.

## 1.9.8 — Cloudflare audio stream bridge
_2026-11-18_

- Added /stream extraction endpoint on the Spot+ Cloudflare worker to speed up full-track resolution.

## 1.9.7 — InstantPlay playback engine
_2026-11-17_

- Faster song starts and switching: non-blocking L1/IndexedDB audio memory, preconnected bridge/audio hosts, and dual-player next-track buffering with skip-velocity protection.
- Smarter audio server routing: reliability + latency scoring with exponential-backoff circuit breakers avoids dead or flaky servers automatically.
- Better stability on cellular & iPhone: adaptive buffer targets, buffered-range seeking, accurate stall recovery, and HTTP Range (206) support for cached offline audio.

## 1.9.6 — Tracks play reliably again
_2026-11-17_

- Fixed songs getting stuck on “Finding audio…” when public Piped and Invidious audio servers are down or rate-limited.
- Songs now fail over quickly past dead servers, play the full track via Spot+’s embedded YouTube player, and fall back to a 30-second catalog preview if needed.
- Added mobile autoplay prompt support so phones/iOS let you tap Play immediately instead of hanging.

## 1.9.5 — Podcasts fixed, faster song starts
_2026-11-17_

- Podcasts work again: top shows and podcast search now use two public directories with automatic fallback, so shows load even if one directory is down.
- Songs load faster: dead or blocked audio servers are skipped right away instead of retrying, more servers are checked in parallel, and stalled streams switch sooner.

## 1.9.4 — More songs play, easy updates
_2026-11-16_

- Songs from your Spotify playlists that still couldn’t be found get a second try, using the music catalog’s spelling of the artist (great for local and regional artists).
- New “Check for updates” button in Settings › What’s new. Spot+ also checks for updates every time you open it.

## 1.9.3 — Songs with several artists play again
_2026-11-16_

- Fixed “No audio server answered” for songs credited to several artists (like “Jala, Buba Corelli”): any of the artists now counts when finding the recording.
- Collab titles like “Artist A x Artist B - Song” are no longer mistaken for mashups.

## 1.9.2 — Right song, smooth sound
_2026-11-16_

- Fixed songs sometimes playing a mashup or a different recording: mashups, medleys and “song x song” blends are no longer accepted, and every song is re-matched once.
- Fixed choppy audio: if an audio server can’t keep up, Spot+ switches to another one mid-song and stops using that server for fast starts.
- With effects off, sound no longer goes through the effects at all, so nothing changes the original.

## 1.9.1 — Developer profile fix
_2026-11-16_

- The “Made by” section now loads the developer’s Discord picture reliably.

## 1.9.0 — Faster, sharper loops for every song
_2026-11-16_

- Loops load much faster: one shared, cached search finds the official music video, which then plays straight from an audio server that works for you.
- The next song’s loop is found while the current one plays, so it starts instantly.
- Music-video loops are cropped tighter to fill the screen and hide black bars, in up to 1080p on fast connections.
- Loops last 10 seconds and come from about a third of the way in, past the intro and near the first chorus.
- Every song now has visuals: when there’s no loop, the album art fills the screen and slowly drifts.

## 1.8.1 — Even faster song starts
_2026-11-16_

- Songs start right away when Spot+ already knows the recording: it plays straight from the last audio server that worked for you, instead of asking a server for the audio links first.
- If that server is slow, Spot+ moves on after 3.5 seconds instead of 6.
- On computers, hovering over a song starts finding it before you click.

## 1.8.0 — Podcasts and audiobooks
_2026-11-16_

- Podcasts: browse the top shows or search any public podcast, follow shows, and play episodes right in Spot+.
- Audiobooks: thousands of free classic books read by LibriVox volunteers, from Sherlock Holmes to The Art of War.
- Spot+ remembers where you stopped in every episode and chapter, with a Continue listening row.
- Skip back 15 seconds or forward 30 in Now Playing, and episode notes in the Lyrics tab.
- Shows that are only on Spotify, and Spotify’s paid audiobooks, can’t be played outside Spotify.

## 1.7.0 — Playlist generator
_2026-11-16_

- New playlist generator (Create › Generate a playlist): start from your taste, artists, songs or genres, pick vibes, then tune familiar ↔ new, deep cuts ↔ big hits, length, songs per artist, order and clean-only. Preview it, regenerate, play or save.
- The full changelog is now in Settings.
- New “Made by” section in Settings with the developer’s live Discord profile and a link to the Spot+ Discord.

## 1.6.1 — Bigger launch logo
_2026-11-16_

- The Spot+ logo on the launch screen is a bit bigger.

## 1.6.0 — Daily Mixes, device sync, sing-along and more
_2026-11-16_

- Daily Mixes: up to 6 fresh mixes every day on Home, built from what you play, like and skip.
- Smart Radio: when your queue ends, music keeps going with similar songs. Skips teach it what you don’t want.
- Link your devices (Settings › Your devices): scan a code and your likes and playlists stay the same on your phone and computer. Encrypted, no account.
- Edit playlists together: tap the share button on a playlist, send the link, and everyone can add and remove songs live.
- Sing-along: tap Sing along in Lyrics to turn the vocals down and follow the words as they fill in. There’s also a Vocal remover slider in ✨ effects.
- AutoMix (Settings › Playback): songs blend into each other like a DJ set. Not available on iPhone and iPad.

## 1.5.1 — Cleaner launch screen
_2026-11-16_

- The launch screen now shows just the Spot+ logo.

## 1.5.0 — Live counters
_2026-11-16_

- See how many people are listening to Spot+ right now, and how many have installed it, live on Home and the download page.
- Counts are anonymous: each device is a random code, nothing about you or your music is sent.

## 1.4.0 — Download playlists, smoother effects
_2026-11-16_

- Download whole playlists and Liked Songs with one tap, just like Spotify. The button fills up as it goes, turns green when done, and tapping it again stops or removes the download.
- Downloaded playlists stay downloaded: songs you add later download by themselves.
- Downloads run 3 songs at a time and prefer audio servers that allow downloading.
- Sound effects respond instantly: reverb rooms are built ahead of time and crossfade, speed changes glide, and the panel no longer redraws while you drag.
- Turning effects on no longer restarts the song when the audio server is already known to support them.
- The launch screen stays up a little longer.
- New “What’s new” screen after every update.

## 1.3.1 — Effects and lock screen fixes
_2026-11-16_

- Songs no longer fail or keep pausing with effects on. Songs whose audio server can’t do effects play normally instead.
- Lock-screen play no longer flashes an old song, and resuming after a long pause refreshes an expired audio link.

## 1.3.0 — Sound effects
_2026-11-16_

- New ✨ button in Now Playing: Slowed + Reverb, Nightcore, 8D Audio, Lo-fi, Bass Boost and more.
- Live speed, pitch, reverb (4 rooms), bass, 8D and lo-fi controls.

## 1.2.0 — Speed patch v2
_2026-11-16_

- Songs start much faster: a shared, cached song lookup means most songs need one server trip instead of two.
- Spot+ learns which audio servers are fastest for you and skips slow ones sooner.
- Recently played songs start instantly, even after reopening the app.

## 1.1.0 — Fixes
_2026-11-16_

- Music no longer keeps playing after you pause or close the app.
- The Update button on the new-version message works.

## 1.0.0 — Spot+ launch
_2026-11-16_

- First public release.
