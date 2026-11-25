// Share a song: a Spotify link, a Spot+ link, or a Spot+ card (a 1080×1920 picture made for stories, with the
// album art, the song and the Spot+ logo). The card is shared as an image where the phone allows it, otherwise
// it's downloaded.

export const APP_URL = 'https://coye2.github.io/spot-plus/';

/** Spotify's page for the song: the exact track when Spot+ knows it, otherwise Spotify's search for it. */
export function spotifyLink(t) {
  if (/^[A-Za-z0-9]{22}$/.test(t?.spotifyId || '')) return 'https://open.spotify.com/track/' + t.spotifyId;
  return 'https://open.spotify.com/search/' + encodeURIComponent(`${t?.title || ''} ${String(t?.artist || '').split(',')[0]}`.trim());
}
/** A link that opens the song in Spot+. */
export function spotPlusLink(t) {
  if (/^\d+$/.test(String(t?.id || ''))) return APP_URL + '#/song/' + t.id;
  return APP_URL + '#/search/' + encodeURIComponent(`${t?.title || ''} ${String(t?.artist || '').split(',')[0]}`.trim());
}

/** Spotify's page for a playlist when Spot+ knows its Spotify playlist ID. */
export function spotifyPlaylistLink(p) {
  if (/^[A-Za-z0-9]{22}$/.test(p?.spotifyId || '')) return 'https://open.spotify.com/playlist/' + p.spotifyId;
  return null;
}
/** A link that opens a playlist directly in Spot+. */
export function spotPlusPlaylistLink(p, { base = APP_URL } = {}) {
  const root = String(base || APP_URL).replace(/#.*$/, '');
  if (/^[a-z2-9]{12}$/.test(p?.collab || '')) return root + '#/collab/' + p.collab;
  if (p?.kind === 'deezer' && /^\d+$/.test(String(p?.id || ''))) return root + '#/playlist/' + p.id;
  if (/^[A-Za-z0-9]{22}$/.test(p?.spotifyId || '')) return root + '#/linked/' + p.spotifyId;
  return root;
}

function loadImage(src) {
  return new Promise((resolve) => {
    if (!src) { resolve(null); return; }
    const im = new Image();
    im.crossOrigin = 'anonymous';
    im.onload = () => resolve(im);
    im.onerror = () => resolve(null);
    im.src = src;
  });
}
function fitText(ctx, text, max, size, weight = 700) {
  let s = size;
  do { ctx.font = `${weight} ${s}px Inter, system-ui, -apple-system, sans-serif`; s -= 2; } while (ctx.measureText(text).width > max && s > 28);
  if (ctx.measureText(text).width <= max) return text;
  let out = text;
  while (out.length > 1 && ctx.measureText(out + '…').width > max) out = out.slice(0, -1);
  return out.trimEnd() + '…';
}

/** Draws the card. Returns a PNG Blob. */
export async function makeCard(t, {accent = '#1ed760'} = {}) {
  const W = 1080, H = 1920;
  const canvas = Object.assign(document.createElement('canvas'), {width: W, height: H});
  const ctx = canvas.getContext('2d');
  const [art, logo] = await Promise.all([loadImage(t.coverXl || t.cover), loadImage('icons/icon-192.png')]);
  // Background: the album art, blurred and darkened, or the theme color when there's no art.
  const bg = ctx.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, accent); bg.addColorStop(1, '#000');
  ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);
  if (art) {
    ctx.save(); ctx.filter = 'blur(60px) saturate(1.3)'; ctx.drawImage(art, -300, -200, H + 400, H + 400); ctx.restore();
  }
  const shade = ctx.createLinearGradient(0, 0, 0, H);
  shade.addColorStop(0, '#0005'); shade.addColorStop(0.55, '#0007'); shade.addColorStop(1, '#000d');
  ctx.fillStyle = shade; ctx.fillRect(0, 0, W, H);
  // The album art, large, with a soft shadow.
  const size = 820, x = (W - size) / 2, y = 330;
  ctx.save(); ctx.shadowColor = '#000a'; ctx.shadowBlur = 80; ctx.shadowOffsetY = 30;
  ctx.fillStyle = '#222'; ctx.beginPath(); ctx.roundRect(x, y, size, size, 28); ctx.fill(); ctx.restore();
  ctx.save(); ctx.beginPath(); ctx.roundRect(x, y, size, size, 28); ctx.clip();
  if (art) ctx.drawImage(art, x, y, size, size); else { ctx.fillStyle = accent; ctx.fillRect(x, y, size, size); }
  ctx.restore();
  // Song and artist.
  ctx.fillStyle = '#fff'; ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
  ctx.fillText(fitText(ctx, t.title || 'Unknown song', size, 78, 800), x, y + size + 130);
  ctx.fillStyle = '#ffffffc0';
  ctx.fillText(fitText(ctx, t.artist || '', size, 48, 500), x, y + size + 200);
  // A little progress bar, like a player.
  ctx.fillStyle = '#ffffff40'; ctx.beginPath(); ctx.roundRect(x, y + size + 260, size, 10, 5); ctx.fill();
  ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.roundRect(x, y + size + 260, size * 0.38, 10, 5); ctx.fill();
  ctx.beginPath(); ctx.arc(x + size * 0.38, y + size + 265, 16, 0, 7); ctx.fill();
  // Spot+ at the bottom.
  const by = H - 170;
  if (logo) { ctx.save(); ctx.beginPath(); ctx.roundRect(x, by - 56, 84, 84, 20); ctx.clip(); ctx.drawImage(logo, x, by - 56, 84, 84); ctx.restore(); }
  ctx.fillStyle = '#fff'; ctx.font = '800 46px Inter, system-ui, -apple-system, sans-serif';
  ctx.fillText('Listen on Spot+', x + 110, by);
  ctx.fillStyle = '#ffffffa0'; ctx.font = '500 32px Inter, system-ui, -apple-system, sans-serif';
  ctx.fillText('coye2.github.io/spot-plus', x + 110, by + 44);
  return await new Promise((resolve, reject) => {
    try { canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('The card couldn’t be made'))), 'image/png'); } catch (e) { reject(e); }
  });
}

