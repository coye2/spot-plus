// Your own playlist cover photos: any photo from the phone, cropped square and shrunk to a small JPEG so it fits
// in the browser's storage (an iPhone photo is several MB; the cover is well under 100 KB).

async function decode(file) {
  if (typeof createImageBitmap === 'function') {
    try { return await createImageBitmap(file); } catch { /* older Safari: fall back to an <img> */ }
  }
  const url = URL.createObjectURL(file);
  try {
    const im = new Image();
    im.decoding = 'async';
    im.src = url;
    await im.decode();
    return im;
  } finally { setTimeout(() => URL.revokeObjectURL(url), 1000); }
}

/** Center-crops a photo to a square JPEG data URL (600 px, smaller if needed to stay under ~300 KB). */
export async function coverFromFile(file, size = 600) {
  if (!file || !/^image\//.test(file.type || 'image/')) throw new Error('Choose a photo for the cover.');
  if (file.size > 40 * 1024 * 1024) throw new Error('That photo is too large. Choose one under 40 MB.');
  let pic;
  try { pic = await decode(file); } catch { throw new Error('That photo couldn’t be opened. Try another one.'); }
  const w = pic.width || pic.naturalWidth, h = pic.height || pic.naturalHeight;
  if (!w || !h) throw new Error('That photo couldn’t be opened. Try another one.');
  const side = Math.min(w, h), sx = (w - side) / 2, sy = (h - side) / 2;
  for (const [px, q] of [[size, 0.84], [480, 0.78], [360, 0.7]]) {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = px;
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(pic, sx, sy, side, side, 0, 0, px, px);
    const url = canvas.toDataURL('image/jpeg', q);
    if (url.length < 300000) { pic.close?.(); return url; }
  }
  pic.close?.();
  throw new Error('That photo couldn’t be made small enough. Try another one.');
}
