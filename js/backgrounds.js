// Backgrounds for the app and library. The player (now playing and the play bar) stays on its own paint.
import {CATALOG, CATEGORIES} from './background-catalog.js';

const DB = 'spotplus-scenes';
const STORE = 'uploads';
const MAX_BYTES = 25 * 1024 * 1024;
const clamp01 = (n, fallback) => {
  const v = Number(n);
  return Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : fallback;
};

export function normalizeScene(scene) {
  if (!scene || (scene.kind !== 'catalog' && scene.kind !== 'upload')) return null;
  if (!/^[\w-]{1,40}$/.test(String(scene.id || ''))) return null;
  return {kind: scene.kind, id: String(scene.id), x: clamp01(scene.x, 0.5), y: clamp01(scene.y, 0.42)};
}

export function readViewport(screen = globalThis) {
  return {
    width: Number(screen.innerWidth || screen.width) || 1280,
    height: Number(screen.innerHeight || screen.height) || 800,
    dpr: Number(screen.devicePixelRatio) || 1,
  };
}

/** Longest edge this screen can actually show, capped at 4K. */
export function targetPixels(viewport = readViewport()) {
  const dpr = Math.min(3, Math.max(1, viewport.dpr || 1));
  const width = Math.max(1, Math.round(viewport.width * dpr));
  const height = Math.max(1, Math.round(viewport.height * dpr));
  const long = Math.max(width, height);
  const cap = long >= 3000 ? 3840 : long >= 1800 ? 2560 : long >= 1200 ? 1920 : 1280;
  const scale = Math.min(1, cap / long);
  return {width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)), cap};
}

/** Phones use a 1920-wide file. Tablets and desktops take the 4K (or larger) original. */
export function deviceTier(viewport = readViewport()) {
  const long = Math.max(viewport.width, viewport.height) * (viewport.dpr || 1);
  if ((viewport.width || 0) < 800) return 'fhd';
  return long >= 1400 ? '4k' : 'fhd';
}

export function wallpaperURLs(item) {
  const base = `https://${item.host}.alphacoders.com/${item.folder}/`;
  return {
    full: `${base}${item.id}.${item.ext}`,
    fhd: `${base}thumb-1920-${item.id}.${item.ext}`,
    preview: `${base}thumbbig-${item.id}.webp`,
  };
}

export function sourceForDevice(item, viewport = readViewport()) {
  const urls = wallpaperURLs(item);
  const tier = deviceTier(viewport);
  return {tier, url: tier === '4k' ? urls.full : urls.fhd, fallback: urls.full, preview: urls.preview};
}

/** Cover-crop rectangle in source pixels. Focus is 0..1 and stays inside the frame. */
export function coverCrop(srcW, srcH, dstW, dstH, focus = {x: 0.5, y: 0.42}) {
  const scale = Math.max(dstW / srcW, dstH / srcH);
  const width = dstW / scale;
  const height = dstH / scale;
  const x = Math.min(Math.max(0, focus.x * srcW - width / 2), Math.max(0, srcW - width));
  const y = Math.min(Math.max(0, focus.y * srcH - height / 2), Math.max(0, srcH - height));
  return {x, y, width, height, scale};
}

export function positionOf(scene) {
  const x = Math.round(clamp01(scene?.x, 0.5) * 100);
  const y = Math.round(clamp01(scene?.y, 0.42) * 100);
  return `${x}% ${y}%`;
}

export function findWallpaper(id) {
  return CATALOG.find(item => item.id === id) || null;
}
export function stageURL(scene, viewport = readViewport()) {
  const picked = normalizeScene(scene);
  if (!picked) return '';
  if (picked.kind === 'catalog') {
    const item = findWallpaper(picked.id);
    return item ? sourceForDevice(item, viewport).url : '';
  }
  const rec = uploads.get(picked.id);
  if (!rec) return '';
  const paint = paints.get(rec.id);
  if (paint?.url) return paint.url;
  const url = URL.createObjectURL(rec.blob);
  paints.set(rec.id, {key: 'raw', url});
  return url;
}

let uploads = new Map();
let paints = new Map();
let thumbs = new Map();
let applyToken = 0;
let listening = false;
let settingsOf = () => ({});

