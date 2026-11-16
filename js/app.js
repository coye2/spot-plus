import {CanvasPlayer,canvasEnabled,setCanvasEnabled,findVisualLoop} from './canvas.js';
import {audioHasHeadroom} from './playback-policy.js';
import {PlayerColors,syncChrome} from './player-colors.js';
import {getTrackStats,matchPlayCount,hydrateStatistics} from './spotify-stats.js';
import {rewindView,importRewind,filters as rewindFilters,hydrateRewind,warmRewind,openRewindStory} from './rewind.js';
import {ListeningMeter,saveHistory,readHistory,clearHistory} from './listening-history.js';
import {recentPlaysAsHistory} from './stats-api.js';
import {fetchSnapshot,newSyncKey,validSyncKey} from './relay-sync.js';
// app.js — Spot+ UI: router, views, player bar, now-playing screen.
import * as api from './api.js';
import * as notify from './notify.js';
import * as store from './store.js';
await store.ready(); // Load the Spotify account copy from IndexedDB before the first render.
import * as player from './player.js';
import { libraryItems, visibleTracks, parseRoute } from './library.js';
import * as dj from './dj.js';
import * as spotify from './spotify.js';
import * as themes from './themes.js';
import {clipSource,hasLocalClip,prefetchClips} from './canvas-cache.js';
import {Jam,jamLink,validJamCode} from './jam.js';
import qrcode from './vendor/qrcode.js';
import {shouldOnboard,showOnboarding} from './onboarding.js';
import {addLinks,syncLinks,loadLinks,cachedLinks,clearLinks,madeForYou,fetchPublic} from './spotify-links.js';
import {bindPlayerDismiss} from './player-gestures.js';
import {COMPANION_INSTALL_URL,connectionDevice,setupHtml,spotifyConnectionURLs,helperInstallHtml,copyHelperInstallLink,spotifyProfileHtml} from './account-setup.js';
let accountDevice=connectionDevice(navigator.userAgent,navigator.platform,navigator.maxTouchPoints);
import {validateAccountSnapshot,isAccountMessage,ACCOUNT_FILE_LIMIT,accountReadNotice} from './spotify-account.js';
import {decodeLibraryText,isLibraryText} from './spotify-reader.js';

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = (s) => { s = Math.max(0, Math.floor(s || 0)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
const fmtNum = (n) => new Intl.NumberFormat(undefined, { notation: 'compact' }).format(n || 0);
const total = (ts) => { const m = Math.round(ts.reduce((a, t) => a + (t.duration || 0), 0) / 60); return m >= 60 ? `${Math.floor(m / 60)} hr ${m % 60} min` : `${m} min`; };
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;

/* ---------------- Icons ---------------- */
const P = {
  mic: '<path d="M12 15a3 3 0 003-3V5a3 3 0 00-6 0v7a3 3 0 003 3zm-5-3H5a7 7 0 006 6.93V22h2v-3.07A7 7 0 0019 12h-2a5 5 0 01-10 0z"/>',
  folder: '<path d="M3 4h7l2 2h9v14H3zm2 4v10h14V8h-8l-2-2H5z"/>',
  arrowUpRight: '<path d="M7 5v2h8.6L5.3 17.3l1.4 1.4L17 8.4V17h2V5z"/>',
  arrow: '<path d="m12 4-1.4 1.4 5.6 5.6H3v2h13.2l-5.6 5.6L12 20l8-8z"/>',
  back: '<path d="M15.41 7.41 14 6l-6 6 6 6 1.41-1.41L10.83 12z"/>',
  share: '<path d="M18 16.08c-.76 0-1.44.3-1.96.77L8.91 12.7c.05-.23.09-.46.09-.7s-.04-.47-.09-.7l7.05-4.11A2.99 2.99 0 1 0 15 5c0 .24.04.47.09.7L8.04 9.81a3 3 0 1 0 0 4.38l7.12 4.16c-.05.21-.08.43-.08.65A2.92 2.92 0 1 0 18 16.08z"/>',
  jam: '<path d="M9 3a3 3 0 1 1 0 6 3 3 0 0 1 0-6zm6.5 1a2.5 2.5 0 1 1 0 5 2.5 2.5 0 0 1 0-5zM9 11c3.3 0 6 1.6 6 4v3H3v-3c0-2.4 2.7-4 6-4zm6.6.1c2.6.3 4.4 1.6 4.4 3.4V18h-3v-3c0-1.5-.5-2.8-1.4-3.9z"/>',
  sun: '<path d="M12 7a5 5 0 1 0 0 10 5 5 0 0 0 0-10zM2 13h2a1 1 0 0 0 0-2H2a1 1 0 0 0 0 2zm18 0h2a1 1 0 0 0 0-2h-2a1 1 0 0 0 0 2zM11 2v2a1 1 0 0 0 2 0V2a1 1 0 0 0-2 0zm0 18v2a1 1 0 0 0 2 0v-2a1 1 0 0 0-2 0z"/>',
  sort: '<path d="M3 5h18v2H3zm0 6h12v2H3zm0 6h6v2H3z"/>',
  pin: '<path d="m15 2 7 7-2 2-2-1-4 4v3l-2 2-3-3-6 6-1-1 6-6-3-3 2-2h3l4-4-1-2z"/>',
  device: '<path d="M3 3h15v8h-2V5H5v12h5v2H3zm10 10h8v9h-8zm2 2v5h4v-5zM7 21h3v2H7z"/>',
  now: '<path d="M3 3h18v18H3zm2 2v14h14V5zm3 2 8 5-8 5z"/>',
  history: '<path d="M12 3a9 9 0 1 1-8.5 12h2.2A7 7 0 1 0 6 8h3v2H2V3h2v3a9 9 0 0 1 8-3zm-1 4h2v5l4 2-1 2-5-3z"/>',
  up: '<path d="m6 15 6-6 6 6 1.4-1.4L12 6.2l-7.4 7.4z"/>',
  dj: [4,8,12,16,20].map((x,i)=>'<rect class="dj-eq-bar" style="--beat:'+i+'" x="'+(x-1)+'" y="'+[5,8,2,7,4][i]+'" width="2" height="'+[14,8,20,10,16][i]+'" rx="1"/>').join(''),
  play: '<path d="M8 5v14l11-7z"/>',
  pause: '<path d="M6 5h4v14H6zM14 5h4v14h-4z"/>',
  next: '<path d="M6 18l8.5-6L6 6v12zm10-12v12h2V6h-2z"/>',
  prev: '<path d="M6 6h2v12H6zm3.5 6l8.5 6V6z"/>',
  shuffle: '<path d="M10.59 9.17L5.41 4 4 5.41l5.17 5.17 1.42-1.41zM14.5 4l2.04 2.04L4 18.59 5.41 20 17.96 7.46 20 9.5V4h-5.5zm.33 9.41l-1.41 1.41 3.13 3.13L14.5 20H20v-5.5l-2.04 2.04-3.13-3.13z"/>',
  repeat: '<path d="M7 7h10v3l4-4-4-4v3H5v6h2V7zm10 10H7v-3l-4 4 4 4v-3h12v-6h-2v4z"/>',
  repeat1: '<path d="M7 7h10v3l4-4-4-4v3H5v6h2V7zm10 10H7v-3l-4 4 4 4v-3h12v-6h-2v4zm-4-2V9h-1l-2 1v1h1.5v4H13z"/>',
  heart: '<path d="M16.5 3c-1.74 0-3.41.81-4.5 2.09C10.91 3.81 9.24 3 7.5 3 4.42 3 2 5.42 2 8.5c0 3.78 3.4 6.86 8.55 11.54L12 21.35l1.45-1.32C18.6 15.36 22 12.28 22 8.5 22 5.42 19.58 3 16.5 3zm-4.4 15.55l-.1.1-.1-.1C7.14 14.24 4 11.39 4 8.5 4 6.5 5.5 5 7.5 5c1.54 0 3.04.99 3.57 2.36h1.87C13.46 5.99 14.96 5 16.5 5c2 0 3.5 1.5 3.5 3.5 0 2.89-3.14 5.74-7.9 10.05z"/>',
  heartFill: '<path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/>',
  more: '<path d="M6 12a2 2 0 1 1-4 0 2 2 0 0 1 4 0zm8 0a2 2 0 1 1-4 0 2 2 0 0 1 4 0zm8 0a2 2 0 1 1-4 0 2 2 0 0 1 4 0z"/>',
  home: '<path d="M10 20v-6h4v6h5v-8h3L12 3 2 12h3v8z"/>',
  search: '<path d="M15.5 14h-.79l-.28-.27A6.47 6.47 0 0016 9.5 6.5 6.5 0 109.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z"/>',
  library: '<path d="M4 6H2v14a2 2 0 002 2h14v-2H4V6zm16-4H8a2 2 0 00-2 2v12a2 2 0 002 2h12a2 2 0 002-2V4a2 2 0 00-2-2zm-2 5h-3v5.5a2.5 2.5 0 11-1-2V5h4v2z"/>',
  settings: '<path d="M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58a.49.49 0 00.12-.61l-1.92-3.32a.49.49 0 00-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54a.48.48 0 00-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96a.48.48 0 00-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.05.3-.09.63-.09.94s.02.64.07.94l-2.03 1.58a.49.49 0 00-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6A3.6 3.6 0 1112 8.4a3.6 3.6 0 010 7.2z"/>',
  download: '<path d="M5 20h14v-2H5v2zM19 9h-4V3H9v6H5l7 7 7-7z"/>',
  check: '<path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/>',
  down: '<path d="M7.41 8.59L12 13.17l4.59-4.58L18 10l-6 6-6-6z"/>',
  plus: '<path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"/>',
  radio: '<path d="M12 10a2 2 0 100 4 2 2 0 000-4zm-6.36-3.64A8.95 8.95 0 003 12c0 2.48 1 4.73 2.64 6.36l1.41-1.41A6.96 6.96 0 015 12c0-1.94.79-3.69 2.05-4.95L5.64 6.36zm12.72 0l-1.41 1.41A6.96 6.96 0 0119 12c0 1.93-.79 3.68-2.05 4.95l1.41 1.41A8.95 8.95 0 0021 12c0-2.48-1-4.73-2.64-6.36zM8.46 9.17A3.97 3.97 0 008 12c0 1.1.45 2.1 1.17 2.83l1.41-1.41A1.99 1.99 0 0110 12c0-.55.22-1.05.59-1.41L9.17 9.17zm6.37 0l-1.41 1.41c.36.36.58.86.58 1.42 0 .55-.22 1.05-.59 1.41l1.41 1.41A3.97 3.97 0 0016 12c0-1.1-.45-2.1-1.17-2.83z"/>',
  queue: '<path d="M3 13h2v-2H3v2zm0 4h2v-2H3v2zm0-8h2V7H3v2zm4 4h14v-2H7v2zm0 4h14v-2H7v2zM7 7v2h14V7H7z"/>',
  lyrics: '<path d="M20 2H4a2 2 0 00-2 2v18l4-4h14a2 2 0 002-2V4a2 2 0 00-2-2zM6 9h12v2H6V9zm8 5H6v-2h8v2zm4-6H6V6h12v2z"/>',
  close: '<path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/>',
  note: '<path d="M12 3v10.55A4 4 0 1014 17V7h4V3h-6z"/>',
  trash: '<path d="M6 19a2 2 0 002 2h8a2 2 0 002-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/>',
  edit: '<path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04a1 1 0 000-1.41l-2.34-2.34a1 1 0 00-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/>',
  swap: '<path d="M6.99 11L3 15l3.99 4v-3H14v-2H6.99v-3zM21 9l-3.99-4v3H10v2h7.01v3L21 9z"/>',
  album: '<path d="M12 2a10 10 0 100 20 10 10 0 000-20zm0 14.5a4.5 4.5 0 110-9 4.5 4.5 0 010 9zm0-5.5a1 1 0 100 2 1 1 0 000-2z"/>',
  person: '<path d="M12 12a4 4 0 100-8 4 4 0 000 8zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"/>',
  vol: '<path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3A4.5 4.5 0 0014 7.97v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06a7 7 0 010 13.42v2.06A9 9 0 0014 3.23z"/>',
  import: '<path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z"/>',
};
const I = Object.fromEntries(Object.entries(P).map(([k, v]) => [k, `<svg viewBox="0 0 24 24" aria-hidden="true">${v}</svg>`]));
const setIcon = (el, name) => { if (el && el.dataset.cur !== name) { el.dataset.cur = name; el.innerHTML = I[name]; } };

/* ---------------- Small UI helpers ---------------- */
const main = $('#main');
const view = $('#view');

function toast(msg, { sticky = false, action = null } = {}) {
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = msg;
  if (action) { const b = document.createElement('button'); b.className = 'toast-action'; b.textContent = action.label; b.onclick = () => { action.run(); el.remove(); }; el.append(b); }
  $('#toasts').appendChild(el);
  requestAnimationFrame(() => el.classList.add('show'));
  const close = (ms = 0) => setTimeout(() => { el.classList.remove('show'); setTimeout(() => el.remove(), 300); }, ms);
  if (!sticky) close(3200);
  return { set: (m) => { el.textContent = m; }, close };
}

function ask({ title, message = '', value = '', placeholder = '', ok = 'OK', input = true }) {
  return new Promise((resolve) => {
    const d = $('#dlg'), form = $('#dlgForm'), inp = $('#dlgInput'), cancel = $('#dlgCancel');
    $('#dlgTitle').textContent = title;
    $('#dlgMsg').textContent = message;
    $('#dlgMsg').hidden = !message;
    inp.hidden = !input; inp.value = value; inp.placeholder = placeholder;
    $('#dlgOk').textContent = ok;
    const finish = (v) => { form.removeEventListener('submit', onSubmit); cancel.removeEventListener('click', onCancel); d.removeEventListener('cancel', onCancel); if (d.open) d.close(); resolve(v); };
    const onSubmit = (e) => { e.preventDefault(); finish(input ? inp.value.trim() || null : true); };
    const onCancel = (e) => { e?.preventDefault?.(); finish(null); };
    form.addEventListener('submit', onSubmit);
    cancel.addEventListener('click', onCancel);
    d.addEventListener('cancel', onCancel);
    d.showModal();
    if (input) setTimeout(() => { inp.focus(); inp.select(); }, 50);
  });
}
const confirmBox = (title, message, ok = 'Delete') => ask({ title, message, ok, input: false });

const sheet = $('#sheet');
let sheetFns = [];
function openSheet({ head = '', items = [], body = '' }) {
  sheetFocus=document.activeElement;
  sheetFns = items.map((x) => x.fn);
  $('#sheetPanel').innerHTML = `<div class="grab"></div><button class="icon sheet-close" data-act="sheet-close" aria-label="Close menu">${I.close}</button>${head}${body}<div class="sheet-list">${items.map((x, i) =>
    `<button class="sheet-item" data-act="sheet-pick" data-si="${i}">${x.icon || ''}<span>${esc(x.label)}${x.sub ? `<small>${esc(x.sub)}</small>` : ''}</span></button>`).join('')}</div>`;
  sheet.hidden = false;
  $('.app').inert=true;
  if(npOpen)np.inert=true;
  $('#sheetPanel button')?.focus();
  requestAnimationFrame(() => sheet.classList.add('open'));
}
function closeSheet() { if(sheet.hidden)return;sheet.classList.remove('open');sheet.hidden=true;$('.app').inert=npOpen&&matchMedia(MOBILE_QUERY).matches;np.inert=false;sheetFocus?.isConnected&&sheetFocus.focus(); }
const sheetHead = (t) => `<div class="sheet-head">${t.cover ? `<img src="${esc(t.cover)}" alt="">` : `<div class="ph-cover" style="width:52px;height:52px;border-radius:8px">${I.note}</div>`}<div><b>${esc(t.title)}</b><span>${esc(t.artist)}${t.album ? ' · ' + esc(t.album) : ''}</span></div></div>`;

/* ---------------- List registry (lets rows know which list they belong to) ---------------- */
const lists = new Map();
let listSeq = 0;
function reg(tracks, meta = {}) { const k = 'l' + ++listSeq; lists.set(k, { tracks, meta }); return k; }
const listOf = (k) => lists.get(k) || { tracks: [], meta: {} };

/* ---------------- Renderers ---------------- */
const img = (src, cls = '') => !src ? `<div class="${cls} ph-cover">${I.note}</div>` : `<img class="${cls}" loading="lazy" src="${esc(safeImage(src))}" alt="">`;
function trackRows(tracks, key, { numbered = false } = {}) {
  if (!tracks.length) return '<p class="muted pad">No songs here yet.</p>';
  const cur = player.current()?.id;
  return `<div class="tracks">${tracks.map((t, i) => `
    <div class="trow${cur === t.id ? ' playing' : ''}" data-list="${key}" data-i="${i}" data-id="${esc(t.id)}">
      ${numbered ? `<span class="tnum">${i + 1}</span>` : ''}${img(t.cover, 'tcover')}
      <div class="tmeta"><div class="ttitle">${t.explicit ? '<span class="e">E</span>' : ''}${esc(t.title)}</div>
      <div class="tsub">${esc(t.artist)}${!numbered && t.album ? ' · ' + esc(t.album) : ''}</div><div class="tplays" data-counter="track" data-track-id="${esc(t.id)}" data-spotify-id="${esc(t.spotifyId||'')}" data-artist-id="${esc(t.artistId||'')}" data-title="${esc(t.title)}" data-duration="${t.duration||0}"></div></div>
      <button class="sr-only" data-act="track-play" data-key="${key}" data-i="${i}" aria-label="Play ${esc(t.title)} by ${esc(t.artist)}">Play</button>
      <span class="talbum">${esc(t.album)}</span>
      ${store.isDownloaded(t.id) ? `<span class="dl-mark" title="Downloaded">${I.download}</span>` : ''}
      <span class="tdur">${t.duration?fmt(t.duration):'—'}</span>
      <button class="icon tmore" data-act="more" aria-label="More options for ${esc(t.title)}">${I.more}</button>
    </div>`).join('')}</div>`;
}
const albumCard = (a) => `<a class="card" href="#/album/${a.id}">${img(a.cover)}<div class="ctitle">${esc(a.title)}</div><div class="csub">${esc([a.year, a.artist].filter(Boolean).join(' · '))}</div></a>`;
const artistCard = (a) => `<a class="card round" href="#/artist/${a.id}">${img(a.picture)}<div class="ctitle">${esc(a.name)}</div><div class="csub">Artist</div></a>`;
const playlistCard = (p) => `<a class="card" href="#/playlist/${p.id}">${img(p.cover)}<div class="ctitle">${esc(p.title)}</div><div class="csub">${esc(p.by || plural(p.count, 'song'))}</div></a>`;
const trackCard = (t, key, i) => `<button class="card" data-act="track-play" data-key="${key}" data-i="${i}" data-id="${esc(t.id)}" aria-label="Play ${esc(t.title)} by ${esc(t.artist)}">${img(t.cover)}<span class="card-play">${I.play}</span><div class="ctitle">${esc(t.title)}</div><div class="csub">${esc(t.artist)}</div></button>`;
const shelf = (title, cards) => (cards.length ? `<section><h2>${esc(title)}</h2><div class="shelf">${cards.join('')}</div></section>` : '');

function mosaic(tracks) {
  const covers = [...new Set(tracks.map((t) => t.cover).filter(Boolean))].slice(0, 4);
  if (covers.length >= 4) return `<div class="mosaic">${covers.map((c) => img(c)).join('')}</div>`;
  if (covers.length) return img(covers[0]);
  return `<div class="ph-cover">${I.note}</div>`;
}
function header({ cover, coverHtml, kicker, title, sub }) {
  return `<header class="phead"><div class="phead-art">${coverHtml || img(cover)}</div>
    <div class="phead-meta"><div class="kicker">${esc(kicker)}</div><h1>${esc(title)}</h1><div class="sub">${sub || ''}</div></div></header>`;
}
const actions = (key, extra = '') => `<div class="actions">
  <button class="btn primary" data-act="play-all" data-key="${key}" aria-label="Play all">${I.play}<span>Play</span></button>
  <button class="btn" data-act="shuffle-all" data-key="${key}">${I.shuffle}<span>Shuffle</span></button>${extra}</div>`;
const loadingHtml = '<div class="loading" role="status"><div class="spin" aria-hidden="true"></div><span class="muted">Loading music…</span></div>';
const errorHtml = (e) => `<div class="empty"><h2>Something went wrong</h2><p class="muted">${esc(e?.message || e)}</p><button class="btn" data-act="retry">Try again</button></div>`;

/* ---------------- Views ---------------- */
async function viewHome() {
  const recent = store.getRecent();
  const rk = reg(recent);
  const shortcuts = `<div class="quick-grid"><a class="quick-item" href="#/spotify"><div class="ph-cover grad2">${I.library}</div><b>Spotify collections</b></a><a class="quick-item" href="#/liked"><div class="ph-cover grad">${I.heartFill}</div><b>Liked Songs</b></a><a class="quick-item" href="#/dj"><div class="ph-cover dj-tile">${I.dj}</div><b>Spot+ DJ</b></a>${store.getPlaylists().slice(0,4).map(p=>`<a class="quick-item" href="#/my/${p.id}">${p.tracks[0]?.cover?img(p.tracks[0].cover):`<div class="ph-cover">${I.note}</div>`}<b>${esc(p.name)}</b></a>`).join('')}${recent.slice(0,Math.max(0,5-Math.min(4,store.getPlaylists().length))).map((t,i)=>`<button class="quick-item" data-act="track-play" data-key="${rk}" data-i="${i}">${img(t.cover)}<b>${esc(t.title)}</b></button>`).join('')}</div>`;
  const toolbar = `<div class="view-toolbar"><button class="avatar home-profile" data-act="profile" aria-label="Profile and settings">${esc((store.getSettings().displayName[0]||'S').toUpperCase())}</button><button class="chip on" data-act="home-filter" data-filter="all" aria-pressed="true">All</button><button class="chip" data-act="home-filter" data-filter="music" aria-pressed="false">Music</button><a class="chip" href="#/dj">DJ</a><span class="spacer"></span><span class="source-note">Music discovery · Deezer</span></div>`;
  const requestBar = homeDJ()+'<a class="rewind-link" href="#/rewind"><div><b>Your Rewind</b><small>Your top music, updated automatically</small></div><span class="rewind-link-icon">'+I.arrowUpRight+'</span></a>';
  if(document.body.dataset.page==='home')view.innerHTML=toolbar+shortcuts+requestBar+shelf('Jump back in',recent.slice(0,12).map((t,i)=>trackCard(t,rk,i)))+loadingHtml;
  let d;
  try { d = await api.home(); } catch (e) {
    return toolbar + shortcuts + requestBar + shelf('Recently played', recent.slice(0, 14).map((t, i) => trackCard(t, rk, i))) + errorHtml(e);
  }
  d.tracks = visibleTracks(d.tracks,store.getSettings());
  const tk = reg(d.tracks);
  const linked=cachedLinks(),mfy=madeForYou(linked).map(p=>`<a class="card" href="#/linked/${p.id}">${img(p.cover)}<div class="ctitle">${esc(p.name)}</div><div class="csub">From your Spotify</div></a>`),pub=(linked?.profile?.playlists||[]).map(p=>`<a class="card" href="#/linked/${p.id}">${img(p.cover)}<div class="ctitle">${esc(p.name)}</div><div class="csub">Your playlist</div></a>`);
  return toolbar + shortcuts + requestBar + shelf('Made for you', mfy) + `<div data-home-section="recent">${shelf('Jump back in', recent.slice(0, 12).map((t, i) => trackCard(t, rk, i)))}</div>` + shelf('Your Spotify playlists', pub)
    + shelf('Trending songs', d.tracks.slice(0,12).map((t,i)=>trackCard(t,tk,i)))
    + shelf('Popular artists', d.artists.slice(0,12).map(artistCard))
    + shelf('New releases', d.releases.slice(0,12).map(albumCard))
    + shelf('Popular albums', d.albums.slice(0,12).map(albumCard))
    + shelf('Playlists to explore', d.playlists.slice(0,12).map(playlistCard));
}

let searchTimer = 0, searchTok = 0;
function viewSearch(q = '') {
  setTimeout(() => {
    const inp = matchMedia('(min-width:768px)').matches?$('#globalQ'):$('#q');
    $('#globalQ').value=q;$('#globalClear').hidden=!q;
    if (!inp) return;
    if (q) runSearch(q);
    else if (!matchMedia('(pointer: coarse)').matches) inp.focus();
  }, 0);
  return `<h1 class="settings-top">Search</h1><form id="catalogSearch" class="searchbox" role="search">${I.search}<input id="q" type="search" aria-label="Search songs, artists, albums and playlists" placeholder="Songs, artists, albums…" value="${esc(q)}" autocomplete="off" enterkeyhint="search"><button class="icon search-clear" id="searchClear" type="button" data-act="search-clear" aria-label="Clear search" ${q?'':'hidden'}>×</button></form>
    <div id="results">${q ? loadingHtml : browseHome()}</div>`;
}
function highlightLyric(line,q){
  const want=new Set(q.toLowerCase().split(/\s+/).map(w=>w.replace(/[^\p{L}\p{N}']/gu,'')).filter(Boolean));
  return line.split(/(\s+)/).map(part=>{const w=part.toLowerCase().replace(/[^\p{L}\p{N}']/gu,'');return want.has(w)?`<mark>${esc(part)}</mark>`:esc(part);}).join('');
}
function renderLyricMatches(found,q){
  const box=$('#lyricMatches');if(!box)return;
  found=visibleTracks(found,store.getSettings());
  if(!found.length){box.remove();return;}
  const k=reg(found);
  box.innerHTML=`<h2>Lyrics</h2>${found.map((t,i)=>`<button class="lyric-match" data-act="track-play" data-key="${k}" data-i="${i}" aria-label="Play ${esc(t.title)} by ${esc(t.artist)}">${img(t.cover,'tcover')}<div><b>${esc(t.title)}</b><small>${esc(t.artist)}</small><q>${highlightLyric(t.lyricSnippet,q)}</q></div></button>`).join('')}`;
}
async function runSearch(q) {
  const my = ++searchTok;
  const box = $('#results');
  if (!box) return;
  history.replaceState(history.state, '', q ? `#/search/${encodeURIComponent(q)}` : '#/search');
  if (!q) { box.innerHTML = browseHome(); return; }
  box.innerHTML = loadingHtml;
  // Lyrics search runs alongside the normal search and fills in on top when ready.
  const lyricJob=api.looksLikeLyrics(q)?api.lyricsSearch(q).catch(()=>[]):null;
  try {
    const d = await api.search(q);
    if (my !== searchTok) return;
    d.tracks=visibleTracks(d.tracks,store.getSettings());
    store.addSearch(q);
    const k = reg(d.tracks);
    const none = !d.tracks.length && !d.artists.length && !d.albums.length && !d.playlists.length;
    box.innerHTML = none ? `<div class="empty"><p class="muted">Nothing found for “${esc(q)}”.</p></div>` : `
      <div class="chips search-filters">${['All','Songs','Artists','Albums','Playlists'].map((name,i)=>`<button class="chip${i?'':' on'}" data-act="search-filter" data-filter="${name.toLowerCase()}" aria-pressed="${!i}">${name}</button>`).join('')}</div>
      ${q.toLowerCase()==='dj'?'<p><a class="btn primary" href="#/dj">Open Spot+ DJ</a></p>':''}
      ${lyricJob?'<section class="lyrics-matches" data-search-section="songs" id="lyricMatches"><h2>Lyrics</h2><div class="lyric-loading"><span></span><span></span><span></span></div></section>':''}
      ${d.tracks.length ? `<section data-search-section="songs"><h2>Songs</h2>${trackRows(d.tracks, k)}</section>` : ''}
      <div data-search-section="artists">${shelf('Artists', d.artists.map(artistCard))}</div>
      <div data-search-section="albums">${shelf('Albums', d.albums.map(albumCard))}</div>
      <div data-search-section="playlists">${shelf('Playlists', d.playlists.map(playlistCard))}</div>`;
    hydrateStatistics(box);
    if(lyricJob)lyricJob.then(found=>{if(my===searchTok)renderLyricMatches(found,q);});
  } catch (e) { if (my === searchTok) box.innerHTML = errorHtml(e); }
}

async function viewArtist(id) {
  const d = await api.artist(id);
  activeArtist=d.artist;
  d.top=visibleTracks(d.top,store.getSettings());
  const k = reg(d.top), a=d.artist, following=store.hasArtist(id);
  const releases=d.albums.slice(0,8).map((x,i)=>`<a class="release-row${i>=4?' more-row':''}" href="#/album/${x.id}">${img(x.cover,'release-cover')}<div><b>${esc(x.title)}</b><small>${i===0?'<span class="latest">Latest release</span> · ':''}${esc([x.year,x.type?x.type[0].toUpperCase()+x.type.slice(1):''].filter(Boolean).join(' · '))}</small></div></a>`).join('');
  return `<div class="artist-page">
  <div class="artist-sticky"><span class="artist-sticky-bg" aria-hidden="true"></span><button class="artist-back" data-act="go-back" aria-label="Back">${I.back}</button><b class="artist-sticky-title" aria-hidden="true">${esc(a.name)}</b></div>
  <header class="artist-hero"><img src="${esc(safeImage(a.pictureXl||a.picture))}" alt="" fetchpriority="high" decoding="async"><div class="artist-hero-fade"></div><h1>${esc(a.name)}</h1></header>
  <p class="artist-listeners spotify-counter" data-counter="artist" data-artist-id="${esc(a.id)}">${fmtNum(a.fans)} fans</p>
  <div class="artist-actions">
    <button class="btn small follow-btn" data-act="follow-artist" aria-pressed="${following}">${following?'Following':'Follow'}</button>
    <button class="icon" data-act="artist-more" data-id="${esc(a.id)}" aria-label="More options for ${esc(a.name)}">${I.more}</button>
    <span class="spacer"></span>
    <button class="icon" data-act="shuffle-all" data-key="${k}" aria-label="Shuffle ${esc(a.name)}">${I.shuffle}</button>
    <button class="play-fab" data-act="play-all" data-key="${k}" aria-label="Play ${esc(a.name)}">${I.play}</button>
  </div>
  ${d.top.length?`<section class="artist-popular collapsible"><h2>Popular</h2>${trackRows(d.top.slice(0,10), k, {numbered:true})}${d.top.length>5?'<button class="see-more" data-act="expand-section">See more</button>':''}</section>`:''}
  ${releases?`<section class="artist-releases collapsible"><h2>Popular releases</h2>${releases}${d.albums.length>4?'<button class="see-more" data-act="expand-section">See discography</button>':''}</section>`:''}
  ${shelf('Fans also like', d.related.map(artistCard))}
  ${artistCollections(a)}
  <section class="artist-about"><h2>About</h2><a class="about-card" href="#/radio/${a.id}" style="--about:url('${esc(safeImage(a.pictureXl||a.picture)).replace(/'/g,'')}')"><div><b class="spotify-counter" data-counter="artist" data-artist-id="${esc(a.id)}">${fmtNum(a.fans)} fans</b><span>Start ${esc(a.name)} Radio for an endless mix of their music and similar artists.</span></div></a></section>
  </div>`;
}
async function viewAlbum(id) {
  const { album: a, tracks } = await api.album(id);
  activeAlbum=a;
  const allowed=visibleTracks(tracks,store.getSettings());
  const k = reg(allowed, { name: a.title });
  return header({ cover: a.coverXl || a.cover, kicker: a.type || 'Album', title: a.title,
      sub: `<a href="#/artist/${a.artistId}">${esc(a.artist)}</a> · ${esc(a.year)} · ${plural(tracks.length, 'song')}, ${total(tracks)}` })
    + actions(k, `<button class="btn" data-act="save-album" aria-pressed="${store.hasAlbum(id)}">${store.hasAlbum(id)?I.check:I.plus}<span>${store.hasAlbum(id)?'Saved':'Save album'}</span></button><button class="icon" data-act="save-list" data-key="${k}" aria-label="Copy album to a playlist">${I.more}</button>
      <button class="btn icon-only" data-act="download-list" data-key="${k}" aria-label="Download all">${I.download}</button>`)
    + trackRows(allowed, k, { numbered: true });
}

async function viewPlaylist(id) {
  const { playlist: p, tracks } = await api.playlist(id);
  const k = reg(tracks, { name: p.title });
  return header({ cover: p.coverXl || p.cover, kicker: 'Playlist', title: p.title,
      sub: `${p.by ? esc(p.by) + ' · ' : ''}${plural(tracks.length, 'song')}, ${total(tracks)}` })
    + (p.description ? `<p class="muted desc">${esc(p.description)}</p>` : '')
    + actions(k, `<button class="btn" data-act="save-list" data-key="${k}">${I.plus}<span>Save</span></button>
      <button class="btn icon-only" data-act="download-list" data-key="${k}" aria-label="Download all">${I.download}</button>`)
    + trackRows(tracks, k);
}

function viewLibrary() {
  return `<div class="lib-list-header"><h1>Your Library</h1><button class="icon" data-act="create-menu" aria-label="Create playlist or import">${I.plus}</button></div><div class="view-toolbar chips">${libraryFilters()}</div><div class="list-tools"><input id="pageLibraryQ" type="search" aria-label="Search library" placeholder="Search your library"><button class="link" data-act="library-sort">${store.getSettings().librarySort==='name'?'Alphabetical':store.getSettings().librarySort==='type'?'Type':'Recently added'} ${I.sort}</button></div><div id="pageLibraryItems" class="library-list">${renderLibraryItems()}</div>`;
}

function viewFolder(id){
  const folder=store.getFolder(id);
  if(!folder)return emptyState('Folder not found','Your playlists are still in Your Library.','Back to library','#/library');
  return `<a class="link folder-back" href="#/library">${I.prev}Your Library</a><div class="folder-heading"><div class="ph-cover">${I.folder}</div><div><div class="kicker">Folder · On this device</div><h1>${esc(folder.name)}</h1></div></div><p class="settings-note">Organize your Spot+ library. Spotify playlists stay unchanged on Spotify.</p><div class="folder-actions"><button class="btn white" data-act="folder-add" data-id="${id}">${I.plus}Add playlists</button><button class="btn" data-act="new-playlist">New playlist</button><button class="icon" data-act="library-menu" data-id="${id}" aria-label="Folder options for ${esc(folder.name)}">${I.more}</button></div><div class="list-tools"><input id="folderQ" type="search" placeholder="Search this folder" aria-label="Search this folder"></div><div id="folderItems" class="library-list" data-folder-id="${id}">${renderLibraryItems({folderId:id,query:''})}</div>`;
}

function viewLiked() {
  const likes = store.getLikes();
  const k = reg(likes);
  return header({ coverHtml: `<div class="ph-cover grad big">${I.heartFill}</div>`, kicker: 'Playlist', title: 'Liked Songs', sub: `${plural(likes.length, 'song')}${likes.length ? ', ' + total(likes) : ''}` })
    + (likes.length ? actions(k, `<button class="btn icon-only" data-act="download-list" data-key="${k}" aria-label="Download all">${I.download}</button>`) : '')
    + (likes.length?trackRows(likes,k):emptyState('Songs you like will appear here','Save a song using its options menu. You can find it here whenever you want to listen.', 'Search music', '#/search'));
}

function viewMy(id) {
  const p = store.getPlaylist(id);
  if (!p) return '<div class="empty"><h2>Playlist not found</h2><a class="btn" href="#/library">Back to library</a></div>';
  const k = reg(p.tracks, { playlistId: p.id, name: p.name });
  return header({ coverHtml: mosaic(p.tracks), kicker: 'Your playlist', title: p.name, sub: `${plural(p.tracks.length, 'song')}${p.tracks.length&&p.tracks.every(t=>t.duration>0) ? ', ' + total(p.tracks) : ''}` })
    + actions(k, `<button class="btn icon-only" data-act="download-list" data-key="${k}" aria-label="Download all">${I.download}</button>
      <button class="btn icon-only" data-act="folder-move" data-id="${p.id}" aria-label="Move to folder">${I.folder}</button>
      <button class="btn icon-only" data-act="rename-pl" data-id="${p.id}" aria-label="Rename">${I.edit}</button>
      <button class="btn icon-only" data-act="delete-pl" data-id="${p.id}" aria-label="Delete">${I.trash}</button>`)
    + (p.tracks.length ? trackRows(p.tracks, k) : '<p class="muted pad">Empty for now. Use ⋯ on any song → “Add to playlist”.</p>');
}

function viewDownloads() {
  const dls = store.getDownloads();
  const k = reg(dls, { downloads: true });
  return header({ coverHtml: `<div class="ph-cover grad2 big">${I.download}</div>`, kicker: 'Offline', title: 'Downloads', sub: `${plural(dls.length, 'song')} saved on this device` })
    + (dls.length ? actions(k) : '')
    + (dls.length ? trackRows(dls, k) : '<p class="muted pad">Download songs, albums or playlists to play them with no connection.</p>');
}

let installEvt = null;
async function viewSettings() {
  const s = store.getSettings();
  const spotifyAccount=store.getSpotifyAccount();
  let storage = '';
  try { const e = await navigator.storage?.estimate?.(); if (e) storage = ` · ${(e.usage / 1048576).toFixed(0)} MB used`; } catch {}
  const sel = (k, opts) => `<select data-setting="${k}">${opts.map(([v, l]) => `<option value="${v}"${s[k] === v ? ' selected' : ''}>${l}</option>`).join('')}</select>`;
  const toggle=(key,label,detail='')=>`<label class="field"><span>${label}<small>${detail}</small></span><input type="checkbox" role="switch" data-setting="${key}" ${s[key]?'checked':''}></label>`;
  return `<h1 class="settings-top">Settings</h1>
  <section class="box"><h2>Your profile</h2><label class="field"><span>Display name<small>Shown on your profile and in Jams.</small></span><input maxlength="60" data-setting="displayName" value="${esc(s.displayName)}"></label><a class="btn small" href="#/profile">View profile</a></section>
  <section class="box"><h2>Spotify</h2><p class="settings-note">${spotifyAccount||cachedLinks()?'Connected. Rewind and your profile update by themselves.':'Connect once to get Rewind, your profile picture and Made For You.'}</p><a class="btn primary" href="#/spotify-account">${spotifyAccount||cachedLinks()?'Manage Spotify':'Connect Spotify'}</a></section>
  <section class="box"><h2>Notifications</h2>${notify.permission()==='unsupported'?'<p class="settings-note">This browser can’t show notifications. On iPhone, add Spot+ to your Home Screen first.</p>':notify.permission()==='granted'?'':`<p class="settings-note">${notify.permission()==='denied'?'Notifications are blocked for Spot+. Allow them in your browser or phone settings.':'Get a heads-up about new music and updates. Never more than two a day, and nothing at night.'}</p>${notify.permission()==='default'?'<button class="btn primary small" data-act="notify-enable">Turn on notifications</button>':''}`}
  ${toggle('notifyReleases','New releases','When an artist you follow drops a song or album.')}${toggle('notifyStats','Weekly recap','Sunday evening: your minutes and most-played artist.')}${toggle('notifyUpdates','App updates','When a new version of Spot+ is ready.')}</section>
  <section class="box"><h2>Appearance</h2>${themeModeSwitch(s)}<p class="settings-note">Light, dark or automatic, with 19 color themes.</p><a class="btn" href="#/themes">Themes</a><label class="field"><span>Library and track spacing</span>${sel('density',[['comfortable','Comfortable'],['compact','Compact']])}</label><label class="field"><span>Text size</span>${sel('textSize',[['normal','Default'],['large','Larger']])}</label><label class="field"><span>Motion</span>${sel('motion',[['system','Follow system'],['reduced','Reduced']])}</label></section>
  <section class="box"><h2>Playback</h2>
    <label class="field"><span>Audio source<small>Full tracks depend on reachable audio servers. Preview mode plays short samples only.</small></span>${sel('source', [['auto', 'Automatic'], ['piped', 'Piped'], ['invidious', 'Invidious'],['audius','Audius public releases'],['preview','Deezer previews (30 sec)']])}</label>
    <label class="field"><span>Streaming quality</span>${sel('quality', [['high', 'High'], ['low', 'Data saver']])}</label>
    ${toggle('preloadNext','Prepare the next song','Buffers the beginning of the next song after your current music has enough buffered audio. Skipped on data-saving connections.')}
    ${toggle('showExplicit','Allow explicit content','When off, explicit tracks are excluded from discovery and new playback queues.')}
    <button class="btn small" data-act="sleep-timer">Sleep timer</button>
    <details class="connection-help"><summary>Advanced audio options</summary>
    <label class="field col"><span>Your own Piped API servers <small>(one per line, tried first)</small></span><textarea data-setting="customPiped" rows="2" placeholder="https://pipedapi.example.com">${esc(s.customPiped)}</textarea></label>
    <label class="field col"><span>Your own Invidious servers</span><textarea data-setting="customInvidious" rows="2" placeholder="https://invidious.example.com">${esc(s.customInvidious)}</textarea></label>
    <div class="row-btns"><button class="btn small" data-act="test-sources">Test audio servers</button><button class="btn small" data-act="clear-matches">Reset song matches</button></div>
    <div id="testOut"></div></details>
  </section>

  <section class="box"><h2>Your data</h2>
    <p class="muted">Your local music library, preferences, saved themes and Spotify library copy are saved in this browser. Export a backup to move them to another device. Audio files and the downloaded AI model are stored separately.</p>
    <div class="row-btns"><button class="btn small" data-act="export">Export backup</button>
    <label class="btn small">Import backup<input type="file" id="importFile" accept="application/json,.json" hidden></label></div>
  </section>
  <section class="box"><h2>Offline</h2>
    <p class="muted">${plural(store.getDownloads().length, 'song')} downloaded${storage}</p>
    <button class="btn small" data-act="clear-downloads">Delete all downloads</button>
    <p class="settings-note">Local audio files are stored separately and are kept when downloads are cleared.</p><button class="btn small" data-act="import-local">Add local audio files</button>
  </section>
  <section class="box"><h2>Install</h2>
    <button class="btn small primary" data-act="install" ${installEvt ? '' : 'hidden'} id="installBtn">Install Spot+</button>
    <p class="muted">Android/desktop Chrome: use the install button or the browser menu → Install app. iPhone: Safari → Share → Add to Home Screen.</p>
  </section>
  <section class="box"><h2>DJ</h2>${toggle('djVoice','DJ voice','Choose your host in DJ preferences.')}<a class="btn small" href="#/dj">Open DJ</a><p class="settings-note">Turn on live conversation from the DJ screen (one-time 600 MB download).</p><button class="btn small" data-act="dj-live-remove">Remove DJ downloads</button></section>
  <details class="box settings-more"><summary>About, shortcuts and what’s supported</summary>
  <section class="box"><h2>What’s supported</h2><div class="capability"><span>Music discovery<small>Deezer public catalog</small></span><span>Available</span></div><div class="capability"><span>Audio playback<small>Piped / Invidious, previews, or local files</small></span><span>Source dependent</span></div><div class="capability"><span>Spotify stats & profile<small>Updates by itself once connected</small></span><span>${spotifyAccount||cachedLinks()?'Connected':'Not connected'}</span></div><div class="capability"><span>Jam<small>Listen together in real time</small></span><span>Spot+ Jam</span></div><div class="capability"><span>Spotify Connect & Blend</span><span class="unavailable">Not supported</span></div><div class="capability"><span>DJ</span><span>Spot+ DJ</span></div><div class="capability"><span>Podcasts & audiobooks</span><span class="unavailable">Not available</span></div><p class="settings-note">Spot+ is independent of Spotify. It reads your public Spotify playlists and profile; Spotify’s own audio and Premium features aren’t included.</p></section>
  <section class="box"><h2>Keyboard shortcuts</h2><p class="settings-note">Space: play/pause · Alt + Right/Left: next/previous · Ctrl/⌘ + K: search · Escape: close overlay. Use Tab and arrow keys for controls.</p></section>
  <section class="box"><h2>About Spot+</h2>
    <p class="muted">Song info comes from Deezer, audio is matched on YouTube through public Piped and Invidious servers, and lyrics come from LRCLIB. Everything runs on your device.</p>
  </section></details>`;
}

/* ---------------- Router ---------------- */
const routes = [
  [/^#\/?(home)?$/, viewHome],
  [/^#\/search(?:\/(.*))?$/, viewSearch],
  [/^#\/artist\/(\d+)$/, viewArtist],
  [/^#\/album\/(\d+)$/, viewAlbum],
  [/^#\/playlist\/(\d+)$/, viewPlaylist],
  [/^#\/library$/, viewLibrary],
  [/^#\/folder\/(folder[\w-]+)$/, viewFolder],
  [/^#\/liked$/, viewLiked],
  [/^#\/my\/(\w+)$/, viewMy],
  [/^#\/downloads$/, viewDownloads],
  [/^#\/settings$/, viewSettings],
  [/^#\/profile$/, viewProfile],
  [/^#\/recent$/, viewRecent],
  [/^#\/rewind$/, rewindView],
  [/^#\/local$/, viewLocal],
  [/^#\/dj$/, viewDJ],
  [/^#\/radio\/(\d+)$/, viewRadio],
  [/^#\/essentials\/(\d+)$/, viewEssentials],
  [/^#\/spotify$/, viewSpotify],
  [/^#\/spotify-account$/, viewSpotifyAccount],
  [/^#\/spotify-account\/helper$/, viewSpotifyHelper],
  [/^#\/spotify-account\/receive\/([a-f0-9]{32})$/, receiveSpotifyAccount],
  [/^#\/spotify-account\/(likes)$/, viewSpotifyAccountList],
  [/^#\/spotify-account\/playlist\/([a-zA-Z0-9]{22})$/, viewSpotifyAccountList],
  [/^#\/spotify\/(playlist|album|artist|track)\/([a-zA-Z0-9]{22})$/, viewSpotifyCollection],
  [/^#\/themes$/, viewThemes],
  [/^#\/linked\/([A-Za-z0-9]{22})$/, viewLinked],
  [/^#\/jam$/, viewJam],
  [/^#\/jam\/([A-Za-z0-9]{6})$/, joinJamFromLink],
];
let routeTok = 0;
async function route({ keepScroll = false } = {}) {
  const h = parseRoute(location.hash);
  document.body.dataset.page = /^#\/?(home)?$/.test(h) ? 'home' : h.split('/')[1];
  if (npOpen && matchMedia(MOBILE_QUERY).matches) closeNP({ nav: true });
  closeSheet();
  const my = ++routeTok;
  ++searchTok;
  clearTimeout(searchTimer);
  const scroll = main.scrollTop;
  const startSeq = listSeq;
  $$('.nav a').forEach((a) => a.classList.toggle('on', h.startsWith(a.getAttribute('href')) || (a.getAttribute('href') === '#/home' && /^#\/?(home)?$/.test(h)) || (a.getAttribute('href') === '#/library' && /^#\/(liked|my|downloads|folder)/.test(h))));
  for (const [re, fn] of routes) {
    const m = h.match(re);
    if (!m) continue;
    if (!keepScroll) view.innerHTML = loadingHtml;
    try {
      const args = re === routes[0][0] ? [] : m.slice(1).map((x) => (x ? decodeURIComponent(x) : x));
      const html = await fn(...args);
      if (my !== routeTok) return;
      lists.forEach((_, k) => { if (+k.slice(1) <= startSeq) lists.delete(k); });
      view.innerHTML = html;
      hydrateStatistics(view);syncAvatars();if(location.hash==='#/rewind')hydrateRewind(view);
      syncVoices();
      view.setAttribute('aria-busy','false');
      renderSidebar();
      syncPlayer();
      main.scrollTop = keepScroll ? scroll : 0;
    } catch (e) {
      if (my === routeTok) view.innerHTML = errorHtml(e);
    }
    return;
  }
  location.replace('#/home');
}
function go(hash) { if (location.hash === hash) route(); else location.hash = hash; }
window.addEventListener('hashchange', () => route());

/* ---------------- Actions ---------------- */
async function startRadio(t) {
  if (!t.artistId) return toast('No radio for this song');
  const tt = toast('Starting radio…');
  try {
    const r = await api.artistRadio(t.artistId);
    player.playList([t, ...r.filter((x) => x.id !== t.id)], 0, { shuffle: false });
    tt.set(`Radio based on ${t.artist}`);
  } catch (e) { tt.set(`Couldn't start radio: ${e.message}`); }
}

let dlBusy = false;
async function downloadTracks(tracks) {
  const todo = tracks.filter((t) => !t.local && !store.isDownloaded(t.id));
  if(store.getSettings().source==='preview')return toast('Preview mode cannot download full songs. Choose a full audio source in Settings.');
  if (!todo.length) return toast('Already downloaded');
  if (dlBusy) return toast('Another download is still running');
  dlBusy = true;
  const tt = toast('Starting download…', { sticky: true });
  let ok = 0, fail = 0;
  for (let i = 0; i < todo.length; i++) {
    const t = todo[i];
    const label = todo.length > 1 ? `${i + 1}/${todo.length}: ` : '';
    tt.set(`Downloading ${label}${t.title}`);
    try {
      await player.download(t, (p) => tt.set(`Downloading ${label}${t.title} — ${Math.round(p * 100)}%`));
      ok++;
    } catch (e) { fail++; console.warn('Download failed', t.title, e); }
  }
  tt.set(fail ? `Downloaded ${ok}, ${fail} failed (that server may block downloads; try again later)` : `Downloaded ${plural(ok, 'song')}`);
  tt.close(4000);
  dlBusy = false;
}

function playlistPicker(tracks) {
  openSheet({
    head: `<div class="sheet-title">Add ${tracks.length > 1 ? plural(tracks.length, 'song') : 'to playlist'}</div>`,
    items: [
      { icon: I.plus, label: 'New playlist…', fn: async () => {
        const name = await ask({ title: 'New playlist', placeholder: 'Playlist name', ok: 'Create' });
        if (name) { store.createPlaylist(name, tracks); toast(`Added to ${name}`); }
      } },
      ...store.getPlaylists().map((p) => ({ icon: I.note, label: p.name, sub: plural(p.tracks.length, 'song'), fn: () => {
        const n = store.addToPlaylist(p.id, tracks);
        toast(n ? `Added to ${p.name}` : 'Already in that playlist');
      } })),
    ],
  });
}

async function pickMatch(t) {
  openSheet({ head: `${sheetHead(t)}<div class="sheet-title">Finding other versions…</div>${loadingHtml}` });
  try {
    const c = await api.candidates(t);
    const curId = store.getVideoCache(t.id)?.id;
    openSheet({
      head: `${sheetHead(t)}<div class="sheet-title">Pick the right version</div>`,
      items: c.map((x) => ({ icon: x.id === curId ? I.check : I.note, label: x.title, sub: `${x.channel || 'YouTube'} · ${fmt(x.duration)}`, fn: () => {
        if (player.current()?.id === t.id) player.useMatch(x.id);
        else store.setVideoCache(t.id, { id: x.id, manual: true });
        toast('Saved — this version will be used from now on');
      } })),
    });
  } catch (e) { closeSheet(); toast(e.message); }
}

function trackSheet(t, meta = {}) {
  const liked = store.isLiked(t.id), dl = store.isDownloaded(t.id);
  const src = player.current()?.id === t.id && player.state.source ? `Streaming via ${api.host(player.state.source.instance)}` : '';
  openSheet({
    head: sheetHead(t) + (src ? `<div class="sheet-note">${esc(src)}</div>` : ''),
    items: [
      { icon: I.queue, label: 'Play next', fn: () => { player.playNext(t); toast('Playing next'); } },
      { icon: I.queue, label: 'Add to queue', fn: () => { player.addToQueue(t); toast('Added to queue'); } },
      { icon: liked ? I.heartFill : I.heart, label: liked ? 'Remove from Liked Songs' : 'Add to Liked Songs', fn: () => toast(store.toggleLike(t) ? 'Added to Liked Songs' : 'Removed from Liked Songs') },
      { icon: I.plus, label: 'Add to playlist…', fn: () => playlistPicker([t]) },
      /^[A-Za-z0-9]{22}$/.test(t.spotifyId||'') && {icon:I.arrow,label:'Open Spotify player',fn:()=>go('#/spotify/track/'+t.spotifyId)},
      t.artistId && { icon: I.radio, label: 'Start radio', fn: () => startRadio(t) },
      !t.local && { icon: dl ? I.check : I.download, label: dl ? 'Remove download' : 'Download for offline', fn: () => (dl ? player.removeDownload(t.id).then(() => toast('Download removed')) : downloadTracks([t])) },
      !t.local && { icon: I.swap, label: 'Wrong song? Pick another version', fn: () => pickMatch(t) },
      t.local && {icon:I.trash,label:'Remove local copy',fn:async()=>{if(await confirmBox('Remove local audio?', 'The imported copy will be removed from this browser. Your original file is kept.')){await player.removeLocalFile(t.id);toast('Local copy removed');}}},
      t.artistId && { icon: I.person, label: 'Go to artist', fn: () => go(`#/artist/${t.artistId}`) },
      t.albumId && { icon: I.album, label: 'Go to album', fn: () => go(`#/album/${t.albumId}`) },
      meta.playlistId && meta.index>0 && {icon:I.up,label:'Move up in playlist',fn:()=>store.updatePlaylist(meta.playlistId,p=>{[p.tracks[meta.index-1],p.tracks[meta.index]]=[p.tracks[meta.index],p.tracks[meta.index-1]];})},
      meta.playlistId && meta.index<store.getPlaylist(meta.playlistId).tracks.length-1 && {icon:I.down,label:'Move down in playlist',fn:()=>store.updatePlaylist(meta.playlistId,p=>{[p.tracks[meta.index+1],p.tracks[meta.index]]=[p.tracks[meta.index],p.tracks[meta.index+1]];})},
      meta.playlistId && { icon: I.trash, label: 'Remove from this playlist', fn: () => store.removeFromPlaylist(meta.playlistId, meta.index) },
    ].filter(Boolean),
  });
}

async function handleAct(act, el) {
  const key = el?.dataset?.key;
  switch (act) {
    case 'spotify-open-player': player.el.pause();$('#spotifyPlayer').innerHTML=`<iframe class="spotify-embed" title="Spotify player" src="https://open.spotify.com/embed/${el.dataset.type}/${el.dataset.id}?theme=0" width="100%" height="352" allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture" loading="lazy"></iframe>`;el.hidden=true;break;
    case 'spotify-save': {const item=await spotify.metadata({type:el.dataset.type,id:el.dataset.id});store.saveSpotifyLink({...item,saved:Date.now()});toast('Spotify link saved to your library');break;}
    case 'spotify-import': $('#spotifyImport').click();break;
    case 'account-connect': beginSpotifyConnection();break;
    case 'account-helper': go('#/spotify-account/helper');break;
    case 'account-helper-copy': await copyHelperInstallLink({clipboard:navigator.clipboard,field:$('#helperInstallLink'),status:$('#helperCopyStatus')});break;
    case 'account-file': $('#spotifyAccountImport').click();break;
    case 'account-paste': await pasteSpotifyAccount();break;
    case 'account-install-helper': openInSafari(COMPANION_INSTALL_URL);break;
    case 'account-paste-field': {const text=$('#accountPasteField')?.value||'';closeSheet();await applyPastedLibrary(text);break;}
    case 'account-disconnect': if(await confirmBox('Remove this Spotify connection?', 'This removes the Spotify library copy from this device. Your local Spot+ music and Spotify account are kept.')){pendingAccount=null;store.clearSpotifyAccount();toast('Spotify copy removed from this device');}break;
    case 'theme-preset': {const t=themes.presets.find(x=>x.id===el.dataset.id);store.setSettings({themePreset:el.dataset.id,themeCustom:null,...(t?.mode?{themeMode:t.mode}:{})});route({keepScroll:true});break;}
    case 'go-back': if(history.length>1)history.back();else go('#/home');break;
    case 'expand-section': {const sec=el.closest('.collapsible');const open=!sec.classList.contains('expanded');sec.classList.toggle('expanded',open);el.textContent=open?'See less':(sec.classList.contains('artist-releases')?'See discography':'See more');break;}
    case 'artist-more': {const a=activeArtist;if(!a)break;openSheet({head:`<div class="sheet-title">${esc(a.name)}</div>`,items:[{icon:I.radio,label:'Go to artist radio',fn:()=>go('#/radio/'+a.id)},{icon:I.play,label:'Play essentials',fn:()=>go('#/essentials/'+a.id)},{icon:I.share||I.arrow,label:'Share',fn:()=>{const url=location.origin+location.pathname+'#/artist/'+a.id;if(navigator.share)navigator.share({title:a.name,url}).catch(()=>{});else navigator.clipboard?.writeText(url).then(()=>toast('Link copied'));}},{icon:I.arrow,label:'Find on Spotify',fn:()=>window.open('https://open.spotify.com/search/'+encodeURIComponent(a.name)+'/artists','_blank','noopener')}]});break;}
    case 'theme-mode': store.setSettings({themeMode:el.dataset.mode});route({keepScroll:true});break;
    case 'theme-undo': if(themeUndo){store.setSettings(themeUndo);route({keepScroll:true});}break;
    case 'theme-remix': {const color=themes.presets[Math.floor(Math.random()*themes.presets.length)];store.setSettings({themePreset:color.id,themeCustom:null,cornerRadius:[0,8,16][Math.floor(Math.random()*3)]});route({keepScroll:true});break;}
    case 'theme-save': {const name=await ask({title:'Save your theme',placeholder:'Theme name',ok:'Save'});if(name){const s=store.getSettings();store.saveTheme({id:'theme'+Date.now(),name,settings:themeSettings(s)});route({keepScroll:true});toast('Theme saved');}break;}
    case 'theme-load': {const saved=store.getThemes().find(t=>t.id===el.dataset.id);if(saved){store.setSettings(themes.normalizeTheme({app:'spotplus-theme',settings:saved.settings}));route({keepScroll:true});}break;}
    case 'theme-export': downloadJson({app:'spotplus-theme',version:1,settings:themeSettings(store.getSettings())},'spotplus-theme.json');break;
    case 'theme-import': $('#themeImport').click();break;
    case 'focus-main': $('#main').focus();break;
    case 'track-play': {if(jam.active&&!jam.host){const t=listOf(key).tracks[+el.dataset.i];if(t){jam.add(t);toast(`Added “${t.title}” to the Jam`);}break;}dj.stop();const tracks=visibleTracks(listOf(key).tracks,store.getSettings());const track=listOf(key).tracks[+el.dataset.i];const index=tracks.findIndex(t=>t.id===track?.id);if(index<0)return toast('Explicit content is turned off in Settings.');if(player.current()?.id===track.id)player.toggle();else player.playList(tracks,index,{shuffle:false});break;}
    case 'profile': profileMenu(); break;
    case 'rewind-import': $('#rewindImport').click();break;
    case 'rewind-range': rewindFilters.range=el.dataset.value;route({keepScroll:true});break;
    case 'rewind-story': openRewindStory({icons:I,canPlayPreview:()=>!player.isPlaying()&&!jam.active});break;
    case 'rewind-export': {
      const records=await readHistory(),url=URL.createObjectURL(new Blob([JSON.stringify({app:'spotplus-rewind',version:1,records})],{type:'application/json'}));
      const a=document.createElement('a');a.href=url;a.download='SpotPlus-Rewind.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),5000);break;
    }
    case 'rewind-clear': if(await confirmBox('Clear Rewind history?','This removes imported Spotify history and Spot+ listening stats from this device. Your music library stays saved.')){await clearHistory('all');listeningMeter.reset();route({keepScroll:true});}break;
    case 'create-menu': createMenu(); break;
    case 'history': go('#/recent');break;
    case 'devices': deviceMenu();break;
    case 'sleep-timer': sleepMenu();break;
    case 'import-local': $('#localFilesInput').click();break;
    case 'collapse-library': store.setSettings({libraryCollapsed:!store.getSettings().libraryCollapsed});applyPreferences();break;
    case 'pin': store.togglePin(el.dataset.id);break;
    case 'library-filter': store.setSettings({libraryFilter:el.dataset.filter});renderSidebar();if(location.hash==='#/library')route({keepScroll:true});break;
    case 'library-sort': openSheet({head:'<div class="sheet-title">Sort your library</div>',items:[['recent','Recently added'],['name','Alphabetical'],['type','Type']].map(([value,label])=>({icon:store.getSettings().librarySort===value?I.check:I.sort,label,fn:()=>{store.setSettings({librarySort:value});renderSidebar();if(location.hash==='#/library')route({keepScroll:true});}}))});break;
    case 'follow-artist': if(activeArtist){const on=store.toggleArtist(activeArtist);el.textContent=on?'Following':'Follow';el.setAttribute('aria-pressed',String(on));toast(on?'Artist added to your library':'Artist removed from your library');}break;
    case 'save-album': if(activeAlbum){const on=store.toggleAlbum(activeAlbum);el.innerHTML=`${on?I.check:I.plus}<span>${on?'Saved':'Save album'}</span>`;el.setAttribute('aria-pressed',String(on));toast(on?'Album added to your library':'Album removed from your library');}break;
    case 'home-filter': $$('[data-act=home-filter]').forEach(b=>{b.classList.toggle('on',b===el);b.setAttribute('aria-pressed',String(b===el));});$$('[data-home-section=recent]').forEach(x=>x.hidden=el.dataset.filter==='music');break;
    case 'search-filter': $$('[data-act=search-filter]').forEach(b=>{b.classList.toggle('on',b===el);b.setAttribute('aria-pressed',String(b===el));});$$('[data-search-section]').forEach(x=>x.hidden=el.dataset.filter!=='all'&&x.dataset.searchSection!==el.dataset.filter);break;
    case 'clear-searches': store.clearSearches();if($('#results'))$('#results').innerHTML=browseHome();break;
    case 'mute': if(player.el.volume>0){lastVolume=player.el.volume;player.setVolume(0);}else player.setVolume(lastVolume||.7);vol.value=player.el.volume*100;vol.style.setProperty('--p',vol.value+'%');el.setAttribute('aria-label',player.el.volume?'Mute':'Unmute');el.classList.toggle('on',!player.el.volume);break;
    case 'retry-playback': player.retry();break;
    case 'dismiss-playback-error': player.state.error=null;syncPlayer();break;
    case 'np-lyrics': openNP('lyrics');break;
    case 'q-up': player.moveQueue(+el.dataset.qi,+el.dataset.qi-1);break;
    case 'q-down': player.moveQueue(+el.dataset.qi,+el.dataset.qi+1);break;
    case 'dj-mic': if(location.hash!=='#/dj'){go('#/dj');}dj.voice.listen();break;
    case 'dj-suggestion': await dj.start(el.dataset.prompt);break;
    case 'dj-host': await dj.voice.preview(el.dataset.host);syncDJVoice();break;
    case 'search-clear': clearTimeout(searchTimer);$('#globalQ').value='';$('#globalClear').hidden=true;if($('#q')){$('#q').value='';$('#searchClear').hidden=true;runSearch('');}else go('#/search');(matchMedia('(min-width:768px)').matches?$('#globalQ'):$('#q'))?.focus();break;
    case 'account-device': accountDevice=el.dataset.device;if($('#helperSetup'))$('#helperSetup').innerHTML=helperInstallHtml(accountDevice);else $('#accountSetup').innerHTML=setupHtml(accountDevice);break;
    case 'dj-live-remove': dj.disableLive();await dj.liveVoice.removeDownloads();await dj.localModel.removeModel();toast('DJ downloads removed. Your music is kept.');break;
    case 'dj-edit': dj.stop();$('#djPrompt').value=dj.voice.state.transcript;$('#djPrompt').focus();break;
    case 'dj-live-enable': await dj.enableLive().catch(e=>toast(e.message));break;
    case 'dj-live-stop': dj.disableLive();syncLiveDJ();break;
    case 'dj-start': await dj.start();break;
    case 'dj-change': await dj.start(dj.state.request,{change:true});break;
    case 'model-load': await dj.localModel.load().catch(e=>toast(e.message));break;
    case 'model-stop': dj.localModel.release();break;
    case 'model-remove': await dj.localModel.removeModel();break;
    case 'more': {
      const row = el.closest('[data-list]');
      const { tracks, meta } = listOf(row.dataset.list);
      const i = +row.dataset.i;
      if (tracks[i]) trackSheet(tracks[i], { ...meta, index: i });
      break;
    }
    case 'play-all': dj.stop();player.playList(visibleTracks(listOf(key).tracks,store.getSettings()), 0, { shuffle: false }); break;
    case 'shuffle-all': dj.stop();player.playList(visibleTracks(listOf(key).tracks,store.getSettings()), 0, { shuffle: true }); break;
    case 'artist-radio': {
      const tt = toast('Starting radio…');
      try { player.playList(await api.artistRadio(el.dataset.id), 0, { shuffle: false }); tt.close(); } catch (e) { tt.set(e.message); }
      break;
    }
    case 'save-list': {
      const { tracks, meta } = listOf(key);
      const name = await ask({ title: 'Save to your library', value: meta.name || 'Playlist', ok: 'Save' });
      if (name) { const p = store.createPlaylist(name, tracks); toast('Saved'); go(`#/my/${p.id}`); }
      break;
    }
    case 'download-list': downloadTracks(listOf(key).tracks); break;
    case 'new-playlist': {
      const folderId=location.hash.match(/^#\/folder\/(folder[\w-]+)$/)?.[1];
      const name = await ask({ title: 'New playlist', placeholder: 'Playlist name', ok: 'Create' });
      if (name) {const p=store.createPlaylist(name);if(folderId&&store.getFolder(folderId))store.moveToFolder(p.id,folderId);go(`#/my/${p.id}`);}
      break;
    }
    case 'new-folder': {const name=await ask({title:'New folder',placeholder:'Folder name',ok:'Create'});if(name)go('#/folder/'+store.createFolder(name).id);break;}
    case 'library-menu': libraryMenu(el.dataset.id);break;
    case 'folder-move': folderPicker(el.dataset.id);break;
    case 'folder-add': folderAddPicker(el.dataset.id);break;
    case 'import-playlist': {
      const link = await ask({ title: 'Import a Deezer playlist', message: 'Paste a deezer.com playlist link or its number.', placeholder: 'https://www.deezer.com/playlist/…', ok: 'Import' });
      if (!link) break;
      const id = api.parseDeezerPlaylist(link);
      if (!id) { toast('That doesn’t look like a Deezer playlist link'); break; }
      const tt = toast('Importing…', { sticky: true });
      try { const { playlist: p, tracks } = await api.playlist(id); const mine = store.createPlaylist(p.title, tracks); tt.set(`Imported ${plural(tracks.length, 'song')}`); go(`#/my/${mine.id}`); }
      catch (e) { tt.set(`Import failed: ${e.message}`); }
      tt.close(3000);
      break;
    }
    case 'rename-pl': {
      const p = store.getPlaylist(el.dataset.id);
      const name = p && (await ask({ title: 'Rename playlist', value: p.name, ok: 'Save' }));
      if (name) store.renamePlaylist(p.id, name);
      break;
    }
    case 'delete-pl': {
      const p = store.getPlaylist(el.dataset.id);
      if (p && (await confirmBox('Delete playlist?', `“${p.name}” will be removed from this device.`))) { store.deletePlaylist(p.id); go('#/library'); }
      break;
    }
    case 'sheet-pick': { const fn = sheetFns[+el.dataset.si]; closeSheet(); if(fn)await fn(); break; }
    case 'sheet-close': closeSheet(); break;
    case 'retry': route(); break;
    // player
    case 'toggle': if(!jamGuestControl('toggle'))player.toggle(); break;
    case 'next': if(!jamGuestControl('next'))player.next(); break;
    case 'prev': if(!jamGuestControl('prev'))player.prev(); break;
    case 'jam-start': {const p=jamProfile();jam.start(p);go('#/jam');break;}
    case 'jam-join': {const code=($('#jamCode')?.value||'').trim().toUpperCase();if(!validJamCode(code))return toast('Enter the 6-character Jam code.');jam.join(code,jamProfile());go('#/jam');break;}
    case 'jam-leave': if(await confirmBox(jam.host?'End this Jam?':'Leave this Jam?',jam.host?'Everyone will stop listening along.':'Your music keeps playing on this device.',jam.host?'End Jam':'Leave'))jam.leave();break;
    case 'jam-share': {const url=jamLink(jam.code);if(navigator.share)navigator.share({title:'Join my Jam on Spot+',text:'Listen along with me: code '+jam.code,url}).catch(()=>{});else navigator.clipboard?.writeText(url).then(()=>toast('Jam link copied'));break;}
    case 'links-add': {const field=$('#spotifyLinksField'),status=$('#linksStatus');if(!field?.value.trim())return toast('Paste a Spotify link first.');el.disabled=true;status.textContent='Reading from Spotify…';
      try{const added=await addLinks(field.value);field.value='';toast('Linked: '+added.join(', '));await route({keepScroll:true});syncAvatars();}catch(e){status.textContent=e.message;}finally{el.disabled=false;}break;}
    case 'links-paste': {const field=$('#spotifyLinksField');try{const text=await navigator.clipboard.readText();if(!/spotify/i.test(text))return toast('Copy a Spotify link first, then tap Paste.');field.value=(field.value.trim()+'\n'+text).trim();$('[data-act="links-add"]')?.click();}catch{toast('Long-press the box and choose Paste.');field.focus();}break;}
    case 'notify-enable': {const p=await Notification.requestPermission().catch(()=>'denied');toast(p==='granted'?'Notifications are on.':'Notifications stay off. You can allow them later in your settings.');if(p==='granted')notify.show({title:'Notifications are on',body:'You’ll hear about new releases and your weekly recap.'},'welcome');route({keepScroll:true});break;}
    case 'links-clear': if(await confirmBox('Remove Spotify links?','Rewind keeps the history it already saved.','Remove')){await clearLinks();route({keepScroll:true});}break;
    case 'jam-open': closeSheet();go('#/jam');break;
    case 'jam-react': jam.react(el.dataset.emoji);break;
    case 'shuffle': player.toggleShuffle(); break;
    case 'repeat': player.cycleRepeat(); break;
    case 'like-current': { const t = player.current(); if (t) toast(store.toggleLike(t) ? 'Added to Liked Songs' : 'Removed from Liked Songs'); break; }
    case 'np-open': openNP(); break;
    case 'np-close': closeNP(); break;
    case 'np-more': { const t = player.current(); if (t) trackSheet(t); break; }
    case 'np-tab': setNPMode(el.dataset.mode); break;
    case 'canvas-cover': canvasPreference=false;setCanvasEnabled(false);setNPMode('art');break;
    case 'canvas-enable': canvasPreference=true;setCanvasEnabled(true);setNPMode('art',{retryCanvas:true});break;
    case 'np-queue': openNP('queue'); break;
    case 'np-artist': { const t = player.current(); if (t?.artistId) go(`#/artist/${t.artistId}`); break; }
    case 'q-jump': player.playIndex(+el.dataset.qi); break;
    case 'q-remove': player.removeAt(+el.dataset.qi); break;
    case 'q-clear': player.clearUpNext(); break;
    case 'ly-seek': player.seek(+el.dataset.t); lyrUserScroll = 0; break;
    // settings
    case 'test-sources': {
      const out = $('#testOut');
      out.innerHTML = '<p class="muted">Testing…</p>';
      try {
        const r = await api.testInstances();
        out.innerHTML = `<div class="tests">${r.map((x) => `<div class="${x.ok ? 'ok' : 'bad'}"><span>${x.ok ? '●' : '○'} ${esc(api.host(x.base))}</span><small>${x.kind} · ${x.ok ? x.ms + ' ms' : esc(x.err)}</small></div>`).join('')}</div>`;
      } catch (e) { out.innerHTML = `<p class="muted">${esc(e.message)}</p>`; }
      break;
    }
    case 'clear-matches': api.clearStreamCache();store.clearVideoCache(); toast('Song matches reset'); break;
    case 'export': {
      const blob = new Blob([JSON.stringify(store.exportData(), null, 1)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `spotplus-backup-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 5000);
      break;
    }
    case 'clear-downloads':
      if (await confirmBox('Delete all downloads?', 'Downloaded songs will need internet again.')) { await player.clearDownloads(); toast('Downloads deleted'); route({ keepScroll: true }); }
      break;
    case 'install':
      if (installEvt) { installEvt.prompt(); await installEvt.userChoice.catch(() => {}); installEvt = null; el.hidden = true; }
      break;
  }
}

document.addEventListener('click', (e) => {
  const a = e.target.closest('[data-act]');
  if (a) { e.preventDefault(); Promise.resolve(handleAct(a.dataset.act, a)).catch(err=>toast(err.message)); return; }
  const row = e.target.closest('[data-list]');
  if (row && !e.target.closest('a')) {
    const { tracks } = listOf(row.dataset.list);
    const i = +row.dataset.i;
    if(tracks[i])handleAct('track-play',{dataset:{key:row.dataset.list,i:String(i)}}).catch(err=>toast(err.message));
  }
});
document.addEventListener('change',e=>{if(e.target.id==='jamControl')jam.setGuestControl(e.target.checked);});
document.addEventListener('input', (e) => {
  if (['q','globalQ'].includes(e.target.id)) {clearTimeout(searchTimer);const q=e.target.value.trim();if($('#q')&&e.target.id!=='q')$('#q').value=q;if(e.target.id!=='globalQ')$('#globalQ').value=q;$('#globalClear').hidden=!q;if($('#searchClear'))$('#searchClear').hidden=!q;if($('#results')){++searchTok;searchTimer=setTimeout(()=>runSearch(q),250);}}
  if(e.target.id==='folderQ'&&$('#folderItems'))$('#folderItems').innerHTML=renderLibraryItems({folderId:$('#folderItems').dataset.folderId,query:e.target.value});
});
document.addEventListener('change', async (e) => {
  const t = e.target;
  if(t.dataset.rewindFilter){rewindFilters[t.dataset.rewindFilter]=t.value;route({keepScroll:true});return;}
  if(t.id==='rewindImport'&&t.files.length){
    t.disabled=true;const status=$('#rewindImportStatus');
    try{const n=await importRewind([...t.files],message=>{status.textContent=message;});await route({keepScroll:true});toast(`Added ${n.toLocaleString()} listens. Duplicates skipped.`);}catch(error){status.textContent=error.message;t.disabled=false;t.value='';}return;
  }
  if (t.dataset.setting) { try { store.setSettings({ [t.dataset.setting]: t.type==='checkbox'?t.checked:t.value.trim() }); applyPreferences(); toast('Saved'); } catch(err) { toast(err.message); } }
  if (['importFile','welcomeBackup'].includes(t.id) && t.files[0]) {
    try { if(t.id==='welcomeBackup')dismissWelcome();if(t.files[0].size>30*1024*1024)throw new Error('Choose a Spot+ backup smaller than 30 MB.');const result=store.importData(JSON.parse(await t.files[0].text()));toast(result.spotifyAccount==='different-account-kept'?'Backup imported. Your current Spotify account copy was kept; the backup belongs to another account.':result.spotifyAccount==='newer-copy-kept'?'Backup imported. Your newer Spotify library copy was kept.':'Backup imported'); }
    catch (err) { toast(`Import failed: ${err.message}`); }
    t.value = '';
  }
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !$('#dlg').open) { if (!sheet.hidden) {e.preventDefault();closeSheet();} else if (npOpen) {e.preventDefault();closeNP();} return; }
  if (e.target.closest('input,textarea,select,button,a') || $('#dlg').open) return;
  if (e.code === 'Space') { e.preventDefault(); player.toggle(); }
});

/* ---------------- Player bar ---------------- */
const bar = $('#bar');
function syncPlayer() {
  const t = player.current();
  const s = player.state;
  bar.hidden = false;
  bar.dataset.startupMs = s.startupMs == null ? '' : String(s.startupMs);
  bar.dataset.playing = String(player.isPlaying());
  bar.classList.toggle('bar-empty',!t);
  document.body.classList.toggle('has-bar', !!t);
  const error=$('#playbackError');error.hidden=!s.error;
  if(s.error)error.innerHTML=`<p>${esc(s.error)}</p><button class="btn small" data-act="retry-playback">Retry</button><a class="btn small" href="#/settings">Audio sources</a><button class="icon" data-act="dismiss-playback-error" aria-label="Dismiss playback error">${I.close}</button>`;
  $$('[data-role=play]').forEach(b=>{setIcon(b,player.isPlaying()?'pause':'play');b.disabled=!t;b.setAttribute('aria-label',s.loading?'Cancel loading':player.isPlaying()?'Pause':'Play');});
  $$('[data-role=like],[data-role=shuffle],[data-role=repeat],[data-act=prev],[data-act=next],[data-act=np-open],[data-act=np-lyrics]').forEach(b=>b.disabled=!t);
  $$('[data-role=seek]').forEach(b=>b.disabled=!t||s.loading||!!s.error||!player.el.src||player.el.src.startsWith('data:'));
  if (!t) {$('#barArt').src='icons/icon-192.png';$('#barTitle').textContent='Choose something to play';$('#barArtist').textContent='Spot+';$$('[data-role=like]').forEach(b=>setIcon(b,'plus'));$$('[data-role=repeat]').forEach(b=>setIcon(b,'repeat'));return;}
  if (bar.dataset.id !== t.id) {
    bar.dataset.id = t.id;
    $('#barArt').src = t.cover || 'icons/icon-192.png';
    $('#barTitle').textContent = t.title;
    $('#barArtist').textContent = t.artist;
    playerColors.setTrack(t);
  }
  const playing = player.isPlaying();
  $$('[data-role=play]').forEach((b) => setIcon(b, playing ? 'pause' : 'play'));
  $$('[data-role=like]').forEach((b) => { const on = store.isLiked(t.id); setIcon(b, on ? 'check' : 'plus'); b.classList.toggle('on', on);b.setAttribute('aria-pressed',String(on));b.setAttribute('aria-label',on?'Remove from Liked Songs':'Add to Liked Songs'); });
  $$('[data-role=shuffle]').forEach((b) => {b.classList.toggle('on', s.shuffle);b.setAttribute('aria-pressed',String(s.shuffle));});
  $$('[data-role=repeat]').forEach((b) => { setIcon(b, s.repeat === 'one' ? 'repeat1' : 'repeat'); b.classList.toggle('on', s.repeat !== 'off');b.setAttribute('aria-label',`Repeat: ${s.repeat}`);b.setAttribute('aria-pressed',String(s.repeat!=='off')); });
  document.body.classList.toggle('is-loading', s.loading);
  $$('.trow[data-id], .card[data-id]').forEach((r) => r.classList.toggle('playing', r.dataset.id === t.id));
  document.title = playing ? `${t.title} · ${t.artist}` : 'Spot+';
  if (npOpen) syncNP();
}
let seeking = false;
function syncTime() {
  const d = player.duration();
  const c = player.el.currentTime || player.restoredPosition() || 0;
  const pct = d ? Math.min(100,(c / d) * 100) : 0;
  $('#barProg').style.width = pct + '%';
  if (!seeking) $$('[data-role=seek]').forEach((r) => { r.value = d ? Math.round((c / d) * 1000) : 0; r.style.setProperty('--p', pct + '%'); });
  $$('[data-role=cur]').forEach((x) => (x.textContent = fmt(c)));
  $$('[data-role=dur]').forEach((x) => (x.textContent = fmt(d)));
  syncLyrics();
}
$$('[data-role=seek]').forEach((r) => {
  r.addEventListener('input', () => { seeking = true; const d = player.duration(); r.style.setProperty('--p', r.value / 10 + '%'); $$('[data-role=cur]').forEach((x) => (x.textContent = fmt((r.value / 1000) * d))); });
  r.addEventListener('change', () => { player.seek((r.value / 1000) * player.duration()); seeking = false; });
});
const vol = $('#vol');
vol.value = Math.round(player.el.volume * 100);
vol.addEventListener('input', () => {player.setVolume(vol.value / 100);vol.style.setProperty('--p',vol.value+'%');});

/* ---------------- Now playing ---------------- */
const MOBILE_QUERY='(max-width:767px), (max-width:950px) and (max-height:500px) and (orientation:landscape)';
const np = $('#np');
let npOpen = false;
let npMode = 'art';
let currentSongPalette={color:'#1b5e46',surface:'#103829',deep:'#06150f'};
function syncStatusColor(){
  const mobile=matchMedia(MOBILE_QUERY).matches,p=themes.palette(store.getSettings()),nowPlaying=npOpen&&mobile;
  syncChrome(nowPlaying?currentSongPalette.surface:p.canvas);
  // iOS 26 Home Screen apps leave a strip at the bottom that the page can't draw into;
  // iOS fills it from the page background, so keep that matching the bottom of the screen.
  const edge=nowPlaying?(currentSongPalette.deep||p.canvas):p.canvas;
  document.documentElement.style.setProperty('--edge',edge);
}
const playerColors=new PlayerColors(p=>{
  currentSongPalette=p;
  for(const node of [np,bar])for(const [key,value]of Object.entries(p))node.style.setProperty('--song-'+key,value);
  syncStatusColor();
});
const listeningMeter=new ListeningMeter(record=>saveHistory([record]).catch(()=>{}));
const trackListening=()=>listeningMeter.tick(player.current(),{sessionKey:player.current()?.id+':'+player.state.playbackId,time:player.el.currentTime||0,playing:player.isPlaying()&&!player.state.loading});
player.on('time',trackListening);player.on('state',trackListening);
document.addEventListener('visibilitychange',()=>{if(document.hidden)listeningMeter.flush();});
window.addEventListener('pagehide',()=>listeningMeter.flush());
function openNP(mode) {
  if (!player.current() && mode!=='queue') return;
  if (!npOpen) {
    npFocus=document.activeElement;
    np.hidden = false;
    requestAnimationFrame(() => np.classList.add('open'));
    npOpen = true;
    document.body.classList.add('has-panel');
    if(matchMedia(MOBILE_QUERY).matches){$('.app').inert=true;np.setAttribute('role','dialog');np.setAttribute('aria-modal','true');np.focus();}
    if(matchMedia(MOBILE_QUERY).matches)history.pushState({ np: 1 }, '');
  }
  setNPMode(mode || 'art');
  syncNP();
  syncStatusColor();
}
function closeNP({ fromPop = false, nav = false } = {}) {
  if (!npOpen) return;
  npOpen = false;
  syncStatusColor();
  canvasPlayer.clear();
  document.body.classList.remove('has-panel');
  $('.app').inert=false;
  np.removeAttribute('aria-modal');np.removeAttribute('role');
  npFocus?.isConnected&&npFocus.focus();
  np.classList.remove('open');
  setTimeout(() => { if (!npOpen) np.hidden = true; }, 250);
  if (!fromPop && history.state?.np) { if (nav) history.replaceState(null, ''); else history.back(); }
}
window.addEventListener('popstate', () => { if (npOpen && matchMedia(MOBILE_QUERY).matches) closeNP({ fromPop: true }); });
matchMedia(MOBILE_QUERY).addEventListener('change',()=>{if(!npOpen)return;const mobile=matchMedia(MOBILE_QUERY).matches;syncStatusColor();$('.app').inert=mobile;if(mobile){np.setAttribute('role','dialog');np.setAttribute('aria-modal','true');np.focus();}else{np.removeAttribute('role');np.removeAttribute('aria-modal');}});
function setNPMode(mode,{retryCanvas=false}={}) {
  if (mode === npMode && mode !== 'art' && matchMedia(MOBILE_QUERY).matches && np.dataset.mode===mode && np.classList.contains('open')) mode = 'art';
  npMode = mode;
  np.dataset.mode = mode;
  $('.np-label').textContent=mode==='queue'?'Queue':mode==='lyrics'?'Lyrics':'Now playing';
  $$('.np-tabs button').forEach((b) => b.classList.toggle('on', b.dataset.mode === mode));
  syncCanvas(retryCanvas);
  if (mode === 'queue') renderQueue();
  if (mode === 'lyrics') { loadLyrics(); lyrUserScroll = 0; lyr.active = -1; syncLyrics(); }
}
function syncNP() {
  const t = player.current();
  if (!t) {if(npMode==='queue')renderQueue();return;}
  const s = player.state;
  if (np.dataset.id !== t.id) {
    np.dataset.id = t.id;
    $('#npArt').src = t.coverXl || t.cover || 'icons/icon-512.png';
    $('#npBg').style.backgroundImage = `url("${safeImage(t.coverXl || t.cover || 'icons/icon-512.png').replace(/"/g, '')}")`;
    $('#npTitle').textContent = t.title;
    $('#npArtist').textContent = t.artist;
    $('#npPlays').textContent='';
    getTrackStats(t).then(data=>{if(player.current()?.id!==t.id)return;const count=matchPlayCount(t,data);$('#npPlays').textContent=count?count.plays.toLocaleString()+' plays on Spotify':'';});
  }
  $('#npSrc').textContent = s.offline ? (t.local?'Local audio · On this device':'Downloaded audio · On this device') : s.source?.preview ? '30-second preview · Deezer' : s.source ? `Audio · ${api.host(s.source.instance)}` : s.loading ? 'Finding audio… Tap play to cancel.' : s.error?'Audio unavailable. Retry or change audio source.':'Ready to play';
  syncCanvas();
  if (npMode === 'queue') renderQueue();
  loadLyrics();
}
let canvasPreference=canvasEnabled({reducedMotion:matchMedia('(prefers-reduced-motion:reduce)').matches||document.body.dataset.motion==='reduced',saveData:navigator.connection?.saveData});
const canvasPlayer=new CanvasPlayer($('#npCanvas'),{media:clipSource,lookup:(track,signal,options)=>findVisualLoop(track,signal,{...options,source:player.state.source}),onState:(state,clip)=>{
  np.classList.toggle('has-canvas',state==='ready');
  np.dataset.canvasState=state;
  np.dataset.visualKind=clip?.kind || '';
  const status=$('#npCanvasStatus');
  status.textContent=({loading:'Finding a loop…',fallback:'Finding a matching video…',deferred:player.isPlaying()?'Starting your music first…':'Loops play with your music',waiting:'Loop ready · Press play',ready:clip?.kind==='music-video'?`${clip.height?clip.height+'p · ':''}Music video loop · `:'Spotify Canvas',missing:'No matching clip found · Cover shown',error:'Clips unavailable right now · Cover shown',blocked:'Tap Loops to start the clip'})[state]||'';
  if(state==='ready'&&clip?.kind==='music-video'){const link=document.createElement('a');link.href=clip.sourceURL;link.target='_blank';link.rel='noopener';link.textContent='Watch video';status.append(link);}
}});
function syncCanvas(retry=false){
  const inCover=npMode==='art';
  $('#npCoverButton').classList.toggle('on',inCover&&!canvasPreference);
  $('#npCoverButton').setAttribute('aria-pressed',String(inCover&&!canvasPreference));
  $('#npCanvasButton').classList.toggle('on',inCover&&canvasPreference);
  $('#npCanvasButton').setAttribute('aria-pressed',String(inCover&&canvasPreference));
  canvasPlayer.sync(player.current(),{visible:npOpen&&inCover&&!document.hidden,enabled:canvasPreference,playing:player.isPlaying()&&!player.state.loading,networkReady:hasLocalClip(player.current())||(!player.state.loading&&audioHasHeadroom(player.el)),retry});
}
player.on('state',()=>syncCanvas());
// Download Canvas clips for this song and the next two while music plays, so opening
// the player (or skipping ahead) shows the loop immediately.
let prefetchedFor='';
player.on('state',()=>{
  const t=player.current();if(!t||!canvasPreference||t.id===prefetchedFor)return;
  prefetchedFor=t.id;const s=player.state;
  setTimeout(()=>prefetchClips([t,s.queue[s.index+1],s.queue[s.index+2]]),player.isPlaying()?1500:0);
});
player.on('time',()=>{if(npOpen&&canvasPreference){syncCanvas();if(np.classList.contains('has-canvas'))playerColors.sampleVideo($('#npCanvas'));}});
document.addEventListener('visibilitychange',()=>syncCanvas());
function qRow(t, idx, cur) {
  return `<div class="trow${cur ? ' playing' : ''}" data-act="q-jump" data-qi="${idx}">${img(t.cover, 'tcover')}
    <div class="tmeta"><div class="ttitle">${esc(t.title)}</div><div class="tsub">${esc(t.artist)}</div></div>
    <button class="sr-only" data-act="q-jump" data-qi="${idx}" aria-label="Play ${esc(t.title)}">Play</button>${cur ? '' : `<div class="q-actions"><button class="icon" data-act="q-up" data-qi="${idx}" aria-label="Move ${esc(t.title)} up" ${idx<=player.state.index+1?'disabled':''}>${I.up}</button><button class="icon" data-act="q-down" data-qi="${idx}" aria-label="Move ${esc(t.title)} down" ${idx===player.state.queue.length-1?'disabled':''}>${I.down}</button><button class="icon" data-act="q-remove" data-qi="${idx}" aria-label="Remove ${esc(t.title)} from queue">${I.close}</button></div>`}</div>`;
}
let queueSignature='';
function renderQueue() {
  const { queue, index } = player.state;
  const up = queue.slice(index + 1, index + 151);
  // Re-rendering recreates every cover image (a visible blink), so only rebuild on change.
  const signature=index+'|'+queue.slice(index,index+151).map(t=>t.id).join(',')+'|'+player.current()?.id;
  if(signature===queueSignature&&$('#npQueue').childElementCount)return;
  queueSignature=signature;
  $('#npQueue').innerHTML = `<div class="q-head">Now playing</div>${queue[index] ? qRow(queue[index], index, true) : ''}
    <div class="q-head">Up next ${up.length ? '<button class="link" data-act="q-clear">Clear</button>' : ''}</div>
    ${up.length ? up.map((t, j) => qRow(t, index + 1 + j, false)).join('') : '<p class="muted pad">Nothing queued.</p>'}`;
}

let lyr = { id: null, lines: null, active: -1 };
let lyrUserScroll = 0;
async function loadLyrics() {
  const t = player.current();
  if (!t || !npOpen || lyr.id === t.id) return;
  lyr = { id: t.id, lines: null, active: -1 };
  const box = $('#npLyrics');
  box.innerHTML = '<p class="muted pad center">Loading lyrics…</p>';
  const r = await api.lyrics(t).catch(() => null);
  if (lyr.id !== t.id) return;
  if (!r) box.innerHTML = '<p class="muted pad center">No lyrics found for this song.</p>';
  else if (r.synced?.length) {
    lyr.lines = r.synced;
    box.innerHTML = `<div class="ly-pad"></div>${r.synced.map((l, i) => `<p class="ly" data-act="ly-seek" data-t="${l.t}" data-li="${i}">${esc(l.text) || '♪'}</p>`).join('')}<div class="ly-pad"></div>`;
    syncLyrics();
  } else if (r.plain) box.innerHTML = `<div class="ly-plain">${esc(r.plain).replace(/\n/g, '<br>')}</div><p class="muted center small">Lyrics aren’t time-synced for this one.</p>`;
  else box.innerHTML = '<p class="muted pad center">♪ Instrumental ♪</p>';
}
function syncLyrics() {
  if (!lyr.lines || !npOpen || npMode === 'queue' || player.current()?.id !== lyr.id) return;
  const now = (player.el.currentTime || 0) + 0.3;
  let i = lyr.lines.findIndex((l) => l.t > now);
  i = (i === -1 ? lyr.lines.length : i) - 1;
  if (i === lyr.active) return;
  const box = $('#npLyrics');
  box.querySelector('.ly.on')?.classList.remove('on');
  lyr.active = i;
  const el = i >= 0 ? box.querySelector(`[data-li="${i}"]`) : null;
  if (!el) return;
  el.classList.add('on');
  if (Date.now() - lyrUserScroll > 3500) box.scrollTo({ top: el.offsetTop - box.clientHeight / 2 + el.clientHeight / 2, behavior: 'smooth' });
}
['wheel', 'touchmove'].forEach((ev) => $('#npLyrics').addEventListener(ev, () => { lyrUserScroll = Date.now(); }, { passive: true }));

/* ---------------- Shared desktop and mobile experience ---------------- */
let activeArtist=null, activeAlbum=null, libraryQuery='', sheetFocus=null, npFocus=null;
let lastVolume=.7, sleepTimer=null;
const libraryFilterNames=[['all','All'],['playlists','Playlists'],['artists','Artists'],['albums','Albums'],['downloaded','Downloaded']];
function safeImage(url) { try { const u=new URL(url,location.href);return ['https:','http:','blob:'].includes(u.protocol)?u.href:'icons/icon-192.png'; } catch { return 'icons/icon-192.png'; } }
function emptyState(title,description,label,href){return `<div class="empty">${I.note}<h2>${esc(title)}</h2><p class="muted">${esc(description)}</p>${label?`<a class="btn white" href="${href}">${esc(label)}</a>`:''}</div>`;}
function libraryFilters(){return libraryFilterNames.map(([key,label])=>`<button class="chip${store.getSettings().libraryFilter===key?' on':''}" data-act="library-filter" data-filter="${key}" aria-pressed="${store.getSettings().libraryFilter===key}">${label}</button>`).join('');}
function libraryData(){return {likes:store.getLikes(),downloads:store.getDownloads(),playlists:store.getPlaylists(),albums:store.getAlbums(),artists:store.getArtists(),localFiles:store.getLocalFiles(),spotifyLinks:store.getSpotifyLinks(),spotifyAccount:store.getSpotifyAccount(),folders:store.getFolders()};}
function renderLibraryItems({folderId=null,query=libraryQuery}={}){
  const s=store.getSettings(),pins=store.getPins();
  const items=libraryItems(libraryData(),{filter:folderId?'all':s.libraryFilter,sort:s.librarySort,query,pins,folderId});
  return items.map(x=>`<div class="library-item${location.hash===x.route?' active':''}" data-library-id="${esc(x.id)}"><a href="${x.route}" title="${esc(x.title)}"><div class="library-art${x.type==='artists'?' artist':''}">${x.cover?img(x.cover):`<div class="ph-cover ${x.className||''}">${I[x.icon]||I.note}</div>`}</div><div class="library-copy"><b>${esc(x.title)}</b><small>${pins.includes(x.id)?I.pin:''}${esc(x.subtitle)}${query&&x.folderName?' · '+esc(x.folderName):''}</small></div></a><button class="icon pin-button${pins.includes(x.id)?' on':''}" data-act="pin" data-id="${esc(x.id)}" aria-label="${pins.includes(x.id)?'Unpin':'Pin'} ${esc(x.title)}" aria-pressed="${pins.includes(x.id)}">${I.pin}</button>${x.folderable||x.isFolder?`<button class="icon library-menu" data-act="library-menu" data-id="${esc(x.id)}" aria-label="Options for ${esc(x.title)}">${I.more}</button>`:''}</div>`).join('') || `<p class="muted pad">${folderId&&!query?'No playlists yet. Add one above, or create a new playlist.':'No matching items in your library.'}</p>`;
}
function renderSidebar(){
  $('#sideFilters').innerHTML=libraryFilters();
  $('#libraryItems').innerHTML=renderLibraryItems()+(!store.getPlaylists().length && !libraryQuery && store.getSettings().libraryFilter==='all'?`<div class="library-empty"><b>Create your first playlist</b><p>Make a home for your favorites.</p><button class="btn small white" data-act="new-playlist">Create playlist</button></div>`:'');
  if($('#pageLibraryItems'))$('#pageLibraryItems').innerHTML=renderLibraryItems();
  if($('#folderItems'))$('#folderItems').innerHTML=renderLibraryItems({folderId:$('#folderItems').dataset.folderId,query:$('#folderQ')?.value||''});
}

function libraryMenu(id){
  const folder=store.getFolder(id);
  if(folder){
    openSheet({head:`<div class="sheet-title">${esc(folder.name)}</div>`,items:[
      {icon:I.plus,label:'Add playlists',fn:()=>folderAddPicker(id)},
      {icon:I.pin,label:store.getPins().includes(id)?'Unpin folder':'Pin folder',fn:()=>store.togglePin(id)},
      {icon:I.edit,label:'Rename folder',fn:async()=>{const name=await ask({title:'Rename folder',value:folder.name,ok:'Save'});if(name)store.renameFolder(id,name);}},
      {icon:I.trash,label:'Remove folder',sub:'Keep all playlists in Your Library',fn:async()=>{if(await confirmBox('Remove folder?',`“${folder.name}” will be removed. Every playlist inside stays in Your Library.`,'Remove folder')){store.deleteFolder(id);go('#/library');toast('Folder removed. Your playlists were kept.');}}}
    ]});return;
  }
  const item=libraryItems(libraryData(),{flat:true}).find(x=>x.id===id&&x.folderable);if(!item)return;
  openSheet({head:`<div class="sheet-title">${esc(item.title)}</div>`,items:[
    {icon:I.folder,label:'Move to folder',sub:item.folderName?'In '+item.folderName:'Organize in Spot+',fn:()=>folderPicker(id)},
    ...(item.folderId?[{icon:I.close,label:'Remove from folder',sub:'Keep in Your Library',fn:()=>{store.moveToFolder(id);toast('Moved to Your Library');}}]:[]),
    {icon:I.pin,label:store.getPins().includes(id)?'Unpin playlist':'Pin playlist',fn:()=>store.togglePin(id)}
  ]});
}
function folderPicker(itemId){
  const current=store.getFolders().find(f=>f.items.includes(itemId));
  openSheet({head:'<div class="sheet-title">Move to folder</div>',items:[
    {icon:I.plus,label:'New folder',fn:async()=>{const name=await ask({title:'New folder',placeholder:'Folder name',ok:'Create'});if(name){const folder=store.createFolder(name);store.moveToFolder(itemId,folder.id);toast('Moved to '+folder.name);}}},
    ...(current?[{icon:I.library,label:'Your Library',sub:'Remove from '+current.name,fn:()=>{store.moveToFolder(itemId);toast('Moved to Your Library');}}]:[]),
    ...store.getFolders().map(f=>({icon:f.id===current?.id?I.check:I.folder,label:f.name,sub:f.id===current?.id?'Current folder':'',fn:()=>{store.moveToFolder(itemId,f.id);toast('Moved to '+f.name);}}))
  ]});
}
function folderAddPicker(id){
  const folder=store.getFolder(id);if(!folder)return;
  const items=libraryItems(libraryData(),{flat:true}).filter(x=>x.folderable&&x.folderId!==id);
  openSheet({head:`<div class="sheet-title">Add to ${esc(folder.name)}</div>`,body:items.length?'':'<p class="sheet-note">All your saved playlists are already here. Create another playlist to add more music.</p>',items:[
    ...items.map(x=>({icon:I.note,label:x.title,sub:x.folderName?'Move from '+x.folderName:x.subtitle,fn:()=>{store.moveToFolder(x.id,id);toast('Added to '+folder.name);}})),
    {icon:I.plus,label:'Create a new playlist',fn:async()=>{const name=await ask({title:'New playlist',placeholder:'Playlist name',ok:'Create'});if(name){const p=store.createPlaylist(name);store.moveToFolder(p.id,id);go('#/my/'+p.id);}}}
  ]});
}
function applyPreferences(){
  const s=store.getSettings();
  document.body.dataset.density=s.density;delete document.body.dataset.accent;document.body.dataset.motion=s.motion;document.body.dataset.textSize=s.textSize;
  const palette=themes.applyTheme(s);
  if(typeof syncStatusColor==='function')queueMicrotask(()=>syncStatusColor());
  syncStatusColor();
  if($('#themeLiveName'))$('#themeLiveName').textContent=s.themeCustom?'Your mix':palette.name;
  if($('#themeContrast'))$('#themeContrast').textContent=themes.contrast(palette.accentText,palette.raised).toFixed(1)+':1 accent text contrast';
  const width=Math.max(224,Math.min(420,Number(s.sidebarWidth)||288));
  document.documentElement.style.setProperty('--sidebar',`${width}px`);
  $('#libraryResize').setAttribute('aria-valuenow',String(width));
  document.body.classList.toggle('library-collapsed',!!s.libraryCollapsed);
  syncAvatars();
  $('#networkNotice').hidden=navigator.onLine;
  renderSidebar();
}
function browseHome(){
  const cats=[['Pop','#8d1766'],['Hip-Hop','#b4431f'],['Rock','#c4283c'],['Electronic','#216078'],['Jazz','#875a2a'],['R&B','#7352a8'],['Classical','#56652d'],['Country','#466d7a']];
  return `${store.getSearches().length?`<div class="sec-head"><h2>Recent searches</h2><button class="link" data-act="clear-searches">Clear</button></div><div class="recent-searches">${store.getSearches().map(q=>`<a class="chip" href="#/search/${encodeURIComponent(q)}">${esc(q)}</a>`).join('')}</div>`:''}<section><h2>Browse music</h2><div class="browse-grid"><a class="browse-card" href="#/spotify" style="--tile:var(--accent)">Spotify collections<small>Official playlists & your library</small>${I.library}</a><a class="browse-card" href="#/dj" style="--tile:#16436b">Made for you<small>Spot+ DJ</small>${I.dj}</a>${cats.map(([name,color])=>`<a class="browse-card" href="#/search/${encodeURIComponent(name)}" style="--tile:${color}">${name}<small>Explore songs & artists</small>${I.note}</a>`).join('')}</div></section>`;
}
// Profile pictures follow your Spotify account photo when a library is connected;
// otherwise they show your initial.
function profileName(){const s=store.getSettings(),custom=s.displayName&&s.displayName!=='Your library'?s.displayName.trim():'';return custom||store.getSpotifyAccount()?.account?.name||cachedLinks()?.profile?.name||'Listener';}
function profilePhoto(){const url=store.getSpotifyAccount()?.account?.avatar||store.getSpotifyStats().account?.avatar||cachedLinks()?.profile?.avatar;return url?safeImage(url):'';}
function syncAvatars(){
  const photo=profilePhoto(),letter=(profileName().trim()[0]||'S').toUpperCase();
  $$('.avatar').forEach(el=>{
    if(photo&&el.dataset.photo!==photo){el.dataset.photo=photo;el.replaceChildren();const im=new Image();im.alt='';im.decoding='async';im.src=photo;im.onerror=()=>{el.dataset.photo='';el.textContent=letter;};el.append(im);el.classList.add('has-photo');}
    else if(!photo){el.dataset.photo='';el.classList.remove('has-photo');el.textContent=letter;}
  });
}
function viewProfile(){const s=store.getSettings(),spotifyProfile=store.getSpotifyAccount()?.account;return `<div class="profile-hero"><div class="avatar">${esc((profileName()[0]||'S').toUpperCase())}</div><div><div class="kicker">Profile</div><h1>${esc(profileName())}</h1><a class="link" href="#/settings">Edit profile</a></div></div><div class="stat-row"><div><b>${store.getPlaylists().length}</b>Playlists</div><div><b>${store.getLikes().length}</b>Liked songs</div><div><b>${store.getArtists().length}</b>Following</div></div><p class="muted">Your library is saved in this browser. Export a backup in Settings to keep a copy.</p>${spotifyProfile?`<section class="box">${spotifyProfileHtml(spotifyProfile)}<a class="link" href="#/spotify-account">Manage Spotify library</a></section>`:''}${shelf('Following',store.getArtists().map(artistCard))}<h2>Your playlists</h2>${renderLibraryItems()}`;}
function viewRecent(){const recent=store.getRecent(),k=reg(recent);return `<h1 class="settings-top">Recently played</h1>${recent.length?trackRows(recent,k):emptyState('Your listening starts here','Play something and it will appear here.','Browse music','#/search')}`;}
function viewLocal(){const tracks=store.getLocalFiles(),k=reg(tracks);return `<h1 class="settings-top">Local files</h1><p class="muted">Audio you choose from your phone or computer, stored in this browser.</p><button class="btn white" data-act="import-local">Add audio files</button>${tracks.length?actions(k)+trackRows(tracks,k):emptyState('Bring your own music','Choose audio files you have permission to play. They stay on this device.')}`;}
function homeDJ(){return `<div class="home-dj"><a class="dj-orb-small" href="#/dj" aria-label="Open Spot+ DJ"></a><form id="homeDJRequest"><label for="homeDJPrompt" class="sr-only">Tell DJ what to play</label><input id="homeDJPrompt" maxlength="300" placeholder="Tell DJ what to play" enterkeyhint="go"><button class="icon" type="button" data-act="dj-mic" aria-label="Talk to DJ">${I.mic}</button></form></div>`;}
function viewDJ(){
 const s=store.getSettings(),k=reg(dj.state.tracks),v=dj.voice.state;
 return `<section class="dj-stage" id="djStage" data-phase="${v.phase}"><h1>DJ</h1><p>Your personal DJ picks the music and talks between songs. Ask for anything.</p><div class="dj-orbit" aria-hidden="true"><b>DJ</b></div><div class="dj-wave" aria-hidden="true">${Array.from({length:9},(_,i)=>'<i style="--i:'+i+'"></i>').join('')}</div><div class="dj-live-state" id="djPhase" ${v.phase==='idle'?'hidden':''}>${v.phase==='idle'?'':esc(v.phase)}</div><div class="dj-caption" id="djCaption" role="status">${esc(v.caption)}</div><div class="dj-transcript" id="djTranscript">${esc(v.transcript)}</div><button class="dj-edit" id="djEdit" data-act="dj-edit" ${v.transcript?'':'hidden'}>Edit what I heard</button>
 <div class="dj-controls"><button class="btn primary" data-act="dj-start">${I.play}Play my mix</button><button class="icon mic-button" data-act="dj-mic" aria-label="Talk to DJ" aria-pressed="${v.phase==='listening'}">${I.mic}<span data-mic-label class="sr-only">Talk to DJ</span></button><button class="btn dj-switch" data-act="dj-change" aria-label="Switch it up">${I.swap}<span>Switch it up</span></button></div></section>
 <div class="dj-request-wrap"><form id="djRequest" class="dj-request"><label class="sr-only" for="djPrompt">Ask the DJ</label><input id="djPrompt" maxlength="300" placeholder="Ask for a mood, artist or moment…" value="${esc(dj.state.request)}" enterkeyhint="send"><button class="btn white" type="submit">Ask</button></form><div class="dj-hints">${['More like this','Focus music','More energy','Late night','Throwbacks'].map(q=>'<button data-act="dj-suggestion" data-prompt="'+q+'">'+q+'</button>').join('')}</div><p id="djStatus" class="settings-note" role="status">${esc(dj.state.message)}</p></div>
 <section class="dj-session"><h2>In your mix</h2><div id="djTracks">${dj.state.tracks.length?trackRows(dj.state.tracks,k):'<p class="muted">Tap Play my mix, or ask for something.</p>'}</div></section>
 <details class="dj-options"><summary>Voice and settings</summary>
 <div class="live-dj-setup" id="liveDJSetup">${liveDJHtml()}</div>
 <fieldset class="host-picker"><legend>Your host</legend><p class="settings-note">Tap a voice to hear it.</p><div class="host-choices">${dj.voice.HOSTS.map(h=>'<button class="host-choice '+(dj.voice.host()===h.id?'selected':'')+'" data-act="dj-host" data-host="'+h.id+'" aria-pressed="'+(dj.voice.host()===h.id)+'"><b>'+h.name+'</b><span>'+h.description+'</span><small>Preview</small></button>').join('')}</div><small class="voice-credit">AI-generated voices.</small><p class="settings-note" id="voiceStatus">${esc(dj.voice.state.error)}</p></fieldset>
 <label class="field"><span>Spoken replies</span><input type="checkbox" role="switch" data-setting="djVoice" ${s.djVoice?'checked':''}></label>
 <label class="field"><span>Talk between songs</span><input type="checkbox" role="switch" data-setting="djCommentary" ${s.djCommentary!==false?'checked':''}></label>
 <label class="field"><span>Keep listening after replies<small>Ask follow-ups without tapping the mic again.</small></span><input type="checkbox" role="switch" id="djConversation" ${v.conversation?'checked':''}></label>
 <button class="btn small" data-act="sleep-timer">Sleep timer</button>
 <p class="dj-privacy">Music pauses while you talk, and the mic turns off when you leave the app. Voice input works best in Safari on iPhone and Chrome on Android.</p></details>`;
}
function liveDJHtml(){
 const voice=dj.liveVoice.state,model=dj.localModel.status,ready=dj.liveReady(),loading=voice.phase==='loading'||model.phase==='loading';
 const message=ready?'Ready. Replies are generated on this device.':loading?(voice.phase==='loading'?voice.message:model.message):voice.phase==='error'?voice.message:model.phase==='error'?model.message:'Have a real conversation with your DJ. Runs on this device; one-time 600 MB download (use Wi-Fi).';
 return '<div><b>'+(ready?'Live DJ is on':'Live conversation')+'</b><p>'+esc(message)+'</p></div>'+(loading?'<progress aria-label="Preparing live DJ" max="100" value="'+(voice.phase==='loading'?Math.round(voice.progress*.67):67+Math.round(model.progress*.33))+'"></progress><button class="btn small" data-act="dj-live-stop">Cancel setup</button>':ready?'<button class="btn small" data-act="dj-live-stop">End live session</button>':'<button class="btn primary" data-act="dj-live-enable">Enable live DJ</button>');
}
function syncLiveDJ(){if($('#liveDJSetup'))$('#liveDJSetup').innerHTML=liveDJHtml();}
dj.liveVoice.onChange(syncLiveDJ);dj.localModel.onChange(syncLiveDJ);
function syncDJVoice(){
 const v=dj.voice.state,phase=v.phase==='idle'&&dj.state.busy?'thinking':v.phase;
 if($('#djStage')){const stage=$('#djStage');stage.dataset.phase=phase;stage.dataset.voice=v.lastVoice;stage.dataset.responseMs=String(v.responseMs);}
 if($('#djPhase')){const label={listening:'Listening…',thinking:'Thinking…',speaking:'Speaking'}[phase]||phase;$('#djPhase').textContent=phase==='idle'?'':label;$('#djPhase').hidden=phase==='idle';}
 if($('#djCaption'))$('#djCaption').textContent=v.caption;
 if($('#djTranscript'))$('#djTranscript').textContent=v.transcript;
 if($('#djEdit'))$('#djEdit').hidden=!v.transcript;
 $$('[data-act="dj-mic"]').forEach(b=>{b.setAttribute('aria-pressed',String(v.phase==='listening'));b.setAttribute('aria-label',v.phase==='listening'?'Stop listening':'Talk to DJ');const label=b.querySelector('[data-mic-label]');if(label)label.textContent=v.phase==='listening'?'Stop listening':'Talk to DJ';});
 if($('#djConversation'))$('#djConversation').checked=v.conversation;
 if($('#voiceStatus'))$('#voiceStatus').textContent=v.error;
 $$('[data-act="dj-host"]').forEach(b=>{const selected=b.dataset.host===dj.voice.host();b.classList.toggle('selected',selected);b.setAttribute('aria-pressed',String(selected));});
}
dj.voice.onChange(syncDJVoice);
function modelStatusHtml(){const s=dj.localModel.status;return `<p class="settings-note">${esc(s.message)}</p>${s.phase==='loading'?`<progress class="model-progress" max="100" value="${s.progress}"></progress>`:''}<div class="row-btns">${s.phase==='idle'||s.phase==='error'?'<button class="btn small white" data-act="model-load">Download & enable local AI</button>':'<button class="btn small" data-act="model-stop">Use lighter DJ</button>'}<button class="btn small" data-act="model-remove">Remove downloaded model</button></div>`;}
function syncVoices(){syncDJVoice();}


function createMenu(){openSheet({head:'<div class="sheet-title">Create</div>',items:[{icon:I.plus,label:'Create a playlist',sub:'Collect your favorite tracks',fn:()=>handleAct('new-playlist',{})},{icon:I.folder,label:'Create a folder',sub:'Organize playlists in your library',fn:()=>handleAct('new-folder',{})},{icon:I.library,label:'Spotify account & collections',sub:'Connect your account or explore playlists',fn:()=>go('#/spotify')},{icon:I.import,label:'Import a Deezer playlist',fn:()=>handleAct('import-playlist',{})},{icon:I.note,label:'Add local audio files',sub:'From this phone or computer',fn:()=>$('#localFilesInput').click()},{icon:I.dj,label:'Start a DJ session',fn:()=>go('#/dj')},{icon:I.jam,label:'Start a Jam',sub:'Listen together in real time',fn:()=>go('#/jam')}]});}
function profileMenu(){openSheet({head:`<div class="sheet-title">${esc(store.getSettings().displayName)}</div>`,items:[{icon:I.person,label:'Profile',sub:'Your library on this device',fn:()=>go('#/profile')},{icon:I.history,label:'Your Rewind',sub:'Your listening, all year round',fn:()=>go('#/rewind')},{icon:I.history,label:'Listening history',fn:()=>go('#/recent')},{icon:I.settings,label:'Theme Studio',sub:'Make Spot+ yours',fn:()=>go('#/themes')},{icon:I.library,label:'Spotify account',fn:()=>go('#/spotify-account')},{icon:I.settings,label:'Settings',fn:()=>go('#/settings')},{icon:I.dj,label:'Spot+ DJ',fn:()=>go('#/dj')}]});}
function deviceMenu(){openSheet({head:'<div class="sheet-title">Connect</div>',body:`<button class="jam-entry" data-act="jam-open">${I.jam}<div><b>${jam.active?'Jam · '+esc(jam.code):'Start a Jam'}</b><small>${jam.active?jam.members.length+' listening':'Listen together with friends, live'}</small></div>${I.arrow}</button><div class="device-card">${I.device}<div><b>This browser</b><small>Current audio output</small></div></div><p class="sheet-note">Use your phone or computer’s audio controls for Bluetooth or AirPlay. Spotify Connect is not available through these music sources.</p>`,items:typeof player.el.setSinkId==='function' && navigator.mediaDevices?.selectAudioOutput?[{icon:I.device,label:'Choose audio output',fn:async()=>{try{const d=await navigator.mediaDevices.selectAudioOutput();await player.el.setSinkId(d.deviceId);toast('Audio output changed');}catch(e){toast(e.name==='NotAllowedError'?'Audio output selection was cancelled.':e.message);}}}]:[]});}
function sleepMenu(){openSheet({head:'<div class="sheet-title">Sleep timer</div>',items:[...[5,15,30,60].map(minutes=>({icon:I.history,label:`${minutes} minutes`,fn:()=>{clearTimeout(sleepTimer);sleepTimer=setTimeout(()=>{player.el.pause();dj.stop();toast('Sleep timer ended');},minutes*60000);toast(`Playback will pause in ${minutes} minutes`);}})),{icon:I.close,label:'Turn off timer',fn:()=>{clearTimeout(sleepTimer);sleepTimer=null;toast('Sleep timer off');}}]});}
function trapFocus(e,root){if(e.key!=='Tab')return;const focusable=$$('button:not(:disabled),a[href],input:not(:disabled),select,textarea,[tabindex="0"]',root).filter(el=>el.getClientRects().length);if(!focusable.length)return;const first=focusable[0],last=focusable.at(-1);if(e.shiftKey&&(document.activeElement===first||!root.contains(document.activeElement))){e.preventDefault();last.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus();}}
document.addEventListener('keydown',e=>{if(!sheet.hidden)trapFocus(e,sheet);else if(npOpen&&matchMedia(MOBILE_QUERY).matches)trapFocus(e,np);if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='k'){e.preventDefault();go('#/search');}if(!e.target.closest('input,textarea,select,button')&&e.altKey){if(e.key==='ArrowRight'){e.preventDefault();player.next();}if(e.key==='ArrowLeft'){e.preventDefault();player.prev();}}});
document.addEventListener('submit',e=>{if(e.target.id==='catalogSearch'){e.preventDefault();clearTimeout(searchTimer);runSearch($('#q').value.trim());$('#q').blur();}});
$('#globalSearch').addEventListener('submit',e=>{e.preventDefault();go(`#/search/${encodeURIComponent($('#globalQ').value.trim())}`);});
document.addEventListener('submit',e=>{if(['djRequest','homeDJRequest'].includes(e.target.id)){e.preventDefault();const prompt=e.target.querySelector('input').value.trim();if(e.target.id==='homeDJRequest')go('#/dj');dj.start(prompt);}});
document.addEventListener('change',e=>{if(e.target.id==='djConversation')dj.voice.toggleConversation();});
document.addEventListener('input',e=>{if(['libraryQ','pageLibraryQ'].includes(e.target.id)){libraryQuery=e.target.value;renderSidebar();}});
$('#localFilesInput').addEventListener('change',async e=>{const files=[...e.target.files];if(!files.length)return;const progress=toast('Importing local audio…',{sticky:true});try{for(const file of files)await player.importLocalFile(file);progress.set(`Added ${plural(files.length,'audio file')}`);go('#/local');}catch(err){progress.set(err.message);}finally{progress.close(4000);e.target.value='';}});
$('#spotifyImport').addEventListener('change',async e=>{
  const files=[...e.target.files];if(!files.length)return;
  const progress=toast('Reading your Spotify music library…',{sticky:true});
  try{
    if(files.length>100||files.reduce((sum,f)=>sum+f.size,0)>80*1024*1024)throw new Error('Choose music export files totaling under 80 MB.');
    const bundle={likes:[],playlists:[]};
    for(const file of files){const data=await spotify.importFile(file);bundle.likes.push(...data.likes);bundle.playlists.push(...data.playlists);}
    bundle.likes=[...new Map(bundle.likes.map(t=>[t.id,t])).values()];
    progress.close();
    const confirmed=await ask({title:'Import your Spotify library?',message:`Found ${plural(bundle.likes.length,'saved song')} and ${plural(bundle.playlists.length,'playlist')}. Merge these into your library? Existing music is kept.`,input:false,ok:'Import music'});
    if(!confirmed)return;
    const added=store.importSpotify(bundle);toast(`Imported ${plural(added.liked,'new liked song')} and ${plural(added.playlists,'new playlist')}. Existing playlists were updated.`);go('#/library');
  }catch(error){progress.set(error.message);progress.close(6000);}finally{e.target.value='';}
});
$('#themeImport').addEventListener('change',async e=>{try{const file=e.target.files[0];if(!file)return;if(file.size>100000)throw new Error('Choose a Spot+ theme JSON file under 100 KB.');store.setSettings(themes.normalizeTheme(JSON.parse(await file.text())));route({keepScroll:true});toast('Theme applied');}catch(error){toast(error.message);}finally{e.target.value='';}});
document.addEventListener('contextmenu',e=>{const libraryRow=e.target.closest('[data-library-id]');if(libraryRow?.querySelector('[data-act="library-menu"]')){e.preventDefault();libraryMenu(libraryRow.dataset.libraryId);return;}const row=e.target.closest('[data-list]');if(row){const {tracks,meta}=listOf(row.dataset.list),index=+row.dataset.i;if(tracks[index]){e.preventDefault();trackSheet(tracks[index],{...meta,index});}}});
$('#libraryResize').addEventListener('pointerdown',e=>{if(e.button!==0)return;e.preventDefault();const bar=e.currentTarget;bar.setPointerCapture(e.pointerId);const move=ev=>{const width=Math.max(224,Math.min(420,ev.clientX-8));document.documentElement.style.setProperty('--sidebar',`${width}px`);bar.setAttribute('aria-valuenow',String(width));};const end=()=>{bar.removeEventListener('pointermove',move);bar.removeEventListener('pointerup',end);bar.removeEventListener('pointercancel',end);store.setSettings({sidebarWidth:Number(bar.getAttribute('aria-valuenow'))});};bar.addEventListener('pointermove',move);bar.addEventListener('pointerup',end);bar.addEventListener('pointercancel',end);});
$('#libraryResize').addEventListener('keydown',e=>{if(['ArrowLeft','ArrowRight'].includes(e.key)){e.preventDefault();store.setSettings({sidebarWidth:Math.max(224,Math.min(420,Number($('#libraryResize').getAttribute('aria-valuenow'))+(e.key==='ArrowRight'?16:-16)))});applyPreferences();}});
for(const event of ['online','offline'])window.addEventListener(event,()=>{$('#networkNotice').hidden=navigator.onLine;});
dj.onChange(()=>{if(location.hash==='#/dj'){const status=$('#djStatus');if(status)status.textContent=dj.state.message;const engine=$('#djEngine');if(engine)engine.textContent=dj.state.engine;syncDJVoice();if($('#djTracks'))$('#djTracks').innerHTML=dj.state.tracks.length?trackRows(dj.state.tracks,reg(dj.state.tracks)):'<p class="muted">Start DJ to build your queue.</p>';}});
dj.localModel.onChange(()=>{if($('#modelState'))$('#modelState').innerHTML=modelStatusHtml();});

/* ---------------- Spotify collections and Theme Studio ---------------- */
let themeUndo=null;
let pendingAccount=null,accountReviewBusy=false;
function accountStatus(message){const status=$('#accountConnectionStatus');if(status)status.textContent=message;}
function beginSpotifyConnection(){
  const nonce=[...crypto.getRandomValues(new Uint8Array(16))].map(b=>b.toString(16).padStart(2,'0')).join('');
  const urls=spotifyConnectionURLs(location.origin,nonce,syncKey()),phone=accountDevice!=='computer',browser=accountDevice==='iphone'?'Safari':accountDevice==='android'?'Firefox':'your browser';
  pendingAccount={nonce,window:null,started:Date.now()};
  const copy={icon:I.copy,label:'Copy Spotify browser link',sub:`Paste into ${browser}’s address bar to stay on the website.`,fn:async()=>{
    try{await navigator.clipboard.writeText(urls.browser);accountStatus(accountDevice==='iphone'?'Link copied. Paste it in Safari, sign in, tap Copy for Spot+, then come back and tap Paste from Spotify.':`Link copied. Paste it in ${browser}, sign in, then use the Spot+ helper’s Send to Spot+ button.`);toast('Browser link copied');}
    catch{openSheet({head:'<div class="sheet-title">Copy this browser link</div>',body:`<p class="sheet-note">Select and copy this link into ${browser}’s address bar.</p><input class="connection-link" aria-label="Spotify browser link" readonly value="${esc(urls.browser)}">`});}
  }};
  const login={icon:I.person,label:'Open Spotify sign-in',sub:'Sign in on accounts.spotify.com. Keep the helper enabled.',fn:()=>{
    const win=window.open(urls.login,'spotplus-spotify');pendingAccount.window=win;
    if(!win){accountStatus('The browser blocked the sign-in tab. Choose Copy Spotify browser link instead.');toast('Use Copy Spotify browser link');return;}
    accountStatus('Spotify sign-in opened. Waiting for the Spot+ helper on Spotify’s website…');
    setTimeout(()=>{if(pendingAccount?.nonce===nonce&&!pendingAccount.helperReady)accountStatus('No helper detected yet. If Spotify opened its app, return here and use Copy Spotify browser link. Enable the Spot+ helper in Safari/Firefox, then reload Spotify’s website.');},15000);
  }};
  if(accountDevice==='iphone'){
    // One tap. In Safari, open Spotify in a tab so the library returns by itself.
    // In the Home Screen app, jump to real Safari (extensions don't run in-app) and
    // offer Paste the moment the user comes back.
    navigator.clipboard?.writeText(urls.browser).catch(()=>{});
    awaitingPaste=true;
    if(isStandalone()){location.href='x-safari-'+urls.browser;accountStatus('Opening Safari… When the Spot+ panel says ready, tap Copy for Spot+ and come back.');return;}
    const win=window.open(urls.browser,'spotplus-spotify');pendingAccount.window=win;
    accountStatus(win?'Spotify opened. Sign in — your library comes back here by itself.':'Link copied. Paste it into Safari’s address bar.');
    return;
  }
  // Android and computer: one tap, same as iPhone. Spotify opens in a new tab with a
  // link back to this one, so the helper sends the library here automatically.
  navigator.clipboard?.writeText(urls.browser).catch(()=>{});
  if(phone)awaitingPaste=true;
  const win=window.open(urls.browser,'spotplus-spotify');pendingAccount.window=win;
  if(!win){copy.fn();return;}
  accountStatus(phone?'Spotify opened. Sign in, and your library comes back here. If the Spotify app opened instead, paste the copied link into Firefox.':'Spotify opened in a new tab. Sign in, and your library comes back here by itself.');
  setTimeout(()=>{if(pendingAccount?.nonce===nonce&&!pendingAccount.helperReady)accountStatus('Still waiting for the Spot+ helper on Spotify. Check that it’s installed and enabled, then reload Spotify.');},20000);
  void login;
}
let awaitingPaste=false;
function isStandalone(){return navigator.standalone===true||matchMedia('(display-mode: standalone)').matches;}
function openInSafari(url){if(isStandalone())location.href='x-safari-'+url;else window.open(url,'_blank','noopener');}
// Coming back from Spotify: one tap pastes (iOS requires the tap for clipboard access).
// Coming back from Spotify: show the paste box straight away.
document.addEventListener('visibilitychange',()=>{
  if(document.hidden||!awaitingPaste||accountReviewBusy||!sheet.hidden)return;
  showPasteSheet('Welcome back',false);
});
// iPhone's programmatic clipboard read shows a small Paste bubble that is easy to
// miss, so on iPhone we use a paste box: tap it, tap Paste, and the paste event hands
// us the text directly (the multi-MB text never has to sit in the field).
const IOS_DEVICE=connectionDevice(navigator.userAgent,navigator.platform,navigator.maxTouchPoints)==='iphone';
async function pasteSpotifyAccount(){
  if(!IOS_DEVICE&&navigator.clipboard?.readText){
    try{const text=await navigator.clipboard.readText();if(isLibraryText(text))return applyPastedLibrary(text);}catch{ /* Denied; use the paste box. */ }
  }
  showPasteSheet('Paste your Spotify library',true);
}
function showPasteSheet(title,focus){
  openSheet({head:`<div class="sheet-title">${esc(title)}</div>`,body:`<p class="sheet-note">On Spotify, tap <b>Copy for Spot+</b>. Then tap the box below and choose <b>Paste</b>.</p><textarea id="accountPasteField" class="connection-link paste-box" rows="3" aria-label="Paste your copied Spotify library" spellcheck="false" autocomplete="off" autocorrect="off" autocapitalize="off" placeholder="Tap here, then Paste"></textarea><p class="sheet-note" id="accountPasteStatus" role="status"></p>`});
  const field=$('#accountPasteField'),note=$('#accountPasteStatus');
  let done=false;
  const take=text=>{
    if(done)return true;
    if(!isLibraryText(text)){note.textContent=text?'That isn’t a Spot+ library. On Spotify, tap Copy for Spot+ again, then paste here.':'';return false;}
    done=true;field.value='';note.textContent='Library pasted';closeSheet();applyPastedLibrary(text);return true;
  };
  field.addEventListener('paste',event=>{
    const text=event.clipboardData?.getData('text/plain')||event.clipboardData?.getData('text')||'';
    if(text){event.preventDefault();take(text);}
  });
  field.addEventListener('input',()=>take(field.value));
  if(focus)field.focus();
}
async function applyPastedLibrary(text){
  try{accountStatus('Opening your copied library…');const raw=await decodeLibraryText(text);accountStatus('Library received. Review it before applying.');await reviewSpotifyAccount(raw);}
  catch(e){accountStatus(e.message);toast(e.message);}
}
function receiveSpotifyAccount(nonce){
  if(window.opener){pendingAccount={nonce,window:window.opener,started:Date.now()};setTimeout(()=>window.opener?.postMessage({type:'spotplus-receiver-ready',nonce},'https://open.spotify.com'),0);}
  return viewSpotifyAccount()+`<p class="connection-feedback" role="status">${window.opener?'Waiting for your library from Spotify. Keep its tab open.':'The browser disconnected the Spotify tab. Use Save library file on Spotify, then Import library file here.'}</p>`;
}
async function reviewSpotifyAccount(raw){
  if(accountReviewBusy)return false;
  accountReviewBusy=true;
  try{
    const snapshot=validateAccountSnapshot(raw),previous=store.getSpotifyAccount();
    const changed=previous&&previous.account.id!==snapshot.account.id;
    const readNotice=accountReadNotice(snapshot);
    const message=`${snapshot.account.name}: ${plural(snapshot.likes.length,'liked song')}, ${plural(snapshot.playlists.length,'playlist')}, ${plural(snapshot.albums.length,'album')} and ${plural(snapshot.artists.length,'artist')}. ${changed?'This replaces the other Spotify account’s copy on this device. ':''}${readNotice?readNotice+' ':''}Complete collections replace the Spotify copy, including removed songs. Your local Spot+ playlists and likes are kept. No changes are sent to Spotify.`;
    if(!await confirmBox('Apply this Spotify library?',message,'Apply library'))return false;
    store.setSpotifyAccount(snapshot);await store.flushSpotifyAccount();
    saveHistory(recentPlaysAsHistory(store.getSpotifyAccount())).catch(()=>{}); // Rewind grows automatically.awaitingPaste=false;toast('Spotify library saved on this device');go('#/spotify-account');return true;
  }catch(e){toast(e.message);return false;}finally{accountReviewBusy=false;}
}
window.addEventListener('message',async event=>{
  if(isAccountMessage(event,pendingAccount,'spotplus-connection-status')){
    pendingAccount.helperReady=true;
    const phase=event.data.phase;
    accountStatus(({ready:'Helper connected. Reading your Spotify library…',reading:'Reading your Spotify library…',done:'Library received. Review it before applying.',error:'The helper needs attention. Return to Spotify’s website to see its message.'})[phase]||'Spotify helper connected.');return;
  }
  if(!isAccountMessage(event,pendingAccount))return;
  const request=pendingAccount;
  if(await reviewSpotifyAccount(event.data.library)){
    event.source.postMessage({type:'spotplus-library-applied',nonce:request.nonce,syncKey:syncKey()},'https://open.spotify.com');
    if(pendingAccount===request)pendingAccount=null;
  }
});
$('#spotifyAccountImport').addEventListener('change',async event=>{
  const file=event.target.files?.[0];event.target.value='';if(!file)return;
  try{if(file.size>ACCOUNT_FILE_LIMIT)throw new Error('Choose a companion library file under 12 MB.');await reviewSpotifyAccount(JSON.parse(await file.text()));}catch(e){toast(e instanceof SyntaxError?'That file is not a valid JSON library.':e.message);}
});
function viewSpotifyHelper(){return `<div class="helper-page"><a class="link helper-back" href="#/spotify-account">← Spotify setup</a><div class="connect-heading"><span class="account-badge">Your music, together</span><h1>Install the Spot+ helper</h1><p>Add your library with a free browser extension.</p></div><div id="helperSetup">${helperInstallHtml(accountDevice)}</div></div>`;}
/* ---------------- Spotify links: no login, no install ---------------- */
function linksSetupHtml(){
  const state=cachedLinks(),lists=state?Object.values(state.playlists):[],has=role=>lists.some(p=>p.role===role);
  const chip=(on,label)=>`<span class="link-chip${on?' on':''}">${label}</span>`;
  const canPaste=!!navigator.clipboard?.readText;
  return `<section class="box links-setup"><span class="account-badge">No login · Nothing to install</span><h2>${state?'Spotify is connected':'Two links, one minute'}</h2>
  <p class="settings-note">${state?'Rewind, your profile and Made For You update by themselves. Add more links anytime.':'Copy two links from the Spotify app and paste them here. That’s it — Rewind, your profile and Made For You then update by themselves.'}</p>
  <ol class="links-steps"><li><b>Your profile:</b> in Spotify, tap your picture → <b>View profile</b> → <b>⋯</b> → <b>Copy link</b>.</li><li><b>On Repeat:</b> search “On Repeat” in Spotify → <b>⋯</b> → <b>Share</b> → <b>Copy link</b>.</li></ol>
  <p class="settings-note">Want more? Do the same for Your Top Songs, daylist or Discover Weekly.</p>
  <div class="links-paste"><textarea id="spotifyLinksField" rows="2" placeholder="Paste Spotify links here" aria-label="Spotify links" spellcheck="false" autocapitalize="off" autocorrect="off"></textarea>${canPaste?`<button class="btn" data-act="links-paste">Paste</button>`:''}<button class="btn primary" data-act="links-add">Add</button></div>
  <p class="connection-feedback" id="linksStatus" role="status"></p>
  <div class="link-chips">${chip(!!state?.profile,'Profile')}${chip(has('onRepeat'),'On Repeat')}${chip(has('topSongs'),'Your Top Songs')}${chip(has('daylist'),'daylist')}${chip(has('discoverWeekly'),'Discover Weekly')}</div>
  ${state?`<button class="link" data-act="links-clear">Disconnect Spotify</button>`:''}</section>`;
}
async function viewLinked(id){
  const state=await loadLinks();
  let p=state?.playlists?.[id];
  if(!p){
    let data=null;try{data=await fetchPublic({playlist:id});}catch{ /* Bridge not updated yet: use Spotify's own player. */ }
    if(!data)return (await viewSpotifyCollection('playlist',id))+'<p class="settings-note">Showing Spotify’s player because the song list couldn’t load right now.</p>';
    const known=spotify.collections.find(c=>c.id===id);
    p={id,name:data.name,cover:known?.cover||data.cover,tracks:data.tracks};
  }
  const tracks=await Promise.all(p.tracks.slice(0,100).map(async t=>{const a=await api.trackArtwork(t.artist.split(',')[0],t.title).catch(()=>null);return {id:'spotify:'+t.spotifyId,spotifyId:t.spotifyId,title:t.title,searchTitle:t.title,artist:t.artist,album:'',duration:t.duration,explicit:t.explicit,cover:a?.cover||'',coverXl:a?.coverXl||'',preview:a?.preview||''};}));
  const list=visibleTracks(tracks,store.getSettings()),k=reg(list);
  return header({cover:p.cover||list[0]?.coverXl,kicker:'From your Spotify',title:p.name,sub:`${list.length} songs · Updates automatically`})+actions(k)+trackRows(list,k,{numbered:p.role==='onRepeat'||p.role==='topSongs'});
}
function viewSpotifyAccount(){
 const account=store.getSpotifyAccount();
 return `<div class="connect-heading"><span class="account-badge">Your music, together</span><h1>${account||cachedLinks()?'Your Spotify':'Connect Spotify'}</h1><p>${account?'Your profile and music, saved on this device.':'Your top music, profile and Rewind, kept up to date for you.'}</p></div>
  ${account?`<section class="box"><div class="kicker">Library saved on this device</div>${spotifyProfileHtml(account.account)}<p class="muted">Last read from Spotify: ${esc(new Date(account.capturedAt).toLocaleString())}</p><div class="account-stats">${[['Liked songs',account.likes.length],['Playlists',account.playlists.length],['Albums',account.albums.length],['Artists',account.artists.length]].map(([label,n])=>`<div class="account-stat"><b>${n}</b><span>${label}</span></div>`).join('')}</div><div class="account-actions"><a class="btn primary" href="#/spotify-account/likes">${I.heartFill}Spotify Liked Songs</a><button class="btn" data-act="account-connect">Refresh from Spotify</button>${accountDevice==='iphone'?'<button class="btn" data-act="account-paste">Paste from Spotify</button>':''}<button class="btn" data-act="account-disconnect">Remove connection</button></div><p class="settings-note">This is your last saved library copy. Refresh while Spotify is open to get changes. Edits in Spot+ stay in Spot+.</p>${accountReadNotice(account)?`<p class="account-status">${esc(accountReadNotice(account))}</p>`:''}${account.skipped?`<p class="settings-note">${account.skipped} unsupported or unavailable items were skipped. The companion currently reads music tracks.</p>`:''}</section>`:''}

 ${linksSetupHtml()}
 <details class="connection-help helper-optional"><summary>More ways to connect (optional)</summary><p class="settings-note">Most people don’t need these. They copy your Liked Songs and saved playlists too.</p><details class="connection-help" ${account?'open':''}><summary>Browser helper — best on a computer</summary><div id="accountSetup">${setupHtml(accountDevice)}</div></details><details class="connection-help"><summary>Spotify data download — one-time copy</summary><p class="settings-note">Request <b>Account data</b> on <a href="https://www.spotify.com/account/privacy/" target="_blank" rel="noopener">Spotify’s privacy page</a>. When Spotify emails the ZIP, choose it here.</p><button class="btn" data-act="spotify-import">${I.import}Choose Spotify ZIP</button></details></details>
  ${account?.playlists.length?`<section><h2>Your Spotify playlists</h2><div class="account-cards">${account.playlists.map(p=>`<a class="card" href="#/spotify-account/playlist/${p.id}">${img(p.cover)}<div class="ctitle">${esc(p.title)}</div><div class="csub">${p.status==='unavailable'&&!p.tracks.length?'Tracks unavailable':p.tracks.length+' songs'}${p.status==='unavailable'&&p.tracks.length?' · Saved copy':p.status==='partial'?' · Incomplete read':''}</div></a>`).join('')}</div></section>`:''}

 `;
}
function viewSpotifyAccountList(id){
  const account=store.getSpotifyAccount();if(!account)return emptyState('Connect your Spotify library','Connect Spotify to see your saved music here.','Spotify account','#/spotify-account');
  const p=id==='likes'?{title:'Spotify Liked Songs',tracks:account.likes,status:account.likesUnreadable?'partial':'ready',unreadable:account.likesUnreadable}:account.playlists.find(x=>x.id===id);
  if(!p)return emptyState('Playlist not in this copy','Refresh your Spotify library to check for changes.','Spotify account','#/spotify-account');
  const tracks=visibleTracks(p.tracks,store.getSettings()),key=reg(tracks,{name:p.title});
  return header({cover:p.cover,coverHtml:p.cover?'':mosaic(tracks),kicker:'Spotify library copy',title:p.title,sub:`${esc(account.account.name)} · ${plural(tracks.length,'song')} · Updated ${esc(new Date(account.capturedAt).toLocaleDateString())}`})+(tracks.length?actions(key,`<button class="btn" data-act="save-list" data-key="${key}">${I.plus}Make editable copy</button><a class="btn" href="#/spotify-account">Refresh & account</a>`):'<div class="account-actions"><a class="btn" href="#/spotify-account">Refresh & account</a></div>')+(p.status==='unavailable'?'<p class="account-status">Spotify could not return this playlist on the last refresh. Any previous tracks have been kept.</p>':p.status==='partial'?'<p class="account-status">Song entries with incomplete details: '+p.unreadable+'. An existing copy of this collection is kept; otherwise, only readable songs are shown. Refresh from Spotify to try again.</p>':'')+trackRows(tracks,key);
}
function spotifyCard(p){const type=p.type||'playlist';return `<a class="card spotify-card" href="${type==='playlist'?'#/linked/'+p.id:'#/spotify/'+type+'/'+p.id}">${img(p.cover)}<div class="ctitle">${esc(p.title)}</div><div class="csub">Spotify · ${esc(p.category||'Shared link')}</div></a>`;}
function artistCollections(a){const official=spotify.collections.find(p=>p.artist?.toLowerCase()===a.name.toLowerCase());return `<section><h2>Featuring ${esc(a.name)}</h2><div class="artist-collections"><a class="collection-tile" href="#/radio/${a.id}">${img(a.picture)}<div><b>${esc(a.name)} Radio</b><small>Spot+ mix · Powered by Deezer</small></div>${I.radio}</a>${official?`<a class="collection-tile" href="#/spotify/playlist/${official.id}">${img(official.cover||a.picture)}<div><b>${esc(official.title)}</b><small>Official Spotify playlist</small></div>${I.arrow}</a>`:`<a class="collection-tile" href="#/essentials/${a.id}">${img(a.picture)}<div><b>${esc(a.name)} essentials</b><small>Popular tracks · Deezer</small></div>${I.play}</a>`}</div><a class="link" href="https://open.spotify.com/search/${encodeURIComponent('This Is '+a.name)}" target="_blank" rel="noopener">Find more artist playlists on Spotify ${I.arrow}</a></section>`;}
async function viewRadio(id){const [d,radio]=await Promise.all([api.artist(id),api.artistRadio(id)]);const tracks=visibleTracks(radio,store.getSettings()),key=reg(tracks,{name:d.artist.name+' Radio'});return header({cover:d.artist.pictureXl||d.artist.picture,kicker:'Artist radio · Spot+',title:d.artist.name+' Radio',sub:`A mix from Deezer’s artist radio · ${plural(tracks.length,'song')}`})+actions(key,`<button class="btn" data-act="save-list" data-key="${key}">${I.plus}Save as playlist</button>`)+trackRows(tracks,key);}
async function viewEssentials(id){const d=await api.artist(id),tracks=visibleTracks(d.top,store.getSettings()),key=reg(tracks,{name:d.artist.name+' essentials'});return header({cover:d.artist.picture,kicker:'Artist essentials · Deezer',title:d.artist.name+' essentials',sub:'Popular tracks from the Deezer catalog.'})+actions(key,`<button class="btn" data-act="save-list" data-key="${key}">Save as playlist</button>`)+trackRows(tracks,key);}
async function viewSpotify(){
  const linked=cachedLinks(),groups=['Charts','Editorial','Moods','Decades','This Is'];
  return `<div class="spotify-heading"><div><div class="kicker">Spotify</div><h1>Spotify collections</h1><p class="muted">Spotify’s playlists, playable in Spot+. No login needed.</p></div></div>
  ${linked?'':`<a class="link-cta" href="#/spotify-account"><span>${I.library}</span><div><b>Connect Spotify</b><small>Takes a minute. No login, nothing to install.</small></div>${I.arrow}</a>`}
  <form id="spotifyLinkForm" class="dj-request"><label class="sr-only" for="spotifyLink">Spotify playlist, artist, album or track link</label><input id="spotifyLink" type="url" required placeholder="Paste any Spotify playlist link"><button class="btn primary">Open</button></form>
  ${groups.map(g=>shelf(g,spotify.collections.filter(p=>p.category===g).map(spotifyCard))).join('')}
  ${store.getSpotifyLinks().length?shelf('Saved links',store.getSpotifyLinks().map(spotifyCard)):''}`;
}
async function viewSpotifyCollection(type,id){const known=spotify.collections.find(p=>p.id===id)||store.getSpotifyLinks().find(p=>p.id===id);let p;try{p=await spotify.metadata({type,id,...known});}catch{p={type,id,title:known?.title||'Spotify '+type,cover:known?.cover||''};}return header({cover:p.cover,kicker:'Spotify · '+type,title:p.title,sub:'Official Spotify player · Content and playback are provided by Spotify.'})+(type==='artist'?'<p class="spotify-counter" data-counter="artist" data-spotify-artist-id="'+id+'">Loading Spotify listeners…</p>':'')+`<div class="actions"><button class="btn white spotify-open" data-act="spotify-open-player" data-type="${type}" data-id="${id}">${I.play}Open Spotify player</button><button class="btn" data-act="spotify-save" data-type="${type}" data-id="${id}">${I.plus}Save link</button><a class="btn" href="${spotify.urlFor({type,id})}" target="_blank" rel="noopener">Open in Spotify ${I.arrow}</a></div><div id="spotifyPlayer"></div><p class="settings-note">Spotify’s player has its own queue. To bring your own playlist tracks into the Spot+ player, import your Spotify data from <a href="#/spotify">Spotify collections</a>.</p>`;}
function themeSettings(s){const p=themes.palette(s);return {themePreset:s.themePreset||'pine',themeCustom:{accent:p.accent,surface:p.surface,raised:p.raised},amoled:s.amoled!==false,cornerRadius:p.radius,coverStyle:s.coverStyle||'square',density:s.density,textSize:s.textSize,motion:s.motion};}
function downloadJson(data,name){const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'}));a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),5000);}
function themeModeSwitch(s){
  const mode=themes.MODES.includes(s.themeMode)?s.themeMode:(themes.presets.find(t=>t.id===s.themePreset)?.mode||'dark');
  return `<div class="mode-switch" role="group" aria-label="Appearance">${[['light','Light'],['dark','Dark'],['system','Auto']].map(([value,label])=>`<button data-act="theme-mode" data-mode="${value}" aria-pressed="${mode===value}">${label}</button>`).join('')}</div>`;
}
function themePresetGroups(s,p){
  const groups=[['Signature',t=>!t.material],['Material',t=>t.material&&!t.mode],['Light',t=>t.mode==='light']];
  return groups.map(([title,test])=>`<section><h2>${title}</h2><div class="theme-presets">${themes.presets.filter(test).map(t=>{const x=themes.palette({...s,themePreset:t.id,themeCustom:null,themeMode:t.mode||s.themeMode});const on=!s.themeCustom&&t.id===p.id;return `<button class="theme-preset${on?' selected':''}" data-act="theme-preset" data-id="${t.id}" aria-pressed="${on}"><div class="theme-swatch" style="--swatch-surface:${x.surface};--swatch-raised:${x.raised};--swatch-accent:${x.accent}"><span></span><i></i><b></b></div><strong>${t.name}</strong><small>${t.note}</small></button>`;}).join('')}</div></section>`).join('');
}
function viewThemes(){
  const s=store.getSettings(),p=themes.palette(s);if(!themeUndo)themeUndo={...themeSettings(s),density:s.density,textSize:s.textSize,motion:s.motion};
  return `<div class="studio-heading"><div><div class="kicker">Personalize</div><h1>Themes</h1><p class="muted">Pick a look or mix your own. Changes apply instantly.</p></div><div class="row-btns"><button class="btn" data-act="theme-undo">Undo this session</button><button class="btn primary" data-act="theme-save">Save theme</button></div></div><div class="studio-grid"><section class="studio-preview"><div class="studio-preview-top"><b id="themeLiveName">${s.themeCustom?'Your mix':p.name}</b><span>LIVE</span></div><div class="mini-workspace" aria-hidden="true"><div class="mini-sidebar"><span class="mini-dot"></span><i></i><i></i><i></i></div><div class="mini-main"><span class="mini-chip">Your library</span><h3>Made for your music</h3><div class="mini-art-row">${img(player.current()?.cover||'icons/icon-512.png')}${img(store.getLikes()[0]?.cover||'icons/icon-512.png')}</div><div class="mini-track"><span></span><b>Spot+</b><i>${I.play}</i></div></div></div><div class="studio-preview-bottom"><span id="themeContrast">${themes.contrast(p.accentText,p.raised).toFixed(1)}:1 accent text contrast</span><span>Auto contrast</span></div></section><section class="studio-controls"><h2>Make it yours</h2>${themeModeSwitch(s)}<label class="field"${p.mode==='light'?' hidden':''}><span>Pure black<small>True black backgrounds for OLED screens.</small></span><input type="checkbox" role="switch" data-setting="amoled" ${s.amoled!==false?'checked':''}></label><div class="color-controls">${[['accent','Accent',p.accent],['surface','Surface tint',p.surface],['raised','Control tint',p.raised]].map(([key,label,value])=>`<label><span>${label}</span><input type="color" data-theme-color="${key}" value="${value}" aria-label="${label} color"><small data-color-value="${key}">${value.toUpperCase()}</small></label>`).join('')}</div><label class="field"><span>Corner shape<small>Square to softly rounded.</small></span><input type="range" min="0" max="24" step="2" value="${p.radius}" data-setting="cornerRadius" aria-label="Corner roundness"></label><label class="field"><span>Album artwork</span><select data-setting="coverStyle"><option value="square" ${s.coverStyle!=='disc'?'selected':''}>Original square</option><option value="disc" ${s.coverStyle==='disc'?'selected':''}>Record circles</option></select></label><button class="btn" data-act="theme-remix">${I.shuffle}Remix a theme</button></section></div>${themePresetGroups(s,p)}<section class="box"><h2>Feel & readability</h2><div class="studio-comfort"><label class="field"><span>Spacing</span><select data-setting="density"><option value="comfortable" ${s.density==='comfortable'?'selected':''}>Comfortable</option><option value="compact" ${s.density==='compact'?'selected':''}>Compact</option></select></label><label class="field"><span>Text</span><select data-setting="textSize"><option value="normal" ${s.textSize==='normal'?'selected':''}>Default</option><option value="large" ${s.textSize==='large'?'selected':''}>Larger</option></select></label><label class="field"><span>Motion</span><select data-setting="motion"><option value="system" ${s.motion==='system'?'selected':''}>Follow system</option><option value="reduced" ${s.motion==='reduced'?'selected':''}>Reduced</option></select></label></div></section><section class="box"><div class="sec-head"><h2>Your theme collection</h2><div class="row-btns"><button class="btn small" data-act="theme-import">Import theme</button><button class="btn small" data-act="theme-export">Export current</button></div></div>${store.getThemes().length?`<div class="saved-themes">${store.getThemes().map(t=>`<button class="btn" data-act="theme-load" data-id="${esc(t.id)}">${esc(t.name)}</button>`).join('')}</div>`:'<p class="muted">Save a mix to keep it here. Theme files contain appearance settings only.</p>'}</section>`;
}
document.addEventListener('input',e=>{const input=e.target;if(input.dataset.themeColor){const s=store.getSettings(),p=themes.palette(s);store.setSettings({themeCustom:{accent:p.accent,surface:p.surface,raised:p.raised,[input.dataset.themeColor]:input.value}});const readout=$(`[data-color-value="${input.dataset.themeColor}"]`);if(readout)readout.textContent=input.value.toUpperCase();$$('.theme-preset').forEach(b=>{b.classList.remove('selected');b.setAttribute('aria-pressed','false');});}if(input.dataset.setting==='cornerRadius')store.setSettings({cornerRadius:Number(input.value)});});
document.addEventListener('submit',e=>{if(e.target.id==='spotifyLinkForm'){e.preventDefault();const parsed=spotify.parseSpotifyLink($('#spotifyLink').value);if(!parsed)return toast('Paste a full open.spotify.com playlist, artist, album or track link.');go(parsed.type==='playlist'?`#/linked/${parsed.id}`:`#/spotify/${parsed.type}/${parsed.id}`);}});

/* ---------------- Automatic Spotify stats ----------------
   The helper publishes encrypted snapshots whenever a Spotify web tab is open; Spot+
   picks up the newest on launch and when you come back to the app. */
function syncKey(){
  try{let key=localStorage.getItem('spotplus.syncKey');if(!validSyncKey(key)){key=newSyncKey();localStorage.setItem('spotplus.syncKey',key);}return key;}catch{return '';}
}
let lastPull=0;
async function pullSpotifyStats({force=false}={}){
  let key='';try{key=localStorage.getItem('spotplus.syncKey');}catch{ /* Ignore. */ }
  if(!validSyncKey(key)||(!force&&Date.now()-lastPull<5*60*1000)||!navigator.onLine)return false;
  lastPull=Date.now();
  const snapshot=await fetchSnapshot(key).catch(()=>null);
  if(!snapshot?.stats)return false;
  const changed=await store.setSyncedStats(snapshot);
  if(changed){
    saveHistory(recentPlaysAsHistory({stats:store.getSpotifyStats().stats})).catch(()=>{});
    if(location.hash==='#/rewind')route({keepScroll:true});
  }
  return changed;
}
setTimeout(()=>pullSpotifyStats(),1200);
loadLinks().then(state=>{if(!state)return;syncAvatars();if(location.hash===''||location.hash==='#/home')route({keepScroll:true});
  syncLinks().then(changed=>{if(changed&&['#/rewind','#/home',''].includes(location.hash))route({keepScroll:true});syncAvatars();}).catch(()=>{});});
document.addEventListener('visibilitychange',()=>{if(!document.hidden)syncLinks().then(changed=>{if(changed&&location.hash==='#/rewind')route({keepScroll:true});}).catch(()=>{});});
// Load listening history in the background so Rewind opens instantly.
(window.requestIdleCallback||setTimeout)(()=>warmRewind(),{timeout:3000});
document.addEventListener('visibilitychange',()=>{if(!document.hidden)pullSpotifyStats();});

/* ---------------- Jam ---------------- */
const jam=new Jam(player,{onToast:msg=>toast(msg),onChange:()=>{document.body.dataset.jam=jam.active?(jam.host?'host':'guest'):'';syncJamChip();if(location.hash==='#/jam')route({keepScroll:true});}});
function jamProfile(){return {name:profileName().slice(0,40),avatar:profilePhoto()};}
function jamGuestControl(action){
  if(!jam.active||jam.host)return false;
  if(!jam.guestControl){toast('Only the host can control playback in this Jam.');return true;}
  jam.control(action);return true;
}
function jamQR(code){try{const q=qrcode(0,'M');q.addData(jamLink(code));q.make();return q.createSvgTag({cellSize:5,margin:2,scalable:true});}catch{return '';}}
function syncJamChip(){
  let chip=$('#jamChip');
  if(!jam.active){chip?.remove();return;}
  if(!chip){chip=document.createElement('a');chip.id='jamChip';chip.className='jam-chip';chip.href='#/jam';document.body.append(chip);}
  chip.innerHTML=`${I.jam}<span>${jam.status==='connecting'?'Connecting…':'Jam · '+jam.members.length}</span>`;
}
function joinJamFromLink(code){
  code=code.toUpperCase();
  if(jam.code!==code)try{jam.join(code,jamProfile());}catch(e){toast(e.message);}
  history.replaceState(null,'','#/jam');
  return viewJam();
}
function viewJam(){
  if(!jam.active)return `<div class="jam-page"><section class="jam-hero"><div class="jam-orbs" aria-hidden="true"><span></span><span></span><span></span></div><p class="kicker">Spot+ Jam</p><h1>Listen together</h1><p>Start a Jam and everyone hears the same music at the same time, on their own phone. Friends can add songs to the queue.</p><p class="jam-private">No accounts and no servers. Phones connect directly through an encrypted network.</p><button class="btn primary big" data-act="jam-start">${I.jam}<span>Start a Jam</span></button></section>
  <section class="box jam-join"><h2>Join a Jam</h2><p class="settings-note">Enter the code from the host’s screen, or scan their QR code with your camera.</p><div class="jam-join-row"><input id="jamCode" maxlength="6" autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="ABC123" aria-label="Jam code" inputmode="text"><button class="btn primary" data-act="jam-join">Join</button></div></section></div>`;
  const people=jam.members.map(m=>`<li>${m.avatar?`<img src="${esc(safeImage(m.avatar))}" alt="">`:`<span class="jam-initial">${esc((m.name[0]||'?').toUpperCase())}</span>`}<b>${esc(m.name)}</b>${m.host?'<small>Host</small>':''}</li>`).join('');
  const now=player.current();
  return `<div class="jam-page"><section class="jam-hero live"><p class="kicker">${jam.status==='connecting'?'Connecting…':'Live now'}</p><h1>${jam.host?'Your Jam':'You’re in a Jam'}</h1>
  ${jam.host?`<div class="jam-qr">${jamQR(jam.code)}</div><div class="jam-code" aria-label="Jam code ${esc(jam.code.split('').join(' '))}">${esc(jam.code)}</div><button class="btn primary" data-act="jam-share">${I.share}<span>Invite friends</span></button>`:`<p>${now?`Listening to <b>${esc(now.title)}</b> · ${esc(now.artist)}`:'Waiting for the host to play something…'}</p><p class="settings-note">Tap any song to add it to the shared queue.</p>`}
  <div class="jam-reacts">${['🔥','❤️','🙌','😂','🎶'].map(e=>`<button data-act="jam-react" data-emoji="${e}" aria-label="Send ${e}">${e}</button>`).join('')}</div></section>
  <section class="box"><h2>${jam.members.length} listening</h2><ul class="jam-people">${people}</ul>
  ${jam.host?`<label class="field"><span>Listeners can control playback<small>Play, pause and skip for everyone.</small></span><input type="checkbox" role="switch" id="jamControl" ${jam.guestControl?'checked':''}></label>`:''}
  <button class="btn" data-act="jam-leave">${jam.host?'End Jam':'Leave Jam'}</button></section></div>`;
}

/* Artist pages: the name slides into a solid top bar once the photo scrolls away. */
// Plain opacity values (no CSS math), so every browser draws it the same.
let scrollFrame=0;
$('#main').addEventListener('scroll',()=>{
  if(scrollFrame)return;
  scrollFrame=requestAnimationFrame(()=>{
    scrollFrame=0;
    const main=$('#main'),top=main.scrollTop;
    main.classList.toggle('scrolled',top>4);
    const hero=$('.artist-hero');if(!hero)return;
    const progress=Math.min(1,Math.max(0,(top-hero.offsetHeight+150)/90));
    const bg=$('.artist-sticky-bg'),title=$('.artist-sticky-title');
    if(bg)bg.style.opacity=String(progress);
    if(title)title.style.opacity=String(progress);
    $('.artist-sticky')?.classList.toggle('solid',progress>.5);
    hero.querySelector('img')?.style.setProperty('transform',`translate3d(0,${Math.min(hero.offsetHeight,top*.35)}px,0) scale(1.03)`);
  });
},{passive:true});

/* ---------------- Instant navigation ----------------
   Start loading an artist, album or playlist the moment a finger touches the link
   (or a mouse hovers it), so the page is usually ready by the time it opens. */
const warmedPages=new Set();
function warmPage(target){
  const link=target?.closest?.('a[href^="#/artist/"],a[href^="#/album/"],a[href^="#/playlist/"]');
  const [,type,id]=link?.getAttribute('href').match(/^#\/(artist|album|playlist)\/(\d+)$/)||[];
  if(!type||warmedPages.has(type+id))return;
  warmedPages.add(type+id);api[type](id).catch(()=>warmedPages.delete(type+id));
}
document.addEventListener('pointerdown',e=>warmPage(e.target),{passive:true,capture:true});
document.addEventListener('pointerover',e=>{if(e.pointerType==='mouse')warmPage(e.target);},{passive:true});

/* ---------------- Wire up ---------------- */
$$('[data-icon]').forEach((el) => setIcon(el, el.dataset.icon));
player.on('state', syncPlayer);
player.on('time', syncTime);
player.on('error', (msg) => toast(msg));
store.onChange((key) => {
  const h = location.hash;
  if(key==='settings'){applyPreferences();if(!store.getSettings().djVoice)dj.voice.cancelSpeech();}
  if (key === 'likes') { syncPlayer(); if (h === '#/liked' || h === '#/library') route({ keepScroll: true }); }
  if (key === 'playlists' && (h === '#/library' || h.startsWith('#/my/') || h.startsWith('#/folder/'))) route({ keepScroll: true });
  if(key==='folders'&&(h==='#/library'||h.startsWith('#/folder/')))route({keepScroll:true});
  if (key === 'downloads' && (h === '#/downloads' || h === '#/library')) route({ keepScroll: true });
  if(['likes','playlists','folders','albums','artists','downloads','pins','localFiles','spotifyLinks','spotifyAccount'].includes(key))renderSidebar();
  if(key==='spotifyAccount'||key==='spotifyStats')syncAvatars();
  if(key==='spotifyAccount'&&(h.startsWith('#/spotify-account')||h==='#/library'||h==='#/settings'||h==='#/profile'))route({keepScroll:true});
  if(key==='localFiles'&&h==='#/local')route({keepScroll:true});
});
document.addEventListener('error',event=>{if(event.target instanceof HTMLImageElement&&event.target.closest('.spotify-profile-photo'))event.target.hidden=true;},true);
window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); installEvt = e; const b = $('#installBtn'); if (b) b.hidden = false; });
if ('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('./sw.js',{updateViaCache:'none'}).catch((e) => console.warn('SW failed', e));
/* ---------------- Notifications ---------------- */
let hadController=!!navigator.serviceWorker?.controller,updateShown=false;
navigator.serviceWorker?.addEventListener('controllerchange',()=>{
  if(!hadController){hadController=true;return;}
  if(updateShown||!store.getSettings().notifyUpdates)return;updateShown=true;
  if(document.hidden){let st=notify.loadState();if(notify.canSend(st,'update')){notify.show({title:'Spot+ was updated',body:'Open Spot+ to get the newest version.'},'update');notify.saveState(notify.markSent(st,'update'));}}
  else toast('A new version of Spot+ is ready.',{sticky:true,action:{label:'Update',run:()=>location.reload()}});
});
navigator.serviceWorker?.addEventListener('message',e=>{if(e.data?.type==='open'&&e.data.url)go(e.data.url);});
async function deliver(kind,msg){
  if(!msg)return;
  let st=notify.loadState();const visible=!document.hidden;
  if(!notify.canSend(st,kind,Date.now(),{visible}))return;
  const sent=visible?(toast(msg.title+' — '+msg.body,{action:{label:'Open',run:()=>go(msg.url)}}),true):await notify.show(msg,kind);
  if(sent)notify.saveState(notify.markSent(notify.loadState(),kind));
}
let notifyBusy=false;
async function runNotifyChecks(){
  if(notifyBusy||!navigator.onLine)return;notifyBusy=true;
  try{
    const s=store.getSettings();let st=notify.loadState();
    if(s.notifyReleases&&!(st.releasesChecked>Date.now()-12*3600000)){
      const artists=store.getArtists().slice(0,30),byArtist={};
      for(const a of artists){try{byArtist[a.id]=await api.artistReleases(a.id);}catch{/* skip this artist */}}
      const {fresh,seen}=notify.pickNewReleases(st.seen||{},byArtist);
      st={...notify.loadState(),seen,releasesChecked:Date.now()};notify.saveState(st);
      await deliver('release',notify.releaseMessage(fresh));
    }
    if(s.notifyStats&&new Date().getDay()===0&&new Date().getHours()>=17)await deliver('stats',notify.weeklyRecap(await readHistory().catch(()=>[])));
  }finally{notifyBusy=false;}
}
setTimeout(runNotifyChecks,8000);setInterval(runNotifyChecks,3*3600000);
document.addEventListener('visibilitychange',()=>{if(!document.hidden)setTimeout(runNotifyChecks,3000);});

player.restore();
applyPreferences();
vol.value=Math.round(player.el.volume*100);
vol.style.setProperty('--p',vol.value+'%');
syncPlayer();
syncTime();
route();
api.instances().catch(() => {});

function dismissWelcome(){try{localStorage.setItem('spotplus.welcome','1');}catch{ /* Private mode. */ }}
// First launch (and first launch from the Home Screen): the tutorial slider.
{
  const standalone=isStandalone(),device=connectionDevice(navigator.userAgent,navigator.platform,navigator.maxTouchPoints);
  const deepLink=/spotify-account|#\/jam\//.test(location.hash);
  if(!deepLink&&shouldOnboard({standalone}))setTimeout(()=>showOnboarding({icons:I,standalone,platform:device,currentMode:store.getSettings().themeMode||'dark',
    canInstall:()=>!!installEvt,install:async()=>{if(!installEvt)return;installEvt.prompt();await installEvt.userChoice.catch(()=>{});installEvt=null;},
    onTheme:patch=>store.setSettings(patch),onConnect:()=>go('#/spotify-account'),onRestore:()=>$('#welcomeBackup').click()}),400);
}
window.dispatchEvent(new Event('spotplus-ready'));
let intentTimer;
document.addEventListener('pointerover',event=>{const target=event.target.closest('[data-act="track-play"]');if(!target||store.getSettings().preloadNext===false)return;clearTimeout(intentTimer);intentTimer=setTimeout(()=>api.prewarm(listOf(target.dataset.key).tracks[+target.dataset.i]),140);});
document.addEventListener('pointerdown',event=>{const target=event.target.closest('[data-act="track-play"]');if(target&&store.getSettings().preloadNext!==false)api.prewarm(listOf(target.dataset.key).tracks[+target.dataset.i]);},{passive:true});

setTimeout(()=>dj.voice.warmVoice(),1200);

bindPlayerDismiss(document.getElementById('np'),()=>closeNP());
