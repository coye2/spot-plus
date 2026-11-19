// Smart search ranking: decides what the person most likely meant (an artist, a song, an album) and orders
// results like Spotify's: one Top result, then the sections in the order that fits the query.
// Typing "just" means Justin Bieber (name starts with it, huge following); "blinding lights" means the song.

const fold = (v) => String(v || '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase()
  .replace(/&/g, ' and ').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

/** How well a name matches what was typed so far: 1 exact, then prefix, word-prefix, contains. 0 = no match. */
export function nameMatch(name, query) {
  const n = fold(name), q = fold(query);
  if (!n || !q) return 0;
  if (n === q) return 1;
  if (n.replace(/ /g, '') === q.replace(/ /g, '')) return 0.97;
  if (n.startsWith(q)) return 0.9 - Math.min(0.05, (n.length - q.length) / 200);
  const words = n.split(' '), parts = q.split(' ');
  // Every typed word starts a word of the name, in order ("j bieber", "bieber j").
  if (parts.every((p) => words.some((w) => w.startsWith(p)))) return 0.75;
  if (n.includes(q)) return 0.55;
  return 0;
}

// Popularity on a 0-1 scale (log), so a huge artist beats a tiny exact namesake only when the match is close.
const popularity = (n, top) => (n > 0 ? Math.min(1, Math.log10(n + 1) / top) : 0);

export function scoreArtist(a, q, {known = new Set()} = {}) {
  const m = nameMatch(a.name, q);
  if (!m) return 0;
  // Fans on a log scale from 1,000 (0) to 100 million (1): 11M beats 2.5M clearly, a namesake with 50 fans is nowhere.
  const fame = a.fans > 0 ? Math.max(0, Math.min(1, (Math.log10(a.fans) - 3) / 5)) : 0;
  return m * 70 + fame * 45 + (known.has(String(a.id)) ? 15 : 0);
}

export function scoreTrack(t, q, {known = new Set()} = {}) {
  const title = nameMatch(t.searchTitle || t.title, q);
  const both = nameMatch(`${t.artist} ${t.searchTitle || t.title}`, q) || nameMatch(`${t.searchTitle || t.title} ${t.artist}`, q);
  const m = Math.max(title, both * 0.95);
  if (!m) return 0;
  // A famous artist outranks a song that merely shares the word (“just” → Justin Bieber, not Radiohead’s “Just”).
  return m * 70 + popularity(t.rank, 6) * 20 + (known.has(String(t.id)) ? 15 : 0);
}

export function scoreAlbum(a, q) {
  const m = nameMatch(a.title, q);
  return m ? m * 62 : 0;
}

/**
 * Orders search results and picks the Top result.
 * Returns {top: {kind, item} | null, intent: 'artists'|'songs'|'albums', tracks, artists, albums, playlists}.
 */
export function rankSearch(d, q, {knownArtists = new Set(), knownTracks = new Set()} = {}) {
  const artists = (d.artists || []).map((a, i) => ({a, s: scoreArtist(a, q, {known: knownArtists}) - i * 0.5}))
    .sort((x, y) => y.s - x.s);
  const tracks = (d.tracks || []).map((t, i) => ({t, s: scoreTrack(t, q, {known: knownTracks}) - i * 0.2}))
    .sort((x, y) => y.s - x.s);
  const albums = (d.albums || []).map((a, i) => ({a, s: scoreAlbum(a, q) - i * 0.5})).sort((x, y) => y.s - x.s);

  const bestArtist = artists[0]?.s || 0, bestTrack = tracks[0]?.s || 0, bestAlbum = albums[0]?.s || 0;
  // Artists win ties: a name you're typing is more often an artist than a song.
  let intent = 'artists';
  if (bestTrack > bestArtist + 6 && bestTrack >= bestAlbum) intent = 'songs';
  else if (bestAlbum > bestArtist + 6 && bestAlbum > bestTrack) intent = 'albums';
  if (!bestArtist && !bestTrack && !bestAlbum) intent = (d.artists || []).length ? 'artists' : 'songs';

  const top = intent === 'artists' && artists.length ? {kind: 'artist', item: artists[0].a}
    : intent === 'albums' && albums.length ? {kind: 'album', item: albums[0].a}
    : tracks.length ? {kind: 'track', item: tracks[0].t}
    : artists.length ? {kind: 'artist', item: artists[0].a} : null;

  // With an artist in mind, their own songs lead the Songs list.
  let orderedTracks = tracks.map((x) => x.t);
  if (top?.kind === 'artist') {
    const id = String(top.item.id);
    orderedTracks = [...orderedTracks.filter((t) => String(t.artistId) === id), ...orderedTracks.filter((t) => String(t.artistId) !== id)];
  }
  return {top, intent, tracks: orderedTracks, artists: artists.map((x) => x.a), albums: albums.map((x) => x.a), playlists: d.playlists || []};
}
