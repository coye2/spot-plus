import test from 'node:test';
import assert from 'node:assert/strict';
import { browserMocks, FakeAudio, settle } from './helpers.mjs';

browserMocks();

function installDomMocks() {
  const host = {
    children: [],
    replaceChildren(...nodes) { this.children = nodes; }
  };
  const iframes = [];
  const messageListeners = [];
  let jsonpResponder = null;

  globalThis.window = {
    addEventListener(type, fn) { if (type === 'message') messageListeners.push(fn); },
    dispatchEvent() {},
    caches: {}
  };
  globalThis.document = {
    getElementById(id) { return id === 'ytEmbedBox' ? host : null; },
    head: {
      appendChild(el) {
        if (el?.tagName === 'SCRIPT' && el.src && jsonpResponder) {
          queueMicrotask(() => {
            const url = new URL(el.src);
            const cb = url.searchParams.get('callback');
            const payload = jsonpResponder(url);
            if (cb && typeof globalThis.window[cb] === 'function') globalThis.window[cb](payload);
          });
        }
      },
      append() {}
    },
    createElement(tag) {
      if (tag === 'iframe') {
        const posted = [];
        const listeners = {};
        const frame = {
          tagName: 'IFRAME',
          src: '',
          className: '',
          title: '',
          posted,
          setAttribute() {},
          addEventListener(type, fn) { (listeners[type] ||= []).push(fn); },
          trigger(type) { (listeners[type] || []).forEach(fn => fn()); },
          contentWindow: {
            postMessage(msg, origin) { posted.push({ msg: JSON.parse(msg), origin }); }
          }
        };
        iframes.push(frame);
        return frame;
      }
      if (tag === 'script') {
        return { tagName: 'SCRIPT', src: '', remove() {}, onerror: null };
      }
      return new FakeAudio();
    }
  };
  return {
    host,
    iframes,
    setJsonpResponder(fn) { jsonpResponder = fn; },
    emitMessage(origin, data) {
      const event = { origin, data: typeof data === 'string' ? data : JSON.stringify(data) };
      for (const fn of [...messageListeners]) fn(event);
    }
  };
}

const dom = installDomMocks();
const api = await import('../js/api.js');
const player = await import('../js/player.js');
const { YouTubeEmbedPlayer } = await import('../js/yt-embed.js');

test('auto mode uses the full YouTube player before a preview when servers fail; youtube mode uses youtube-embed', async () => {
  localStorage.clear();
  localStorage.setItem('spotplus.settings', JSON.stringify({ source: 'auto' }));
  const prevFetch = globalThis.fetch;
  dom.setJsonpResponder((url) => {
    if (url.pathname === '/track/yt-fb-1') return { data: [] };
    if (url.pathname === '/search') {
      return {
        data: [
          {
            id: 9901,
            title: 'Blinding Lights',
            duration: 200,
            artist: { name: 'The Weeknd' },
            preview: 'https://cdnt-preview.dzcdn.net/api/1/1/blinding.mp3'
          }
        ]
      };
    }
    return { data: [] };
  });
  globalThis.fetch = async (url) => {
    url = String(url);
    if (url.includes('/match')) {
      return new Response(JSON.stringify({
        items: [
          { id: 'fHI8X4OXluQ', title: 'The Weeknd - Blinding Lights (Official Audio)', channel: 'The Weeknd', duration: 204 },
          { id: '4NRXx6U8ABQ', title: 'Blinding Lights', channel: 'The Weeknd - Topic', duration: 202 }
        ]
      }));
    }
    return new Response('down', { status: 503 });
  };
  try {
    const autoRes = await api.resolve(
      { id: 'yt-fb-1', title: 'Blinding Lights', artist: 'The Weeknd', duration: 200 },
      { allowEmbed: true }
    );
    assert.equal(autoRes.kind, 'youtube-embed');
    // Without the interactive player (downloads, effects), Auto still falls back to the preview.
    const noEmbed = await api.resolve(
      { id: 'yt-fb-1b', title: 'Blinding Lights', artist: 'The Weeknd', duration: 200 },
      { allowEmbed: false }
    );
    assert.equal(noEmbed.kind, 'preview');

    // Explicit youtube source uses youtube-embed, while download / cors never receives embed
    localStorage.setItem('spotplus.settings', JSON.stringify({ source: 'youtube' }));
    const embed = await api.resolve(
      { id: 'yt-fb-2', title: 'Blinding Lights', artist: 'The Weeknd', duration: 200 },
      { allowEmbed: true }
    );
    assert.equal(embed.kind, 'youtube-embed');
    assert.equal(embed.videoId, '4NRXx6U8ABQ');
    assert.deepEqual(embed.videoIds, ['4NRXx6U8ABQ', 'fHI8X4OXluQ']);

    await assert.rejects(
      () => api.resolve({ id: 'yt-fb-2', title: 'Blinding Lights', artist: 'The Weeknd', duration: 200 }, { cors: true }),
      /requires interactive playback/
    );
  } finally {
    dom.setJsonpResponder(null);
    globalThis.fetch = prevFetch;
  }
});