/** Draws a playlist story card (cover art or 2×2 track mosaic). Returns a PNG Blob. */
export async function makePlaylistCard(p, {accent = '#1ed760'} = {}) {
  const W = 1080, H = 1920;
  const canvas = Object.assign(document.createElement('canvas'), {width: W, height: H});
  const ctx = canvas.getContext('2d');
  const uniqueCovers = [...new Set([p?.cover, ...(Array.isArray(p?.covers) ? p.covers : [])].filter(Boolean))];
  const [logo, ...loaded] = await Promise.all([
    loadImage('icons/icon-192.png'),
    ...(p?.cover ? [loadImage(p.cover)] : uniqueCovers.slice(0, 4).map(loadImage)),
  ]);
  const images = loaded.filter(Boolean);
  const bgArt = images[0] || null;
  const bg = ctx.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, accent); bg.addColorStop(1, '#000');
  ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);
  if (bgArt) {
    ctx.save(); ctx.filter = 'blur(60px) saturate(1.3)'; ctx.drawImage(bgArt, -300, -200, H + 400, H + 400); ctx.restore();
  }
  const shade = ctx.createLinearGradient(0, 0, 0, H);
  shade.addColorStop(0, '#0005'); shade.addColorStop(0.55, '#0007'); shade.addColorStop(1, '#000d');
  ctx.fillStyle = shade; ctx.fillRect(0, 0, W, H);
  const size = 820, x = (W - size) / 2, y = 310;
  ctx.save(); ctx.shadowColor = '#000a'; ctx.shadowBlur = 80; ctx.shadowOffsetY = 30;
  ctx.fillStyle = '#222'; ctx.beginPath(); ctx.roundRect(x, y, size, size, 28); ctx.fill(); ctx.restore();
  ctx.save(); ctx.beginPath(); ctx.roundRect(x, y, size, size, 28); ctx.clip();
  if (!p?.cover && images.length >= 4) {
    const half = size / 2;
    ctx.drawImage(images[0], x, y, half, half);
    ctx.drawImage(images[1], x + half, y, half, half);
    ctx.drawImage(images[2], x, y + half, half, half);
    ctx.drawImage(images[3], x + half, y + half, half, half);
  } else if (bgArt) {
    ctx.drawImage(bgArt, x, y, size, size);
  } else {
    ctx.fillStyle = accent; ctx.fillRect(x, y, size, size);
  }
  ctx.restore();
  // Playlist label, title & subtitle.
  ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = '#ffffffb0'; ctx.font = '700 32px Inter, system-ui, -apple-system, sans-serif';
  ctx.fillText('PLAYLIST', x, y + size + 96);
  ctx.fillStyle = '#fff';
  ctx.fillText(fitText(ctx, p?.title || 'Playlist', size, 76, 800), x, y + size + 184);
  ctx.fillStyle = '#ffffffc0';
  ctx.fillText(fitText(ctx, p?.subtitle || 'Spot+ playlist', size, 44, 500), x, y + size + 252);
  // Spot+ footer.
  const by = H - 170;
  if (logo) { ctx.save(); ctx.beginPath(); ctx.roundRect(x, by - 56, 84, 84, 20); ctx.clip(); ctx.drawImage(logo, x, by - 56, 84, 84); ctx.restore(); }
  ctx.fillStyle = '#fff'; ctx.font = '800 46px Inter, system-ui, -apple-system, sans-serif';
  ctx.fillText('Listen on Spot+', x + 110, by);
  ctx.fillStyle = '#ffffffa0'; ctx.font = '500 32px Inter, system-ui, -apple-system, sans-serif';
  ctx.fillText('coye2.github.io/spot-plus', x + 110, by + 44);
  return await new Promise((resolve, reject) => {
    try { canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('The card couldn’t be made'))), 'image/png'); } catch (e) { reject(e); }
  });
}

