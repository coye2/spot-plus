// Open Spotify links in Spot+: paste one in search (or anywhere), share one to Spot+ from another app on Android,
// or open coye2.github.io/spot-plus/?open=<link>. Songs, albums, playlists and artists open their Spot+ page.

const KINDS = ['track', 'album', 'playlist', 'artist', 'user', 'episode', 'show'];
/** Finds the first Spotify link or URI in any text. Returns {kind, id} or null. */
export function parseSpotify(text) {
  const s = String(text || '');
  const web = /https?:\/\/open\.spotify\.com\/(?:intl-[a-z]{2}(?:-[a-z]{2})?\/)?(?:embed\/)?(track|album|playlist|artist|user|episode|show)\/([A-Za-z0-9._-]{1,64})/i.exec(s);
  const uri = /spotify:(track|album|playlist|artist|user|episode|show):([A-Za-z0-9._-]{1,64})/i.exec(s);
  const m = web || uri;
  if (!m) return null;
  const kind = m[1].toLowerCase(), id = m[2];
  if (!KINDS.includes(kind) || (kind !== 'user' && !/^[A-Za-z0-9]{22}$/.test(id))) return null;
  return {kind, id};
}
/** Short spotify.link / spoti.fi links need Spotify to say where they go; Spot+ can't follow them on its own. */
export const isShortLink = (text) => /https?:\/\/(spotify\.link|spoti\.fi)\//i.test(String(text || ''));
/** The Spot+ page for a Spotify link. */
export function routeFor(link) {
  if (!link) return '';
  switch (link.kind) {
    case 'track': return '#/sptrack/' + link.id;
    case 'album': return '#/spalbum/' + link.id;
    case 'playlist': return '#/linked/' + link.id;
    case 'artist': return '#/sartist/' + link.id;
    case 'user': return '';
    default: return '#/spotify/' + link.kind + '/' + link.id;
  }
}
