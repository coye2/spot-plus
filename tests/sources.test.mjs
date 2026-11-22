import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { browserMocks, settle } from './helpers.mjs';

browserMocks();

test('JioSaavn resolver selects clean AAC 320kbps release and rejects karaoke/nightcore knockoffs', async () => {
  localStorage.clear();
  localStorage.setItem('spotplus.settings', JSON.stringify({ source: 'jiosaavn', quality: 'high' }));
  const prevFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    url = String(url);
    if (url.includes('saavn.sumit.co/api/search/songs')) {
      return new Response(JSON.stringify({
        success: true,
        data: {
          results: [
            {
              id: 'bad-karaoke',
              name: 'Blinding Lights (Karaoke Version)',
              duration: 200,
              artists: { primary: [{ name: 'The Weeknd' }] },
              downloadUrl: [{ quality: '320kbps', url: 'https://aac.saavncdn.com/bad.mp4' }],
            },
            {
              id: 'good-saavn',
              name: 'Blinding Lights',
              duration: 200,
              artists: { primary: [{ name: 'The Weeknd' }] },
              downloadUrl: [
                { quality: '96kbps', url: 'https://aac.saavncdn.com/96.mp4' },
                { quality: '320kbps', url: 'https://aac.saavncdn.com/320.mp4' },
              ],
            },
          ],
        },
      }));
    }
    return new Response('not found', { status: 404 });
  };
  try {
    const api = await import('../js/api.js');
    api.clearStreamCache();
    const res = await api.resolve({ id: 'saavn-1', title: 'Blinding Lights', artist: 'The Weeknd', duration: 200 });
    assert.equal(res.kind, 'jiosaavn');
    assert.equal(res.engineLabel, 'JioSaavn');
    assert.equal(res.url, 'https://aac.saavncdn.com/320.mp4');
    assert.equal(res.bitrate, 320000);
    assert.equal(res.mime, 'audio/mp4');
  } finally {
    globalThis.fetch = prevFetch;
  }
});

test('HiFi / Monochrome resolver decodes BTS manifest FLAC streams and obeys data-saver AAC fallback', async () => {
  localStorage.clear();
  localStorage.setItem('spotplus.settings', JSON.stringify({
    source: 'hifi',
    quality: 'high',
    customHifi: 'https://hifi.example.test',
  }));
  const manifest = Buffer.from(JSON.stringify({
    mimeType: 'audio/flac',
    codecs: 'flac',
    urls: ['https://cdn.tidal.example/lossless.flac'],
  })).toString('base64');
  const prevFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    url = String(url);
    if (url.startsWith('https://hifi.example.test/search/')) {
      return new Response(JSON.stringify({
        data: { items: [{ id: 5511, title: 'Starboy', duration: 230, artist: { name: 'The Weeknd' }, allowStreaming: true }] },
      }));
    }
    if (url.startsWith('https://hifi.example.test/track/') && url.includes('quality=LOSSLESS')) {
      return new Response(JSON.stringify({
        data: { manifestMimeType: 'application/vnd.tidal.bts', manifest },
      }));
    }
    return new Response('down', { status: 503 });
  };
  try {
    const api = await import('../js/api.js');
    api.clearStreamCache();
    const res = await api.resolve({ id: 'hifi-1', title: 'Starboy', artist: 'The Weeknd', duration: 230 });
    assert.equal(res.kind, 'hifi');
    assert.equal(res.lossless, true);
    assert.equal(res.url, 'https://cdn.tidal.example/lossless.flac');
    assert.equal(res.mime, 'audio/flac');
  } finally {
    globalThis.fetch = prevFetch;
  }
});

