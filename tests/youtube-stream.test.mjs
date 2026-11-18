import test from 'node:test';
import assert from 'node:assert/strict';
import {pickAudioFormat, shapeStream, youtubeStream} from '../canvas-bridge/youtube-stream.js';

test('pickAudioFormat prefers AAC when InstantPlay asks for iPhone-safe audio', () => {
  const formats = [
    {itag: 251, url: 'https://googlevideo.example/opus', mimeType: 'audio/webm; codecs="opus"', bitrate: 160000},
    {itag: 140, url: 'https://googlevideo.example/aac', mimeType: 'audio/mp4; codecs="mp4a.40.2"', bitrate: 128000},
  ];
  assert.equal(pickAudioFormat(formats, {preferAac: true}).itag, 140);
  assert.equal(pickAudioFormat(formats, {preferAac: false}).itag, 251);
  assert.equal(pickAudioFormat([{itag: 999, url: 'https://x', mimeType: 'audio/mp4'}]).url, 'https://x');
  assert.equal(pickAudioFormat([{itag: 140, signatureCipher: 'a', mimeType: 'audio/mp4'}]), null);
});

test('shapeStream marks bridge InstantPlay results as fast', () => {
  const stream = shapeStream({url: 'https://googlevideo.example/a.m4a', mimeType: 'audio/mp4', bitrate: 128000, itag: 140}, 'MxEjnYdfLXU');
  assert.equal(stream.kind, 'bridge');
  assert.equal(stream.fast, true);
  assert.equal(stream.videoId, 'MxEjnYdfLXU');
});

test('/stream resolves through InnerTube when mirrors are down', async () => {
  const formats = [
    {itag: 140, url: 'https://googlevideo.example/aac.m4a', mimeType: 'audio/mp4', bitrate: 128000},
  ];
  const fetcher = async (url, opts = {}) => {
    const href = String(url);
    if (href.includes('/visitor_id')) return new Response(JSON.stringify({responseContext: {visitorData: 'visitor-token'}}));
    if (href.includes('/player') && opts.method === 'POST') {
      return new Response(JSON.stringify({playabilityStatus: {status: 'OK'}, streamingData: {adaptiveFormats: formats}}));
    }
    return new Response('down', {status: 403});
  };
  const response = await youtubeStream(new Request('https://bridge.test/stream?id=MxEjnYdfLXU&aac=1'), {fetcher});
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.url, 'https://googlevideo.example/aac.m4a');
  assert.equal(body.fast, true);
  assert.equal(body.videoId, 'MxEjnYdfLXU');
});

test('/stream falls back to a server-side Invidious mirror', async () => {
  const fetcher = async (url) => {
    const href = String(url);
    if (href.includes('/visitor_id')) return new Response(JSON.stringify({responseContext: {visitorData: 'v'}}));
    if (href.includes('/player')) return new Response(JSON.stringify({playabilityStatus: {status: 'LOGIN_REQUIRED', reason: 'bot'}}));
    if (href.includes('yt.chocolatemoo53.com/api/v1/videos/')) {
      return new Response(JSON.stringify({adaptiveFormats: [{itag: 140, type: 'audio/mp4', bitrate: 128000, url: 'https://cdn.example/song.m4a'}]}));
    }
    return new Response('no', {status: 502});
  };
  const response = await youtubeStream(new Request('https://bridge.test/stream?id=MxEjnYdfLXU'), {fetcher});
  assert.equal(response.status, 200);
  assert.equal((await response.json()).url, 'https://cdn.example/song.m4a');
});
