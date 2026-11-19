// Release notes: the single source for the in-app "What's new" screen and CHANGELOG.md.
// Newest first. Add an entry with every fix.
export const CHANGELOG = [
  {version: '1.9.51', date: '2026-11-19', title: 'No more songs stuck at 0:00 when YouTube blocks Spot+', items: [
    'When YouTube starts refusing the Spot+ server (it does after a while), Automatic now notices after two songs and plays from its other full-song sources for a few minutes, then tries YouTube again. Before, every song sat at 0:00 for up to a minute.',
    'A refused song moves on after two uploads instead of three.',
  ]},
  {version: '1.9.50', date: '2026-11-19', title: 'Fewer songs stuck at 0:00', items: [
    'Spot+ YouTube Relay now asks YouTube once per song instead of twice. The extra check could pass while the song itself was refused, leaving it stuck at 0:00.',
    'When YouTube refuses every upload of a song in Automatic, Spot+ now switches to another full-song source instead of skipping the song.',
  ]},
  {version: '1.9.49', date: '2026-11-19', title: 'Pause works again, and whole songs from the relay', items: [
    'Fixed pause: the screen could say paused while music kept playing and the button couldn’t stop it. Pausing now stops every player, and a tap while that happens stops the music.',
    'Fixed songs from Spot+ YouTube Relay stopping after a fraction of a second: the server cut its own audio stream right after it started.',
    'Songs YouTube refuses now fail in about 2 seconds instead of 10–15, so Spot+ moves to another upload much sooner.',
    'Fixed the relay giving up on many songs with a “too many requests” error from Cloudflare.',
    'The relay asks YouTube as a second app when the first is refused (the version Metrolist uses), so more songs play.',
    'Now Playing shows “Spot+ YouTube Relay” instead of the server address. Tap it for playback details: server, format, which upload played and why.',
    'Audio source list cleaned up: Spot+ YouTube Relay, Automatic, HiFi / Monochrome, JioSaavn and Audius (SoundCloud once it’s set up). Piped, Invidious, YouTube player and Deezer previews are gone; if you used one, Spot+ switches you to the closest option.',
    'Song matching now also tells apart demos, radio edits and extended mixes.',
  ]},
  {version: '1.9.48', date: '2026-11-19', title: 'Spot+ YouTube Relay: full-song integrity and iPhone playback', items: [
    'Spot+ YouTube Relay validates complete upstream audio byte ranges, detects truncation, and avoids accidentally treating a cut-off recording as a completed song.',
    'Improved iPhone seeking and mid-track continuation, including Safari suffix ranges and safe signed-link refreshes.',
    'Shows the recording timeline from actual YouTube duration metadata instead of guessing from fragmented audio size, and rejects seriously mismatched recordings.',
    'Quicker skip cancellation and relay-only source selection, with playback-health reporting and more regression tests.',
  ]},
  {version: '1.9.46', date: '2026-11-19', title: 'Lock screen skip, background auto-next, and polished wallpaper cards', items: [
    'Fixed the iPhone Lock Screen and Notification Center player showing 10-second jump controls instead of full-song Previous and Next buttons.',
    'Fixed songs stopping at the end when the screen is locked or Spot+ is in the background: the next song now continues automatically on the active audio session.',
    'Polished Settings and section cards over Clear wallpapers with rounded corners, balanced inner padding, and clean spacing between cards.',
  ]},
  {version: '1.9.45', date: '2026-11-19', title: 'Full songs again, the way 1.9.41 played', items: [
    'Automatic is the 1.9.41 and 1.9.42 player again. A song that the full servers cannot start is skipped, instead of playing a 30-second preview.',
  ]},
  {version: '1.9.44', date: '2026-11-19', title: 'Songs start when the relay is blocked', items: [
    'Automatic still uses Claude’s 1.9.42 player. If YouTube refuses the full-song relay, the song starts from a preview instead of sitting silent.',
  ]},
  {version: '1.9.43', date: '2026-11-19', title: 'Spot+ is open again', items: [
    'The maintenance screen is off. Opening Spot+ loads the app.',
  ]},
  {version: '1.9.42', date: '2026-11-19', title: 'Songs recover when a stream drops', items: [
    'If a song’s stream drops partway, Spot+ retries from the same spot using another upload of the song, instead of giving up on it.',
  ]},
  {version: '1.9.41', date: '2026-11-19', title: 'Backgrounds sized for your screen', items: [
    'On a phone, Backgrounds shows tall phone wallpapers from Alpha Coders; on a computer, wide ones. No more stretched or cropped-to-nothing backgrounds.',
  ]},
  {version: '1.9.40', date: '2026-11-19', title: 'Correct song times, and no more stuck playback', items: [
    'Song times are right again on iPhone. Songs showed 6–9 minutes because Safari guessed the length from the file size; Spot+ now uses the real length from YouTube.',
    'Fixed songs refusing to play until the app was restarted: one failed check of the Spot+ server (often right after the phone wakes up) switched the YouTube audio off for 5 minutes. It now just checks again.',
    'Skipping a non-music outro now moves straight to the next song.',
    'Fixed an error at the start of each song that could leave the play button and song title out of date.',
  ]},
  {version: '1.9.39', date: '2026-11-19', title: 'Faster starts when YouTube is picky', items: [
    'When YouTube is slow to hand over one upload of a song, Spot+ starts trying the next one after 1.5 seconds instead of waiting up to 7, and plays whichever answers first.',
  ]},
  {version: '1.9.38', date: '2026-11-19', title: 'Songs no longer cut off', items: [
    'Fixed songs on iPhone stopping at 0:00 or after the first minute. YouTube changed what it allows in August, and the Spot+ server now asks for audio the way that still gets the whole song.',
    'Before a song starts, the server checks that YouTube will deliver all of it, so a song never plays partway and stops.',
    'If YouTube drops the connection in the middle of a song, the server picks up from the same spot without a gap.',
  ]},
  {version: '1.9.37', date: '2026-11-19', title: 'More songs play in full', items: [
    'When YouTube briefly refuses the Spot+ server, it waits out the moment and tries again instead of giving up.',
    'If the usual uploads of a song aren’t available, Spot+ also tries lyric videos and other uploads of the same song.',
  ]},
  {version: '1.9.36', date: '2026-11-19', title: 'Spotube-style audio', items: [
    'Higher quality: Opus 160 kbps on Android and computers, AAC on iPhone. Data saver in Settings → Playback switches to a light 48 kbps stream.',
    'Skips the non-music parts of YouTube uploads (spoken intros, skits, long outros) using SponsorBlock, like Spotube.',
  ]},
  {version: '1.9.35', date: '2026-11-19', title: 'Maintenance', items: [
    'Spot+ is down for maintenance while playback is upgraded. It will be back soon.',
  ]},
  {version: '1.9.34', date: '2026-11-19', title: 'No 30-second clips', items: [
    'Automatic never plays a 30-second preview anymore. Every song is the full song.',
    'Spot+ tries harder to find the full song: more attempts through the Spot+ server, and a song that drops mid-play retries from the same spot.',
    'In the rare case no full version can be found, Spot+ tells you and moves to the next song instead of playing a clip.',
  ]},
  {version: '1.9.33', date: '2026-11-19', title: 'No ads', items: [
    'Automatic never uses YouTube’s player anymore, so no ads ever play. Every song plays in Spot+’s own player.',
    'If the Spot+ server is briefly refused by YouTube, Spot+ tries again with more uploads before moving on.',
    'YouTube’s player is still there if you pick “YouTube player” in Settings → Playback.',
  ]},
  {version: '1.9.32', date: '2026-11-19', title: 'Music keeps playing when you leave the app', items: [
    'Fixed music stopping when you switch away from Spot+ or lock the phone.',
    'With effects on, the song keeps playing in the background without reverb and bass, at the same spot. Effects come back when you open Spot+ again; speed and pitch keep working.',
    'Fewer ads: when YouTube briefly refuses the Spot+ server, it retries with a fresh session and tries other uploads before falling back to YouTube’s player.',
  ]},
  {version: '1.9.31', date: '2026-11-19', title: 'Full YouTube songs in Spot+’s own player', items: [
    'New: YouTube audio through the Spot+ server. Full songs play in Spot+’s own player instead of YouTube’s, so there are no ads and no extra tap, on iPhone too.',
    'Background playback, lock-screen controls and the queue work like any other Spot+ song.',
    'Spot+ checks that the audio really streams before it plays a song from this source.',
    'YouTube’s player (with ads) is now only a backup when this doesn’t work.',
  ]},
  {version: '1.9.30', date: '2026-11-19', title: 'SoundCloud: full songs, no ads, no extra tap', items: [
    'New audio source: SoundCloud through its official API. Songs play in Spot+’s own player straight from your tap, with no YouTube box, no ads, and sound in about a third of a second, on iPhone too.',
    'Automatic tries SoundCloud first and waits for it a moment before YouTube’s player, so most songs play ad-free.',
    'Turns on once the Spot+ server has a SoundCloud app key.',
  ]},
  {version: '1.9.29', date: '2026-11-19', title: 'Spot+ for iPhone app', items: [
    'New iPhone app: SpotPlus.ipa on the GitHub releases page (ios-latest). In it, one tap on a song plays it, with no tap in the YouTube box, and music keeps playing with the screen off.',
    'Install it from a computer with Sideloadly or AltStore. With a free Apple ID it needs re-signing every 7 days.',
  ]},
  {version: '1.9.28', date: '2026-11-19', title: 'InstantPlay: the next song is ready before you ask', items: [
    'A hidden second YouTube player loads the next song in your queue (and the song you touch) ahead of time. Skipping swaps players instead of loading, and the next song starts in under a second.',
    'The YouTube player loads when the app opens, so the first song starts about twice as fast.',
    'Songs start on YouTube right away instead of waiting for the lossless servers. When a lossless server answers, Spot+ still switches to it mid-song.',
    'Blocked uploads are found in the background, before you press play.',
    'Android and computers: one tap on a song plays it. No extra tap.',
    'iPhone: Apple only lets YouTube’s player start from a tap inside it, so the first song of each session still needs one tap in the YouTube box. After that, songs start on their own.',
  ]},
  {version: '1.9.27', date: '2026-11-19', title: 'Full songs on iPhone', items: [
    'Fixed songs sitting at 0:00. Spot+ was trying shortcut links to public YouTube mirrors that are down, and waiting on each one. Automatic no longer uses them.',
    'Turned off the worker’s stream links. They only work from Cloudflare’s servers, not from phones.',
    'On iPhone, a small YouTube box now appears when it needs one tap to start. Tap ▶ in it once; after that, songs start on their own.',
    'Removed the 30-second preview button from that box.',
  ]},
  {version: '1.9.26', date: '2026-11-19', title: 'InstantPlay: full songs, faster starts, lossless upgrades', items: [
    'Fixed the main cause of 30-second clips. Many labels block their official uploads from playing outside YouTube. Spot+ now tries up to 8 uploads of the same song (music video, lyric video, live) and remembers which ones are blocked, so each blocked upload only costs time once.',
    'Fixed InstantPlay preloading a 30-second clip for the next song when the lossless servers were busy.',
    'Songs start on YouTube’s player within about a second. If a lossless server answers afterwards, Spot+ crossfades to lossless at the same spot, mid-song.',
    'The YouTube player stays loaded between songs and swaps the next one in place, so skipping starts the next song almost at once.',
    'With effects on, a song that has no effects-friendly server now plays in full without effects, instead of as a clip.',
  ]},
  {version: '1.9.25', date: '2026-11-18', title: 'Spot+ is open again', items: [
    'Maintenance is over. Everyone can open Spot+ again, with full songs and the new wallpaper search.',
  ]},
  {version: '1.9.24', date: '2026-11-18', title: 'Search every Alpha Coders wallpaper', items: [
    'Search on Background now covers all of Alpha Coders, not only the 2,670 wallpapers saved in the app. Results keep loading as you scroll.',
    'Picking a category keeps going past the saved set. Scroll to the end and more wallpapers from that category load in.',
    'The wallpaper grid loads in batches as you scroll, so the page opens fast and scrolling stays smooth.',
    'Tapping a wallpaper sets it in place. The list keeps your spot and your search results.',
    'A wallpaper you found through search stays set after you close and reopen the app.',
  ]},
  {version: '1.9.23', date: '2026-11-18', title: 'Full songs instead of 30-second previews', items: [
    'Automatic playback no longer falls back to a 30-second preview when the free audio servers are busy. If none of them answers within about 2.5 seconds, the full song plays through YouTube’s official player.',
    'When the servers have been failing, the next songs go straight to YouTube’s player, so they start almost at once. Spot+ tries the lossless servers again after 10 minutes.',
    'Audius is no longer part of Automatic. It often returned fan uploads instead of the real song. You can still pick it in Playback settings.',
    'Previews are now the last resort. They only play when effects are on or no full recording can be found.',
  ]},
  {version: '1.9.22', date: '2026-11-18', title: 'The wallpaper list takes the swipe', items: [
    'On Background, a finger on the wallpaper database moves that list. The rest of the page stays still, including while you search.',
  ]},
  {version: '1.9.21', date: '2026-11-18', title: 'Full songs from Monochrome, then a preview that actually starts', items: [
    'Automatic playback asks Monochrome first. It has the mainstream catalog, including songs the other public servers miss, and it is not the YouTube player.',
    'JioSaavn, HiFi, Audius, Invidious, and Piped still run beside it. A 30-second preview is only used after those miss, and that preview is fetched fresh so it can start.',
    'The “could not search for alternatives” message no longer appears when the public match service can still find recordings. The playback failure is shown once.',
  ]},
  {version: '1.9.20', date: '2026-11-18', title: 'Background grid scrolling, hardened maintenance gate, Deezer restoration, and Spotube-style multi-source audio', items: [
    'Turned the Background picker into a responsive visual grid (2 columns on iPhone, multi-column on desktop) whose internal catalog container scrolls independently without dragging the rest of the page, with multi-token search across all 2,670+ wallpapers.',
    'Hardened the maintenance gate with hashed owner verification (zero plaintext handle in shipped code), origin-bound signed tokens, brute-force lockout, and DOM mutation enforcement.',
    'Restored Deezer in Playback settings with iTunes AAC preview rescue and added Spotube-style full-track sources: JioSaavn (320 kbps AAC), HiFi / Monochrome Lossless, Audius, updated Piped/Invidious pools, preconnected audio hosts, and fail-fast routing for InstantPlay.',
  ]},
  {version: '1.9.19', date: '2026-11-18', title: 'Keep profile photos available when Spot+ is offline & restore original audio playback', items: [
    'Your photo chooser module is now part of the iPhone PWA offline shell, so launching Spot+ without a connection does not depend on fetching it.',
    'Restored all 2,670 wallpapers inside an independent iOS scrolling viewport, single-surface search fields, Clear theme, and background full-audio recovery while a preview plays.',
    'Automatic playback stays on real audio servers (Invidious, Piped, Audius, custom servers, and /stream) without forcing the YouTube embed, auto-starts after the first tap, and auto-advances across the queue.',
  ]},
  {version: '1.9.18', date: '2026-11-18', title: 'iPhone wallpaper scrolling, real profile photos, and full-audio recovery', items: [
    'Search fields are a single clean shape on iPhone, without a nested native input border.',
    'The complete Alpha Coders wallpaper catalog is reachable in its own scrolling list, with compact phone controls and lazy-loaded thumbnails.',
    'Clear mode exposes the wallpaper while keeping controls readable and the mini player and tab bar opaque.',
    'Use your synced Spotify photo or choose an iPhone photo stored only on this device, then switch back any time.',
    'Automatic playback now stays on real audio servers (Invidious, Piped, Audius, custom servers, and the Spot+ /stream bridge) with 30-second Deezer previews as a last resort while checking full audio in the background.',
    'Removed premature “Tap play above to start” interruptions, preserved unlocked iOS audio elements, and guaranteed queue continuation across streams, previews, repeat one/all, and Smart Radio.',
  ]},
  {version: '1.9.17', date: '2026-11-18', title: 'Search fields and the wallpaper list line up', items: [
    'Search fields, including Tell DJ what to play, no longer show a box inside the field.',
    'The wallpaper database scrolls on its own. The rest of the page stays still, and the full wallpaper library is back.',
    'Clear is still in Appearance, next to Light, Dark, and Auto.',
  ]},
  {version: '1.9.16', date: '2026-11-18', title: 'A clearer Clear theme, and a wallpaper grid that scrolls', items: [
    'Clear keeps the wallpaper visible. Panels, the player, and the tab bar stay readable instead of showing the page through them.',
    'The wallpaper picker is a grid, and only that grid scrolls.',
  ]},
  {version: '1.9.15', date: '2026-11-18', title: 'Your real Spotify photo, and a photo you choose', items: [
    'A connected Spotify account uses that account’s profile photo.',
    'Change photo on your profile or in Settings. Use Spotify photo puts the account picture back.',
  ]},
  {version: '1.9.14', date: '2026-11-18', title: 'Clear theme and a wallpaper list that stays put', items: [
    'The wallpaper list is the only thing that scrolls on the background screen. It no longer drags the rest of the app.',
    'Clear sits with Light, Dark, and Auto. It makes the app transparent over your wallpaper. The full player stays solid.',
    'The background screen keeps a small crop preview, and search and categories stay at the top of the list.',
  ]},
  {version: '1.9.13', date: '2026-11-18', title: 'Show sharp backgrounds and a searchable wallpaper library', items: [
    'Fixed premature 30-second previews cutting off full-track playback: Spot+ now exhausts full-length alternative streams and YouTube failover before falling back to catalog previews.',
    'Fixed double playback error alerts and CORS failures on preview fallback by binding error/rejection handling per media attempt and clearing crossorigin when needed.',
    'Hardened Cloudflare /stream extraction with clean mirror headers, IOS client fallback, companion AAC fallback, and automatic circuit-breaker cooldowns.',
    'Restored full adaptive InstantPlay memory (L1 LRU + IndexedDB), pause warm retention, non-resetting stall recovery, Web Audio uncaptured spare safety, and scoped service worker caching.',
  ]},
  {version: '1.9.12', date: '2026-11-18', title: 'Cleaner playback errors & preview fixes', items: [
    'Fixed playback errors showing duplicate notifications when an audio source fails.',
    'Fixed 30-second catalog previews failing when Web Audio effects were enabled.',
  ]},
  {version: '1.9.11', date: '2026-11-18', title: 'App & library backgrounds', items: [
    'Added Background studio (Settings › Appearance › Background) with 4K-class curated wallpapers and custom image uploads with drag-to-crop.',
  ]},
  {version: '1.9.10', date: '2026-11-18', title: 'Smooth next-track buffering', items: [
    'Adjusted warm-buffer thresholds and stall timers to eliminate audio glitches during track starts and transitions.',
  ]},
  {version: '1.9.9', date: '2026-11-18', title: 'Faster direct links & pause memory', items: [
    'Direct mirror streams and AAC mobile selection start playback faster and keep paused songs warm for 90 seconds.',
  ]},
  {version: '1.9.8', date: '2026-11-18', title: 'Cloudflare audio stream bridge', items: [
    'Added /stream extraction endpoint on the Spot+ Cloudflare worker to speed up full-track resolution.',
  ]},
  {version: '1.9.7', date: '2026-11-17', title: 'InstantPlay playback engine', items: [
    'Faster song starts and switching: non-blocking L1/IndexedDB audio memory, preconnected bridge/audio hosts, and dual-player next-track buffering with skip-velocity protection.',
    'Smarter audio server routing: reliability + latency scoring with exponential-backoff circuit breakers avoids dead or flaky servers automatically.',
    'Better stability on cellular & iPhone: adaptive buffer targets, buffered-range seeking, accurate stall recovery, and HTTP Range (206) support for cached offline audio.',
  ]},
  {version: '1.9.6', date: '2026-11-17', title: 'Tracks play reliably again', items: [
    'Fixed songs getting stuck on “Finding audio…” when public Piped and Invidious audio servers are down or rate-limited.',
    'Songs now fail over quickly past dead servers, play the full track via Spot+’s embedded YouTube player, and fall back to a 30-second catalog preview if needed.',
    'Added mobile autoplay prompt support so phones/iOS let you tap Play immediately instead of hanging.',
  ]},
  {version: '1.9.5', date: '2026-11-17', title: 'Podcasts fixed, faster song starts', items: [
    'Podcasts work again: top shows and podcast search now use two public directories with automatic fallback, so shows load even if one directory is down.',
    'Songs load faster: dead or blocked audio servers are skipped right away instead of retrying, more servers are checked in parallel, and stalled streams switch sooner.',
  ]},
  {version: '1.9.4', date: '2026-11-16', title: 'More songs play, easy updates', items: [
    'Songs from your Spotify playlists that still couldn’t be found get a second try, using the music catalog’s spelling of the artist (great for local and regional artists).',
    'New “Check for updates” button in Settings › What’s new. Spot+ also checks for updates every time you open it.',
  ]},
  {version: '1.9.3', date: '2026-11-16', title: 'Songs with several artists play again', items: [
    'Fixed “No audio server answered” for songs credited to several artists (like “Jala, Buba Corelli”): any of the artists now counts when finding the recording.',
    'Collab titles like “Artist A x Artist B - Song” are no longer mistaken for mashups.',
  ]},
  {version: '1.9.2', date: '2026-11-16', title: 'Right song, smooth sound', items: [
    'Fixed songs sometimes playing a mashup or a different recording: mashups, medleys and “song x song” blends are no longer accepted, and every song is re-matched once.',
    'Fixed choppy audio: if an audio server can’t keep up, Spot+ switches to another one mid-song and stops using that server for fast starts.',
    'With effects off, sound no longer goes through the effects at all, so nothing changes the original.',
  ]},
  {version: '1.9.1', date: '2026-11-16', title: 'Developer profile fix', items: ['The “Made by” section now loads the developer’s Discord picture reliably.']},
  {version: '1.9.0', date: '2026-11-16', title: 'Faster, sharper loops for every song', items: [
    'Loops load much faster: one shared, cached search finds the official music video, which then plays straight from an audio server that works for you.',
    'The next song’s loop is found while the current one plays, so it starts instantly.',
    'Music-video loops are cropped tighter to fill the screen and hide black bars, in up to 1080p on fast connections.',
    'Loops last 10 seconds and come from about a third of the way in, past the intro and near the first chorus.',
    'Every song now has visuals: when there’s no loop, the album art fills the screen and slowly drifts.',
  ]},
  {version: '1.8.1', date: '2026-11-16', title: 'Even faster song starts', items: [
    'Songs start right away when Spot+ already knows the recording: it plays straight from the last audio server that worked for you, instead of asking a server for the audio links first.',
    'If that server is slow, Spot+ moves on after 3.5 seconds instead of 6.',
    'On computers, hovering over a song starts finding it before you click.',
  ]},
  {version: '1.8.0', date: '2026-11-16', title: 'Podcasts and audiobooks', items: [
    'Podcasts: browse the top shows or search any public podcast, follow shows, and play episodes right in Spot+.',
    'Audiobooks: thousands of free classic books read by LibriVox volunteers, from Sherlock Holmes to The Art of War.',
    'Spot+ remembers where you stopped in every episode and chapter, with a Continue listening row.',
    'Skip back 15 seconds or forward 30 in Now Playing, and episode notes in the Lyrics tab.',
    'Shows that are only on Spotify, and Spotify’s paid audiobooks, can’t be played outside Spotify.',
  ]},
  {version: '1.7.0', date: '2026-11-16', title: 'Playlist generator', items: [
    'New playlist generator (Create › Generate a playlist): start from your taste, artists, songs or genres, pick vibes, then tune familiar ↔ new, deep cuts ↔ big hits, length, songs per artist, order and clean-only. Preview it, regenerate, play or save.',
    'The full changelog is now in Settings.',
    'New “Made by” section in Settings with the developer’s live Discord profile and a link to the Spot+ Discord.',
  ]},
  {version: '1.6.1', date: '2026-11-16', title: 'Bigger launch logo', items: ['The Spot+ logo on the launch screen is a bit bigger.']},
  {version: '1.6.0', date: '2026-11-16', title: 'Daily Mixes, device sync, sing-along and more', items: [
    'Daily Mixes: up to 6 fresh mixes every day on Home, built from what you play, like and skip.',
    'Smart Radio: when your queue ends, music keeps going with similar songs. Skips teach it what you don’t want.',
    'Link your devices (Settings › Your devices): scan a code and your likes and playlists stay the same on your phone and computer. Encrypted, no account.',
    'Edit playlists together: tap the share button on a playlist, send the link, and everyone can add and remove songs live.',
    'Sing-along: tap Sing along in Lyrics to turn the vocals down and follow the words as they fill in. There’s also a Vocal remover slider in ✨ effects.',
    'AutoMix (Settings › Playback): songs blend into each other like a DJ set. Not available on iPhone and iPad.',
  ]},
  {version: '1.5.1', date: '2026-11-16', title: 'Cleaner launch screen', items: ['The launch screen now shows just the Spot+ logo.']},
  {version: '1.5.0', date: '2026-11-16', title: 'Live counters', items: [
    'See how many people are listening to Spot+ right now, and how many have installed it, live on Home and the download page.',
    'Counts are anonymous: each device is a random code, nothing about you or your music is sent.',
  ]},
  {version: '1.4.0', date: '2026-11-16', title: 'Download playlists, smoother effects', items: [
    'Download whole playlists and Liked Songs with one tap, just like Spotify. The button fills up as it goes, turns green when done, and tapping it again stops or removes the download.',
    'Downloaded playlists stay downloaded: songs you add later download by themselves.',
    'Downloads run 3 songs at a time and prefer audio servers that allow downloading.',
    'Sound effects respond instantly: reverb rooms are built ahead of time and crossfade, speed changes glide, and the panel no longer redraws while you drag.',
    'Turning effects on no longer restarts the song when the audio server is already known to support them.',
    'The launch screen stays up a little longer.',
    'New “What’s new” screen after every update.',
  ]},
  {version: '1.3.1', date: '2026-11-16', title: 'Effects and lock screen fixes', items: [
    'Songs no longer fail or keep pausing with effects on. Songs whose audio server can’t do effects play normally instead.',
    'Lock-screen play no longer flashes an old song, and resuming after a long pause refreshes an expired audio link.',
  ]},
  {version: '1.3.0', date: '2026-11-16', title: 'Sound effects', items: [
    'New ✨ button in Now Playing: Slowed + Reverb, Nightcore, 8D Audio, Lo-fi, Bass Boost and more.',
    'Live speed, pitch, reverb (4 rooms), bass, 8D and lo-fi controls.',
  ]},
  {version: '1.2.0', date: '2026-11-16', title: 'Speed patch v2', items: [
    'Songs start much faster: a shared, cached song lookup means most songs need one server trip instead of two.',
    'Spot+ learns which audio servers are fastest for you and skips slow ones sooner.',
    'Recently played songs start instantly, even after reopening the app.',
  ]},
  {version: '1.1.0', date: '2026-11-16', title: 'Fixes', items: [
    'Music no longer keeps playing after you pause or close the app.',
    'The Update button on the new-version message works.',
  ]},
  {version: '1.0.0', date: '2026-11-16', title: 'Spot+ launch', items: ['First public release.']},
];
export const APP_VERSION = CHANGELOG[0].version;
const SEEN = 'spotplus.seenVersion';
const newer = (a, b) => { const x = a.split('.').map(Number), y = b.split('.').map(Number); for (let i = 0; i < 3; i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0); return false; };
/** Releases this person hasn't seen yet. First-time users see nothing (they get the welcome tour instead). */
export function unseen(storage = globalThis.localStorage) {
  let seen = null; try { seen = storage.getItem(SEEN); } catch { /* storage blocked */ }
  // Existing users from before this screen existed: show just the latest release once.
  if (!seen) { let returning = false; try { returning = !!storage.getItem('spotplus.onboarded.v2'); } catch { /* blocked */ } return returning ? CHANGELOG.slice(0, 1) : []; }
  return CHANGELOG.filter(entry => newer(entry.version, seen)).slice(0, 3);
}
export function markSeen(storage = globalThis.localStorage) { try { storage.setItem(SEEN, APP_VERSION); } catch { /* storage blocked */ } }
