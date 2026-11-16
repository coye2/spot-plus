// Release notes: the single source for the in-app "What's new" screen and CHANGELOG.md.
// Newest first. Add an entry with every fix.
export const CHANGELOG = [
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