test('auto mode falls back to Deezer preview if /match also fails', async () => {
  localStorage.clear();
  localStorage.setItem('spotplus.settings', JSON.stringify({ source: 'auto' }));
  const prevFetch = globalThis.fetch;
  dom.setJsonpResponder((url) => {
    if (url.pathname === '/track/9001') {
      return {
        id: 9001,
        title: 'Preview Song',
        duration: 190,
        artist: { name: 'Preview Artist' },
        preview: 'https://cdnt-preview.dzcdn.net/api/1/1/preview.mp3'
      };
    }
    return { data: [] };
  });
  globalThis.fetch = async () => new Response('down', { status: 503 });
  try {
    const res = await api.resolve(
      { id: '9001', title: 'Preview Song', artist: 'Preview Artist', duration: 190 },
      { allowEmbed: true }
    );
    assert.equal(res.kind, 'preview');
    assert.equal(res.preview, true);
    assert.equal(res.url, 'https://cdnt-preview.dzcdn.net/api/1/1/preview.mp3');
  } finally {
    dom.setJsonpResponder(null);
    globalThis.fetch = prevFetch;
  }
});

test('YouTubeEmbedPlayer handles lifecycle messages, candidate rotation, seek, pause, dedupes ended, and stop', () => {
  const beforeCount = dom.iframes.length;
  const events = [];
  const yt = new YouTubeEmbedPlayer({
    onReady: () => events.push('ready'),
    onPlaying: () => events.push('playing'),
    onPause: () => events.push('pause'),
    onTime: (t) => events.push(`time:${t}`),
    onEnded: () => events.push('ended'),
    onError: (msg) => events.push(`error:${msg}`)
  });

  assert.equal(yt.load(['aaaaaaaaaaa', 'bbbbbbbbbbb'], { startAt: 15, autoplay: true, volume: 0.6 }), true);
  assert.equal(dom.iframes.length, beforeCount + 1);
  const frame = dom.iframes.at(-1);
  assert.match(frame.src, /embed\/aaaaaaaaaaa\?enablejsapi=1&autoplay=1.*&start=15/);

  // Simulate candidate 1 playback error -> rotates to candidate 2
  dom.emitMessage('https://www.youtube.com', { event: 'onError', info: 150 });
  assert.equal(yt.videoId, 'bbbbbbbbbbb');
  assert.match(frame.src, /embed\/bbbbbbbbbbb/);

  // Simulate ready + playing telemetry
  dom.emitMessage('https://www.youtube.com', { event: 'onReady' });
  dom.emitMessage('https://www.youtube.com', { event: 'infoDelivery', info: { duration: 210, currentTime: 16, playerState: 1 } });
  assert.equal(yt.ready, true);
  assert.equal(yt.paused, false);
  assert.equal(yt.duration, 210);
  assert.equal(yt.currentTime, 16);
  assert.ok(events.includes('ready'));
  assert.ok(events.includes('playing'));
  assert.ok(events.includes('time:16'));

  // Seek and pause commands post YouTube API commands
  yt.seek(42);
  assert.equal(yt.currentTime, 42);
  yt.pause();
  assert.equal(yt.paused, true);
  assert.ok(events.includes('pause'));
  assert.ok(frame.posted.some(p => p.msg.func === 'seekTo' && p.msg.args[0] === 42));
  assert.ok(frame.posted.some(p => p.msg.func === 'pauseVideo'));

  // Duplicate ended signals for the same generation emit onEnded once
  dom.emitMessage('https://www.youtube.com', { event: 'infoDelivery', info: { playerState: 0 } });
  dom.emitMessage('https://www.youtube.com', { event: 'onStateChange', info: 0 });
  assert.equal(events.filter(e => e === 'ended').length, 1);
  yt.stop();
  assert.equal(yt.active, false);
  // The booted player stays loaded (stopped, silent) so the next song swaps in instantly.
  assert.notEqual(frame.src, 'about:blank');
  assert.ok(frame.posted.some(p => p.msg.func === 'stopVideo'));
});

