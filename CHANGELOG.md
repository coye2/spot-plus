# Changelog

Every Spot+ update. The app shows the newest ones in its “What’s new” screen.

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