test('Deezer mode returns Deezer preview, and auto mode never falls back to a clip', async () => {
  localStorage.clear();
  localStorage.setItem('spotplus.settings', JSON.stringify({ source: 'deezer' }));
  const prevFetch = globalThis.fetch;
  const api = await import('../js/api.js');
  api.clearStreamCache();

  try {
    const dz = await api.resolve({
      id: 'dz-1',
      title: 'Instant Crush',
      artist: 'Daft Punk',
      duration: 337,
      preview: 'https://cdnt-preview.dzcdn.net/stream/crush.mp3',
    });
    assert.equal(dz.kind, 'preview');
    assert.equal(dz.engineLabel, 'Deezer');
    assert.equal(dz.url, 'https://cdnt-preview.dzcdn.net/stream/crush.mp3');

    assert.equal(await api.resolveFull({ id: 'dz-1', title: 'Instant Crush', artist: 'Daft Punk' }), null);

    // Auto mode without direct preview falls back cleanly to iTunes AAC if Deezer + full engines fail
    localStorage.setItem('spotplus.settings', JSON.stringify({ source: 'auto' }));
    globalThis.fetch = async (url) => {
      url = String(url);
      if (url.startsWith('https://itunes.apple.com/search')) {
        return new Response(JSON.stringify({
          results: [{
            trackId: 888,
            trackName: 'Instant Crush',
            artistName: 'Daft Punk',
            trackTimeMillis: 337000,
            previewUrl: 'https://audio-ssl.itunes.apple.com/itunes-assets/crush.m4a',
          }],
        }));
      }
      return new Response('down', { status: 503 });
    };
    api.clearStreamCache();
    await settle();
    // Automatic never rescues with a 30-second clip.
    await assert.rejects(api.resolve({ id: 'it-1', title: 'Instant Crush', artist: 'Daft Punk', duration: 337 }));
  } finally {
    globalThis.fetch = prevFetch;
  }
});

test('the source dropdown offers Spot+ YouTube Relay first and no retired sources', async () => {
  const app = await readFile(new URL('../js/app.js', import.meta.url), 'utf8');
  const select = app.slice(app.indexOf('<select data-setting="source">'), app.indexOf('</select>', app.indexOf('<select data-setting="source">')));
  const values = [...select.matchAll(/\['(\w+)', '/g)].map((m) => m[1]);
  assert.deepEqual(values, ['ytrelay', 'auto', 'spotify', 'soundcloud', 'hifi', 'jiosaavn', 'audius']);
  assert.ok(select.includes("['ytrelay', 'Spot+ YouTube Relay']"));
  assert.ok(select.includes("['spotify', 'Spotify — Official Playback']"));
  for (const gone of ['piped', 'invidious', 'youtube', 'deezer']) assert.ok(!values.includes(gone), gone);
  assert.ok(select.includes('api.soundcloudAvailable()'), 'SoundCloud only when set up');
  assert.ok(app.includes('data-setting="customHifi"'));
});

test('retired source settings move to the closest one that is still offered', async () => {
  const {migrateSource} = await import('../js/store.js');
  assert.equal(migrateSource('piped'), 'ytrelay');
  assert.equal(migrateSource('invidious'), 'ytrelay');
  assert.equal(migrateSource('youtube'), 'ytrelay');
  assert.equal(migrateSource('deezer'), 'auto');
  assert.equal(migrateSource('preview'), 'auto');
  assert.equal(migrateSource('jiosaavn'), 'jiosaavn');
  assert.equal(migrateSource(undefined), 'auto');
});

test('Now Playing never shows the server hostname for the relay', async () => {
  const app = await readFile(new URL('../js/app.js', import.meta.url), 'utf8');
  const line = app.slice(app.indexOf("$('#npSrc').textContent ="), app.indexOf('\n', app.indexOf("$('#npSrc').textContent =")));
  assert.ok(line.includes("s.source?.kind === 'ytrelay' ? 'Spot+ YouTube Relay'"));
  assert.ok(!/engineLabel\} · \$\{api\.host/.test(line), 'no "label · host" for labelled sources');
});

test('the matcher passes over demos, radio edits and extended mixes, and says why', async () => {
  const {rankAudioMatches} = await import('../js/audio-selection.js');
  const track = {title: 'Numb', artist: 'Linkin Park', duration: 187};
  const ranked = rankAudioMatches([
    {id: 'a', title: 'Numb (Demo)', channel: 'Linkin Park', duration: 190},
    {id: 'b', title: 'Numb (Extended Mix)', channel: 'Linkin Park', duration: 300},
    {id: 'c', title: 'Numb (Official Audio)', channel: 'Linkin Park - Topic', duration: 187},
  ], track);
  assert.deepEqual(ranked.map((r) => r.id), ['c']);
  assert.match(ranked[0].why, /Topic/);
});
