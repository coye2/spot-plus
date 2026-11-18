// A photo chosen on this device. It wins over the Spotify picture until removed.
const DB = 'spotplus-profile';
const KEY = 'self';
const MAX_BYTES = 8 * 1024 * 1024;
let url = '';
let custom = false;

function database() {
  return new Promise((resolve, reject) => {
    if (!globalThis.indexedDB) return reject(new Error('Photos cannot be saved in this browser.'));
    const open = indexedDB.open(DB, 1);
    open.onupgradeneeded = () => open.result.createObjectStore('photo');
    open.onsuccess = () => resolve(open.result);
    open.onerror = () => reject(open.error);
  });
}
function idb(mode, fn) {
  return database().then(db => new Promise((resolve, reject) => {
    const tx = db.transaction('photo', mode);
    const result = fn(tx.objectStore('photo'));
    tx.oncomplete = () => resolve(result?.result);
    tx.onerror = tx.onabort = () => reject(tx.error || new Error('aborted'));
  }));
}
export const hasCustomPhoto = () => custom;
export const customPhotoURL = () => url;

export async function loadPhoto() {
  try {
    const saved = await idb('readonly', store => store.get(KEY));
    if (url) URL.revokeObjectURL(url);
    if (saved?.blob) { url = URL.createObjectURL(saved.blob); custom = true; }
    else { url = ''; custom = false; }
  } catch { url = ''; custom = false; }
  return url;
}

async function squareJpeg(file) {
  const bitmap = await createImageBitmap(file);
  const side = Math.min(bitmap.width, bitmap.height);
  const out = Math.min(512, side);
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = out;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(bitmap, (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side, 0, 0, out, out);
  bitmap.close?.();
  const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.9));
  if (!blob) throw new Error('Could not read that image.');
  return blob;
}

export async function savePhoto(file) {
  if (!file || !/^image\//.test(file.type || '')) throw new Error('Choose an image.');
  if (file.size > MAX_BYTES) throw new Error('Use an image under 8 MB.');
  let blob;
  try { blob = await squareJpeg(file); }
  catch { throw new Error('Choose a JPEG or PNG.'); }
  await idb('readwrite', store => store.put({blob, at: Date.now()}, KEY));
  if (url) URL.revokeObjectURL(url);
  url = URL.createObjectURL(blob);
  custom = true;
  return url;
}

export async function clearPhoto() {
  try { await idb('readwrite', store => store.delete(KEY)); } catch { /* Already gone. */ }
  if (url) URL.revokeObjectURL(url);
  url = '';
  custom = false;
}

/** Pull the public Spotify photo at most once a day, and immediately when it is missing. */
export function shouldRefreshPhoto({id = '', avatar = '', checkedAt = 0, now = Date.now(), force = false} = {}) {
  if (!/^[A-Za-z0-9._-]{1,64}$/.test(id)) return false;
  if (force || !avatar) return true;
  return now - Number(checkedAt || 0) >= 86400000;
}
