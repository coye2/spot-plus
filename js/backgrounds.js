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
    preview: `${base}thumb-350-${item.id}.webp`,
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
export async function removeUpload(id) {
  await idb('readwrite', store => store.delete(id));
  uploads.delete(id);
  const paint = paints.get(id);
  if (paint?.url) URL.revokeObjectURL(paint.url);
  paints.delete(id);
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
  const viewport = readViewport();
  const tier = deviceTier(viewport);
  const pixels = targetPixels(viewport);
  const layout = studio.querySelector('.bg-layout');
  layout?.classList.toggle('wide', viewport.width >= 900);
  layout?.classList.toggle('tall', viewport.width < 900);
  const lead = studio.querySelector('.muted');
  if (lead) {
    const device = viewport.width >= 900 ? 'screen' : 'phone';
    const source = tier === '4k' ? '4K' : '1920';
    lead.textContent = `Covers the app and your library. The player stays on its own color. Drag the preview to crop. This ${device} uses a ${source} source, painted at ${pixels.width}×${pixels.height}.`;
  }
  const note = studio.querySelector('.bg-note');
  if (note) {
    const name = note.textContent.split('·')[0].trim() || 'No background';
    note.textContent = `${name} · ${tier === '4k' ? '4K file, cropped to this device' : '1920 file, cropped to this phone'} · Alpha Coders and your uploads`;
  }
  const preview = studio.querySelector('#bgStage img');
  if (preview && scene?.kind === 'catalog') {
    const item = findWallpaper(scene.id);
    const next = item ? sourceForDevice(item, viewport).url : '';
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

function rows(items, scene, kind, esc) {
  return items.map(item => {
    const on = scene?.kind === kind && scene.id === item.id;
    const preview = kind === 'catalog' ? wallpaperURLs(item).preview : '';
    const res = item.w && item.h ? `${item.w}×${item.h}` : '—';
    const remove = kind === 'upload' ? `<button type="button" class="bg-remove" data-act="bg-delete" data-id="${esc(item.id)}">Remove</button>` : '';
    return `<tr class="${on ? 'is-on' : ''}" data-act="bg-pick" data-kind="${kind}" data-id="${esc(item.id)}" tabindex="0" aria-pressed="${on}">
      <td class="bg-col-preview">${preview ? `<img class="bg-thumb" alt="" loading="lazy" decoding="async" src="${esc(preview)}" width="96" height="54">` : '<span class="bg-thumb bg-thumb-file"></span>'}</td>
      <td class="bg-col-name"><b>${esc(item.name)}</b><small>${esc(item.category || 'On this device')}</small></td>
      <td class="bg-col-res">${res}</td>
      <td class="bg-col-source">${kind === 'catalog' ? 'Alpha Coders' : 'Upload'}</td>
      <td class="bg-col-act">${on ? '<span class="bg-on">On</span>' : '<span class="bg-set">Use</span>'}${remove}</td>
    </tr>`;
  }).join('');
}

const htmlEscape = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));

function categories() {
  return CATEGORIES.map(item => typeof item === 'string' ? {slug: item.toLowerCase().replace(/\s+/g, '-'), name: item} : item);
}

/** All includes the entire catalog. Filtering by category or search never drops records. */
export function wallpaperGroups({category = '', query = ''} = {}) {
  const cats = categories();
  const active = cats.find(item => item.slug === category || item.name === category) || null;
  const q = String(query || '').trim().toLowerCase();
  let items = active ? CATALOG.filter(item => item.category === active.name) : CATALOG;
  if (q) items = items.filter(item => `${item.name} ${item.category}`.toLowerCase().includes(q));
  const names = [];
  const buckets = new Map();
  for (const item of items) {
    if (!buckets.has(item.category)) { buckets.set(item.category, []); names.push(item.category); }
    buckets.get(item.category).push(item);
  }
  return {active, groups: names.map(name => [name, buckets.get(name)]), count: items.length};
}

