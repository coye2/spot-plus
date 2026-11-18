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
  const out = {kind: scene.kind, id: String(scene.id), x: clamp01(scene.x, 0.5), y: clamp01(scene.y, 0.42)};
  const item = scene.kind === 'catalog' ? liveItem(scene.item) : null;
  if (item && item.id === out.id) out.item = item;
  return out;
}

/** A wallpaper found through the live Alpha Coders search; only safe image-host parts are kept. */
export function liveItem(x) {
  if (!x || !/^\d{1,10}$/.test(String(x.id || '')) || !/^images\d{0,2}$/.test(String(x.host || '')) || !/^\d{1,6}$/.test(String(x.folder || '')) || !/^(jpe?g|png|webp)$/.test(String(x.ext || ''))) return null;
  return {id: String(x.id), host: String(x.host), folder: String(x.folder), ext: String(x.ext), name: String(x.name || 'Wallpaper').slice(0, 140), category: String(x.category || 'Alpha Coders').slice(0, 60), w: Number(x.w) || 0, h: Number(x.h) || 0};
}
const live = new Map();

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

export function findWallpaper(id, scene) {
  if (scene?.item?.id === id) { live.set(id, scene.item); return scene.item; }
  return CATALOG.find(item => item.id === id) || live.get(id) || null;
}
export function stageURL(scene, viewport = readViewport()) {
  const picked = normalizeScene(scene);
  if (!picked) return '';
  if (picked.kind === 'catalog') {
    const item = findWallpaper(picked.id, picked);
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
    const item = findWallpaper(scene.id, scene);
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
    const item = findWallpaper(scene.id, scene);
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

let activeSearchQuery = '';
let activeCategorySlug = '';
let savedGridScroll = 0;
// The grid paints in batches as you scroll, so thousands of wallpapers never load at once.
const BATCH = 48;
export const WALLPAPER_ENDPOINT = 'https://spot-plus-canvas.pwr97pnmkn.workers.dev/wallpapers';
const catalogIds = new Set(CATALOG.map(item => item.id));

function rows(items, scene, kind, esc) {
  return items.map(item => {
    const on = scene?.kind === (kind === 'live' ? 'catalog' : kind) && scene.id === item.id;
    const preview = kind === 'catalog' || kind === 'live' ? wallpaperURLs(item).preview : '';
    const res = item.w && item.h ? `${item.w}×${item.h}` : '—';
    const remove = kind === 'upload' ? `<button type="button" class="bg-remove" data-act="bg-delete" data-id="${esc(item.id)}">Remove</button>` : '';
    return `<tr class="bg-card${on ? ' is-on' : ''}" data-act="bg-pick" data-kind="${kind === 'live' ? 'catalog' : kind}" data-id="${esc(item.id)}" tabindex="0" aria-pressed="${on}">
      <td class="bg-col-preview">${preview ? `<img class="bg-thumb" alt="${esc(item.name)}" loading="lazy" decoding="async" referrerpolicy="no-referrer" src="${esc(preview)}" width="350" height="197">` : '<span class="bg-thumb bg-thumb-file"></span>'}</td>
      <td class="bg-col-name"><b>${esc(item.name)}</b><small>${esc(item.category || 'On this device')}</small></td>
      <td class="bg-col-res">${res}</td>
      <td class="bg-col-source">${kind === 'upload' ? 'Upload' : 'Alpha Coders'}</td>
      <td class="bg-col-act">${on ? '<span class="bg-on">Active</span>' : '<span class="bg-set">Use</span>'}${remove}</td>
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
  const tokens = String(query || '').trim().toLowerCase().split(/\s+/).filter(Boolean);
  let items = active ? CATALOG.filter(item => item.category === active.name) : CATALOG;
  if (tokens.length) {
    items = items.filter(item => {
      const hay = `${item.name} ${item.category} ${item.id} ${item.w}x${item.h} ${item.w >= 3840 ? '4k uhd' : 'fhd 1080p'}`.toLowerCase();
      return tokens.every(tok => hay.includes(tok));
    });
  }
  const names = [];
  const buckets = new Map();
  for (const item of items) {
    if (!buckets.has(item.category)) { buckets.set(item.category, []); names.push(item.category); }
    buckets.get(item.category).push(item);
  }
  return {active, groups: names.map(name => [name, buckets.get(name)]), count: items.length};
}

function statusText(count, active, query) {
  const label = `${count.toLocaleString()} wallpaper${count === 1 ? '' : 's'}`;
  if (query && active) return `${label} in ${active.name} for “${query}”`;
  if (query) return `${label} for “${query}”`;
  if (active) return `${label} in ${active.name}`;
  return `${label} · Full database`;
}

export function page({category = '', settings = {}, uploads: saved = [], viewport = readViewport(), esc = String} = {}) {
  const scene = normalizeScene(settings.scene);
  const {active, groups, count} = wallpaperGroups({category, query: activeSearchQuery});
  const nextSlug = active?.slug || '';
  if (nextSlug !== activeCategorySlug) {
    activeCategorySlug = nextSlug;
    savedGridScroll = 0;
  }
  const cats = categories();
  const picked = scene?.kind === 'catalog' ? findWallpaper(scene.id, scene) : saved.find(item => item.id === scene?.id);
  const tier = deviceTier(viewport);
  const pixels = targetPixels(viewport);
  const frame = viewport.width >= 900 ? 'wide' : 'tall';
  const chips = [{slug: '', name: 'All'}, ...cats].map(({slug, name}) => {
    const on = (slug || '') === (active?.slug || '');
    return `<a class="chip${on ? ' on' : ''}" href="#/backgrounds${slug ? '/' + slug : ''}" aria-pressed="${on}">${esc(name)}</a>`;
  }).join('');
  const preview = stageURL(settings.scene, viewport);
  const body = tableBody(groups, scene, esc);
  const mine = saved.length ? `<tbody class="bg-uploads-body"><tr class="bg-group"><th colspan="5">On this device (${saved.length})</th></tr>${rows(saved, scene, 'upload', esc)}</tbody>` : '';
  const liveLabel = liveQueryFor(active, activeSearchQuery);
  const hasEmpty = !groups.length && !saved.length;
  return `<div class="bg-studio" data-category="${esc(nextSlug)}" data-scene-kind="${esc(scene?.kind || '')}" data-scene-id="${esc(scene?.id || '')}">
    <div class="studio-heading"><div><div class="kicker">Appearance</div><h1>Background</h1><p class="muted">Covers the app and your library. The player stays on its own color. Drag the preview to crop. This ${esc(viewport.width >= 900 ? 'screen' : 'phone')} uses a ${tier === '4k' ? '4K' : '1920'} source, painted at ${pixels.width}×${pixels.height}.</p></div>
    <div class="row-btns"><button class="btn" type="button" data-act="bg-upload">Upload</button><button class="btn" type="button" data-act="bg-clear">None</button></div></div>
    <div class="bg-layout ${frame}">
      <button type="button" class="bg-stage" id="bgStage" aria-label="Drag to choose the crop" style="--scene-x:${positionOf(scene).split(' ')[0]};--scene-y:${positionOf(scene).split(' ')[1]}">
        ${preview ? `<img alt="" src="${esc(preview)}">` : '<span class="bg-stage-empty">Pick a wallpaper</span>'}
        <i class="bg-stage-app"></i><i class="bg-stage-library"></i><b>App and library</b>
      </button>
      <p class="bg-note">${picked ? esc(picked.name) : 'No background'} · ${tier === '4k' ? '4K file, cropped to this device' : '1920 file, cropped to this phone'} · Alpha Coders and your uploads</p>
    </div>
    <div class="bg-search-bar">
      <label class="bg-search"><input id="bgSearch" type="search" value="${esc(activeSearchQuery)}" placeholder="Search every Alpha Coders wallpaper" aria-label="Search wallpapers" enterkeyhint="search" autocomplete="off"></label>
      <button type="button" class="btn small bg-search-clear" id="bgSearchClear" data-act="bg-reset-search"${activeSearchQuery ? '' : ' hidden'}>Clear</button>
    </div>
    <div class="bg-status-row"><span id="bgStatus">${esc(statusText(count, active, activeSearchQuery.trim()))}</span></div>
    <div class="chips bg-filters">${chips}</div>
    <div class="bg-table-wrap" id="bgList">
      <table class="bg-table">
        <thead><tr><th>Preview</th><th>Name</th><th class="bg-col-res">Resolution</th><th class="bg-col-source">Source</th><th></th></tr></thead>
        ${mine}${body}
        <tbody class="bg-live-body" hidden><tr class="bg-group"><th colspan="5" id="bgLiveHead">More from Alpha Coders</th></tr></tbody>
      </table>
      <div class="bg-more" id="bgMore" aria-live="polite">${count > BATCH ? 'Scroll for more' : liveLabel ? 'Loading more from Alpha Coders…' : ''}</div>
      <div class="bg-empty" id="bgEmpty"${hasEmpty ? '' : ' hidden'}>
        <p>No wallpapers match “<span id="bgEmptyQuery">${esc(activeSearchQuery.trim())}</span>”.</p>
        <button type="button" class="btn small" data-act="bg-reset-search">Show all wallpapers</button>
      </div>
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
  const space = Math.max(160, Math.floor(limit - wrap.getBoundingClientRect().top - 8));
  // A real pixel flex basis. iOS shrinks a height-only scrollport to a tiny strip.
  wrap.style.position = 'relative';
  wrap.style.flex = '0 0 ' + space + 'px';
  wrap.style.height = space + 'px';
  wrap.style.maxHeight = space + 'px';
  wrap.style.overflowY = 'scroll';
  wrap.style.webkitOverflowScrolling = 'touch';
  wrap.style.touchAction = 'pan-y';
  wrap.style.overscrollBehavior = 'contain';
  return space;
}

/** First batch only; mount() paints the rest as the list nears its end. */
function tableBody(groups, scene, esc, limit = BATCH) {
  const items = groups.flatMap(([, list]) => list);
  return items.length ? `<tbody class="bg-catalog-body">${rows(items.slice(0, limit), scene, 'catalog', esc)}</tbody>` : '';
}

/** What to ask the live search: the typed words, or the open category so it keeps going past our copy. */
function liveQueryFor(active, query) {
  const typed = String(query || '').trim();
  if (typed.length >= 2) return typed;
  return active ? active.name : '';
}

/** Scene for a tapped card; wallpapers from the live search carry their own image address. */
export function sceneFor(kind, id, cur) {
  const base = {kind, id: String(id), x: cur?.x ?? 0.5, y: cur?.y ?? 0.42};
  if (kind === 'catalog' && !catalogIds.has(String(id)) && live.has(String(id))) base.item = live.get(String(id));
  return base;
}

/** Update the active card, preview, and note without rebuilding the page (keeps your place in the list). */
export function markPicked(root, picked) {
  const studio = root.querySelector?.('.bg-studio');
  if (!studio) return;
  const scene = normalizeScene(picked);
  studio.dataset.sceneKind = scene?.kind || '';
  studio.dataset.sceneId = scene?.id || '';
  studio.querySelectorAll('.bg-card').forEach(card => {
    const on = !!scene && card.dataset.kind === scene.kind && card.dataset.id === scene.id;
    card.classList.toggle('is-on', on);
    card.setAttribute('aria-pressed', String(on));
    const slot = card.querySelector('.bg-on,.bg-set');
    if (slot) { slot.className = on ? 'bg-on' : 'bg-set'; slot.textContent = on ? 'Active' : 'Use'; }
  });
  const stage = studio.querySelector('#bgStage');
  const url = stageURL(scene);
  if (stage && url) {
    let img = stage.querySelector('img');
    if (!img) { stage.querySelector('.bg-stage-empty')?.remove(); img = document.createElement('img'); img.alt = ''; stage.prepend(img); }
    if (img.getAttribute('src') !== url) img.src = url;
  }
  const note = studio.querySelector('.bg-note');
  const item = scene?.kind === 'catalog' ? findWallpaper(scene.id, scene) : null;
  if (note && item) note.textContent = `${item.name} · ${note.textContent.split('·').slice(1).join('·').trim()}`;
}

export function mount(root, hooks) {
  const list = root.querySelector('#bgList');
  const search = root.querySelector('#bgSearch');
  const clearBtn = root.querySelector('#bgSearchClear');
  const statusEl = root.querySelector('#bgStatus');
  const emptyEl = root.querySelector('#bgEmpty');
  const emptyQueryEl = root.querySelector('#bgEmptyQuery');

  const table = root.querySelector('.bg-table');
  const moreEl = root.querySelector('#bgMore');
  const liveBody = root.querySelector('.bg-live-body');
  const liveHead = root.querySelector('#bgLiveHead');
  const studioOf = () => root.querySelector('.bg-studio') || root;
  const sceneNow = () => ({kind: studioOf().dataset.sceneKind, id: studioOf().dataset.sceneId});
  let flat = [], shown = root.querySelectorAll('.bg-catalog-body .bg-card').length, local = 0;
  const L = {q: '', page: 0, more: false, busy: false, token: 0, count: 0, failed: false, timer: 0, seen: new Set()};

  const status = () => {
    const studio = studioOf();
    const {active} = wallpaperGroups({category: studio.dataset.category || ''});
    const trimmed = (search?.value || '').trim();
    let text = statusText(local, active, trimmed);
    if (L.count) text += ` · +${L.count.toLocaleString()} from all of Alpha Coders`;
    else if (L.busy && L.q) text += ' · searching all of Alpha Coders…';
    if (statusEl) statusEl.textContent = text;
    if (moreEl) moreEl.textContent = shown < flat.length ? 'Scroll for more' : L.busy ? 'Loading more from Alpha Coders…' : L.failed ? 'Alpha Coders did not answer. Scroll to try again.' : L.q && L.more ? 'Scroll for more' : L.q && L.count ? 'That is everything Alpha Coders has for this.' : '';
    if (emptyEl) {
      const hasUploads = !!root.querySelector('.bg-uploads-body');
      emptyEl.hidden = local > 0 || L.count > 0 || hasUploads || (L.q && (L.busy || L.more));
      if (emptyQueryEl) emptyQueryEl.textContent = trimmed;
    }
  };

  const paintLocal = () => {
    if (shown >= flat.length) return false;
    let body = root.querySelector('.bg-catalog-body');
    if (!body) { table?.querySelector('.bg-live-body')?.insertAdjacentHTML('beforebegin', '<tbody class="bg-catalog-body"></tbody>'); body = root.querySelector('.bg-catalog-body'); }
    body?.insertAdjacentHTML('beforeend', rows(flat.slice(shown, shown + BATCH), sceneNow(), 'catalog', htmlEscape));
    shown = Math.min(flat.length, shown + BATCH);
    return true;
  };

  const loadLive = async () => {
    if (!L.q || L.busy || (!L.more && L.page) || !liveBody) return;
    L.busy = true; L.failed = false; status();
    const token = L.token, page = L.page + 1;
    try {
      const r = await fetch(`${WALLPAPER_ENDPOINT}?q=${encodeURIComponent(L.q)}&page=${page}`, {credentials: 'omit'});
      if (!r.ok) throw new Error('unavailable');
      const data = await r.json();
      if (token !== L.token) return;
      const fresh = (data.items || []).map(liveItem).filter(item => item && !catalogIds.has(item.id) && !L.seen.has(item.id));
      for (const item of fresh) { L.seen.add(item.id); live.set(item.id, item); }
      L.page = page; L.more = !!data.more && page < 200;
      if (fresh.length) {
        liveBody.hidden = false;
        if (liveHead) liveHead.textContent = `More “${L.q}” from all of Alpha Coders`;
        liveBody.insertAdjacentHTML('beforeend', rows(fresh, sceneNow(), 'live', htmlEscape));
        L.count += fresh.length;
      }
    } catch {
      if (token === L.token) L.failed = true;
    } finally {
      if (token === L.token) { L.busy = false; status(); fill(); }
    }
  };

  // Keep painting until the list can scroll (or there is nothing left), so the end is never a dead stop.
  const nearEnd = () => list && list.scrollTop + list.clientHeight >= list.scrollHeight - 900;
  const fill = () => {
    let guard = 0;
    while (list && nearEnd() && paintLocal() && guard++ < 40) { /* paint the next batch */ }
    if (list && nearEnd() && shown >= flat.length && !L.failed) loadLive();
    status();
  };

  const resetLive = (query) => {
    clearTimeout(L.timer);
    Object.assign(L, {q: query, page: 0, more: !!query, busy: false, token: L.token + 1, count: 0, failed: false, seen: new Set()});
    if (liveBody) { liveBody.hidden = true; liveBody.querySelectorAll('.bg-card').forEach(node => node.remove()); }
  };

  const applyFilter = ({ resetScroll = true, keepRendered = false } = {}) => {
    const studio = studioOf();
    const query = search?.value || '';
    activeSearchQuery = query;
    const trimmed = query.trim();
    if (clearBtn) clearBtn.hidden = !trimmed;
    const {active, groups, count} = wallpaperGroups({category: studio.dataset.category || '', query});
    flat = groups.flatMap(([, items]) => items);
    local = count;
    if (!keepRendered) {
      root.querySelectorAll('.bg-catalog-body').forEach(node => node.remove());
      shown = 0;
      paintLocal();
    }
    const nextLive = liveQueryFor(active, query);
    if (nextLive !== L.q || !keepRendered) resetLive(nextLive);
    if (list && resetScroll) {
      list.scrollTop = 0;
      savedGridScroll = 0;
    }
    fitWallpaperList(root);
    status();
    // Wait for typing to settle before asking Alpha Coders; local matches show at once.
    if (L.q) L.timer = setTimeout(fill, trimmed ? 450 : 0);
  };
  if (list) applyFilter({resetScroll: false, keepRendered: true});

  if (search && !search.dataset.bound) {
    search.dataset.bound = '1';
    let typing = 0;
    search.addEventListener('input', () => { clearTimeout(typing); typing = setTimeout(() => applyFilter({ resetScroll: true }), 120); });
  }

  root.querySelectorAll('[data-act="bg-reset-search"]').forEach((btn) => {
    if (btn.dataset.bound) return;
    btn.dataset.bound = '1';
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (search) {
        search.value = '';
        applyFilter({ resetScroll: true });
        search.focus();
      }
    });
  });

  const restore = () => {
    if (!list || savedGridScroll <= 0) return;
    let guard = 0;
    while (list.scrollHeight < savedGridScroll + list.clientHeight && paintLocal() && guard++ < 80) { /* paint up to the saved spot */ }
    list.scrollTop = savedGridScroll;
  };
  if (list) {
    restore();
    if (!list.dataset.bound) {
      list.dataset.bound = '1';
      let ticking = false;
      list.addEventListener('scroll', () => {
        savedGridScroll = list.scrollTop;
        if (ticking) return;
        ticking = true;
        requestAnimationFrame(() => { ticking = false; fill(); });
      }, { passive: true });
    }
  }

  fitWallpaperList(root);
  requestAnimationFrame(() => {
    fitWallpaperList(root);
    restore();
    fill();
  });

  if (!root.dataset.fit) {
    root.dataset.fit = '1';
    const refit = () => { if (document.body?.dataset.page === 'backgrounds') fitWallpaperList(root); };
    globalThis.addEventListener?.('resize', refit);
    globalThis.visualViewport?.addEventListener?.('resize', refit);
    const main = document.querySelector('main');
    if (main && !main.dataset.bgScrollGuard) {
      main.dataset.bgScrollGuard = '1';
      main.addEventListener('scroll', () => {
        if (document.body?.dataset.page === 'backgrounds' && main.scrollTop !== 0) main.scrollTop = 0;
      }, { passive: true });
    }
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
