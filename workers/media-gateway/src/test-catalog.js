// workers/media-gateway/src/test-catalog.js — Authorized synthetic WAV test catalog for PoC validation.
// Generates deterministic, valid PCM WAV audio streams with full HTTP Range (206) support so
// OpenSubsonic clients and tests can validate browsing, search, cover art, 302 direct playback,
// and byte-range seeking without relying on unauthorized or copyrighted third-party streams.

const SAMPLE_RATE = 8000;
const CHANNELS = 1;
const BITS_PER_SAMPLE = 16;

export const AUTHORIZED_TEST_TRACKS = Object.freeze([
  {
    id: 'test-track-440',
    title: 'Highway Calibration Tone (A4)',
    artist: 'Spot+ Test Lab',
    artistId: 'artist-spotplus-lab',
    album: 'Vehicle Interop Suite',
    albumId: 'album-vehicle-suite',
    duration: 3,
    freqHz: 440,
    track: 1,
    year: 2026,
    starred: true,
    coverId: 'cover-vehicle-suite',
    contentType: 'audio/wav',
    suffix: 'wav',
    bitRate: 128,
  },
  {
    id: 'test-track-523',
    title: 'CarPlay Signal Check (C5)',
    artist: 'Spot+ Test Lab',
    artistId: 'artist-spotplus-lab',
    album: 'Vehicle Interop Suite',
    albumId: 'album-vehicle-suite',
    duration: 3,
    freqHz: 523.25,
    track: 2,
    year: 2026,
    starred: true,
    coverId: 'cover-vehicle-suite',
    contentType: 'audio/wav',
    suffix: 'wav',
    bitRate: 128,
  },
  {
    id: 'test-track-659',
    title: 'Android Auto Range Probe (E5)',
    artist: 'Spot+ Acoustics',
    artistId: 'artist-spotplus-acoustics',
    album: 'OpenSubsonic Direct Play',
    albumId: 'album-opensubsonic-direct',
    duration: 4,
    freqHz: 659.25,
    track: 1,
    year: 2026,
    starred: false,
    coverId: 'cover-opensubsonic-direct',
    contentType: 'audio/wav',
    suffix: 'wav',
    bitRate: 128,
  },
]);

export const AUTHORIZED_TEST_PLAYLISTS = Object.freeze([
  {
    id: 'pl-drive-mix',
    name: 'Drive Interop Test',
    owner: 'spotplus',
    created: '2026-11-25T00:00:00Z',
    changed: '2026-11-25T00:00:00Z',
    trackIds: ['test-track-440', 'test-track-523', 'test-track-659'],
  },
  {
    id: 'pl-favorites',
    name: 'Liked Songs',
    owner: 'spotplus',
    created: '2026-11-25T00:00:00Z',
    changed: '2026-11-25T00:00:00Z',
    trackIds: ['test-track-440', 'test-track-523'],
  },
]);

const wavCache = new Map();

/** Builds a valid, deterministic 16-bit PCM WAV file for an authorized synthetic test track. */
export function synthesizeWavTrack(track) {
  if (!track) return null;
  if (wavCache.has(track.id)) return wavCache.get(track.id);

  const numSamples = SAMPLE_RATE * Math.max(1, Math.min(10, Number(track.duration) || 2));
  const dataBytes = numSamples * CHANNELS * (BITS_PER_SAMPLE / 8);
  const buf = new ArrayBuffer(44 + dataBytes);
  const view = new DataView(buf);
  const writeStr = (off, s) => {
    for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i));
  };

  writeStr(0, 'RIFF');
  view.setUint32(4, 36 + dataBytes, true);
  writeStr(8, 'WAVE');
  writeStr(12, 'fmt ');
  view.setUint32(16, 16, true); // PCM chunk size
  view.setUint16(20, 1, true); // PCM format
  view.setUint16(22, CHANNELS, true);
  view.setUint32(24, SAMPLE_RATE, true);
  view.setUint32(28, SAMPLE_RATE * CHANNELS * (BITS_PER_SAMPLE / 8), true);
  view.setUint16(32, CHANNELS * (BITS_PER_SAMPLE / 8), true);
  view.setUint16(34, BITS_PER_SAMPLE, true);
  writeStr(36, 'data');
  view.setUint32(40, dataBytes, true);

  const freq = Number(track.freqHz) || 440;
  for (let i = 0; i < numSamples; i++) {
    // Gentle fade-in/out envelope to prevent clicks on car speakers during hardware testing.
    const env = Math.min(1, i / 400, (numSamples - 1 - i) / 400);
    const sample = Math.sin((2 * Math.PI * freq * i) / SAMPLE_RATE) * 0.25 * env;
    view.setInt16(44 + i * 2, Math.round(sample * 32767), true);
  }

  const bytes = new Uint8Array(buf);
  wavCache.set(track.id, bytes);
  return bytes;
}

/** Builds a clean deterministic SVG artwork response for authorized test tracks. */
export function buildTestCoverSvg(coverId = 'cover-vehicle-suite') {
  const accent = coverId === 'cover-opensubsonic-direct' ? '#38bdf8' : '#1db954';
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
  <rect width="512" height="512" rx="48" fill="#0d1117"/>
  <circle cx="256" cy="256" r="156" fill="${accent}" fill-opacity="0.18"/>
  <circle cx="256" cy="256" r="108" fill="${accent}"/>
  <text x="256" y="274" text-anchor="middle" fill="#04120a" font-family="system-ui,sans-serif" font-size="64" font-weight="800">Spot+</text>
</svg>`;
}

export function createTestCatalog(origin = 'https://gateway.spotplus.local') {
  const tracksById = new Map();
  const artistsById = new Map();
  const albumsById = new Map();

  for (const raw of AUTHORIZED_TEST_TRACKS) {
    const track = {
      ...raw,
      streamUrl: `${origin}/authorized-test-audio/${encodeURIComponent(raw.id)}.wav`,
      coverUrl: `${origin}/authorized-test-cover/${encodeURIComponent(raw.coverId)}.svg`,
    };
    tracksById.set(track.id, track);

    if (!artistsById.has(track.artistId)) {
      artistsById.set(track.artistId, {
        id: track.artistId,
        name: track.artist,
        coverArt: track.coverId,
        albumIds: new Set(),
      });
    }
    artistsById.get(track.artistId).albumIds.add(track.albumId);

    if (!albumsById.has(track.albumId)) {
      albumsById.set(track.albumId, {
        id: track.albumId,
        name: track.album,
        artist: track.artist,
        artistId: track.artistId,
        coverArt: track.coverId,
        year: track.year,
        trackIds: [],
      });
    }
    albumsById.get(track.albumId).trackIds.push(track.id);
  }

  const playlistsById = new Map();
  for (const pl of AUTHORIZED_TEST_PLAYLISTS) {
    const tracks = pl.trackIds.map((id) => tracksById.get(id)).filter(Boolean);
    playlistsById.set(pl.id, {
      ...pl,
      songCount: tracks.length,
      duration: tracks.reduce((sum, t) => sum + (t.duration || 0), 0),
      coverArt: tracks[0]?.coverId || 'cover-vehicle-suite',
      tracks,
    });
  }

  return {
    tracksById,
    artistsById,
    albumsById,
    playlistsById,
  };
}
