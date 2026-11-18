// Release notes: the single source for the in-app "What's new" screen and CHANGELOG.md.
// Newest first. Add an entry with every fix.
export const CHANGELOG = [
  {version: '1.9.13', date: '2026-11-18', title: 'Sharp backgrounds and a searchable wallpaper library', items: [
    'Backgrounds stay sharp. The app and library show the photo, without a blur over it. The player keeps its own color.',
    'The wallpaper library is the Alpha Coders category list: search by name, and browse every category.',
    'The background screen uses a short title, Upload and None side by side, and a simpler table.',
  ]},
  {version: '1.9.12', date: '2026-11-18', title: 'One playback message, and the preview still starts', items: [
    'A failed song no longer stacks the same “Playback failed” message on top of itself.',
    'When full audio cannot start, the 30-second preview is allowed to play. An error from the link that just died no longer cancels that preview.',
  ]},
  {version: '1.9.11', date: '2026-11-18', title: 'Backgrounds for the app and library', items: [
    'A background changer for the app and playlist areas. The player and the play bar keep their own color.',
    'Wallpapers are a 4K Alpha Coders catalog in an Apple-style table. The crop is instant: drag the preview, and the file size follows the device (1920 on a phone, the 4K original on a large screen).',
    'Upload your own image. It is cropped and lightly sharpened for this screen, and saved on the device.',
  ]},
  {version: '1.9.10', date: '2026-11-18', title: 'Playback stays on the link that is working', items: [
    'Fixed the glitch where a song restarted over and over while it was still connecting, then died with “No audio server answered.” Buffering is no longer treated as a failure.',
    'A link is only replaced after several seconds of silence, or when it actually errors. The first backup is tried in place, without tearing the player down.',
    'If full audio still cannot start, Spot+ plays the 30-second catalog preview so the song begins instead of stopping on an error.',
  ]},
  {version: '1.9.9', date: '2026-11-18', title: 'InstantPlay starts without waiting', items: [
    'Songs start as soon as the recording is known: Spot+ plays a direct audio link immediately and keeps backup links ready, instead of waiting on a slow or missing server.',
    'A bridge that doesn’t answer is abandoned in a fraction of a second so it can’t delay playback.',
    'The next songs are prepared as soon as audio is flowing, including on iPhone where Safari hides how much is buffered.',
    'If the first audio link stalls, Spot+ switches to the next one in about a second.',
  ]},
  {version: '1.9.8', date: '2026-11-18', title: 'InstantPlay audio bridge — songs play again', items: [
    'Fixed “No audio server answered”: Spot+ now resolves audio through its own InstantPlay bridge instead of depending on public Invidious/Piped mirrors that are down or blocked.',
    'Song starts stay InstantPlay-fast: match the recording, then get a direct audio link from the bridge in one step (AAC on iPhone).',
    'Dead or blocked mirrors are skipped for longer so retries don’t waste time on servers that keep answering 403.',
  ]},
  {version: '1.9.7', date: '2026-11-18', title: 'InstantPlay: Spotify-speed starts and skips', items: [
    'Songs start and skip faster: the next two tracks are found while you listen, and the next song’s audio is buffered as soon as the current one has enough headroom.',
    'Skipping stays instant after a short pause — Spot+ keeps the prepared next track ready instead of throwing it away.',
    'On iPhone and iPad, InstantPlay always uses AAC audio and playsinline media elements so Safari starts tracks reliably.',
    'Near the end of a song, a ready next track takes over seamlessly even when AutoMix can’t fade (Safari on iPhone/iPad).',
    'If a fast-start Opus stream stutters, Spot+ can switch to AAC mid-song without rematching the recording.',
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