export function page({category = '', settings = {}, uploads: saved = [], viewport = readViewport(), esc = String} = {}) {
  const scene = normalizeScene(settings.scene);
  const {active, groups} = wallpaperGroups({category});
  const cats = categories();
  const picked = scene?.kind === 'catalog' ? findWallpaper(scene.id) : saved.find(item => item.id === scene?.id);
  const tier = deviceTier(viewport);
  const pixels = targetPixels(viewport);
  const frame = viewport.width >= 900 ? 'wide' : 'tall';
  const chips = [{slug: '', name: 'All'}, ...cats].map(({slug, name}) => {
    const on = (slug || '') === (active?.slug || '');
    return `<a class="chip${on ? ' on' : ''}" href="#/backgrounds${slug ? '/' + slug : ''}" aria-pressed="${on}">${esc(name)}</a>`;
  }).join('');
  const preview = stageURL(settings.scene, viewport);
  const body = tableBody(groups, scene, esc);
  const mine = saved.length ? `<tbody><tr class="bg-group"><th colspan="5">On this device</th></tr>${rows(saved, scene, 'upload', esc)}</tbody>` : '';
  return `<div class="bg-studio" data-category="${esc(active?.slug || '')}" data-scene-kind="${esc(scene?.kind || '')}" data-scene-id="${esc(scene?.id || '')}">
    <div class="studio-heading"><div><div class="kicker">Appearance</div><h1>Background</h1><p class="muted">Covers the app and your library. The player stays on its own color. Drag the preview to crop. This ${esc(viewport.width >= 900 ? 'screen' : 'phone')} uses a ${tier === '4k' ? '4K' : '1920'} source, painted at ${pixels.width}×${pixels.height}.</p></div>
    <div class="row-btns"><button class="btn" type="button" data-act="bg-upload">Upload</button><button class="btn" type="button" data-act="bg-clear">None</button></div></div>
    <div class="bg-layout ${frame}">
      <button type="button" class="bg-stage" id="bgStage" aria-label="Drag to choose the crop" style="--scene-x:${positionOf(scene).split(' ')[0]};--scene-y:${positionOf(scene).split(' ')[1]}">
        ${preview ? `<img alt="" src="${esc(preview)}">` : '<span class="bg-stage-empty">Pick a wallpaper</span>'}
        <i class="bg-stage-app"></i><i class="bg-stage-library"></i><b>App and library</b>
      </button>
      <p class="bg-note">${picked ? esc(picked.name) : 'No background'} · ${tier === '4k' ? '4K file, cropped to this device' : '1920 file, cropped to this phone'} · Alpha Coders and your uploads</p>
    </div>
    <label class="bg-search"><input id="bgSearch" type="search" placeholder="Search wallpapers" aria-label="Search wallpapers" enterkeyhint="search" autocomplete="off"></label>
    <div class="chips bg-filters">${chips}</div>
    <div class="bg-table-wrap" id="bgList">
      <table class="bg-table">
        <thead><tr><th>Preview</th><th>Name</th><th class="bg-col-res">Resolution</th><th class="bg-col-source">Source</th><th></th></tr></thead>
        ${body}${mine}
      </table>
    </div>
  </div>`;
}

export function fitWallpaperList(root = document) {
  const wrap = root.querySelector?.('#bgList') || root.querySelector?.('.bg-table-wrap');
  const main = document.querySelector('main');
  if (!wrap?.getBoundingClientRect || !main?.getBoundingClientRect) return 0;
  // The outer app must never become the scroller for the wallpaper database.
  main.scrollTop = 0;
  const style = getComputedStyle(main);
  const mainBottom = main.getBoundingClientRect().bottom - (parseFloat(style.paddingBottom) || 0);
  let limit = Math.min(globalThis.visualViewport?.height || globalThis.innerHeight || 800, mainBottom);
  for (const node of [document.querySelector('.nav'), document.querySelector('.bar')]) {
    if (node && !node.hidden && getComputedStyle(node).display !== 'none') {
      limit = Math.min(limit, node.getBoundingClientRect().top);
    }
  }
  const space = Math.max(120, Math.floor(limit - wrap.getBoundingClientRect().top - 8));
  // A real pixel flex basis is required in iOS WebKit: height alone gets shrunk to a tiny strip.
  wrap.style.flex = '0 0 ' + space + 'px';
  wrap.style.height = space + 'px';
  wrap.style.maxHeight = space + 'px';
  wrap.style.overflowY = 'auto';
  return space;
}

function tableBody(groups, scene, esc) {
  return groups.map(([name, items]) => items.length ? `<tbody class="bg-catalog-body"><tr class="bg-group"><th colspan="5">${esc(name)}</th></tr>${rows(items, scene, 'catalog', esc)}</tbody>` : '').join('');
}

export function mount(root, hooks) {
  const search = root.querySelector('#bgSearch');
  if (search && !search.dataset.bound) {
    search.dataset.bound = '1';
    search.addEventListener('input', () => {
      const studio = root.querySelector('.bg-studio') || root;
      const scene = {kind: studio.dataset.sceneKind, id: studio.dataset.sceneId};
      const {groups} = wallpaperGroups({category: studio.dataset.category || '', query: search.value});
      root.querySelectorAll('.bg-catalog-body').forEach(node => node.remove());
      root.querySelector('.bg-table')?.insertAdjacentHTML('beforeend', tableBody(groups, scene, htmlEscape));
    });
  }
  fitWallpaperList(root);
  requestAnimationFrame(() => fitWallpaperList(root));
  if (!root.dataset.fit) {
    root.dataset.fit = '1';
    globalThis.addEventListener?.('resize', () => { if (document.body?.dataset.page === 'backgrounds') fitWallpaperList(root); });
  }
  const stage = root.querySelector('#bgStage');
  if (!stage || stage.dataset.bound) return;
  stage.dataset.bound = '1';
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