function db() {
  return new Promise((resolve, reject) => {
    const open = indexedDB.open(DB, 1);
    open.onupgradeneeded = () => open.result.createObjectStore(STORE);
    open.onsuccess = () => resolve(open.result);
    open.onerror = () => reject(open.error);
  });
}
function idb(mode, fn) {
  return db().then(database => new Promise((resolve, reject) => {
    const tx = database.transaction(STORE, mode);
    const result = fn(tx.objectStore(STORE));
    tx.oncomplete = () => resolve(result?.result);
    tx.onerror = tx.onabort = () => reject(tx.error || new Error('aborted'));
  }));
}
async function loadUploads() {
  if (!globalThis.indexedDB) return;
  const keys = await idb('readonly', store => store.getAllKeys());
  const rows = await idb('readonly', store => store.getAll());
  uploads = new Map((keys || []).map((key, i) => [String(key), rows[i]]));
}
export function listUploads() {
  return [...uploads.values()];
}
export async function saveUpload(file) {
  if (!file || !/^image\//.test(file.type || '')) throw new Error('Choose an image file.');
  if (file.size > MAX_BYTES) throw new Error('Use an image under 25 MB.');
  const bitmap = await createImageBitmap(file);
  const rec = {id: 'u' + Date.now().toString(36), name: String(file.name || 'Upload').replace(/\.[^.]+$/, '').slice(0, 60) || 'Upload', blob: file, w: bitmap.width, h: bitmap.height};
  bitmap.close?.();
  await idb('readwrite', store => store.put(rec, rec.id));
  uploads.set(rec.id, rec);
  return rec;
}
function uploadThumb(rec) {
  if (!rec?.blob) return '';
  const saved = thumbs.get(rec.id);
  if (saved) return saved;
  const url = URL.createObjectURL(rec.blob);
  thumbs.set(rec.id, url);
  return url;
}
export async function removeUpload(id) {
  await idb('readwrite', store => store.delete(id));
  uploads.delete(id);
  const paint = paints.get(id);
  if (paint?.url) URL.revokeObjectURL(paint.url);
  paints.delete(id);
  const thumb = thumbs.get(id);
  if (thumb) URL.revokeObjectURL(thumb);
  thumbs.delete(id);
}

async function paintUpload(rec, scene, viewport) {
  const target = targetPixels(viewport);
  const crop = coverCrop(rec.w, rec.h, target.width, target.height, scene);
  const fit = Math.min(1, target.width / crop.width, target.height / crop.height);
  const outW = Math.max(1, Math.round(crop.width * fit));
  const outH = Math.max(1, Math.round(crop.height * fit));
  const key = `${rec.id}:${outW}x${outH}:${scene.x}:${scene.y}`;
  const cached = paints.get(rec.id);
  if (cached?.key === key) return cached.url;
  const bitmap = await createImageBitmap(rec.blob);
  const canvas = document.createElement('canvas');
  canvas.width = outW;
  canvas.height = outH;
  const ctx = canvas.getContext('2d', {alpha: false});
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.filter = 'contrast(1.06) saturate(1.08)';
  ctx.drawImage(bitmap, crop.x, crop.y, crop.width, crop.height, 0, 0, outW, outH);
  bitmap.close?.();
  const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.92));
  const url = URL.createObjectURL(blob);
  if (cached?.url) URL.revokeObjectURL(cached.url);
  paints.set(rec.id, {key, url});
  return url;
}

function place(scene) {
  const pos = positionOf(scene);
  document.documentElement.style.setProperty('--scene-x', pos.split(' ')[0]);
  document.documentElement.style.setProperty('--scene-y', pos.split(' ')[1]);
}

function show(url, scene, fallback) {
  const layer = document.getElementById('sceneBg');
  const img = layer?.querySelector('img');
  if (!layer || !img) return;
  document.body.dataset.scene = 'on';
  layer.hidden = false;
  place(scene);
  img.onload = () => { img.dataset.ready = '1'; };
  if (img.dataset.src !== url) {
    img.dataset.src = url;
    img.dataset.fallback = fallback || '';
    img.referrerPolicy = 'no-referrer';
    img.src = url;
  }
}
function clearScene() {
  document.body.dataset.scene = '';
  const layer = document.getElementById('sceneBg');
  if (layer) layer.hidden = true;
  syncStudio(null);
}
function syncStudio(scene) {
  const studio = document.querySelector('.bg-studio');
  if (!studio) return;
  const note = studio.querySelector('.bg-note');
  if (note && scene?.kind === 'catalog') {
    const item = findWallpaper(scene.id);
    if (item) note.textContent = item.name;
  }
  const preview = studio.querySelector('#bgStage img');
  if (preview && scene?.kind === 'catalog') {
    const item = findWallpaper(scene.id);
    const next = item ? wallpaperURLs(item).preview : '';
    if (next && preview.getAttribute('src') !== next) preview.src = next;
  }
}

