import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {browserMocks, settle} from './helpers.mjs';

browserMocks();

const actionHandlers = new Map();
let lastPositionState = null;
globalThis.MediaMetadata = class MediaMetadata {
  constructor(init) { Object.assign(this, init); }
};
Object.defineProperty(globalThis, 'navigator', {
  configurable: true,
  value: {
    mediaSession: {
      metadata: null,
      playbackState: 'none',
      setActionHandler(action, handler) { actionHandlers.set(action, handler); },
      setPositionState(state) { lastPositionState = state; },
    },
  },
});

const player = await import('../js/player.js');
const api = await import('../js/api.js');
const {memoryEngine} = await import('../js/memory-engine.js');

test('lock screen Media Session clears 10s seek handlers so iOS shows full-song Previous/Next skip buttons', () => {
  assert.equal(typeof actionHandlers.get('play'), 'function');
  assert.equal(typeof actionHandlers.get('pause'), 'function');
  assert.equal(typeof actionHandlers.get('previoustrack'), 'function');
  assert.equal(typeof actionHandlers.get('nexttrack'), 'function');
  assert.equal(typeof actionHandlers.get('seekto'), 'function');
  assert.equal(actionHandlers.get('seekbackward'), null, 'seekbackward must be null so iOS shows Previous Track');
  assert.equal(actionHandlers.get('seekforward'), null, 'seekforward must be null so iOS shows Next Track');
});

test('background ended auto-advance and lock-screen nexttrack reuse the active audio element without blanking src', async () => {
  const track1 = {id: 'bg-1', title: 'Car Crash', artist: 'Colorblind', album: 'Car Crash', duration: 200};
  const track2 = {id: 'bg-2', title: 'Second Song', artist: 'Colorblind', album: 'Album 2', duration: 210};
  const track3 = {id: 'bg-3', title: 'Third Song', artist: 'Colorblind', album: 'Album 3', duration: 195};

  memoryEngine.putStream(api.streamKey(track1), {
    url: 'https://spot-plus-canvas.pwr97pnmkn.workers.dev/yta?id=11111111111&fmt=aac',
    mime: 'audio/mp4', bitrate: 128000, kind: 'ytrelay', instance: 'relay', videoId: '11111111111', alternatives: [],
  });
  memoryEngine.putStream(api.streamKey(track2), {
    url: 'https://spot-plus-canvas.pwr97pnmkn.workers.dev/yta?id=22222222222&fmt=aac',
    mime: 'audio/mp4', bitrate: 128000, kind: 'ytrelay', instance: 'relay', videoId: '22222222222', alternatives: [],
  });
  memoryEngine.putStream(api.streamKey(track3), {
    url: 'https://spot-plus-canvas.pwr97pnmkn.workers.dev/yta?id=33333333333&fmt=aac',
    mime: 'audio/mp4', bitrate: 128000, kind: 'ytrelay', instance: 'relay', videoId: '33333333333', alternatives: [],
  });

  // Start track 1 in foreground.
  globalThis.document.hidden = false;
  player.playList([track1, track2, track3], 0);
  await settle();

  const activeEl = player.el;
  assert.equal(player.current()?.id, 'bg-1');
  assert.equal(activeEl.paused, false);
  assert.equal(navigator.mediaSession.metadata?.title, 'Car Crash');

  // Lock screen / move app to background and spy on removeAttribute('src').
  globalThis.document.hidden = true;
  let clearedSrc = false;
  const origRemove = activeEl.removeAttribute.bind(activeEl);
  activeEl.removeAttribute = (name) => {
    if (name === 'src') clearedSrc = true;
    return origRemove(name);
  };

  // 1) Track 1 ends while screen is locked -> must auto-advance to Track 2 on the SAME element.
  activeEl.dispatchEvent(new Event('ended'));
  await settle();

  assert.equal(player.current()?.id, 'bg-2', 'ended while locked must advance to next track');
  assert.equal(player.el, activeEl, 'background auto-advance must keep the same active audio element');
  assert.equal(clearedSrc, false, 'background auto-advance must not tear down src before loading next track');
  assert.equal(activeEl.paused, false, 'next track must automatically start playing');
  assert.match(activeEl.src, /22222222222/);
  assert.equal(navigator.mediaSession.metadata?.title, 'Second Song');

  // 2) Tap Next on Lock Screen -> must skip whole song to Track 3 on the SAME element.
  actionHandlers.get('nexttrack')();
  await settle();

  assert.equal(player.current()?.id, 'bg-3', 'lock screen nexttrack must skip to Track 3');
  assert.equal(player.el, activeEl, 'lock screen skip must reuse the same active audio element');
  assert.equal(activeEl.paused, false, 'skipped track must keep playing');
  assert.match(activeEl.src, /33333333333/);
  assert.equal(navigator.mediaSession.metadata?.title, 'Third Song');

  // 3) Tap Previous on Lock Screen at <= 3s -> must skip back to Track 2 on the SAME element.
  activeEl.currentTime = 1;
  actionHandlers.get('previoustrack')();
  await settle();
  assert.equal(player.current()?.id, 'bg-2', 'lock screen previoustrack must skip back to Track 2');
  assert.equal(player.el, activeEl);
  assert.equal(activeEl.paused, false);

  // 4) Lock screen seekto scrubber updates positionState.
  activeEl.currentTime = 0;
  actionHandlers.get('seekto')({seekTime: 42});
  assert.equal(activeEl.currentTime, 42);
  assert.equal(lastPositionState?.position, 42);

  // 5) Manual pause prevents ended from auto-advancing.
  player.pause();
  activeEl.dispatchEvent(new Event('ended'));
  await settle();
  assert.equal(player.current()?.id, 'bg-2', 'manual pause must not auto-advance on ended');

  // Clean up background flag for any subsequent tests.
  globalThis.document.hidden = false;
});

test('1.9.45 audio engine freeze guard: api.js keeps frozen Automatic source stack and relay settings', () => {
  const apiCode = readFileSync(new URL('../js/api.js', import.meta.url), 'utf8');
  assert.match(apiCode, /return \['soundcloud', 'ytrelay', 'monochrome', 'jiosaavn'\];/, '1.9.45 Automatic source list must remain frozen');
  // 1.9.49: no separate relay check request; the audio element's request is the only YouTube lookup.
  assert.doesNotMatch(apiCode, /RELAY_HEDGE_MS|RELAY_PROBE_MS/, 'relay songs make one YouTube lookup, not two');
});

test('Clear-wallpaper Settings cards have rounded corners, generous inner padding, and vertical spacing', () => {
  const css = readFileSync(new URL('../css/backgrounds.css', import.meta.url), 'utf8');
  assert.match(css, /body\[data-chrome=clear\]\[data-scene=on\] \.box\{[^}]*border-radius:18px/, 'Clear-mode .box must have rounded corners');
  assert.match(css, /body\[data-chrome=clear\]\[data-scene=on\] \.box\{[^}]*padding:22px 24px/, 'Clear-mode .box must have balanced desktop padding');
  assert.match(css, /body\[data-chrome=clear\]\[data-scene=on\] \.box\{[^}]*margin:0 0 14px/, 'Clear-mode .box must separate stacked cards vertically');
  assert.match(css, /@media\(max-width:767px\)\{[^}]*body\[data-chrome=clear\]\[data-scene=on\] \.box\{[^}]*padding:18px 16px/, 'Clear-mode mobile .box must have 16px horizontal padding');
});