/** Shares text + link with the phone's share sheet, or copies the link. Returns 'shared', 'copied' or 'cancelled'. */
export async function shareLink({title, text, url}) {
  if (navigator.share) {
    try { await navigator.share({title, text, url}); return 'shared'; } catch (e) { if (e?.name === 'AbortError') return 'cancelled'; }
  }
  await navigator.clipboard?.writeText(url);
  return 'copied';
}
/** Shares the card image (with the Spot+ link), or downloads it where images can't be shared. */
export async function shareCard(t, opts) {
  const blob = await makeCard(t, opts);
  const name = `${(t.title || 'song').replace(/[^\w\- ]+/g, '').trim().slice(0, 60) || 'song'} - Spot+.png`;
  const file = new File([blob], name, {type: 'image/png'});
  if (navigator.canShare?.({files: [file]})) {
    try { await navigator.share({files: [file], text: `${t.title} by ${t.artist} on Spot+ ${spotPlusLink(t)}`}); return 'shared'; }
    catch (e) { if (e?.name === 'AbortError') return 'cancelled'; }
  }
  const url = URL.createObjectURL(blob);
  Object.assign(document.createElement('a'), {href: url, download: name}).click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
  return 'downloaded';
}
/** Shares a playlist story card image (with the Spot+ playlist link), or downloads it where images can't be shared. */
export async function sharePlaylistCard(p, opts = {}) {
  const blob = await makePlaylistCard(p, opts);
  const name = `${(p?.title || 'playlist').replace(/[^\w\- ]+/g, '').trim().slice(0, 60) || 'playlist'} - Spot+.png`;
  const file = new File([blob], name, {type: 'image/png'});
  const link = opts.url || spotPlusPlaylistLink(p, { base: opts.base });
  if (navigator.canShare?.({files: [file]})) {
    try { await navigator.share({files: [file], text: `${p?.title || 'Playlist'} on Spot+ ${link}`}); return 'shared'; }
    catch (e) { if (e?.name === 'AbortError') return 'cancelled'; }
  }
  const url = URL.createObjectURL(blob);
  Object.assign(document.createElement('a'), {href: url, download: name}).click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
  return 'downloaded';
}