export function apply(settings = {}) {
  const scene = normalizeScene(settings.scene);
  const job = ++applyToken;
  if (!scene) { clearScene(); return; }
  place(scene);
  if (scene.kind === 'catalog') {
    const item = findWallpaper(scene.id);
    if (!item) { clearScene(); return; }
    const picked = sourceForDevice(item, readViewport());
    show(picked.url, scene, picked.fallback);
    syncStudio(scene);
    return;
  }
  const rec = uploads.get(scene.id);
  if (!rec) return;
  syncStudio(scene);
  paintUpload(rec, scene, readViewport()).then(url => {
    if (job === applyToken) show(url, scene, '');
  }).catch(() => { if (job === applyToken) clearScene(); });
}

export function install(getSettings) {
  settingsOf = getSettings;
  if (!listening && globalThis.addEventListener) {
    listening = true;
    const img = document.getElementById('sceneBg')?.querySelector('img');
    img?.addEventListener('error', () => {
      const next = img.dataset.fallback;
      if (next && img.src !== next) { img.dataset.fallback = ''; img.dataset.src = next; img.src = next; }
    });
    let timer = 0;
    globalThis.addEventListener('resize', () => {
      clearTimeout(timer);
      timer = setTimeout(() => apply(settingsOf()), 120);
    });
    apply(getSettings());
    loadUploads().then(() => apply(settingsOf())).catch(() => {});
  } else apply(getSettings());
}

const htmlEscape = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));

export function categoryFrom(value) {
  if (!value) return null;
  const key = String(value).toLowerCase();
  return CATEGORIES.find(item => item.slug === key || item.name.toLowerCase() === key) || null;
}

/** Search the Alpha Coders catalog. With no query and no category, return a few from each category. */
export function searchWallpapers({category = '', query = '', limit = 80} = {}) {
  const picked = categoryFrom(category);
  const q = String(query || '').trim().toLowerCase();
  let items = picked ? CATALOG.filter(item => item.category === picked.name) : CATALOG;
  if (q) items = items.filter(item => `${item.name} ${item.category}`.toLowerCase().includes(q));
  else if (!picked) {
    const seen = new Map();
    const sample = [];
    for (const item of items) {
      const count = seen.get(item.category) || 0;
      if (count >= 3) continue;
      seen.set(item.category, count + 1);
      sample.push(item);
    }
    return sample;
  }
  return items.slice(0, limit);
}

function rows(items, scene, kind, esc, showCategory) {
  return items.map(item => {
    const on = scene?.kind === kind && scene.id === item.id;
    const preview = kind === 'catalog' ? wallpaperURLs(item).preview : uploadThumb(item);
    const remove = kind === 'upload' ? `<button type="button" class="bg-remove" data-act="bg-delete" data-id="${esc(item.id)}">Remove</button>` : (on ? '<span class="bg-on">Selected</span>' : '');
    return `<div class="bg-row${on ? ' is-on' : ''}" data-act="bg-pick" data-kind="${kind}" data-id="${esc(item.id)}" role="button" tabindex="0" aria-pressed="${on}">
      ${preview ? `<img class="bg-thumb" alt="" src="${esc(preview)}">` : '<span class="bg-thumb bg-thumb-file"></span>'}
      <span class="bg-col-name"><b>${esc(item.name)}</b>${showCategory && item.category ? `<small>${esc(item.category)}</small>` : ''}</span>
      ${remove}
    </div>`;
  }).join('');
}

function catalogMarkup(items, scene, esc, {grouped = false, showCategory = false} = {}) {
  if (!items.length) return '<div class="bg-catalog-body"><p class="bg-empty">No matches</p></div>';
  if (!grouped) return `<div class="bg-catalog-body">${rows(items, scene, 'catalog', esc, showCategory)}</div>`;
  const names = [];
  const buckets = new Map();
  for (const item of items) {
    if (!buckets.has(item.category)) { buckets.set(item.category, []); names.push(item.category); }
    buckets.get(item.category).push(item);
  }
  return `<div class="bg-catalog-body">${names.map(name => `<section class="bg-group"><h2>${esc(name)}</h2>${rows(buckets.get(name), scene, 'catalog', esc, false)}</section>`).join('')}</div>`;
}