test('a booted YouTube player swaps the next song in place instead of reloading', () => {
  const yt = new YouTubeEmbedPlayer({});
  assert.equal(yt.warm('ccccccccccc'), true);
  const frame = dom.iframes.at(-1);
  assert.match(frame.src, /embed\/ccccccccccc\?enablejsapi=1&autoplay=0/);
  dom.emitMessage('https://www.youtube.com', { event: 'onReady' });
  assert.equal(yt.live, true);
  const src = frame.src;
  yt.load(['ddddddddddd'], { startAt: 0, autoplay: true, volume: 1 });
  assert.equal(frame.src, src, 'no full reload');
  assert.ok(frame.posted.some(p => p.msg.func === 'loadVideoById' && p.msg.args[0].videoId === 'ddddddddddd'));
  yt.stop();
});

test('player unifies position, pause, seek, and preview fallback only when YouTube player is selected', async () => {
  localStorage.clear();
  localStorage.setItem('spotplus.settings', JSON.stringify({ source: 'youtube' }));
  const prevFetch = globalThis.fetch;
  dom.setJsonpResponder((url) => {
    if (url.pathname === '/track/9002') {
      return {
        id: 9002,
        title: 'Track',
        duration: 200,
        artist: { name: 'Artist' },
        preview: 'https://cdnt-preview.dzcdn.net/api/1/1/track9002.mp3'
      };
    }
    return { data: [] };
  });
  globalThis.fetch = async (url) => {
    url = String(url);
    if (url.includes('/match')) {
      return new Response(JSON.stringify({
        items: [{ id: 'cccccccccc1', title: 'Artist - Track', channel: 'Artist', duration: 200 }]
      }));
    }
    return new Response('down', { status: 503 });
  };
  try {
    player.playList([{ id: '9002', title: 'Track', artist: 'Artist', duration: 200 }]);
    await settle();
    assert.equal(player.isEmbed(), true);
    dom.emitMessage('https://www.youtube.com', { event: 'onReady' });
    dom.emitMessage('https://www.youtube.com', { event: 'infoDelivery', info: { duration: 200, currentTime: 25, playerState: 1 } });
    assert.equal(player.isPaused(), false);
    assert.equal(player.position(), 25);
    assert.equal(player.canSeek(), true);
    player.toggle();
    assert.equal(player.isPaused(), true);

    // Explicitly invoking 30s preview button (or fallback in auto mode) switches to preview
    await player.fallbackToPreview('unembeddable', { allowPreview: true });
    await settle();
    assert.equal(player.state.source?.kind, 'preview');
    assert.equal(player.isEmbed(), false);
  } finally {
    dom.setJsonpResponder(null);
    globalThis.fetch = prevFetch;
  }
});

test('a wider YouTube net keeps the same song and drops covers, remixes, and wrong lengths', async () => {
  const api = await import('../js/api.js');
  const t = { title: 'Blinding Lights', artist: 'The Weeknd', duration: 200 };
  const items = [
    { id: 'aaaaaaaaaaa', title: 'The Weeknd - Blinding Lights (Official Video)', channel: 'TheWeekndVEVO', duration: 263 },
    { id: 'bbbbbbbbbbb', title: 'The Weeknd - Blinding Lights (Lyrics)', channel: 'Lyric Hub', duration: 201 },
    { id: 'ccccccccccc', title: 'Blinding Lights - piano cover', channel: 'Some Pianist The Weeknd fan', duration: 200 },
    { id: 'ddddddddddd', title: 'The Weeknd - Blinding Lights (slowed + reverb)', channel: 'x', duration: 260 },
    { id: 'eeeeeeeeeee', title: 'The Weeknd - Blinding Lights 1 hour', channel: 'x', duration: 3600 },
    { id: 'fffffffffff', title: 'Dua Lipa - Levitating', channel: 'Dua Lipa', duration: 203 },
  ];
  assert.deepEqual(api.looseEmbedMatches(items, t).map(x => x.id), ['aaaaaaaaaaa', 'bbbbbbbbbbb']);
});
