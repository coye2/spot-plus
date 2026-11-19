// End-to-end playback test: the production build in Chrome with an iPhone user agent, playing real songs
// through the live worker. Checks full-length audio (no 30 s clips), SponsorBlock skips, automatic queue
// advance, playback continuing while the page is hidden, and the lock-screen metadata.
// It cannot test iOS itself (background audio, the lock screen); those need a real iPhone.
// Run: npm run build && node scripts/smoke-playback.mjs   (CHROME=/path/to/chrome to pick a browser)
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {ALLOWED_ID_HASHES, DEV_ACCESS_STORAGE_KEY, createSessionToken} from '../js/maintenance.js';
import {APP_VERSION} from '../js/changelog.js';

const {chromium} = await import('playwright').catch(() => import(process.env.PLAYWRIGHT_CORE || 'playwright-core'));
// The worker only answers pages from Spot+'s own site and its local test address (port 8080).
const port = '8080';
const origin = 'http://127.0.0.1:' + port;
const sleep = (ms) => new Promise((ok) => setTimeout(ok, ms));
const server = spawn(process.execPath, ['scripts/serve.mjs', 'dist'], {env: {...process.env, PORT: port}, stdio: ['ignore', 'pipe', 'pipe']});
let logs = '';
server.stdout.on('data', (d) => { logs += d; });
server.stderr.on('data', (d) => { logs += d; });
const proxy = process.env.HTTPS_PROXY || process.env.https_proxy;
let browser;
const report = [];
const log = (line) => { report.push(line); console.log(line); };
try {
  for (let n = 0; n < 100 && !logs.includes('Spot+ http://'); n++) await sleep(100);
  browser = await chromium.launch({
    headless: true,
    executablePath: process.env.CHROME || undefined,
    args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'],
    ...(proxy ? {proxy: {server: proxy, bypass: '127.0.0.1,localhost'}} : {}),
  });
  const ctx = await browser.newContext({
    viewport: {width: 390, height: 844}, hasTouch: true, isMobile: true, serviceWorkers: 'block',
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 26_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1',
  });
  await ctx.addInitScript(({key, token, version}) => {
    try {
      localStorage.setItem('spotplus.landing', '1');
      localStorage.setItem('spotplus.onboarded.v2', '1');
      localStorage.setItem('spotplus.onboarded.v2.installed', '1');
      localStorage.setItem('spotplus.seenVersion', version);
      localStorage.setItem(key, token);
    } catch { /* storage blocked */ }
    Object.defineProperty(navigator, 'standalone', {configurable: true, value: true});
    // Lets the test hide the page the way leaving the app does.
    let hidden = false;
    Object.defineProperty(document, 'hidden', {configurable: true, get: () => hidden});
    Object.defineProperty(document, 'visibilityState', {configurable: true, get: () => (hidden ? 'hidden' : 'visible')});
    globalThis.__setHidden = (value) => { hidden = value; document.dispatchEvent(new Event('visibilitychange')); };
  }, {key: DEV_ACCESS_STORAGE_KEY, token: createSessionToken(ALLOWED_ID_HASHES[0], {origin}), version: APP_VERSION});
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const relayRanges = [];
  page.on('request', (r) => { if (r.url().includes('/yta?')) relayRanges.push(r.headers().range || '(none)'); });
  if (process.env.DEBUG) {
    page.on('response', (r) => { if (/workers\.dev|sponsor\.ajay/.test(r.url())) console.log('   ', r.status(), r.url().slice(0, 110)); });
    page.on('requestfailed', (r) => console.log('    FAILED', r.url().slice(0, 110), r.failure()?.errorText));
    page.on('console', (m) => { if (/error|warn/.test(m.type())) console.log('    console.' + m.type(), m.text().slice(0, 200)); });
  }
  await page.goto(origin + '/', {waitUntil: 'load'});
  await sleep(2500);

  const snap = () => page.evaluate(async () => {
    const p = await import('./js/player.js');
    const s = p.state.source || {};
    return {index: p.state.index, title: p.current()?.title, playing: p.isPlaying(), pos: p.position(), elDur: p.el.duration,
      kind: s.kind, videoId: s.videoId, error: p.state.error || '', loading: !!p.state.loading,
      meta: navigator.mediaSession?.metadata?.title || '', mediaError: p.el.error ? p.el.error.code + ' ' + p.el.error.message : ''};
  });
  const waitFor = async (pred, ms, label) => {
    const end = Date.now() + ms;
    let last;
    while (Date.now() < end) { last = await snap(); if (pred(last)) return last; await sleep(200); }
    throw new Error(`${label} timed out: ${JSON.stringify(last)}`);
  };
  const play = (tracks, source) => page.evaluate(async ({tracks, source}) => {
    (await import('./js/store.js')).setSettings({source});
    (await import('./js/player.js')).playList(tracks, 0);
  }, {tracks, source});
  const seek = (sec) => page.evaluate(async (sec) => (await import('./js/player.js')).seek(sec), sec);
  const segmentsOf = (id) => page.evaluate(async (id) => (await import('./js/sponsorblock.js')).segmentsFor(id), id);

  // Each song must start, be the full song, and then hand over to the next song by itself.
  async function checkSong(i, label, {hidden = false} = {}) {
    const started = Date.now();
    const s = await waitFor((x) => x.index === i && x.playing && x.pos > 0.3 && x.elDur > 0, 30000, `${label}: start`);
    const startup = ((Date.now() - started) / 1000).toFixed(1);
    assert.ok(s.elDur > 90, `${label}: ${s.elDur}s is a clip, not the full song`);
    assert.equal(s.meta, s.title, `${label}: lock-screen title`);
    log(`OK  ${label}: "${s.title}" via ${s.kind}${s.videoId ? ' ' + s.videoId : ''}, full length ${Math.round(s.elDur)}s, playing after ${startup}s${hidden ? ' (page hidden)' : ''}`);
    return s;
  }
  async function checkAdvance(i, label) {
    const s = await snap();
    await seek(s.elDur - 4);
    await waitFor((x) => x.index === i + 1, 20000, `${label}: moves to the next song`);
    log(`OK  ${label}: moved to the next song by itself`);
  }

  // 1. The Spotube-style YouTube relay on its own.
  const relaySongs = [
    {id: 'e2e-cure', title: 'the cure', artist: 'Olivia Rodrigo', duration: 0},
    {id: 'e2e-espresso', title: 'Espresso', artist: 'Sabrina Carpenter', duration: 175},
    {id: 'e2e-numb', title: 'Numb', artist: 'Linkin Park', duration: 185},
  ];
  const t0 = Date.now();
  await play(relaySongs, process.env.SOURCE || 'ytrelay');
  const first = await checkSong(0, 'Relay song 1');
  log(`    time from tap to sound: ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  if (!process.env.SOURCE) assert.equal(first.kind, 'ytrelay');

  // SponsorBlock: a non-music intro is skipped at the start; a non-music outro ends the song early.
  const segs = await segmentsOf(first.videoId);
  const intro = segs.find(([a]) => a < 1);
  const outro = segs.find(([, b]) => b >= first.elDur - 2);
  if (intro) {
    const at = await waitFor((x) => x.pos >= intro[1] - 0.25, 8000, 'SponsorBlock intro skip');
    log(`OK  SponsorBlock: skipped the non-music intro 0-${intro[1].toFixed(1)}s (now at ${at.pos.toFixed(1)}s)`);
  } else log(`--  SponsorBlock: upload ${first.videoId} has no marked intro`);
  if (outro) {
    await seek(outro[0] - 1.5);
    await waitFor((x) => x.index === 1, 15000, 'SponsorBlock outro skip');
    log(`OK  SponsorBlock: skipped the non-music outro from ${outro[0].toFixed(1)}s and moved to the next song`);
  } else await checkAdvance(0, 'Relay song 1');

  // 2. Leave the app: playback continues and the queue advances while hidden.
  await page.evaluate(() => globalThis.__setHidden(true));
  const before = await checkSong(1, 'Relay song 2', {hidden: true});
  await sleep(3000);
  const after = await snap();
  assert.ok(after.playing && after.pos > before.pos + 2, `kept playing while hidden: ${before.pos} -> ${after.pos}`);
  log(`OK  Hidden page: still playing (${before.pos.toFixed(1)}s -> ${after.pos.toFixed(1)}s)`);
  await checkAdvance(1, 'Relay song 2 (hidden)');
  await checkSong(2, 'Relay song 3', {hidden: true});
  await page.evaluate(() => globalThis.__setHidden(false));

  // 3. Automatic mode, the default: whichever full-song source answers first.
  await play([
    {id: 'e2e-bohemian', title: 'Bohemian Rhapsody', artist: 'Queen', duration: 354},
    {id: 'e2e-clint', title: 'Clint Eastwood', artist: 'Gorillaz', duration: 341},
  ], 'auto');
  await checkSong(0, 'Auto song 1');
  await checkAdvance(0, 'Auto song 1');
  await checkSong(1, 'Auto song 2');

  const ranges = [...new Set(relayRanges)].slice(0, 6).join(', ');
  log(`    relay requests: ${relayRanges.length} (ranges seen: ${ranges})`);
  assert.deepEqual(errors, [], 'page errors');
  log('PASS');
} finally {
  await browser?.close();
  server.kill();
}