export function page({category = '', settings = {}, uploads: saved = [], viewport = readViewport(), esc = htmlEscape} = {}) {
  const scene = normalizeScene(settings.scene);
  const active = categoryFrom(category);
  const items = searchWallpapers({category: active?.slug || '', limit: active ? 120 : 80});
  const picked = scene?.kind === 'catalog' ? findWallpaper(scene.id) : saved.find(item => item.id === scene?.id);
  const mode = ['light', 'dark', 'system', 'clear'].includes(settings.themeMode) ? settings.themeMode : 'dark';
  const modes = [['light', 'Light'], ['dark', 'Dark'], ['system', 'Auto'], ['clear', 'Clear']].map(([value, label]) => `<button type="button" data-act="theme-mode" data-mode="${value}" aria-pressed="${mode === value}">${label}</button>`).join('');
  const chips = [{slug: '', name: 'All'}, ...CATEGORIES].map(item => {
    const on = (active?.slug || '') === item.slug;
    return `<a class="chip${on ? ' on' : ''}" href="#/backgrounds${item.slug ? '/' + item.slug : ''}" aria-current="${on ? 'true' : 'false'}">${esc(item.name)}</a>`;
  }).join('');
  const stageItem = scene?.kind === 'catalog' ? findWallpaper(scene.id) : null;
  const stageSrc = stageItem ? wallpaperURLs(stageItem).preview : stageURL(settings.scene, viewport);
  const [px, py] = positionOf(scene).split(' ');
  const mine = saved.length ? `<div id="bgMine"><h2>Yours</h2>${rows(saved, scene, 'upload', esc, false)}</div>` : '<div id="bgMine"></div>';
  return `<div class="bg-studio" data-category="${esc(active?.slug || '')}" data-scene-kind="${esc(scene?.kind || '')}" data-scene-id="${esc(scene?.id || '')}">
    <header class="bg-head">
      <button type="button" class="bg-stage" id="bgStage" aria-label="Drag to crop" style="--scene-x:${px};--scene-y:${py}">
        ${stageSrc ? `<img alt="" src="${esc(stageSrc)}">` : '<span class="bg-stage-empty">Pick one</span>'}
      </button>
      <div class="bg-head-copy">
        <h1>Background</h1>
        <p class="bg-note">${picked ? esc(picked.name) : 'App and library'}</p>
        <div class="bg-actions"><button class="btn" type="button" data-act="bg-upload">Upload</button><button class="btn" type="button" data-act="bg-clear">None</button></div>
      </div>
    </header>
    <div class="bg-tools">
      <div class="mode-switch" role="group" aria-label="Appearance">${modes}</div>
      <label class="bg-search"><input id="bgSearch" type="search" placeholder="Search" aria-label="Search wallpapers" enterkeyhint="search" autocomplete="off"></label>
      <nav class="bg-filters" aria-label="Categories">${chips}</nav>
      <p class="bg-count">${CATALOG.length.toLocaleString()} wallpapers · ${CATEGORIES.length} categories</p>
    </div>
    <div class="bg-list" id="bgList">
      ${mine}
      ${catalogMarkup(items, scene, esc, {grouped: !active})}
    </div>
  </div>`;
}

export function mount(root, hooks) {
  const stage = root.querySelector('#bgStage');
  const search = root.querySelector('#bgSearch');
  if (search && !search.dataset.bound) {
    search.dataset.bound = '1';
    search.addEventListener('input', () => {
      const scene = {kind: root.dataset.sceneKind, id: root.dataset.sceneId};
      const items = searchWallpapers({category: root.dataset.category || '', query: search.value, limit: 80});
      root.querySelectorAll('.bg-catalog-body').forEach(node => node.remove());
      const query = search.value.trim();
      root.querySelector('#bgList')?.insertAdjacentHTML('beforeend', catalogMarkup(items, scene, htmlEscape, {grouped: !query && !root.dataset.category, showCategory: Boolean(query)}));
    });
  }
  if (!stage || stage.dataset.bound) return;
  stage.dataset.bound = '1';
  root.addEventListener('keydown', event => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    const row = event.target.closest?.('.bg-row');
    if (!row || event.target !== row) return;
    event.preventDefault();
    row.click();
  });
  let drag = false;
  const point = (event) => {
    const box = stage.getBoundingClientRect();
    const x = clamp01((event.clientX - box.left) / (box.width || 1), 0.5);
    const y = clamp01((event.clientY - box.top) / (box.height || 1), 0.42);
    const pos = positionOf({x, y});
    const [px, py] = pos.split(' ');
    stage.style.setProperty('--scene-x', px);
    stage.style.setProperty('--scene-y', py);
    document.documentElement.style.setProperty('--scene-x', px);
    document.documentElement.style.setProperty('--scene-y', py);
    return {x, y};
  };
  stage.addEventListener('pointerdown', event => { drag = true; stage.setPointerCapture?.(event.pointerId); point(event); });
  stage.addEventListener('pointermove', event => { if (drag) point(event); });
  stage.addEventListener('pointerup', event => { if (!drag) return; drag = false; hooks.onFocus(point(event)); });
  stage.addEventListener('pointercancel', () => { drag = false; });
}
