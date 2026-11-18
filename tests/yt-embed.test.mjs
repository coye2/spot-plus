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

test('auto mode falls back to youtube-embed when allowEmbed is true and download/cors never receives embed', async () => {
  localStorage.clear();
  localStorage.setItem('spotplus.settings', JSON.stringify({ source: 'auto' }));
  const prevFetch = globalThis.fetch;
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
    const embed = await api.resolve(
      { id: 'yt-fb-1', title: 'Blinding Lights', artist: 'The Weeknd', duration: 200 },
      { allowEmbed: true }
    );
    assert.equal(embed.kind, 'youtube-embed');
    assert.equal(embed.videoId, '4NRXx6U8ABQ');
    assert.deepEqual(embed.videoIds, ['4NRXx6U8ABQ', 'fHI8X4OXluQ']);

    // Download / CORS callers must NOT receive the cached youtube-embed result
    await assert.rejects(
      () => api.resolve({ id: 'yt-fb-1', title: 'Blinding Lights', artist: 'The Weeknd', duration: 200 }, { cors: true }),
      /No audio server/
    );
  } finally {
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

test('YouTubeEmbedPlayer handles lifecycle messages, candidate rotation, seek, pause, and stop', () => {
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

  // Ended + stop
  dom.emitMessage('https://www.youtube.com', { event: 'onStateChange', info: 0 });
  assert.ok(events.includes('ended'));
  yt.stop();
  assert.equal(yt.active, false);
  assert.equal(frame.src, 'about:blank');
});

test('player unifies position, pause, seek, and preview fallback when playing youtube-embed', async () => {
  localStorage.clear();
  localStorage.setItem('spotplus.settings', JSON.stringify({ source: 'auto' }));
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

    // If YouTube reports non-embeddable error, fallbackToPreview loads Deezer 30s preview
    dom.emitMessage('https://www.youtube.com', { event: 'onError', info: 101 });
    await settle();
    assert.equal(player.state.source?.kind, 'preview');
    assert.equal(player.isEmbed(), false);
  } finally {
    dom.setJsonpResponder(null);
    globalThis.fetch = prevFetch;
  }
});
