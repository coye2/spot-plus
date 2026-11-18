// Release notes: the single source for the in-app "What's new" screen and CHANGELOG.md.
// Newest first. Add an entry with every fix.
export const CHANGELOG = [
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
